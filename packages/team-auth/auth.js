/**
 * Xác thực nhóm: hỗ trợ đăng nhập bằng Tài khoản (username) & Mật khẩu (password),
 * đồng thời giữ tương thích Bearer token (qa_...) cho phiên trình duyệt và QA Launcher.
 * Vai trò: admin (quản lý môi trường, mật khẩu, đẩy rule) và member (dùng, thêm tài khoản, sửa link).
 * Chưa có người dùng nào: server chạy chế độ một người, chỉ cho phép nghe trên 127.0.0.1.
 */
import crypto from 'node:crypto';
import { db } from '../../database/db.js';

export const ROLES = ['admin', 'member'];
export const PERMS = ['environments', 'secrets', 'rules', 'rules_edit', 'automation', 'automation_push'];
const hash = t => crypto.createHash('sha256').update(String(t || '')).digest('hex');

export const normalizeUsername = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim().replace(/\s+/g, '');

export function hashPassword(password) {
  return hash('qa_pw_v1:' + String(password || ''));
}

export async function hasUsers() {
  return (await db.find('team_users', u => u.is_active === 1)).length > 0;
}

/** Tạo người dùng với username và password, đồng thời tạo session token */
export async function createUser(name, role = 'member', username = '', password = '', employee_code = '') {
  if (!ROLES.includes(role)) throw new Error(`Vai trò phải là ${ROLES.join(' hoặc ')}`);
  const cleanName = String(name || '').trim();
  const cleanUser = normalizeUsername(username || cleanName);
  if (!cleanUser) throw new Error('Cần nhập tên tài khoản đăng nhập');
  const existing = await db.find('team_users', u => u.is_active === 1 && normalizeUsername(u.username || u.display_name) === cleanUser);
  if (existing.length) throw new Error(`Tài khoản "${cleanUser}" đã tồn tại`);
  const pw = String(password || '123456');
  if (pw.length < 4) throw new Error('Mật khẩu phải từ 4 ký tự trở lên');
  const token = 'qa_' + crypto.randomBytes(24).toString('base64url');
  const user = await db.insert('team_users', {
    display_name: cleanName || cleanUser,
    username: cleanUser,
    password_hash: hashPassword(pw),
    role,
    employee_code: String(employee_code || '').trim(),
    token_hash: hash(token),
    session_token: token,
    is_active: 1,
    type: 'USER'
  });
  return { user, token };
}

/** Đăng nhập bằng tài khoản (username hoặc tên hiển thị) và mật khẩu */
export async function loginWithPassword(username, password) {
  const cleanUser = normalizeUsername(username);
  const pw = String(password || '');
  if (!cleanUser || !pw) throw new Error('Vui lòng nhập đầy đủ tài khoản và mật khẩu.');
  const users = await db.find('team_users', u => u.is_active === 1);
  const u = users.find(x => normalizeUsername(x.username) === cleanUser || normalizeUsername(x.display_name) === cleanUser);
  if (!u) throw new Error('Tài khoản hoặc mật khẩu không đúng.');
  const expectedHash = u.password_hash || hashPassword('123456');
  const a = Buffer.from(expectedHash);
  const b = Buffer.from(hashPassword(pw));
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) throw new Error('Tài khoản hoặc mật khẩu không đúng.');
  let token = u.session_token;
  if (!token || hash(token) !== u.token_hash) {
    token = 'qa_' + crypto.randomBytes(24).toString('base64url');
    await db.update('team_users', u.id, {
      username: u.username || normalizeUsername(u.display_name),
      password_hash: expectedHash,
      token_hash: hash(token),
      session_token: token
    });
  }
  return {
    token,
    user: {
      id: u.id,
      username: u.username || normalizeUsername(u.display_name),
      display_name: u.display_name,
      employee_code: u.employee_code || '',
      nickname: u.nickname || '',
      job_title: u.job_title || '',
      joined_at: u.joined_at || '',
      avatar: u.avatar || '',
      role: u.role,
      perms: u.perms || [],
      type: 'USER',
      email: ''
    }
  };
}

