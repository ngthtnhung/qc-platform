/**
 * Internal AI QA Testing Platform - Backend API Server
 * Zero-dependency native HTTP server serving RESTful API /api/v1 and static Web Dashboard.
 * Defined in Section 8 of System Design v1.0.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { db } from '../../database/db.js';
import { PolicyEngine } from '../../packages/policy-engine/policy-engine.js';
import { BugAnalyzer } from '../ai-service/bug-analyzer.js';
import { CheckpointManager } from '../workflow-orchestrator/checkpoint-manager.js';
import { browserRunner } from '../automation-runner/browser-runner.js';
import { getRoutes, parseRouteLines } from '../../packages/account-routes/routes.js';
import { SecretVault, VAULT_ENV_TYPES } from '../../packages/secret-vault/vault.js';
import { authenticate, hasUsers, setUserAccess, createUser, resetToken, revokeUser } from '../../packages/team-auth/auth.js';
import { normalizeTask, normalizeParams, mergeParams, chooseAccount, isRunnable, FILE_ID } from '../../packages/automation-tasks/tasks.js';
import { BugStore, similarRules, guessModule, moduleMembers } from '../../packages/bug-search/search.js';
import { buildBundle } from '../../packages/kb-sync/bundle.js';
import { analyzeLocal, analyzeAI } from '../../packages/bug-search/analysis.js';
import { BusinessRuleStore } from '../ai-service/business-rule-store.js';
import { startBugLive } from '../../packages/haraworks-live/index.js';
import { getBugDetail } from '../../packages/haraworks-live/detail.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIR = path.join(__dirname, '../../apps/web');

const PORT = process.env.PORT || 3001;

// Default authenticated QC user context
const LOCAL_USER = {
  id: 'usr_qc_lead',
  display_name: 'QC Tester (Me)',
  email: 'qc.tester@erp.local',
  role: 'QC',
  type: 'USER'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, Correlation-Id'
  });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function serveStaticFile(res, filePath, contentType) {
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType
    });
    res.end(content);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

const HOST = process.env.HOST || '127.0.0.1';

// ---- File người dùng tải lên để tác vụ đính kèm (ảnh, PDF): lưu ở database/automation-files, tối đa 10 MB, xóa sau 14 ngày
const FILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/automation-files');
const MAX_FILE = 10 * 1024 * 1024;
// Loại file được phép đính kèm: nhận dạng theo nội dung (không tin đuôi file), đuôi chỉ để phân biệt các loại cùng khuôn (zip, OLE, văn bản)
const ZIP_TYPES = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip' };
const OLE_TYPES = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
const TEXT_TYPES = { txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', log: 'text/plain' };
const sniff = (b, name = '') => {
  const hex = b.subarray(0, 12).toString('hex');
  const ext = (String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
  if (hex.startsWith('89504e47')) return ['image/png', 'png'];
  if (hex.startsWith('ffd8ff')) return ['image/jpeg', 'jpg'];
  if (hex.startsWith('47494638')) return ['image/gif', 'gif'];
  if (hex.startsWith('52494646') && b.subarray(8, 12).toString() === 'WEBP') return ['image/webp', 'webp'];
  if (hex.startsWith('424d')) return ['image/bmp', 'bmp'];
  if (b.subarray(0, 4).toString() === '%PDF') return ['application/pdf', 'pdf'];
  if (hex.startsWith('504b0304') && ZIP_TYPES[ext]) return [ZIP_TYPES[ext], ext];
  if (hex.startsWith('d0cf11e0a1b11ae1') && OLE_TYPES[ext]) return [OLE_TYPES[ext], ext];
  if (b.subarray(0, 5).toString() === '{\\rtf') return ['application/rtf', 'rtf'];
  if (TEXT_TYPES[ext] && !b.subarray(0, 8192).includes(0)) return [TEXT_TYPES[ext], ext];
  return null; // không phải loại được phép (ví dụ chương trình, script, file có macro)
};
const uploadTimes = new Map();
function allowUpload(userId) {
  const now = Date.now(), list = (uploadTimes.get(userId) || []).filter(t => now - t < 600000);
  if (list.length >= 30) { uploadTimes.set(userId, list); return false; }
  list.push(now); uploadTimes.set(userId, list); return true;
}
const fileIds = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
async function filesExist(ids) { for (const id of ids) { if (!FILE_ID.test(id) || !(await db.findById('automation_files', id))) return false; } return true; }

// Lượt chạy nhiều lần: { id, index, total }, chỉ nhận dạng an toàn, tối đa 50 lần
const cleanBatch = b => (b && /^[a-z0-9]{1,24}$/i.test(String(b.id)) && Number.isInteger(b.index) && Number.isInteger(b.total) && b.total >= 1 && b.total <= 50 && b.index >= 1 && b.index <= b.total)
  ? { id: String(b.id), index: b.index, total: b.total } : null;
// Giới hạn tốc độ trong bộ nhớ: tối đa 120 lần bắt đầu chạy trong 10 phút cho mỗi người dùng
const runTimes = new Map();
function allowRun(userId) {
  const now = Date.now(), list = (runTimes.get(userId) || []).filter(t => now - t < 600000);
  if (list.length >= 120) { runTimes.set(userId, list); return false; }
  list.push(now); runTimes.set(userId, list); return true;
}
const handler = async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = urlObj.pathname;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key, Correlation-Id'
    });
    return res.end();
  }

  try {
    await db.init();

    // Xác thực: khi đã có người dùng nhóm thì mọi API (trừ health) cần token
    const authRequired = await hasUsers();
    const authedUser = await authenticate(req);
    if (authRequired && pathname.startsWith('/api/v1/') && pathname !== '/api/v1/health' && !authedUser) {
      return sendJson(res, 401, { success: false, error: { code: 'AUTH_REQUIRED', message: 'Cần đăng nhập bằng token cá nhân.' } });
    }
    const DEFAULT_QC_USER = authedUser || LOCAL_USER; // người thực hiện, dùng cho kiểm toán
    // Admin có mọi quyền; member chỉ có quyền lẻ được cấp: environments, secrets, rules
    const requireAdmin = (perm) => {
      const need = [].concat(perm || []);
      const ok = DEFAULT_QC_USER.role === 'admin' || need.some(p => (DEFAULT_QC_USER.perms || []).includes(p));
      if (authRequired && !ok) {
        sendJson(res, 403, { success: false, error: { code: 'ADMIN_ONLY', message: 'Chỉ quản trị viên được làm việc này.' } });
        return false;
      }
      return true;
    };
    if (pathname === '/api/v1/team/users' && method === 'GET') {
      if (!requireAdmin()) return;
      return sendJson(res, 200, { success: true, data: (await db.find('team_users')).map(u => ({ id: u.id, display_name: u.display_name, role: u.role, perms: u.perms || [], is_active: u.is_active, created_at: u.created_at, is_me: u.id === DEFAULT_QC_USER.id })) });
    }
    if (pathname === '/api/v1/team/users' && method === 'POST') {
      if (!requireAdmin()) return;
      const body = await parseJsonBody(req);
      try {
        const name = String(body.name || '').trim();
        if (!name || name.length > 80) throw new Error('Tên người dùng 1 đến 80 ký tự');
        const { user, token } = await createUser(name, body.role || 'member');
        let u = user;
        if (Array.isArray(body.perms) && body.perms.length) u = await setUserAccess(user.id, { perms: body.perms });
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'USER_CREATE', decision: 'ALLOW', reason: `${user.id} (${name}), role=${u.role}`, correlationId: `corr_user_${user.id}` });
        return sendJson(res, 201, { success: true, data: { id: user.id, display_name: name, role: u.role, perms: u.perms || [], token } });
      } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
    }
    let um;
    if ((um = /^\/api\/v1\/team\/users\/([^/]+)\/(reset-token|revoke)$/.exec(pathname)) && method === 'POST') {
      if (!requireAdmin()) return;
      const uid = um[1];
      const target = await db.findById('team_users', uid);
      if (!target) return sendJson(res, 404, { success: false, error: { message: 'Không thấy người dùng' } });
      if (um[2] === 'revoke') {
        if (uid === DEFAULT_QC_USER.id) return sendJson(res, 400, { success: false, error: { message: 'Không thể tự thu hồi chính mình' } });
        const admins = (await db.find('team_users', x => x.is_active === 1 && x.role === 'admin')).length;
        if (target.role === 'admin' && target.is_active === 1 && admins <= 1) return sendJson(res, 400, { success: false, error: { message: 'Không thể thu hồi quản trị viên cuối cùng' } });
        await revokeUser(uid);
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'USER_REVOKE', decision: 'ALLOW', reason: uid, correlationId: `corr_user_${uid}` });
        return sendJson(res, 200, { success: true, data: { id: uid, is_active: 0 } });
      }
      const token = await resetToken(uid);
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'USER_RESET_TOKEN', decision: 'ALLOW', reason: uid, correlationId: `corr_user_${uid}` });
      return sendJson(res, 200, { success: true, data: { id: uid, token } });
    }
    if (/^\/api\/v1\/team\/users\/[^/]+$/.test(pathname) && method === 'PUT') {
      if (!requireAdmin()) return;
      const uid = pathname.split('/')[5];
      const body = await parseJsonBody(req);
      try {
        const u = await setUserAccess(uid, { role: body.role, perms: body.perms });
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'USER_ACCESS_CHANGE', decision: 'ALLOW', reason: `${uid}: role=${u.role}, perms=${(u.perms || []).join(',') || '-'}`, correlationId: `corr_user_${uid}` });
        return sendJson(res, 200, { success: true, data: { id: u.id, role: u.role, perms: u.perms || [] } });
      } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
    }
    if (pathname === '/api/v1/me' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: { ...DEFAULT_QC_USER, auth_required: authRequired } });
    }

    // ==========================================
    // 1. Environments API
    // ==========================================
    if (pathname === '/api/v1/environments' && method === 'GET') {
      const envs = await db.find('environment_profiles', e => e.is_active === 1);
      return sendJson(res, 200, { success: true, data: envs });
    }

    if (pathname === '/api/v1/environments' && method === 'POST') {
      if (!requireAdmin('environments')) return;
      const body = await parseJsonBody(req);
      const id = body.id || `env_${Date.now()}`;
      const record = await db.insert('environment_profiles', {
        id,
        name: body.name || id,
        base_url: body.base_url || '',
        login_url: body.login_url || body.base_url || '',
        environment_type: body.environment_type || 'STAGING',
        allowed_actions: JSON.stringify(body.allowed_actions || ['READ', 'REPRODUCE']),
        requires_org_confirmation: body.environment_type === 'PRODUCTION_TEST' ? 1 : 0,
        org_identifier: body.org_identifier || 'org-default',
        is_active: 1
      });
      return sendJson(res, 201, { success: true, data: record });
    }

    if (pathname.startsWith('/api/v1/environments/') && method === 'PUT') {
      if (!requireAdmin('environments')) return;
      const id = pathname.split('/').pop();
      const body = await parseJsonBody(req);
      const updated = await db.update('environment_profiles', id, {
        name: body.name,
        base_url: body.base_url,
        login_url: body.login_url,
        org_identifier: body.org_identifier
      });
      return sendJson(res, 200, { success: true, data: updated });
    }

    if (pathname.startsWith('/api/v1/environments/') && method === 'DELETE') {
      if (!requireAdmin('environments')) return;
      const id = pathname.split('/').pop();
      await db.delete('environment_profiles', id);
      return sendJson(res, 200, { success: true, message: `Deleted environment ${id}` });
    }

    // ==========================================
    // 2. Accounts API
    // ==========================================
    if (pathname === '/api/v1/accounts' && method === 'GET') {
      const accounts = await db.find('account_profiles', a => a.is_active === 1);
      // Không bao giờ trả mật khẩu: chỉ cho biết đã lưu hay chưa
      const envMap = new Map((await db.find('environment_profiles', () => true)).map(e => [e.id, e]));
      return sendJson(res, 200, { success: true, data: accounts.map(a => ({
        ...a, has_secret: SecretVault.has(a.id), secret_updated_at: SecretVault.updatedAt(a.id),
        routes: envMap.has(a.environment_profile_id) ? getRoutes(a, envMap.get(a.environment_profile_id)) : []
      })) });
    }

    if (pathname === '/api/v1/accounts' && method === 'POST') {
      const body = await parseJsonBody(req);
      const record = await db.insert('account_profiles', {
        name: body.name || body.role,
        role: body.role,
        environment_profile_id: body.environment_profile_id,
        username_ref: body.username,
        secret_ref: 'NONE',
        expected_org_ref: body.expected_org || '',
        default_route: body.default_route || '/maintenance/tickets',
        is_active: 1
      });
      if (body.password) {
        const envOfAcc = await db.findById('environment_profiles', record.environment_profile_id);
        if (envOfAcc && VAULT_ENV_TYPES.includes(envOfAcc.environment_type)) {
          SecretVault.set(record.id, String(body.password));
          await db.update('account_profiles', record.id, { secret_ref: 'VAULT' });
        }
      }
      return sendJson(res, 201, { success: true, data: { ...record, has_secret: SecretVault.has(record.id) } });
    }

    // Sửa danh sách link của tài khoản: body { text: "Tên | URL" mỗi dòng } hoặc { routes: [{name,url}] }
    if (/^\/api\/v1\/accounts\/[^/]+\/routes$/.test(pathname) && method === 'PUT') {
      const id = pathname.split('/')[4];
      const acc = await db.findById('account_profiles', id);
      const accEnv = acc && await db.findById('environment_profiles', acc.environment_profile_id);
      if (!acc || !accEnv) return sendJson(res, 404, { success: false, error: { message: 'Không tìm thấy tài khoản' } });
      const body = await parseJsonBody(req);
      const text = body.text ?? (body.routes || []).map(r => `${r.name || ''} | ${r.url}`).join('\n');
      const { routes, errors } = parseRouteLines(text, accEnv);
      if (errors.length) return sendJson(res, 400, { success: false, error: { message: errors.join('; ') } });
      if (!routes.length) return sendJson(res, 400, { success: false, error: { message: 'Cần ít nhất một link' } });
      await db.update('account_profiles', id, { routes, default_route: routes[0].url });
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'ROUTES_UPDATE', decision: 'ALLOW', reason: `Cập nhật ${routes.length} link cho ${id}`, correlationId: `corr_routes_${id}` });
      return sendJson(res, 200, { success: true, data: { routes } });
    }

    // Lưu / xóa mật khẩu (ghi một chiều). Chỉ Staging và Production OrgID DEMO.
    if (/^\/api\/v1\/accounts\/[^/]+\/secret$/.test(pathname) && (method === 'PUT' || method === 'DELETE')) {
      if (!requireAdmin('secrets')) return;
      const id = pathname.split('/')[4];
      const acc = await db.findById('account_profiles', id);
      if (!acc) return sendJson(res, 404, { success: false, error: { message: 'Không tìm thấy tài khoản' } });
      if (method === 'DELETE') {
        SecretVault.delete(id);
        await db.update('account_profiles', id, { secret_ref: 'NONE' });
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'SECRET_DELETE', decision: 'ALLOW', reason: `Xóa mật khẩu đã lưu của ${id}`, correlationId: `corr_secret_${id}` });
        return sendJson(res, 200, { success: true, data: { has_secret: false } });
      }
      const accEnv = await db.findById('environment_profiles', acc.environment_profile_id);
      if (!accEnv || !VAULT_ENV_TYPES.includes(accEnv.environment_type)) {
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'SECRET_SET', decision: 'DENY', reason: `Môi trường ${accEnv?.environment_type} không được lưu mật khẩu`, correlationId: `corr_secret_${id}` });
        return sendJson(res, 403, { success: false, error: { message: 'Chỉ lưu mật khẩu cho Staging và Production OrgID DEMO.' } });
      }
      const body = await parseJsonBody(req);
      if (!body.password || typeof body.password !== 'string') return sendJson(res, 400, { success: false, error: { message: 'Thiếu mật khẩu' } });
      SecretVault.set(id, body.password);
      await db.update('account_profiles', id, { secret_ref: 'VAULT' });
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'SECRET_SET', decision: 'ALLOW', reason: `Lưu mật khẩu mã hóa cho ${id}`, correlationId: `corr_secret_${id}` });
      return sendJson(res, 200, { success: true, data: { has_secret: true } });
    }

    if (pathname.startsWith('/api/v1/accounts/') && method === 'DELETE') {
      const id = pathname.split('/').pop();
      SecretVault.delete(id);
      await db.delete('account_profiles', id);
      return sendJson(res, 200, { success: true, message: `Deleted account ${id}` });
    }

    // ==========================================
    // 3. Browser Sessions API (Org Confirmation Gate)
    // ==========================================
    if (pathname === '/api/v1/browser-sessions' && method === 'POST') {
      const body = await parseJsonBody(req);
      const session = await browserRunner.createSession({
        accountProfileId: body.account_profile_id,
        environmentProfileId: body.environment_profile_id,
        routeUrl: body.route_url || '',
        user: DEFAULT_QC_USER,
        correlationId: req.headers['correlation-id']
      });
      return sendJson(res, 201, { success: true, data: session });
    }

    // Launcher trên máy người dùng lấy thông tin đăng nhập cho đúng phiên vừa tạo: một lần, trong 2 phút, đúng chủ phiên
    if (/^\/api\/v1\/browser-sessions\/[^/]+\/credentials$/.test(pathname) && method === 'GET') {
      const sid = pathname.split('/')[4];
      const st = browserRunner.getSession(sid);
      const deny = (code, msg) => sendJson(res, code, { success: false, error: { message: msg } });
      if (!st) return deny(404, 'Không thấy phiên');
      if (authRequired && st.createdBy !== DEFAULT_QC_USER.id) return deny(403, 'Phiên này không phải của bạn');
      if (Date.now() - new Date(st.createdAt).getTime() > 120000) return deny(410, 'Phiên đã quá 2 phút, hãy mở lại');
      if (st.credentialsServed) return deny(409, 'Thông tin đăng nhập của phiên này đã được lấy');
      const envRec = await db.findById('environment_profiles', st.environmentId);
      if (!envRec || !VAULT_ENV_TYPES.includes(envRec.environment_type)) return sendJson(res, 200, { success: true, data: { username: st.username, password: null } });
      st.credentialsServed = true;
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'CREDENTIAL_READ', decision: 'ALLOW', reason: `Launcher lấy mật khẩu của ${st.accountId} cho phiên ${sid}`, correlationId: `corr_cred_${sid}` });
      return sendJson(res, 200, { success: true, data: { username: st.username, password: SecretVault.get(st.accountId) } });
    }

    if (/^\/api\/v1\/browser-sessions\/[^/]+$/.test(pathname) && method === 'GET') {
      const state = browserRunner.getSession(pathname.split('/')[4]);
      return state ? sendJson(res, 200, { success: true, data: state }) : sendJson(res, 404, { success: false, error: { message: 'Session not found' } });
    }

    if (/^\/api\/v1\/browser-sessions\/[^/]+$/.test(pathname) && method === 'DELETE') {
      return sendJson(res, 200, { success: true, data: browserRunner.closeSession(pathname.split('/')[4]) });
    }

    if (pathname.includes('/confirm-org') && method === 'POST') {
      const sessionId = pathname.split('/')[4];
      const confirmed = await browserRunner.confirmOrg(sessionId, DEFAULT_QC_USER);
      return sendJson(res, 200, { success: true, data: confirmed });
    }

    if (pathname.includes('/execute-step') && method === 'POST') {
      const sessionId = pathname.split('/')[4];
      const body = await parseJsonBody(req);
      const result = await browserRunner.executeStep(sessionId, body.step, DEFAULT_QC_USER);
      return sendJson(res, 200, { success: true, data: result });
    }

    // ==========================================
    // Tác vụ tự động hóa (Playwright) ghi lại khi khám phá module
    // ==========================================
    const jerr = (code, message) => sendJson(res, code, { success: false, error: { message } });
    // Quyết định của người dùng: code sinh ra dùng được ngay, không cần duyệt thủ công (người có quyền vẫn sửa code trên platform)
    const autoApprove = t => db.update('automation_tasks', t.id, { status: 'approved', approved_sha: t.script_sha, approved_by: 'auto', approved_at: new Date().toISOString() });
    if (pathname === '/api/v1/automation/tasks' && method === 'GET') {
      const mod = urlObj.searchParams.get('module') || '';
      for (const d of await db.find('automation_tasks', t => t.status !== 'retired' && !isRunnable(t))) await autoApprove(d);
      const tasks = await db.find('automation_tasks', t => t.status !== 'retired' && (!mod || t.module === mod));
      const withFiles = async t => ({ ...t, runnable: isRunnable(t), params: await Promise.all((t.params || []).map(async p => p.type === 'file' && p.value
        ? { ...p, files: (await Promise.all(fileIds(p.value).map(id => db.findById('automation_files', id)))).filter(Boolean).map(f => ({ id: f.id, name: f.name, size: f.size })) } : p)) });
      return sendJson(res, 200, { success: true, data: await Promise.all(tasks.map(withFiles)) });
    }
    if (pathname === '/api/v1/automation/tasks' && method === 'POST') {
      if (!requireAdmin(['automation', 'automation_push'])) return;
      const stg = await db.findById('environment_profiles', 'env_staging');
      if (!stg) return jerr(409, 'Chưa có môi trường Staging');
      const { task, errors } = normalizeTask(await parseJsonBody(req), stg);
      if (errors) return jerr(400, errors.join('; '));
      const existing = task.id && await db.findById('automation_tasks', task.id);
      let saved;
      if (existing) {
        const changed = existing.script_sha !== task.script_sha;
        // Sửa code thì mất duyệt, phải duyệt lại
        saved = await db.update('automation_tasks', existing.id, { ...task, status: 'approved', approved_sha: task.script_sha, approved_by: 'auto', approved_at: new Date().toISOString() });
      } else {
        saved = await db.insert('automation_tasks', { ...task, id: task.id || `at_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, status: 'approved', approved_sha: task.script_sha, approved_by: 'auto', approved_at: new Date().toISOString(), created_by: DEFAULT_QC_USER.id, created_at: new Date().toISOString() });
      }
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'AUTOMATION_TASK_SAVE', decision: 'ALLOW', reason: `${saved.id} (${saved.name}) sha ${saved.script_sha.slice(0, 12)}`, correlationId: `corr_at_${saved.id}` });
      return sendJson(res, 201, { success: true, data: { ...saved, runnable: isRunnable(saved) } });
    }
    let am;
    if ((am = /^\/api\/v1\/automation\/tasks\/([^/]+)\/(approve|run)$/.exec(pathname)) && method === 'POST') {
      const task = await db.findById('automation_tasks', am[1]);
      if (!task || task.status === 'retired') return jerr(404, 'Không thấy tác vụ');
      if (am[2] === 'approve') {
        if (!requireAdmin('automation')) return;
        const body = await parseJsonBody(req);
        // Duyệt đúng bản code đã đọc: mã băm gửi lên phải khớp bản hiện tại
        if (body.sha !== task.script_sha) return jerr(409, 'Code đã thay đổi so với bản bạn xem. Tải lại và đọc lại trước khi duyệt.');
        const u = await db.update('automation_tasks', task.id, { status: 'approved', approved_sha: task.script_sha, approved_by: DEFAULT_QC_USER.id, approved_at: new Date().toISOString() });
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'AUTOMATION_TASK_APPROVE', decision: 'ALLOW', reason: `${task.id} sha ${task.script_sha.slice(0, 12)}`, correlationId: `corr_at_${task.id}` });
        return sendJson(res, 200, { success: true, data: { ...u, runnable: isRunnable(u) } });
      }
      // run: tự chọn tài khoản Staging phù hợp, tạo phiên; trình duyệt người dùng gọi launcher để chạy
      if (!allowRun(DEFAULT_QC_USER.id)) return jerr(429, 'Chạy quá nhiều lần trong 10 phút (tối đa 120). Đợi một lúc rồi thử lại.');
      if (!isRunnable(task)) return jerr(409, 'Tác vụ chưa được duyệt hoặc code đã đổi sau khi duyệt.');
      const body = await parseJsonBody(req);
      for (const p of (task.params || []).filter(x => x.type === 'file')) {
        const v = body.params && typeof body.params[p.key] === 'string' ? body.params[p.key] : p.value;
        if (v && !(await filesExist(fileIds(v)))) return jerr(400, `File của "${p.label || p.key}" không còn trên server, hãy chọn lại`);
      }
      const stagingEnvs = await db.find('environment_profiles', e => e.environment_type === 'STAGING' && e.is_active === 1);
      const ids = new Set(stagingEnvs.map(e => e.id));
      const accs = (await db.find('account_profiles', a => a.is_active === 1 && ids.has(a.environment_profile_id)))
        .map(a => ({ ...a, has_secret: SecretVault.has(a.id) }));
      const acc = body.account_id ? accs.find(a => a.id === body.account_id) : chooseAccount(task, accs);
      if (!acc) return jerr(422, `Không có tài khoản Staging phù hợp${task.required_roles.length ? ` (cần vai trò: ${task.required_roles.join(', ')})` : ''}. Thêm tài khoản ở tab 1 hoặc chọn tài khoản thủ công.`);
      const session = await browserRunner.createSession({
        accountProfileId: acc.id, environmentProfileId: acc.environment_profile_id,
        taskId: task.id, taskBatch: cleanBatch(body.batch), taskParams: body.params && typeof body.params === 'object' ? body.params : null, forceRoute: task.start_url, user: DEFAULT_QC_USER, correlationId: req.headers['correlation-id']
      });
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'AUTOMATION_TASK_RUN', decision: 'ALLOW', reason: `${task.id} bằng ${acc.id}`, correlationId: `corr_at_${task.id}` });
      return sendJson(res, 201, { success: true, data: { session, account: { id: acc.id, name: acc.name, role: acc.role, auto: !body.account_id } } });
    }
    // Đổi giá trị tham số mặc định của tác vụ. Chỉ sửa giá trị và cờ auto của khóa có sẵn, không đụng code nên không mất duyệt.
    if ((am = /^\/api\/v1\/automation\/tasks\/([^/]+)\/params$/.exec(pathname)) && method === 'PUT') {
      if (!requireAdmin(['automation', 'automation_push'])) return;
      const t = await db.findById('automation_tasks', am[1]);
      if (!t || t.status === 'retired') return jerr(404, 'Không thấy tác vụ');
      const body = await parseJsonBody(req);
      const incoming = new Map((Array.isArray(body.params) ? body.params : []).map(p => [p.key, p]));
      // Chỉ đổi giá trị; cờ auto chỉ đổi khi được gửi kèm (không gửi thì giữ nguyên)
      const next = (t.params || []).map(p => incoming.has(p.key)
        ? { ...p, value: String(incoming.get(p.key).value ?? p.value), auto: incoming.get(p.key).auto === undefined ? p.auto : incoming.get(p.key).auto !== false }
        : p);
      const chk = normalizeParams(next);
      if (chk.errors.length) return jerr(400, chk.errors.join('; '));
      for (const p of chk.params.filter(x => x.type === 'file' && x.value)) if (!(await filesExist(fileIds(p.value)))) return jerr(400, `File của "${p.label}" không tồn tại`);
      const u = await db.update('automation_tasks', t.id, { params: chk.params });
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'AUTOMATION_PARAMS_SAVE', decision: 'ALLOW', reason: t.id, correlationId: `corr_at_${t.id}` });
      return sendJson(res, 200, { success: true, data: { ...u, runnable: isRunnable(u) } });
    }
    if ((am = /^\/api\/v1\/automation\/tasks\/([^/]+)$/.exec(pathname)) && method === 'DELETE') {
      if (!requireAdmin('automation')) return;
      const t = await db.findById('automation_tasks', am[1]);
      if (!t) return jerr(404, 'Không thấy tác vụ');
      await db.update('automation_tasks', t.id, { status: 'retired' });
      return sendJson(res, 200, { success: true });
    }
    if (pathname === '/api/v1/automation/runs' && method === 'GET') {
      const tid = urlObj.searchParams.get('task') || '';
      const runs = (await db.find('automation_runs', r => !tid || r.task_id === tid)).slice(-30).reverse();
      return sendJson(res, 200, { success: true, data: runs });
    }
    // ---- Tải file lên và lấy thông tin file (cho ô chọn file trong mô tả bước của tác vụ)
    if (pathname === '/api/v1/automation/files' && method === 'POST') {
      if (!allowUpload(DEFAULT_QC_USER.id)) return jerr(429, 'Tải lên quá nhiều trong 10 phút (tối đa 30 file). Đợi một lúc rồi thử lại.');
      const body = await parseJsonBody(req);
      const raw = String(body.data_base64 || '');
      if (raw.length > MAX_FILE * 1.4) return jerr(413, 'File quá lớn (tối đa 10 MB)');
      const buf = Buffer.from(raw, 'base64');
      if (!buf.length || buf.length > MAX_FILE) return jerr(413, 'File trống hoặc quá lớn (tối đa 10 MB)');
      const kind = sniff(buf, body.name);
      if (!kind) return jerr(415, 'Chỉ nhận ảnh (PNG, JPG, GIF, WEBP, BMP), PDF, Word (doc, docx), Excel (xls, xlsx), PowerPoint (ppt, pptx), văn bản (txt, csv, md, rtf) và zip. Không nhận chương trình, script hoặc file có macro');
      fs.mkdirSync(FILES_DIR, { recursive: true });
      if ((await db.find('automation_files', () => true)).length >= 100) return jerr(409, 'Kho ảnh test đã đủ 100 file. Xóa bớt file không dùng rồi tải lên lại.');
      const id = 'f_' + Math.random().toString(36).slice(2, 14).padEnd(10, '0');
      const base = path.basename(String(body.name || 'tep')).replace(/[^\w.\- ]/g, '_').slice(0, 80) || 'tep';
      const name = base.toLowerCase().endsWith('.' + kind[1]) ? base : `${base}.${kind[1]}`;
      fs.writeFileSync(path.join(FILES_DIR, id + '.' + kind[1]), buf);
      const rec = await db.insert('automation_files', { id, name, mime: kind[0], size: buf.length, stored: id + '.' + kind[1], uploaded_by: DEFAULT_QC_USER.id });
      return sendJson(res, 201, { success: true, data: { id: rec.id, name: rec.name, size: rec.size, mime: rec.mime } });
    }
    // Kho ảnh test: danh sách, xem ảnh, xóa. File lưu lâu dài để chọn lại cho nhiều lần chạy.
    if (pathname === '/api/v1/automation/files' && method === 'GET') {
      const all = await db.find('automation_files', () => true);
      return sendJson(res, 200, { success: true, data: all.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).map(f => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, created_at: f.created_at })) });
    }
    if ((am = /^\/api\/v1\/automation\/files\/([^/]+)\/raw$/.exec(pathname)) && method === 'GET') {
      const f = await db.findById('automation_files', am[1]);
      if (!f) return jerr(404, 'Không thấy file');
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.size, 'X-Content-Type-Options': 'nosniff' });
      return res.end(fs.readFileSync(path.join(FILES_DIR, f.stored)));
    }
    if ((am = /^\/api\/v1\/automation\/files\/([^/]+)$/.exec(pathname)) && method === 'DELETE') {
      if (!requireAdmin(['automation', 'automation_push'])) return;
      const f = await db.findById('automation_files', am[1]);
      if (!f) return jerr(404, 'Không thấy file');
      try { fs.rmSync(path.join(FILES_DIR, f.stored), { force: true }); } catch {}
      await db.delete('automation_files', f.id);
      return sendJson(res, 200, { success: true, data: { id: f.id } });
    }
    if ((am = /^\/api\/v1\/automation\/files\/([^/]+)\/meta$/.exec(pathname)) && method === 'GET') {
      const f = await db.findById('automation_files', am[1]);
      return f ? sendJson(res, 200, { success: true, data: { id: f.id, name: f.name, size: f.size, mime: f.mime } }) : jerr(404, 'Không thấy file');
    }
    // Launcher tải file của chính phiên này: chỉ file nằm trong tham số của phiên, chỉ chủ phiên
    if ((am = /^\/api\/v1\/browser-sessions\/([^/]+)\/files\/([^/]+?)(\/meta)?$/.exec(pathname)) && method === 'GET') {
      const st = browserRunner.getSession(am[1]);
      if (!st || !st.taskId) return jerr(404, 'Phiên này không gắn tác vụ');
      if (authRequired && st.createdBy !== DEFAULT_QC_USER.id) return jerr(403, 'Phiên này không phải của bạn');
      const task = await db.findById('automation_tasks', st.taskId);
      const allowed = new Set(mergeParams(task || {}, st.taskParams).filter(p => p.type === 'file').flatMap(p => fileIds(p.value)));
      if (!allowed.has(am[2])) return jerr(403, 'File này không thuộc tham số của phiên');
      const f = await db.findById('automation_files', am[2]);
      if (!f) return jerr(404, 'Không thấy file');
      if (am[3]) return sendJson(res, 200, { success: true, data: { id: f.id, name: f.name, size: f.size, mime: f.mime } });
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.size });
      return res.end(fs.readFileSync(path.join(FILES_DIR, f.stored)));
    }

    // Launcher lấy code của tác vụ gắn với phiên của chính người dùng; chỉ khi đã duyệt, chỉ Staging
    if ((am = /^\/api\/v1\/browser-sessions\/([^/]+)\/task$/.exec(pathname)) && method === 'GET') {
      const st = browserRunner.getSession(am[1]);
      if (!st || !st.taskId) return jerr(404, 'Phiên này không gắn tác vụ');
      if (authRequired && st.createdBy !== DEFAULT_QC_USER.id) return jerr(403, 'Phiên này không phải của bạn');
      if (st.environmentType !== 'STAGING') return jerr(403, 'Tác vụ tự động chỉ chạy trên Staging');
      const task = await db.findById('automation_tasks', st.taskId);
      if (!task || !isRunnable(task)) return jerr(409, 'Tác vụ chưa duyệt hoặc code đã đổi');
      return sendJson(res, 200, { success: true, data: { id: task.id, name: task.name, script: task.script, sha: task.script_sha, steps: task.steps, startUrl: task.start_url, testPrefix: '[AI TEST]', params: mergeParams(task, st.taskParams) } });
    }
    if ((am = /^\/api\/v1\/browser-sessions\/([^/]+)\/task-result$/.exec(pathname)) && method === 'POST') {
      const st = browserRunner.getSession(am[1]);
      if (!st || !st.taskId) return jerr(404, 'Phiên này không gắn tác vụ');
      if (authRequired && st.createdBy !== DEFAULT_QC_USER.id) return jerr(403, 'Phiên này không phải của bạn');
      const b = await parseJsonBody(req);
      const run = await db.insert('automation_runs', {
        task_id: st.taskId, session_id: am[1], account_id: st.accountId, account_name: st.accountName, user_id: DEFAULT_QC_USER.id,
        user_name: DEFAULT_QC_USER.display_name, batch: st.taskBatch || null, status: b.status === 'PASS' ? 'PASS' : 'FAIL', steps: Array.isArray(b.steps) ? b.steps.slice(0, 100) : [],
        log: Array.isArray(b.log) ? b.log.slice(0, 200).map(String) : [], error: b.error ? String(b.error).slice(0, 500) : '', duration_ms: Number(b.duration_ms) || 0
      });
      return sendJson(res, 201, { success: true, data: { id: run.id } });
    }

    // ==========================================
    // Bug cũ (từ Kho Business Rule) và tìm rule, bug liên quan theo mô tả
    // ==========================================
    if (pathname === '/api/v1/bugs/meta' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: { ...BugStore.meta(), facets: BugStore.facets() } });
    }
    if (pathname === '/api/v1/bugs' && method === 'GET') {
      const q = urlObj.searchParams;
      return sendJson(res, 200, { success: true, data: BugStore.list({
        module: q.get('module') || '', q: q.get('q') || '', category: q.get('category') || '', year: q.get('year') || '',
        status: q.get('status') || '', assignee: q.get('assignee') || '', approver: q.get('approver') || '', closed: q.get('closed') || '', age: q.get('age') || '',
        unknown: q.get('unknown') === '1', offset: Math.max(0, +q.get('offset') || 0), limit: Math.min(200, +q.get('limit') || 50)
      }) });
    }
    // Chi tiết một bug (mô tả, người, lịch sử, bình luận) lấy trực tiếp từ Haraworks bằng cookie phiên trên server
    {
      const dm = /^\/api\/v1\/bugs\/([0-9a-f]{24})\/detail$/.exec(pathname);
      if (dm && method === 'GET') {
        try { return sendJson(res, 200, { success: true, data: await getBugDetail(dm[1]) }); }
        catch (e) {
          const code = e.code || 'ERROR';
          return sendJson(res, code === 'NO_COOKIE' || code === 'AUTH' ? 503 : code === 'NOT_FOUND' ? 404 : 502, { success: false, error: { code, message: e.message } });
        }
      }
    }
    // Bug realtime từ Haraworks: trạng thái nguồn + số bản (giao diện hỏi nhẹ để biết có đổi không)
    if (pathname === '/api/v1/bugs/live' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: { ...bugLive.status(), revision: BugStore.liveRevision() } });
    }
    if (pathname === '/api/v1/bugs/live/refresh' && method === 'POST') {
      bugLive.trigger('người dùng yêu cầu');
      return sendJson(res, 202, { success: true, data: { enabled: bugLive.enabled } });
    }
    if (pathname === '/api/v1/bugs/sync' && method === 'POST') {
      if (!requireAdmin('rules')) return;
      const body = await parseJsonBody(req);
      let meta;
      try { meta = BugStore.replace(body.bugs ? { bugs: body.bugs } : body, body.notes); }
      catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'BUGS_SYNC', decision: 'ALLOW', reason: `Cập nhật ${meta.count} bug, bản ${meta.revision}`, correlationId: `corr_bugs_${meta.revision}` });
      return sendJson(res, 200, { success: true, data: meta });
    }
    if (pathname === '/api/v1/kb/modules' && method === 'GET') {
      const mods = (BusinessRuleStore.load().modules || []).map(m => ({ code: m.code, name: m.name, cluster: m.cluster || '' }));
      return sendJson(res, 200, { success: true, data: mods });
    }
    // Tự động tìm rule và bug cũ liên quan khi người dùng gõ mô tả
    if (pathname === '/api/v1/bug-search' && method === 'POST') {
      const body = await parseJsonBody(req);
      const text = String(body.text || '').slice(0, 4000);
      if (text.trim().length < 8) return sendJson(res, 200, { success: true, data: { module_guess: '', module_used: '', rules: [], bugs: [] } });
      // Chưa chọn module: tìm trên tất cả module, chỉ gợi ý module đoán được (không dùng để lọc)
      const used = body.module || '';
      const guess = used ? '' : guessModule(text);
      const rules = similarRules(text, used, 8);
      return sendJson(res, 200, { success: true, data: {
        module_guess: guess, module_used: used, artifact_url: rules.artifact_url,
        rules: rules.rules, bugs: BugStore.similar(text, used, 10, ['new', 'old'].includes(body.age) ? body.age : '')
      } });
    }

    // AI phân tích bug: nguyên nhân có thể, nơi cần kiểm tra, tác vụ tự động gợi ý
    if (pathname === '/api/v1/bug-analysis' && method === 'POST') {
      const body = await parseJsonBody(req);
      const text = String(body.text || '').slice(0, 4000);
      if (text.trim().length < 8) return sendJson(res, 400, { success: false, error: { message: 'Mô tả quá ngắn' } });
      const used = body.module || '';
      const guess = used ? '' : guessModule(text);
      const rules = similarRules(text, used, 8).rules;
      const bugs = BugStore.similar(text, used, 10, ['new', 'old'].includes(body.age) ? body.age : '');
      const tasks = await db.find('automation_tasks', t => t.status !== 'retired');
      const input = { text, moduleUsed: used, moduleGuess: guess, rules, bugs, tasks };
      let out;
      const ai = process.env.GEMINI_API_KEY ? { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, baseUrl: process.env.GEMINI_BASE_URL || undefined }
        : process.env.ANTHROPIC_API_KEY ? { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined } : null;
      if (ai) {
        try { out = await analyzeAI(input, { ...ai, model: process.env.QA_AI_MODEL || undefined }); }
        catch (e) { out = { ...analyzeLocal(input), engine_note: `Gọi AI không được (${e.message}), đang hiển thị phân tích theo dữ liệu.` }; }
      } else out = analyzeLocal(input);
      return sendJson(res, 200, { success: true, data: out });
    }

    // Thêm, sửa, xóa rule ngay trên platform (lớp chỉnh sửa riêng, không bị đồng bộ từ Kho ghi đè)
    if (pathname === '/api/v1/business-rules' && method === 'POST') {
      if (!requireAdmin('rules_edit')) return;
      try {
        const rule = BusinessRuleStore.createLocal(DEFAULT_QC_USER, await parseJsonBody(req));
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'RULE_CREATE', decision: 'ALLOW', reason: rule.rule_id, correlationId: `corr_rule_${rule.rule_id}` });
        return sendJson(res, 201, { success: true, data: rule });
      } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
    }
    let rm;
    if ((rm = /^\/api\/v1\/business-rules\/([A-Za-z0-9_-]+)(\/restore)?$/.exec(pathname)) && !['meta', 'sync'].includes(rm[1])
        && ((method === 'PUT' || method === 'DELETE') && !rm[2] || method === 'POST' && rm[2])) {
      if (!requireAdmin('rules_edit')) return;
      const rid = rm[1];
      try {
        let data = { rule_id: rid };
        if (method === 'PUT') data = BusinessRuleStore.editLocal(DEFAULT_QC_USER, rid, await parseJsonBody(req));
        else if (method === 'DELETE') BusinessRuleStore.deleteLocal(DEFAULT_QC_USER, rid);
        else BusinessRuleStore.restoreLocal(rid);
        const action = method === 'PUT' ? 'RULE_EDIT' : method === 'DELETE' ? 'RULE_DELETE' : 'RULE_RESTORE';
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action, decision: 'ALLOW', reason: rid, correlationId: `corr_rule_${rid}` });
        return sendJson(res, 200, { success: true, data });
      } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
    }

    if (pathname === '/api/v1/business-rules/meta' && method === 'GET') {
      const d = BusinessRuleStore.load();
      return sendJson(res, 200, { success: true, data: { revision: d.revision || 0, synced_at: d.synced_at, count: d.rules.length } });
    }
    // Nút "Cập nhật rule từ kho": nạp lại từ thư mục xuất của Kho trên máy server (nơi Explore đã xuất rule)
    if (pathname === '/api/v1/business-rules/refresh' && method === 'POST') {
      if (!requireAdmin('rules')) return;
      let meta;
      try { meta = BusinessRuleStore.replace(buildBundle(path.join(path.dirname(FILES_DIR), 'kb-snapshot'))); }
      catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'RULES_REFRESH', decision: 'ALLOW', reason: `Nạp lại từ kb-snapshot: ${meta.count} rule, bản ${meta.revision}`, correlationId: `corr_rules_${meta.revision}` });
      return sendJson(res, 200, { success: true, data: meta });
    }
    if (pathname === '/api/v1/business-rules/sync' && method === 'POST') {
      if (!requireAdmin('rules')) return;
      const body = await parseJsonBody(req);
      let meta;
      try { meta = BusinessRuleStore.replace(body); }
      catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'RULES_SYNC', decision: 'ALLOW', reason: `Cập nhật ${meta.count} rule, bản ${meta.revision}`, correlationId: `corr_rules_${meta.revision}` });
      return sendJson(res, 200, { success: true, data: meta });
    }

    // Business Rule KB (read-only snapshot of "Kho Business Rule Haraworks")
    if (pathname === '/api/v1/business-rules' && method === 'GET') {
      return sendJson(res, 200, {
        success: true,
        data: BusinessRuleStore.list({ module: urlObj.searchParams.get('module') || '', q: urlObj.searchParams.get('q') || '', confirmed: urlObj.searchParams.get('confirmed') === '1' })
      });
    }

    // ==========================================
    // 4. Bug Analyses API (RAG Grounded)
    // ==========================================
    if (pathname === '/api/v1/bug-analyses' && method === 'POST') {
      const body = await parseJsonBody(req);
      const analysis = await BugAnalyzer.analyze({
        rawText: body.raw_text,
        moduleId: body.module_id || 'mod_maint',
        platform: body.platform || 'Web',
        attachments: body.attachments || []
      });

      // Start workflow run record
      const { run } = await CheckpointManager.startWorkflowRun({
        workflowType: 'BUG_ANALYSIS',
        createdBy: DEFAULT_QC_USER.id,
        moduleId: body.module_id || 'mod_maint',
        inputPayload: body,
        idempotencyKey: req.headers['idempotency-key']
      });

      const nextState = analysis.missing_information && analysis.missing_information.length > 0
        ? 'NEEDS_INFORMATION'
        : 'WAITING_FOR_QC_REVIEW';

      await CheckpointManager.advanceWorkflow(run.id, nextState, 'ANALYSIS_READY', { analysis });

      return sendJson(res, 200, {
        success: true,
        workflowRunId: run.id,
        data: analysis
      });
    }

    // ==========================================
    // 7. System Health & Diagnostics API
    // ==========================================
    if (pathname === '/api/v1/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'HEALTHY', ai: process.env.GEMINI_API_KEY ? 'gemini' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'none',
        version: '1.0.0',
        uptime: process.uptime(),
        database: 'CONNECTED',
        timestamp: new Date().toISOString()
      });
    }

    // ==========================================
    // 8. Static Web Dashboard Files
    // ==========================================
    if (pathname === '/' || pathname === '/index.html') {
      return serveStaticFile(res, path.join(WEB_DIR, 'index.html'), 'text/html');
    }
    if (pathname === '/logo.svg' || pathname === '/favicon.ico') return serveStaticFile(res, path.join(WEB_DIR, 'logo.svg'), 'image/svg+xml');
    if (pathname.endsWith('.js')) {
      return serveStaticFile(res, path.join(WEB_DIR, pathname), 'application/javascript');
    }
    if (pathname.endsWith('.css')) {
      return serveStaticFile(res, path.join(WEB_DIR, pathname), 'text/css');
    }

    // Fallback 404
    return sendJson(res, 404, { error: 'Endpoint not found' });
  } catch (err) {
    console.error('[API Error]:', err);
    return sendJson(res, 500, {
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message
      }
    });
  }
};

// Bug realtime: lấy từ tasks.haraworks.vn (cùng cách với app haraworks-tasks-local) rồi gộp vào BugStore
const bugLive = startBugLive({
  onChange: (rows) => BugStore.setLive(rows),
  getModules: () => BusinessRuleStore.load().modules || []
});

const useTls = process.env.TLS_CERT && process.env.TLS_KEY;
const server = useTls
  ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, handler)
  : http.createServer(handler);

await db.init();
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
if (!loopback && !(await hasUsers())) {
  console.error('Từ chối chạy: HOST không phải localhost nhưng chưa có người dùng nhóm. Tạo trước: node scripts/team-user.mjs add "Tên" admin');
  process.exit(1);
}
if (!loopback && !useTls) console.warn('CẢNH BÁO: đang chạy HTTP không mã hóa trên mạng; token và mật khẩu đi dạng chữ rõ. Dùng TLS_CERT/TLS_KEY hoặc reverse proxy HTTPS.');

server.listen(PORT, HOST, () => {
  console.log(`========================================================`);
  console.log(`🚀 QA Platform API & Dashboard running at ${useTls ? 'https' : 'http'}://${loopback ? 'localhost' : HOST}:${PORT}`);
  console.log(`========================================================`);
});
