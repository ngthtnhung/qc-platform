/**
 * Xác thực nhóm: mỗi người một token cá nhân (qa_...), server chỉ lưu băm SHA-256.
 * Vai trò: admin (quản lý môi trường, mật khẩu, đẩy rule) và member (dùng, thêm tài khoản, sửa link).
 * Chưa có người dùng nào: server chạy chế độ một người, chỉ cho phép nghe trên 127.0.0.1.
 */
import crypto from 'node:crypto';
import { db } from '../../database/db.js';

export const ROLES = ['admin', 'member'];
export const PERMS = ['environments', 'secrets', 'rules', 'rules_edit', 'automation', 'automation_push']; // automation_push: chỉ đẩy tác vụ nháp; automation: duyệt, gỡ // quyền lẻ có thể cấp cho member
const hash = t => crypto.createHash('sha256').update(t).digest('hex');

export async function hasUsers() {
  return (await db.find('team_users', u => u.is_active === 1)).length > 0;
}

/** Tạo người dùng, trả token một lần duy nhất (không lưu lại được) */
export async function createUser(name, role = 'member') {
  if (!ROLES.includes(role)) throw new Error(`Vai trò phải là ${ROLES.join(' hoặc ')}`);
  const token = 'qa_' + crypto.randomBytes(24).toString('base64url');
  const user = await db.insert('team_users', {
    display_name: name, role, token_hash: hash(token), is_active: 1, type: 'USER'
  });
  return { user, token };
}

export async function resetToken(id) {
  const token = 'qa_' + crypto.randomBytes(24).toString('base64url');
  await db.update('team_users', id, { token_hash: hash(token) });
  return token;
}

export async function revokeUser(id) { return db.update('team_users', id, { is_active: 0 }); }

export async function authenticate(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const h = Buffer.from(hash(m[1]));
  const users = await db.find('team_users', u => u.is_active === 1);
  const u = users.find(x => { const b = Buffer.from(x.token_hash); return b.length === h.length && crypto.timingSafeEqual(b, h); });
  return u ? { id: u.id, display_name: u.display_name, role: u.role, perms: u.perms || [], type: 'USER', email: '' } : null;
}

/** Đổi vai trò và/hoặc quyền lẻ. Không cho hạ admin cuối cùng. */
export async function setUserAccess(id, { role, perms }) {
  const u = await db.findById('team_users', id);
  if (!u) throw new Error('Không thấy người dùng');
  const updates = {};
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
  return db.update('team_users', id, updates);
}