export async function setPassword(id, password, username, employee_code) {
  const u = await db.findById('team_users', id);
  if (!u) throw new Error('Không thấy người dùng');
  const updates = {};
  if (employee_code !== undefined) {
    updates.employee_code = String(employee_code || '').trim();
  }
  if (username !== undefined && String(username).trim()) {
    const cleanUser = normalizeUsername(username);
    const dup = await db.find('team_users', x => x.is_active === 1 && x.id !== id && normalizeUsername(x.username || x.display_name) === cleanUser);
    if (dup.length) throw new Error(`Tài khoản "${cleanUser}" đã tồn tại`);
    updates.username = cleanUser;
  }
  if (password !== undefined && String(password) !== '') {
    if (String(password).length < 4) throw new Error('Mật khẩu phải từ 4 ký tự trở lên');
    updates.password_hash = hashPassword(password);
    const token = 'qa_' + crypto.randomBytes(24).toString('base64url');
    updates.token_hash = hash(token);
    updates.session_token = token;
  }
  return db.update('team_users', id, updates);
}

export async function resetToken(id) {
  const token = 'qa_' + crypto.randomBytes(24).toString('base64url');
  await db.update('team_users', id, { token_hash: hash(token), session_token: token });
  return token;
}

export async function revokeUser(id) { return db.update('team_users', id, { is_active: 0 }); }

export async function authenticate(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const h = Buffer.from(hash(m[1]));
  const users = await db.find('team_users', u => u.is_active === 1);
  const u = users.find(x => { const b = Buffer.from(x.token_hash || ''); return b.length === h.length && crypto.timingSafeEqual(b, h); });
  return u ? {
    id: u.id,
    username: u.username || normalizeUsername(u.display_name),
    display_name: u.display_name,
    employee_code: u.employee_code || '',
    nickname: u.nickname || '',
    job_title: u.job_title || '',
    joined_at: u.joined_at || '',
    avatar: u.avatar || '',
    role: u.role,
    perms: u.perms || [],
    type: 'USER',
    email: ''
  } : null;
}

/** Đổi vai trò và/hoặc quyền lẻ, mã nhân viên. Không cho hạ admin cuối cùng. */
export async function setUserAccess(id, { role, perms, username, password, employee_code }) {
  const u = await db.findById('team_users', id);
  if (!u) throw new Error('Không thấy người dùng');
  const updates = {};
  if (employee_code !== undefined) {
    updates.employee_code = String(employee_code || '').trim();
  }
  if (role !== undefined) {
    if (!ROLES.includes(role)) throw new Error(`Vai trò phải là ${ROLES.join(' hoặc ')}`);
    if (u.role === 'admin' && role !== 'admin') {
      const admins = (await db.find('team_users', x => x.is_active === 1 && x.role === 'admin')).length;
      if (admins <= 1) throw new Error('Không thể hạ quản trị viên cuối cùng');
    }
    updates.role = role;
  }
  if (perms !== undefined) {
    if (!Array.isArray(perms) || perms.some(p => !PERMS.includes(p))) throw new Error(`Quyền hợp lệ: ${PERMS.join(', ')}`);
    updates.perms = [...new Set(perms)];
  }
  if (username !== undefined && String(username).trim()) {
    const cleanUser = normalizeUsername(username);
    const dup = await db.find('team_users', x => x.is_active === 1 && x.id !== id && normalizeUsername(x.username || x.display_name) === cleanUser);
    if (dup.length) throw new Error(`Tài khoản "${cleanUser}" đã tồn tại`);
    updates.username = cleanUser;
  }
  if (password !== undefined && String(password) !== '') {
    if (String(password).length < 4) throw new Error('Mật khẩu phải từ 4 ký tự trở lên');
    updates.password_hash = hashPassword(password);
  }
  return db.update('team_users', id, updates);
}
