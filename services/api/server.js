/**
 * Internal AI QA Testing Platform - Backend API Server
 * Zero-dependency native HTTP server serving RESTful API /api/v1 and static Web Dashboard.
 * Defined in Section 8 of System Design v1.0.
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { db } from '../../database/db.js';
import { PolicyEngine } from '../../packages/policy-engine/policy-engine.js';
import { BugAnalyzer } from '../ai-service/bug-analyzer.js';
import { CheckpointManager } from '../workflow-orchestrator/checkpoint-manager.js';
import { browserRunner } from '../automation-runner/browser-runner.js';
import { getRoutes, parseRouteLines } from '../../packages/account-routes/routes.js';
import { SecretVault, VAULT_ENV_TYPES } from '../../packages/secret-vault/vault.js';
import { authenticate, hasUsers, setUserAccess, createUser, resetToken, revokeUser, loginWithPassword, setPassword, normalizeUsername } from '../../packages/team-auth/auth.js';
import { normalizeTask, normalizeParams, mergeParams, chooseAccount, isRunnable, validateScript, FILE_ID } from '../../packages/automation-tasks/tasks.js';
import { BugStore, FunctionStore, similarRules, guessModule, moduleMembers } from '../../packages/bug-search/search.js';
import { STATUS_LABELS } from '../../packages/bug-search/codes.js';
import { buildBundle } from '../../packages/kb-sync/bundle.js';
import { analyzeLocal, analyzeAI } from '../../packages/bug-search/analysis.js';
import { BusinessRuleStore } from '../ai-service/business-rule-store.js';
import { suggestAutomationFix } from '../ai-service/automation-code-assistant.js';
import { startBugLive, readCookie, writeCookie } from '../../packages/haraworks-live/index.js';
import { startFunctionLive } from '../../packages/haraworks-live/function-live.js';
import { startNotifyLive } from '../../packages/haraworks-live/notifications.js';
import { startBuildLive } from '../../packages/haraworks-live/build-live.js';
import { getBugDetail, fetchBugImages } from '../../packages/haraworks-live/detail.js';

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

function parseJsonBody(req, maxBytes = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        const error = new Error('Dữ liệu gửi lên quá lớn');
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
const LABEL_COLORS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/label-colors.json');
const PROJECT_COLOR_PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5', '#0d9488', '#ea580c'];
const DEFAULT_LABEL_COLORS = {
  module: {
    '4RUM': '#8b5cf6', ACC: '#0ea5e9', ANNOUN: '#f59e0b', BONUS: '#ec4899', BOOKING: '#14b8a6',
    BOSS: '#6366f1', BUDGET: '#84cc16', CHAT: '#3b82f6', CHECK: '#eab308', CHECKLIST: '#10b981',
    COMMON: '#64748b', CORE: '#e11d48', CUS: '#06b6d4', DELP: '#f97316', DRIVE: '#22c55e',
    DV5S: '#2563eb', EFORM: '#a855f7', ESIGN: '#0d9488', FILE: '#6d28d9', HOME: '#0284c7',
    HRM: '#db2777', 'HRWS DIS': '#059669', IOT: '#ea580c', LISTEN: '#9333ea', LND: '#4f46e5',
    MAIL: '#dc2626', MAINT: '#d97706', NEWS: '#0891b2', NPS: '#65a30d', QC: '#be123c',
    REC: '#7c3aed', RISK: '#b91c1c', SAL: '#15803d', SCM: '#0369a1', SHIFT: '#c026d3',
    SMART: '#1d4ed8', TASK: '#0f766e', VHST: '#b45309'
  },
  status: { 0: '#6b7280', 1: '#2563eb', 2: '#d97706', 3: '#7c3aed', 4: '#dc2626', 5: '#16a34a', 6: '#d97706', 10: '#6b7280', 11: '#6b7280' },
  project: {
    'Super Team': '#3b82f6',
    'Winx Team': '#ec4899',
    'Integrity Team': '#10b981',
    'Team 1': '#f59e0b',
    'ODOO BUG PRODUCTION': '#64748b',
    'HRWs APP - RELEASE': '#8b5cf6',
    'HRWs - RELEASE CHECKLIST': '#06b6d4'
  }
};
function readLabelColorsRaw() {
  if (!fs.existsSync(LABEL_COLORS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(LABEL_COLORS_FILE, 'utf8')) || {}; } catch { return {}; }
}
function readLabelColors() {
  const saved = readLabelColorsRaw();
  return {
    module: { ...DEFAULT_LABEL_COLORS.module, ...(saved.module || {}) },
    status: { ...DEFAULT_LABEL_COLORS.status, ...(saved.status || {}) },
    project: { ...DEFAULT_LABEL_COLORS.project, ...(saved.project || {}) }
  };
}
function readEffectiveModulesAndStatuses() {
  const saved = readLabelColorsRaw();
  const colors = readLabelColors();
  const baseMods = (BusinessRuleStore.load().modules || []).map(m => ({ code: m.code, name: m.name }));
  const deletedMods = new Set(Array.isArray(saved.deleted_modules) ? saved.deleted_modules : []);
  const customMods = Array.isArray(saved.custom_modules) ? saved.custom_modules : [];
  const modNames = saved.module_names || {};

  const modMap = new Map();
  for (const m of baseMods) {
    if (!deletedMods.has(m.code)) modMap.set(m.code, { code: m.code, name: modNames[m.code] || m.name, color: colors.module[m.code] || '#3b82f6' });
  }
  for (const m of customMods) {
    if (m?.code) modMap.set(m.code, { code: m.code, name: m.name || m.code, color: colors.module[m.code] || m.color || '#3b82f6' });
  }

  const deletedSt = new Set(Array.isArray(saved.deleted_statuses) ? saved.deleted_statuses.map(String) : []);
  const customSt = Array.isArray(saved.custom_statuses) ? saved.custom_statuses : [];
  const stNames = saved.status_names || {};

  const stMap = new Map();
  for (const [code, name] of Object.entries(STATUS_LABELS)) {
    if (!deletedSt.has(String(code))) stMap.set(String(code), { code: String(code), name: stNames[code] || name, color: colors.status[code] || '#6b7280' });
  }
  for (const s of customSt) {
    if (s?.code != null && String(s.code) !== '') stMap.set(String(s.code), { code: String(s.code), name: s.name || String(s.code), color: colors.status[s.code] || s.color || '#6b7280' });
  }

  // Tập hợp tất cả dự án từ Bug, Function, Build và mặc định
  const projNames = new Set([
    ...Object.keys(DEFAULT_LABEL_COLORS.project),
    ...Object.keys(colors.project || {}),
    ...Object.keys((typeof BugStore?.facets === 'function' ? BugStore.facets().projects : {}) || {}),
    ...Object.keys((typeof FunctionStore?.facets === 'function' ? FunctionStore.facets().teams : {}) || {})
  ]);
  const projects = [];
  let pIdx = 0;
  for (const pName of projNames) {
    if (!pName) continue;
    const col = colors.project[pName] || PROJECT_COLOR_PALETTE[pIdx % PROJECT_COLOR_PALETTE.length];
    colors.project[pName] = col;
    projects.push({ code: pName, name: pName, color: col });
    pIdx++;
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));

  return { colors, modules: [...modMap.values()], statuses: [...stMap.values()], projects };
}
function writeLabelColors(data) {
  fs.writeFileSync(LABEL_COLORS_FILE + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(LABEL_COLORS_FILE + '.tmp', LABEL_COLORS_FILE);
}
const PERSONAL_WS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../database/personal-workspace.json');
function readAllPersonalWs() {
  if (!fs.existsSync(PERSONAL_WS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PERSONAL_WS_FILE, 'utf8')) || {}; } catch { return {}; }
}
function readPersonalWs(userId) {
  const all = readAllPersonalWs();
  const u = all[userId] || {};
  return {
    todos: Array.isArray(u.todos) ? u.todos : [],
    notes: Array.isArray(u.notes) ? u.notes : []
  };
}
function writePersonalWs(userId, data) {
  const all = readAllPersonalWs();
  all[userId] = { todos: data.todos || [], notes: data.notes || [] };
  fs.writeFileSync(PERSONAL_WS_FILE + '.tmp', JSON.stringify(all, null, 2));
  fs.renameSync(PERSONAL_WS_FILE + '.tmp', PERSONAL_WS_FILE);
}
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
const ANALYSIS_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_ANALYSIS_FILES = 5, MAX_ANALYSIS_BYTES = 10 * 1024 * 1024;
function sniffAnalysisAttachment(buf, name) {
  const known = sniff(buf, name);
  if (known) return known;
  const ext = (String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && ['mp4', 'm4v', 'mov'].includes(ext)) {
    return [ext === 'mov' ? 'video/quicktime' : 'video/mp4', ext];
  }
  if (ext === 'webm' && buf.subarray(0, 4).toString('hex') === '1a45dfa3') return ['video/webm', ext];
  return null;
}
function normalizeAnalysisAttachments(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_ANALYSIS_FILES) {
    const error = new Error(`Chỉ nhận tối đa ${MAX_ANALYSIS_FILES} file đính kèm.`);
    error.statusCode = 400;
    throw error;
  }
  let total = 0;
  return value.map(file => {
    const raw = String(file?.data_base64 || '');
    if (!raw || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw)) {
      const error = new Error('Dữ liệu file đính kèm không hợp lệ.');
      error.statusCode = 400;
      throw error;
    }
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length || buf.toString('base64') !== raw) {
      const error = new Error('File đính kèm trống hoặc không hợp lệ.');
      error.statusCode = 400;
      throw error;
    }
    total += buf.length;
    if (total > MAX_ANALYSIS_BYTES) {
      const error = new Error('Tổng dung lượng file đính kèm không được vượt quá 10 MB.');
      error.statusCode = 413;
      throw error;
    }
    const name = path.basename(String(file?.name || 'tep')).replace(/[^\w.\- ]/g, '_').slice(0, 100) || 'tep';
    const kind = sniffAnalysisAttachment(buf, name);
    if (!kind || (kind[0].startsWith('image/') && !ANALYSIS_IMAGE_TYPES.has(kind[0]))) {
      const error = new Error('Định dạng không được hỗ trợ. Nhận ảnh PNG/JPG/GIF/WebP, video MP4/MOV/WebM, PDF, Office, văn bản và ZIP.');
      error.statusCode = 415;
      throw error;
    }
    return { name, mime: kind[0], size: buf.length, ...(ANALYSIS_IMAGE_TYPES.has(kind[0]) ? { data_base64: raw } : {}) };
  });
}
// Nạp các tác vụ nháp trong database/automation-drafts (nơi Explore ghi) vào platform; chạy lại chỉ cập nhật, không tạo trùng
const DRAFTS_DIR = path.join(path.dirname(FILES_DIR), 'automation-drafts');
async function importDraftTasks() {
  const out = { found: 0, added: 0, updated: 0, errors: [] };
  if (!fs.existsSync(DRAFTS_DIR)) return out;
  const stg = await db.findById('environment_profiles', 'env_staging');
  if (!stg) { out.errors.push('Chưa có môi trường Staging'); return out; }
  for (const f of fs.readdirSync(DRAFTS_DIR).filter(n => n.endsWith('.json') && !n.startsWith('_'))) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8')); } catch { out.errors.push(`${f}: không phải JSON hợp lệ`); continue; }
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      out.found++;
      item.id ||= 'at_' + crypto.createHash('sha1').update(`${item.module}|${item.name}`).digest('hex').slice(0, 16);
      const { task, errors } = normalizeTask(item, stg);
      if (errors) { out.errors.push(`${f}: ${errors.join('; ')}`); continue; }
      const existing = await db.findById('automation_tasks', task.id);
      const approval = { status: 'approved', approved_sha: task.script_sha, approved_by: 'auto', approved_at: new Date().toISOString() };
      if (existing) {
        if (existing.script_sha === task.script_sha && existing.name === task.name && existing.status !== 'retired') continue; // không đổi
        await db.update('automation_tasks', existing.id, { ...task, ...approval }); out.updated++;
      } else { await db.insert('automation_tasks', { ...task, ...approval }); out.added++; }
    }
  }
  return out;
}
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

    // Đăng nhập bằng Tài khoản & Mật khẩu
    if (pathname === '/api/v1/auth/login' && method === 'POST') {
      const body = await parseJsonBody(req);
      try {
        const result = await loginWithPassword(body.username, body.password);
        await PolicyEngine.logAudit({ actor: result.user, action: 'USER_LOGIN', decision: 'ALLOW', reason: `Đăng nhập tài khoản ${result.user.username}`, correlationId: `corr_login_${result.user.id}` });
        return sendJson(res, 200, { success: true, data: result });
      } catch (e) {
        return sendJson(res, 401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: e.message } });
      }
    }

    // Xác thực: khi đã có người dùng nhóm thì mọi API (trừ health, auth/login) cần đăng nhập
    const authRequired = await hasUsers();
    const authedUser = await authenticate(req);
    if (authRequired && pathname.startsWith('/api/v1/') && pathname !== '/api/v1/health' && pathname !== '/api/v1/auth/login' && !authedUser) {
      return sendJson(res, 401, { success: false, error: { code: 'AUTH_REQUIRED', message: 'Cần đăng nhập bằng tài khoản và mật khẩu.' } });
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
      return sendJson(res, 200, { success: true, data: (await db.find('team_users')).map(u => ({ id: u.id, username: u.username || normalizeUsername(u.display_name), display_name: u.display_name, employee_code: u.employee_code || '', role: u.role, perms: u.perms || [], is_active: u.is_active, created_at: u.created_at, is_me: u.id === DEFAULT_QC_USER.id })) });
    }
    if (pathname === '/api/v1/team/users' && method === 'POST') {
      if (!requireAdmin()) return;
      const body = await parseJsonBody(req);
      try {
        const name = String(body.name || '').trim();
        if (!name || name.length > 80) throw new Error('Tên người dùng 1 đến 80 ký tự');
        const { user, token } = await createUser(name, body.role || 'member', body.username || name, body.password || '123456', body.employee_code || '');
        let u = user;
        if (Array.isArray(body.perms) && body.perms.length) u = await setUserAccess(user.id, { perms: body.perms, employee_code: body.employee_code });
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'USER_CREATE', decision: 'ALLOW', reason: `${user.id} (${name}, user=${u.username}), role=${u.role}`, correlationId: `corr_user_${user.id}` });
        return sendJson(res, 201, { success: true, data: { id: user.id, username: u.username, display_name: name, employee_code: u.employee_code || '', role: u.role, perms: u.perms || [], token } });
      } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
    }
    let um;
    if ((um = /^\/api\/v1\/team\/users\/([^/]+)\/(reset-token|reset-password|revoke)$/.exec(pathname)) && method === 'POST') {
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
      if (um[2] === 'reset-password') {
        const body = await parseJsonBody(req);
        try {
          const u = await setPassword(uid, body.password, body.username, body.employee_code);
          await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'USER_RESET_PASSWORD', decision: 'ALLOW', reason: uid, correlationId: `corr_user_${uid}` });
          const payload = { id: uid, username: u.username, employee_code: u.employee_code || '' };
          if (uid === DEFAULT_QC_USER.id && u.session_token) payload.token = u.session_token;
          return sendJson(res, 200, { success: true, data: payload });
        } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
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
        const u = await setUserAccess(uid, { role: body.role, perms: body.perms, username: body.username, password: body.password, employee_code: body.employee_code });
        await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'USER_ACCESS_CHANGE', decision: 'ALLOW', reason: `${uid}: role=${u.role}, perms=${(u.perms || []).join(',') || '-'}`, correlationId: `corr_user_${uid}` });
        return sendJson(res, 200, { success: true, data: { id: u.id, username: u.username, employee_code: u.employee_code || '', role: u.role, perms: u.perms || [] } });
      } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
    }
    // Cập nhật thông tin cá nhân của chính mình (avatar, tên, biệt danh, vai trò, ngày tham gia, mã nhân viên, đổi mật khẩu)
    if (pathname === '/api/v1/me/profile' && method === 'PUT') {
      const body = await parseJsonBody(req);
      try {
        const extraUpdates = {};
        if (body.display_name !== undefined) extraUpdates.display_name = String(body.display_name || '').trim();
        if (body.nickname !== undefined) extraUpdates.nickname = String(body.nickname || '').trim().slice(0, 60);
        if (body.job_title !== undefined) extraUpdates.job_title = String(body.job_title || '').trim().slice(0, 80);
        if (body.joined_at !== undefined) extraUpdates.joined_at = String(body.joined_at || '').trim().slice(0, 20);
        if (body.avatar !== undefined) {
          const av = String(body.avatar || '').trim();
          if (av.length > 250000) throw new Error('Ảnh avatar quá lớn (tối đa ~180KB).');
          extraUpdates.avatar = av;
        }
        let u;
        if (body.password) {
          u = await setPassword(DEFAULT_QC_USER.id, body.password, body.username, body.employee_code);
        } else {
          u = await setUserAccess(DEFAULT_QC_USER.id, { username: body.username, employee_code: body.employee_code });
        }
        if (Object.keys(extraUpdates).length) {
          await db.update('team_users', u.id, extraUpdates);
          Object.assign(u, extraUpdates);
        }
        const token = u.session_token || undefined;
        return sendJson(res, 200, {
          success: true,
          data: {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            employee_code: u.employee_code || '',
            nickname: u.nickname || '',
            job_title: u.job_title || '',
            joined_at: u.joined_at || '',
            avatar: u.avatar || '',
            role: u.role,
            token
          }
        });
      } catch (e) { return sendJson(res, 400, { success: false, error: { message: e.message } }); }
    }
    // ==========================================
    // Quản lý To-do & Note cá nhân trên Dashboard (lưu riêng theo từng user)
    // ==========================================
    if (pathname === '/api/v1/personal-workspace' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: readPersonalWs(DEFAULT_QC_USER.id) });
    }
    if (pathname === '/api/v1/personal-workspace/task-search' && method === 'GET') {
      const q = (urlObj.searchParams.get('q') || '').trim();
      const bugs = BugStore.list({ live: true, q, limit: 10, offset: 0 }).items.map(b => ({ id: b.id, taskType: 'bug', typeLabel: 'Bug', title: b.title, url: b.url, statusLabel: b.status_label || '' }));
      const fns = FunctionStore.list({ q, limit: 10, offset: 0 }).items.map(f => ({ id: f.id, taskType: 'function', typeLabel: 'Function', title: f.title, url: f.url, statusLabel: f.status_label || '' }));
      const bds = buildLive.list({ q, limit: 10, offset: 0 }).items.map(b => ({ id: b.id, taskType: 'build', typeLabel: 'Build', title: b.title, url: b.url, statusLabel: b.status_label || '' }));
      return sendJson(res, 200, { success: true, data: [...bugs, ...fns, ...bds].slice(0, 24) });
    }
    if (pathname === '/api/v1/personal-workspace/todos' && method === 'POST') {
      const body = await parseJsonBody(req);
      const ws = readPersonalWs(DEFAULT_QC_USER.id);
      const cleanLinks = Array.isArray(body.linkedTasks)
        ? body.linkedTasks.slice(0, 15).map(t => ({ id: String(t.id || ''), taskType: String(t.taskType || 'bug'), title: String(t.title || '').slice(0, 200), url: String(t.url || '') })).filter(t => t.id && t.title)
        : undefined;
      if (body.id) {
        const idx = ws.todos.findIndex(x => x.id === body.id);
        if (idx === -1) return sendJson(res, 404, { success: false, error: { message: 'Không tìm thấy công việc.' } });
        if (body.text !== undefined) ws.todos[idx].text = String(body.text).trim().slice(0, 400);
        if (body.done !== undefined) ws.todos[idx].done = !!body.done;
        if (body.dueDate !== undefined) ws.todos[idx].dueDate = String(body.dueDate || '').slice(0, 20);
        if (cleanLinks !== undefined) ws.todos[idx].linkedTasks = cleanLinks;
        ws.todos[idx].updatedAt = new Date().toISOString();
      } else {
        const text = String(body.text || '').trim().slice(0, 400);
        if (!text) return sendJson(res, 400, { success: false, error: { message: 'Vui lòng nhập nội dung To-do.' } });
        ws.todos.unshift({
          id: 'td_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          text,
          done: !!body.done,
          dueDate: String(body.dueDate || '').slice(0, 20),
          linkedTasks: cleanLinks || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      writePersonalWs(DEFAULT_QC_USER.id, ws);
      return sendJson(res, 200, { success: true, data: ws });
    }
    let pwMatch;
    if ((pwMatch = /^\/api\/v1\/personal-workspace\/todos\/([^/]+)$/.exec(pathname)) && method === 'DELETE') {
      const ws = readPersonalWs(DEFAULT_QC_USER.id);
      ws.todos = ws.todos.filter(x => x.id !== pwMatch[1]);
      writePersonalWs(DEFAULT_QC_USER.id, ws);
      return sendJson(res, 200, { success: true, data: ws });
    }
    if (pathname === '/api/v1/personal-workspace/notes' && method === 'POST') {
      const body = await parseJsonBody(req);
      const ws = readPersonalWs(DEFAULT_QC_USER.id);
      const cleanLinks = Array.isArray(body.linkedTasks)
        ? body.linkedTasks.slice(0, 20).map(t => ({ id: String(t.id || ''), taskType: String(t.taskType || 'bug'), title: String(t.title || '').slice(0, 200), url: String(t.url || '') })).filter(t => t.id && t.title)
        : undefined;
      if (body.id) {
        const idx = ws.notes.findIndex(x => x.id === body.id);
        if (idx === -1) return sendJson(res, 404, { success: false, error: { message: 'Không tìm thấy ghi chú.' } });
        if (body.title !== undefined) ws.notes[idx].title = String(body.title).trim().slice(0, 150);
        if (body.content !== undefined) ws.notes[idx].content = String(body.content).slice(0, 4000);
        if (body.pinned !== undefined) ws.notes[idx].pinned = !!body.pinned;
        if (cleanLinks !== undefined) ws.notes[idx].linkedTasks = cleanLinks;
        ws.notes[idx].updatedAt = new Date().toISOString();
      } else {
        const title = String(body.title || '').trim().slice(0, 150);
        const content = String(body.content || '').trim().slice(0, 4000);
        if (!title && !content) return sendJson(res, 400, { success: false, error: { message: 'Vui lòng nhập tiêu đề hoặc nội dung ghi chú.' } });
        ws.notes.unshift({
          id: 'nt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          title: title || 'Ghi chú',
          content,
          pinned: !!body.pinned,
          linkedTasks: cleanLinks || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
      writePersonalWs(DEFAULT_QC_USER.id, ws);
      return sendJson(res, 200, { success: true, data: ws });
    }
    if ((pwMatch = /^\/api\/v1\/personal-workspace\/notes\/([^/]+)$/.exec(pathname)) && method === 'DELETE') {
      const ws = readPersonalWs(DEFAULT_QC_USER.id);
      ws.notes = ws.notes.filter(x => x.id !== pwMatch[1]);
      writePersonalWs(DEFAULT_QC_USER.id, ws);
      return sendJson(res, 200, { success: true, data: ws });
    }
    // Cập nhật token/cookie Haraworks để đồng bộ realtime (lưu cục bộ secrets/haraworks.json trong .gitignore, không lưu DB và không trả lại giao diện)
    if (pathname === '/api/v1/me/haraworks-token' && method === 'POST') {
      const body = await parseJsonBody(req);
      const rawToken = String(body.token || '').trim();
      if (!rawToken) return sendJson(res, 400, { success: false, error: { message: 'Vui lòng nhập token/cookie.' } });
      try {
        const cleanCookie = writeCookie(rawToken);
        bugLive.setCookie(cleanCookie);
        functionLive.setCookie(cleanCookie);
        buildLive.setCookie(cleanCookie);
        notifyLive.setCookie(cleanCookie);
        await PolicyEngine.logAudit({
          actor: DEFAULT_QC_USER,
          action: 'HARAWORKS_TOKEN_UPDATE',
          decision: 'ALLOW',
          reason: 'Cập nhật token/cookie Haraworks để đồng bộ realtime',
          correlationId: `corr_hw_token_${DEFAULT_QC_USER.id}`
        });
        return sendJson(res, 200, { success: true, data: { has_haraworks_token: true } });
      } catch (e) {
        return sendJson(res, 400, { success: false, error: { message: e.message } });
      }
    }
    if (pathname === '/api/v1/me' && method === 'GET') {
      const st = bugLive.status();
      return sendJson(res, 200, {
        success: true,
        data: {
          ...DEFAULT_QC_USER,
          auth_required: authRequired,
          has_haraworks_token: !!st.enabled,
          haraworks_auth_error: !!(st.error && /^AUTH:/.test(st.error))
        }
      });
    }
    if (pathname === '/api/v1/label-colors' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: readEffectiveModulesAndStatuses() });
    }
    if (pathname === '/api/v1/settings/general' && method === 'PUT') {
      const body = await parseJsonBody(req);
      const prev = readLabelColorsRaw();
      const next = {
        module: { ...DEFAULT_LABEL_COLORS.module, ...(prev.module || {}) },
        status: { ...DEFAULT_LABEL_COLORS.status, ...(prev.status || {}) },
        project: { ...DEFAULT_LABEL_COLORS.project, ...(prev.project || {}) },
        custom_modules: [],
        deleted_modules: [],
        module_names: {},
        custom_statuses: [],
        deleted_statuses: [],
        status_names: {}
      };
      const baseMods = new Map((BusinessRuleStore.load().modules || []).map(m => [String(m.code), m.name]));
      if (Array.isArray(body.modules)) {
        const seenMod = new Set();
        for (const m of body.modules) {
          const code = String(m?.code || '').trim().toUpperCase();
          const name = String(m?.name || code).trim();
          const color = /^#[0-9a-f]{6}$/i.test(String(m?.color || '')) ? String(m.color).toLowerCase() : '#3b82f6';
          if (!code) continue;
          seenMod.add(code);
          next.module[code] = color;
          if (baseMods.has(code)) {
            if (name && name !== baseMods.get(code)) next.module_names[code] = name;
          } else {
            next.custom_modules.push({ code, name, color });
          }
        }
        for (const bc of baseMods.keys()) {
          if (!seenMod.has(bc)) next.deleted_modules.push(bc);
        }
      }
      if (Array.isArray(body.statuses)) {
        const seenSt = new Set();
        for (const s of body.statuses) {
          const code = String(s?.code ?? '').trim();
          const name = String(s?.name || code).trim();
          const color = /^#[0-9a-f]{6}$/i.test(String(s?.color || '')) ? String(s.color).toLowerCase() : '#6b7280';
          if (code === '') continue;
          seenSt.add(code);
          next.status[code] = color;
          if (Object.prototype.hasOwnProperty.call(STATUS_LABELS, code)) {
            if (name && name !== STATUS_LABELS[code]) next.status_names[code] = name;
          } else {
            next.custom_statuses.push({ code, name, color });
          }
        }
        for (const bs of Object.keys(STATUS_LABELS)) {
          if (!seenSt.has(bs)) next.deleted_statuses.push(bs);
        }
      }
      if (Array.isArray(body.projects)) {
        for (const p of body.projects) {
          const code = String(p?.code || p?.name || '').trim();
          const color = /^#[0-9a-f]{6}$/i.test(String(p?.color || '')) ? String(p.color).toLowerCase() : '';
          if (code && color) next.project[code] = color;
        }
      }
      writeLabelColors(next);
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'GENERAL_SETTINGS_UPDATE', decision: 'ALLOW', reason: 'Cập nhật cấu hình Module và Trạng thái', correlationId: `corr_general_${Date.now()}` });
      return sendJson(res, 200, { success: true, data: readEffectiveModulesAndStatuses() });
    }
    if (pathname === '/api/v1/label-colors' && method === 'PUT') {
      if (!requireAdmin()) return;
      const body = await parseJsonBody(req);
      const incoming = body.colors || {};
      const prev = readLabelColorsRaw();
      const eff = readEffectiveModulesAndStatuses();
      const moduleCodes = new Set(eff.modules.map(m => String(m.code)));
      const statusCodes = new Set(eff.statuses.map(s => String(s.code)));
      const colors = { ...prev, module: { ...DEFAULT_LABEL_COLORS.module, ...(prev.module || {}) }, status: { ...DEFAULT_LABEL_COLORS.status, ...(prev.status || {}) } };
      for (const [group, allowed] of [['module', moduleCodes], ['status', statusCodes]]) {
        const values = incoming[group] || {};
        if (!values || typeof values !== 'object' || Array.isArray(values)) return sendJson(res, 400, { success: false, error: { message: `Cấu hình màu ${group} không hợp lệ.` } });
        for (const [code, color] of Object.entries(values)) {
          if (!allowed.has(code) || !/^#[0-9a-f]{6}$/i.test(String(color))) {
            return sendJson(res, 400, { success: false, error: { message: `Mã màu ${group} không hợp lệ.` } });
          }
          colors[group][code] = String(color).toLowerCase();
        }
      }
      writeLabelColors(colors);
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'LABEL_COLORS_UPDATE', decision: 'ALLOW', reason: 'Cập nhật màu nhãn module và trạng thái', correlationId: `corr_label_colors_${Date.now()}` });
      return sendJson(res, 200, { success: true, data: { colors: readLabelColors() } });
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
      const username = String(body.username || '').trim();
      const role = String(body.role || '').trim();
      if (!username || !role || !body.environment_profile_id) return sendJson(res, 400, { success: false, error: { message: 'Cần nhập Role, Username và môi trường.' } });
      const record = await db.insert('account_profiles', {
        name: String(body.name || '').trim() || username,
        role,
        environment_profile_id: body.environment_profile_id,
        username_ref: username,
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

    let accountMatch;
    if ((accountMatch = /^\/api\/v1\/accounts\/([^/]+)$/.exec(pathname)) && method === 'PUT') {
      const id = accountMatch[1];
      const account = await db.findById('account_profiles', id);
      if (!account) return sendJson(res, 404, { success: false, error: { message: 'Không tìm thấy tài khoản' } });
      const body = await parseJsonBody(req);
      const username = String(body.username || '').trim();
      const role = String(body.role || '').trim();
      const name = String(body.name || '').trim() || username;
      if (!username || !role || !name) return sendJson(res, 400, { success: false, error: { message: 'Cần nhập Tên người dùng, vai trò và Username.' } });
      const accountEnv = await db.findById('environment_profiles', account.environment_profile_id);
      if (!accountEnv) return sendJson(res, 404, { success: false, error: { message: 'Không tìm thấy môi trường của tài khoản' } });
      const { routes, errors } = parseRouteLines(String(body.routes_text || ''), accountEnv);
      if (errors.length) return sendJson(res, 400, { success: false, error: { message: errors.join('; ') } });
      if (!routes.length) return sendJson(res, 400, { success: false, error: { message: 'Cần ít nhất một link' } });
      const updated = await db.update('account_profiles', id, {
        name, role, username_ref: username, routes, default_route: routes[0].url
      });
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'ACCOUNT_UPDATE', decision: 'ALLOW', reason: `Cập nhật tài khoản ${id}`, correlationId: `corr_account_${id}` });
      return sendJson(res, 200, { success: true, data: { ...updated, has_secret: SecretVault.has(id) } });
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
        // Code mới được chấp nhận ngay; người dùng cần đọc kỹ trước khi lưu.
        saved = await db.update('automation_tasks', existing.id, { ...task, status: 'approved', approved_sha: task.script_sha, approved_by: 'auto', approved_at: new Date().toISOString() });
      } else {
        saved = await db.insert('automation_tasks', { ...task, id: task.id || `at_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, status: 'approved', approved_sha: task.script_sha, approved_by: 'auto', approved_at: new Date().toISOString(), created_by: DEFAULT_QC_USER.id, created_at: new Date().toISOString() });
      }
      await PolicyEngine.logAudit({ actor: DEFAULT_QC_USER, action: 'AUTOMATION_TASK_SAVE', decision: 'ALLOW', reason: `${saved.id} (${saved.name}) sha ${saved.script_sha.slice(0, 12)}`, correlationId: `corr_at_${saved.id}` });
      return sendJson(res, 201, { success: true, data: { ...saved, runnable: isRunnable(saved) } });
    }
    let repair;
    if ((repair = /^\/api\/v1\/automation\/tasks\/([^/]+)\/repair$/.exec(pathname)) && method === 'POST') {
      if (!requireAdmin(['automation', 'automation_push'])) return;
      const task = await db.findById('automation_tasks', repair[1]);
      if (!task || task.status === 'retired') return jerr(404, 'Không thấy tác vụ');
      const body = await parseJsonBody(req);
      if (typeof body.error !== 'string' || !body.error.trim()) return jerr(400, 'Cần dán lỗi của lần chạy để AI phân tích.');
      if (body.error.length > 10000) return jerr(413, 'Lỗi chạy quá dài (tối đa 10000 ký tự).');
      let repairTask = task;
      if (body.script !== undefined) {
        if (typeof body.script !== 'string' || !body.script.trim()) return jerr(400, 'Code hiện tại không hợp lệ.');
        if (body.script.length > 20000) return jerr(413, 'Code quá dài (tối đa 20000 ký tự).');
        const scriptErrors = validateScript(body.script);
        if (scriptErrors.length) return jerr(400, scriptErrors.join('; '));
        repairTask = { ...task, script: body.script };
      }
      const providers = [
        process.env.GEMINI_API_KEY && { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, baseUrl: process.env.GEMINI_BASE_URL || undefined },
        process.env.ANTHROPIC_API_KEY && { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined }
      ].filter(Boolean);
      if (!providers.length) return jerr(503, 'Chưa cấu hình GEMINI_API_KEY hoặc ANTHROPIC_API_KEY trên server.');
      const failures = [];
      for (let i = 0; i < providers.length; i++) {
        const ai = providers[i];
        try {
          const suggestion = await suggestAutomationFix(repairTask, body.error, { ...ai, model: i === 0 ? process.env.QA_AI_MODEL || undefined : undefined });
          const errors = validateScript(suggestion.script);
          if (errors.length) return jerr(422, errors.join('; '));
          const fallbackNote = failures.length ? `Nhà cung cấp chính gặp sự cố (${failures[0]}); đã dùng dự phòng. ` : '';
          const providerName = suggestion.provider === 'gemini' ? 'Gemini' : 'Claude';
          return sendJson(res, 200, {
            success: true,
            data: {
              script: suggestion.script,
              engine_note: `${fallbackNote}Đề xuất từ ${providerName} (${suggestion.model}); hãy đọc kỹ code trước khi lưu.`
            }
          });
        } catch (e) {
          const status = Number(e.status) || 502;
          failures.push(e.message);
          const transient = status === 408 || status === 425 || status === 429 || status >= 500;
          if (!transient || i === providers.length - 1) return jerr(status, `Không nhận được đề xuất sửa code: ${failures.join(' · ')}`);
        }
      }
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
      const allFiles = await db.find('automation_files', () => true);
      if (allFiles.length >= 100) {
        const oldest = allFiles.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).slice(0, allFiles.length - 99);
        for (const old of oldest) {
          try { fs.rmSync(path.join(FILES_DIR, old.stored), { force: true }); } catch {}
          await db.delete('automation_files', old.id);
        }
      }
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
        module: q.get('module') || '', project: q.get('project') || '', q: q.get('q') || '', category: q.get('category') || '', year: q.get('year') || '',
        status: q.get('status') || '', assignee: q.get('assignee') || '', approver: q.get('approver') || '', closed: q.get('closed') || '', age: q.get('age') || '', sort: q.get('sort') || 'created', live: q.get('live') === '1',
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
    if (pathname === '/api/v1/sync-all' && method === 'POST') {
      bugLive.trigger('đồng bộ toàn bộ');
      functionLive.trigger('đồng bộ toàn bộ');
      buildLive.trigger('đồng bộ toàn bộ');
      notifyLive.trigger('đồng bộ toàn bộ');
      return sendJson(res, 202, {
        success: true,
        data: {
          enabled: bugLive.enabled,
          bugs: bugLive.status(),
          functions: functionLive.status(),
          builds: buildLive.status()
        }
      });
    }
    if (pathname === '/api/v1/bugs/live/refresh' && method === 'POST') {
      bugLive.trigger('người dùng yêu cầu');
      return sendJson(res, 202, { success: true, data: { enabled: bugLive.enabled } });
    }
    if (pathname === '/api/v1/bugs/today-mentions' && method === 'GET') {
      const foldTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
      const targets = [DEFAULT_QC_USER.display_name, DEFAULT_QC_USER.username, DEFAULT_QC_USER.employee_code].map(foldTxt).filter(t => t.length >= 2);
      const meFold = foldTxt(DEFAULT_QC_USER.display_name);
      const todayBugs = BugStore.list({ live: true, sort: 'created', offset: 0, limit: 100 }).items.filter(b => b.is_today).slice(0, 25);
      const mentions = [];
      const hasMention = (txt) => {
        const f = foldTxt(txt);
        if (!f) return false;
        return targets.some(t => {
          const escRe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`(?:^|[^a-z0-9])${escRe}(?:$|[^a-z0-9])`, 'i').test(f);
        });
      };
      for (let i = 0; i < todayBugs.length; i += 5) {
        const chunk = todayBugs.slice(i, i + 5);
        await Promise.all(chunk.map(async (b) => {
          try {
            const detail = await getBugDetail(b.id);
            for (const c of (detail.comments?.items || [])) {
              if (foldTxt(c.by) !== meFold && hasMention(c.text)) {
                mentions.push({ commentId: c.id, bugId: b.id, bugTitle: b.title, bugUrl: b.url, by: c.by || '', text: c.text || '', at: c.at || '' });
              }
              for (const r of (c.replies || [])) {
                if (foldTxt(r.by) !== meFold && hasMention(r.text)) {
                  mentions.push({ commentId: r.id, bugId: b.id, bugTitle: b.title, bugUrl: b.url, by: r.by || '', text: r.text || '', at: r.at || '' });
                }
              }
            }
          } catch {}
        }));
      }
      mentions.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return sendJson(res, 200, { success: true, data: mentions });
    }

    // ==========================================
    // My Tasks Dashboard (Jira-inspired Kanban, Gantt, Metrics & Reminders)
    // ==========================================
    if (pathname === '/api/v1/my-tasks' && method === 'GET') {
      const period = urlObj.searchParams.get('period') || 'week';
      const foldTxt = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
      const codeTarget = foldTxt(DEFAULT_QC_USER.employee_code || '');
      const nameTarget = foldTxt(DEFAULT_QC_USER.display_name || '');
      const userTargets = [DEFAULT_QC_USER.display_name, DEFAULT_QC_USER.username].map(foldTxt).filter(t => t.length >= 2);

      // Quét Bug tasks, QC Function child tasks & Release Function tasks (HRWs - RELEASE CHECKLIST)
      const allBugs = BugStore.list({ live: true, sort: 'created', offset: 0, limit: 2000 }).items;
      const allQcFns = FunctionStore.listQc();
      const allReleaseFns = buildLive.list({ kind: 'function', offset: 0, limit: 2000 }).items;

      if (!globalThis.__qaColleagueHrMap) globalThis.__qaColleagueHrMap = new Map();
      const hrMap = globalThis.__qaColleagueHrMap;
      if (codeTarget) {
        const cookie = readCookie();
        const baseUrl = process.env.HARAWORKS_BASE_URL || 'https://tasks.haraworks.vn';
        const missingIds = [];
        for (const t of [...allBugs, ...allQcFns]) {
          const aid = t.assigneeId ? String(t.assigneeId) : '';
          if (aid && !hrMap.has(aid) && !missingIds.includes(aid)) missingIds.push(aid);
        }
        if (cookie && missingIds.length) {
          for (let i = 0; i < Math.min(missingIds.length, 40); i += 10) {
            const chunk = missingIds.slice(i, i + 10);
            await Promise.all(chunk.map(async (aid) => {
              try {
                const r = await fetch(`${baseUrl}/call/hr_api/colleague?HaraId=${encodeURIComponent(aid)}`, { headers: { cookie, accept: 'application/json' } });
                if (!r.ok) { hrMap.set(aid, null); return; }
                const j = await r.json();
                const d = j?.data || {};
                const hrId = foldTxt(d.hrId || d.hr_Id || d.employeeCode || d.staffCode || d.code || '');
                const fullName = foldTxt(d.fullName || d.name || '');
                hrMap.set(aid, { hrId, fullName });
              } catch { hrMap.set(aid, null); }
            }));
          }
        }
      }

      const detectMyRole = (task) => {
        const aFold = foldTxt(task.assignee || '');
        const apFold = foldTxt(task.approver || '');
        const aid = task.assigneeId ? String(task.assigneeId) : '';
        const col = aid ? hrMap.get(aid) : null;

        let isAssignee = false;
        let isApprover = false;

        if (codeTarget) {
          if (col?.hrId && col.hrId === codeTarget) isAssignee = true;
          if (aFold && aFold.includes(codeTarget)) isAssignee = true;
          if (apFold && apFold.includes(codeTarget)) isApprover = true;
        }
        if (nameTarget) {
          if (aFold && (aFold === nameTarget || aFold.includes(nameTarget) || nameTarget.includes(aFold))) isAssignee = true;
          if (apFold && (apFold === nameTarget || apFold.includes(nameTarget) || nameTarget.includes(apFold))) isApprover = true;
        }
        for (const t of userTargets) {
          if (aFold && (aFold === t || aFold.includes(t))) isAssignee = true;
          if (apFold && (apFold === t || apFold.includes(t))) isApprover = true;
        }
        if (isAssignee) return 'assignee';
        if (isApprover) return 'approver';
        return null;
      };

      const now = new Date();
      const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
      const nowMs = now.getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Tính khoảng thời gian cho bộ lọc (Tuần này, Tháng này, 30 ngày gần đây, Năm, Tất cả)
      const vnNow = new Date(todayStr + 'T12:00:00+07:00');
      const dayOfWeek = (vnNow.getDay() + 6) % 7; // 0 = Thứ 2
      const mondayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(vnNow.getTime() - dayOfWeek * oneDayMs));
      const sundayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(vnNow.getTime() + (6 - dayOfWeek) * oneDayMs));
      const monthPrefix = todayStr.slice(0, 7);
      const thirtyDaysAgoStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(vnNow.getTime() - 30 * oneDayMs));

      const inPeriod = (t) => {
        if (period === 'all') return true;
        const cDate = String(t.createdAt || '').slice(0, 10);
        if (!cDate) return false;
        if (period === 'week') return cDate >= mondayStr && cDate <= sundayStr;
        if (period === 'month') return cDate.startsWith(monthPrefix);
        if (period === '30d') return cDate >= thirtyDaysAgoStr;
        if (/^\d{4}$/.test(period)) return cDate.startsWith(period);
        return true;
      };

      const CLOSED_STATUS_SET = new Set([5, 11]); // Hoàn thành (5), Không thực hiện (11)
      const HIDDEN_CLOSED_SET = new Set([10, 11]); // Task bị đóng (Không xử lý / Không thực hiện) -> không hiện trong dashboard
      const allMatchedTasks = [];
      const yearSet = new Set([todayStr.slice(0, 4)]);

      const isInTimelineToday = (startAt, endAt, createdAt) => {
        const s = String(startAt || '').slice(0, 10);
        const e = String(endAt || '').slice(0, 10);
        const c = String(createdAt || '').slice(0, 10);
        if (s && e) return s <= todayStr && todayStr <= e;
        if (e) return todayStr <= e;
        if (s) return s <= todayStr;
        return c === todayStr;
      };

      for (const b of allBugs) {
        if (HIDDEN_CLOSED_SET.has(b.status)) continue;
        const myRole = detectMyRole(b);
        if (!myRole) continue;
        const isClosed = CLOSED_STATUS_SET.has(b.status);
        const missing = [];
        if (!b.customer || !String(b.customer).trim()) missing.push('Khách hàng');
        if (!b.module && !b.module_custom && !b.module_name) missing.push('Ứng dụng');
        if (!b.platform || !String(b.platform).trim()) missing.push('Nền tảng');
        if (!b.classification && !b.category) missing.push('Phân loại');
        if (!b.severity && b.priority == null) missing.push('Độ nghiêm trọng');

        const deadline = b.plan_end_at || '';
        const startAt = b.plan_start_at || b.date || '';
        let isOverdue = false;
        let isDueToday = false;
        if (deadline && !isClosed) {
          const dDate = deadline.slice(0, 10);
          if (dDate < todayStr) isOverdue = true;
          else if (dDate === todayStr) isDueToday = true;
        }
        const createdMs = b.date ? new Date(b.date).getTime() : 0;
        // Task gán mới trong 24h: chỉ lấy task bug đã gán tôi là người thực hiện
        const isAssigned24h = myRole === 'assignee' && (nowMs - createdMs) <= oneDayMs;
        const inTimeline = !isClosed && isInTimelineToday(startAt, deadline, b.date);
        const isNeedToDoToday = !isClosed && (isOverdue || myRole === 'assignee' || (myRole === 'approver' && inTimeline));
        if (b.date && /^\d{4}/.test(b.date)) yearSet.add(b.date.slice(0, 4));

        allMatchedTasks.push({
          id: b.id,
          taskType: 'bug',
          typeLabel: 'Bug',
          myRole,
          myRoleLabel: myRole === 'assignee' ? 'Tôi thực hiện' : 'Tôi duyệt',
          title: b.title,
          url: b.url,
          status: b.status,
          statusLabel: b.status_label || 'Mới',
          priority: b.priority,
          priorityLabel: b.priority_label || 'Không ưu tiên',
          assignee: b.assignee,
          approver: b.approver,
          module: b.module || b.module_custom || '',
          moduleName: b.module_name || b.module || '',
          customer: b.customer || '',
          platform: b.platform || '',
          classification: b.classification || b.category || '',
          severity: b.severity || '',
          project: b.project || '',
          createdAt: b.date || '',
          updatedAt: b.updated || '',
          startAt,
          endAt: deadline,
          closed: isClosed,
          missingFields: missing,
          isMissingInfo: missing.length > 0,
          isOverdue,
          isDueToday,
          isAssigned24h,
          isNeedToDoToday
        });
      }

      for (const f of allQcFns) {
        if (HIDDEN_CLOSED_SET.has(f.status)) continue;
        const myRole = detectMyRole(f);
        if (myRole !== 'assignee') continue; // Đối với task function: track task con có tiền tố QC được gán cho user
        const isClosed = CLOSED_STATUS_SET.has(f.status);
        const deadline = f.plan_end_at || '';
        const startAt = f.plan_start_at || f.date || '';
        let isOverdue = false;
        let isDueToday = false;
        if (deadline && !isClosed) {
          const dDate = deadline.slice(0, 10);
          if (dDate < todayStr) isOverdue = true;
          else if (dDate === todayStr) isDueToday = true;
        }
        const isAssigned24h = false;
        const inTimeline = !isClosed && isInTimelineToday(startAt, deadline, f.date);
        const isNeedToDoToday = !isClosed && (isOverdue || inTimeline);
        if (f.date && /^\d{4}/.test(f.date)) yearSet.add(f.date.slice(0, 4));

        allMatchedTasks.push({
          id: f.id,
          taskType: 'function',
          typeLabel: 'Task Function',
          myRole: 'assignee',
          myRoleLabel: 'Tôi thực hiện',
          title: f.title,
          url: f.url,
          status: f.status,
          statusLabel: f.status_label || 'Mới',
          priority: f.priority,
          priorityLabel: f.priority_label || 'Không ưu tiên',
          assignee: f.assignee,
          approver: f.approver,
          module: f.module || f.module_custom || '',
          moduleName: f.module_name || f.module || '',
          customer: f.customer || '',
          platform: f.platform || '',
          classification: f.classification || f.category || '',
          severity: f.severity || '',
          team: f.team || f.project || '',
          project: f.project || '',
          createdAt: f.date || '',
          updatedAt: f.updated || '',
          startAt,
          endAt: deadline,
          closed: isClosed,
          missingFields: [],
          isMissingInfo: false,
          isOverdue,
          isDueToday,
          isAssigned24h,
          isNeedToDoToday
        });
      }

      for (const rf of allReleaseFns) {
        if (HIDDEN_CLOSED_SET.has(rf.status)) continue;
        const myRole = detectMyRole(rf);
        if (myRole !== 'assignee') continue; // Task Release: chỉ track những task tôi là người thực hiện
        const isClosed = CLOSED_STATUS_SET.has(rf.status);
        const deadline = rf.plan_end_at || '';
        const startAt = rf.plan_start_at || '';
        const hasAssignedDates = !!(startAt || deadline);
        let isOverdue = false;
        let isDueToday = false;
        if (deadline && !isClosed) {
          const dDate = deadline.slice(0, 10);
          if (dDate < todayStr) isOverdue = true;
          else if (dDate === todayStr) isDueToday = true;
        }
        const isAssigned24h = false;
        const inTimeline = !isClosed && hasAssignedDates && isInTimelineToday(startAt, deadline, '');
        const isNeedToDoToday = !isClosed && hasAssignedDates && (isOverdue || inTimeline);
        if (rf.date && /^\d{4}/.test(rf.date)) yearSet.add(rf.date.slice(0, 4));

        allMatchedTasks.push({
          id: rf.id,
          taskType: 'release',
          subType: 'release',
          typeLabel: 'Release Function',
          myRole: 'assignee',
          myRoleLabel: 'Tôi thực hiện',
          title: rf.title,
          url: rf.url,
          status: rf.status,
          statusLabel: rf.status_label || 'Mới',
          priority: rf.priority,
          priorityLabel: rf.priority_label || 'Không ưu tiên',
          assignee: rf.assignee,
          approver: rf.approver,
          module: rf.module || '',
          moduleName: rf.module || '',
          customer: '',
          platform: '',
          classification: '',
          severity: '',
          team: rf.project || 'HRWs - RELEASE CHECKLIST',
          project: rf.project || 'HRWs - RELEASE CHECKLIST',
          createdAt: rf.date || '',
          updatedAt: rf.updated || '',
          startAt,
          endAt: deadline,
          closed: isClosed,
          missingFields: [],
          isMissingInfo: false,
          isOverdue,
          isDueToday,
          isAssigned24h,
          isNeedToDoToday
        });
      }

      // Helper kiểm tra task có thuộc hôm nay hoặc tương lai hay không
      const isTodayOrFutureTask = (t) => {
        if (t.closed || HIDDEN_CLOSED_SET.has(t.status)) return false;
        const s = String(t.startAt || '').slice(0, 10);
        const e = String(t.endAt || '').slice(0, 10);
        const c = String(t.createdAt || '').slice(0, 10);
        if (e && e >= todayStr) return true;
        if (s && s >= todayStr) return true;
        if (!e && !s && c && c >= todayStr) return true;
        return false;
      };

      // Áp dụng bộ lọc thời gian chung cho Kanban, Gantt và Charts
      // Riêng task Release Function: luôn hiện các task trong tương lai (từ hôm nay trở đi), quá khứ thì theo bộ lọc
      // Task chưa đóng mà đã trễ hạn hoặc hết hạn hôm nay luôn hiện, bất kể ngày tạo (nếu không, bug tạo từ tuần trước sẽ biến mất khỏi mục Trễ hạn)
      const myTasks = allMatchedTasks.filter(t => {
        if (t.taskType === 'release') {
          if (isTodayOrFutureTask(t)) return true;
        }
        if (!t.closed && (t.isOverdue || t.isDueToday)) return true;
        return inPeriod(t);
      });

      const total = myTasks.length;
      const openTasks = myTasks.filter(t => !t.closed);
      const closedTasks = myTasks.filter(t => t.closed);
      const overdueTasks = myTasks.filter(t => t.isOverdue);
      const dueTodayTasks = myTasks.filter(t => t.isDueToday);
      const missingInfoBugs = myTasks.filter(t => t.taskType === 'bug' && t.isMissingInfo);
      const newAssigned24h = myTasks.filter(t => t.isAssigned24h);

      const priOrder = p => ({ 1: 0, 2: 0, 3: 1, 4: 2 })[p] ?? 3;
      // To do: luôn lấy tất cả task trạng thái Mới từ hôm nay đến tương lai (không áp dụng bộ lọc thời gian, không lấy task quá khứ không hạn hoặc đã đóng)
      const todoItems = allMatchedTasks
        .filter(t => (t.status === 0 || t.status == null) && !t.closed && !HIDDEN_CLOSED_SET.has(t.status) && (isTodayOrFutureTask(t) || t.isOverdue))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || priOrder(a.priority) - priOrder(b.priority));

      // Future tasks: các task chưa đóng có thời gian ở hôm nay hoặc tương lai (luôn hiện trên Gantt chart)
      const futureTasks = allMatchedTasks.filter(t => isTodayOrFutureTask(t));

      const kanban = {
        todo: todoItems,
        inProgress: myTasks.filter(t => t.status === 1),
        paused: myTasks.filter(t => t.status === 2 || t.status === 3 || t.status === 4 || t.status === 6),
        done: myTasks.filter(t => t.status === 5)
      };

      const byType = { bug: myTasks.filter(t => t.taskType === 'bug').length, function: myTasks.filter(t => t.taskType === 'function').length };
      const byStatus = {
        'Mới (To do)': kanban.todo.length,
        'Đang thực hiện': kanban.inProgress.length,
        'Tạm ngưng': kanban.paused.length,
        'Hoàn thành': kanban.done.length
      };

      const byPriority = { 'Ưu tiên cao': 0, 'Ưu tiên': 0, 'Không ưu tiên': 0, 'Chưa gắn': 0 };
      myTasks.forEach(t => {
        if (t.priority === 1 || t.priority === 2) byPriority['Ưu tiên cao']++;
        else if (t.priority === 3) byPriority['Ưu tiên']++;
        else if (t.priority === 4) byPriority['Không ưu tiên']++;
        else byPriority['Chưa gắn']++;
      });

      return sendJson(res, 200, {
        success: true,
        data: {
          period,
          years: [...yearSet].sort((a, b) => b.localeCompare(a)),
          projects: [...new Set(allMatchedTasks.map(t => t.project || t.team).filter(Boolean))].sort(),
          user: {
            id: DEFAULT_QC_USER.id,
            display_name: DEFAULT_QC_USER.display_name,
            username: DEFAULT_QC_USER.username,
            employee_code: DEFAULT_QC_USER.employee_code || ''
          },
          summary: {
            total,
            open: openTasks.length,
            closed: closedTasks.length,
            overdue: overdueTasks.length,
            dueToday: dueTodayTasks.length,
            missingInfoBugs: missingInfoBugs.length,
            assigned24h: newAssigned24h.length
          },
          kanban,
          charts: {
            byType,
            byStatus,
            byPriority
          },
          tasks: myTasks,
          todoTasks: todoItems,
          futureTasks
        }
      });
    }

    // ==========================================
    // Tra Cứu Task Function Realtime (4 dự án Team trên Haraworks từ 01/01/2024)
    // ==========================================
    if (pathname === '/api/v1/functions/meta' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: { ...FunctionStore.meta(), facets: FunctionStore.facets() } });
    }
    if (pathname === '/api/v1/functions' && method === 'GET') {
      const q = urlObj.searchParams;
      return sendJson(res, 200, { success: true, data: FunctionStore.list({
        team: q.get('team') || '', projectId: q.get('projectId') || '',
        module: q.get('module') || '', q: q.get('q') || '', category: q.get('category') || '', year: q.get('year') || '',
        status: q.get('status') || '', assignee: q.get('assignee') || '', approver: q.get('approver') || '', closed: q.get('closed') || '', age: q.get('age') || '', sort: q.get('sort') || 'created',
        unknown: q.get('unknown') === '1', offset: Math.max(0, +q.get('offset') || 0), limit: Math.min(200, +q.get('limit') || 50)
      }) });
    }
    {
      const fdm = /^\/api\/v1\/functions\/([0-9a-f]{24})\/detail$/.exec(pathname);
      if (fdm && method === 'GET') {
        try { return sendJson(res, 200, { success: true, data: await getBugDetail(fdm[1]) }); }
        catch (e) {
          const code = e.code || 'ERROR';
          return sendJson(res, code === 'NO_COOKIE' || code === 'AUTH' ? 503 : code === 'NOT_FOUND' ? 404 : 502, { success: false, error: { code, message: e.message } });
        }
      }
    }
    if (pathname === '/api/v1/functions/live' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: { ...functionLive.status(), revision: FunctionStore.liveRevision() } });
    }
    if (pathname === '/api/v1/functions/live/refresh' && method === 'POST') {
      functionLive.trigger('người dùng yêu cầu');
      return sendJson(res, 202, { success: true, data: { enabled: functionLive.enabled } });
    }

    // ==========================================
    // Notification Realtime từ Haraworks
    // ==========================================
    if (pathname === '/api/v1/notifications' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: notifyLive.state(DEFAULT_QC_USER.id) });
    }
    if (pathname === '/api/v1/notifications/mark-seen' && method === 'POST') {
      const body = await parseJsonBody(req);
      return sendJson(res, 200, { success: true, data: notifyLive.markSeen(DEFAULT_QC_USER.id, body.id || '') });
    }
    if (pathname === '/api/v1/notifications/refresh' && method === 'POST') {
      notifyLive.trigger('người dùng yêu cầu');
      return sendJson(res, 202, { success: true, data: { enabled: notifyLive.enabled } });
    }

    // ==========================================
    // Theo dõi Đợt Build App Mobile & Build Task Function
    // ==========================================
    if (pathname === '/api/v1/builds/meta' && method === 'GET') {
      const st = buildLive.status();
      const facets = buildLive.facets();
      const projFacets = { ...(facets.projects || {}) };
      for (const teamName of ['Super Team', 'Winx Team', 'Integrity Team', 'Team 1']) {
        if (!projFacets[teamName]) projFacets[teamName] = 0;
      }
      return sendJson(res, 200, { success: true, data: { count: st.count, lastSyncAt: st.lastSyncAt, revision: st.revision, facets: { ...facets, projects: projFacets } } });
    }
    if (pathname === '/api/v1/builds' && method === 'GET') {
      const q = urlObj.searchParams;
      const projParam = q.get('project') || '';
      const isTeamProj = ['Super Team', 'Winx Team', 'Integrity Team', 'Team 1'].includes(projParam);
      const data = buildLive.list({
        kind: q.get('kind') || '', project: isTeamProj ? '' : projParam, q: q.get('q') || '', status: q.get('status') || '',
        closed: q.get('closed') || '', assignee: q.get('assignee') || '', year: q.get('year') || '',
        sort: q.get('sort') || 'created',
        offset: isTeamProj ? 0 : Math.max(0, +q.get('offset') || 0),
        limit: isTeamProj ? 2000 : Math.min(200, +q.get('limit') || 50)
      });
      data.items = (data.items || []).map(b => {
        const src = FunctionStore.findSource({ ids: b.linked_ids, title: b.title, sourceTitle: b.source_title, selfId: b.id });
        return { ...b, source_function: src, source_team: src?.team || '' };
      });
      if (isTeamProj) {
        const filtered = data.items.filter(b => b.source_team === projParam);
        const off = Math.max(0, +q.get('offset') || 0);
        const lim = Math.min(200, +q.get('limit') || 50);
        data.total = filtered.length;
        data.items = filtered.slice(off, off + lim);
      }
      return sendJson(res, 200, { success: true, data });
    }
    if (pathname === '/api/v1/builds/check' && method === 'GET') {
      const q = urlObj.searchParams;
      return sendJson(res, 200, { success: true, data: buildLive.checkTask({ id: q.get('id') || '', title: q.get('title') || '' }) });
    }
    if (pathname === '/api/v1/builds/live' && method === 'GET') {
      return sendJson(res, 200, { success: true, data: buildLive.status() });
    }
    if (pathname === '/api/v1/builds/live/refresh' && method === 'POST') {
      buildLive.trigger('người dùng yêu cầu');
      return sendJson(res, 202, { success: true, data: { enabled: buildLive.enabled } });
    }
    {
      const bdm = /^\/api\/v1\/builds\/([0-9a-f]{24})\/detail$/.exec(pathname);
      if (bdm && method === 'GET') {
        try { return sendJson(res, 200, { success: true, data: await getBugDetail(bdm[1]) }); }
        catch (e) {
          const code = e.code || 'ERROR';
          return sendJson(res, code === 'NO_COOKIE' || code === 'AUTH' ? 503 : code === 'NOT_FOUND' ? 404 : 502, { success: false, error: { code, message: e.message } });
        }
      }
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
      const age = ['new', 'old'].includes(body.age) ? body.age : '';
      return sendJson(res, 200, { success: true, data: {
        module_guess: guess, module_used: used, artifact_url: rules.artifact_url,
        rules: rules.rules,
        bugs: BugStore.similar(text, used, 10, age),
        functions: FunctionStore.similar(text, used, 10, age)
      } });
    }

    // AI phân tích bug: nguyên nhân có thể, nơi cần kiểm tra, tác vụ tự động gợi ý
    if (pathname === '/api/v1/bug-analysis' && method === 'POST') {
      const body = await parseJsonBody(req, 15 * 1024 * 1024);
      const text = String(body.text || '').slice(0, 4000);
      if (text.trim().length < 8) return sendJson(res, 400, { success: false, error: { message: 'Mô tả quá ngắn' } });
      let attachments = normalizeAnalysisAttachments(body.attachments);
      // Nạp ảnh từ bug realtime: server tự lấy ảnh theo mã bug (không nhận địa chỉ ảnh từ trình duyệt)
      let liveNote = '';
      if (body.bug_id && /^[0-9a-f]{24}$/.test(String(body.bug_id))) {
        const room = MAX_ANALYSIS_FILES - attachments.length;
        const used = attachments.reduce((n, a) => n + (a.size || 0), 0);
        if (room > 0) {
          try {
            const got = await fetchBugImages(body.bug_id, { max: room, maxBytes: Math.max(0, Math.min(4 * 1024 * 1024, MAX_ANALYSIS_BYTES - used)) });
            if (got.images.length) attachments = attachments.concat(normalizeAnalysisAttachments(got.images.map(i => ({ ...i }))).slice(0, room));
            liveNote = got.found ? ` Đã nạp ${got.images.length}/${got.found} ảnh từ bug realtime.` : ' Bug realtime này không có ảnh.';
          } catch (e) { liveNote = ` Không nạp được ảnh từ bug realtime (${e.message}).`; }
        }
      }
      const used = body.module || '';
      const guess = used ? '' : guessModule(text);
      const rules = similarRules(text, used, 8).rules;
      const bugs = BugStore.similar(text, used, 10);
      const taskModule = used || guess;
      const tasks = await db.find('automation_tasks', t => t.status !== 'retired' && taskModule && t.module === taskModule);
      const input = { text, moduleUsed: used, moduleGuess: guess, platform: body.platform === 'Mobile' ? 'Mobile' : 'Web', rules, bugs, tasks, attachments };
      let out;
      const ai = process.env.GEMINI_API_KEY ? { provider: 'gemini', apiKey: process.env.GEMINI_API_KEY, baseUrl: process.env.GEMINI_BASE_URL || undefined }
        : process.env.ANTHROPIC_API_KEY ? { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, baseUrl: process.env.ANTHROPIC_BASE_URL || undefined } : null;
      if (ai) {
        try { out = await analyzeAI(input, { ...ai, model: process.env.QA_AI_MODEL || undefined }); }
        catch (e) { out = { ...analyzeLocal(input), engine_note: `Gọi AI không được (${e.message}), đang hiển thị phân tích theo dữ liệu.${attachments.some(a => a.data_base64) ? ' Ảnh đính kèm không được AI phân tích trong lần này.' : ''}` }; }
      } else {
        out = analyzeLocal(input);
        if (attachments.some(a => a.data_base64)) out.engine_note += ' Chưa có khóa AI nên ảnh đính kèm chưa được phân tích.';
      }
      if (liveNote) out.engine_note = (out.engine_note || '') + liveNote;
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
    if ((rm = /^\/api\/v1\/business-rules\/([A-Za-z0-9_-]+)$/.exec(pathname)) && !['meta', 'sync'].includes(rm[1])
        && (method === 'PUT' || method === 'DELETE')) {
      if (!requireAdmin('rules_edit')) return;
      const rid = rm[1];
      try {
        let data = { rule_id: rid };
        if (method === 'PUT') data = BusinessRuleStore.editLocal(DEFAULT_QC_USER, rid, await parseJsonBody(req));
        else if (method === 'DELETE') BusinessRuleStore.deleteLocal(DEFAULT_QC_USER, rid);
        const action = method === 'PUT' ? 'RULE_EDIT' : 'RULE_DELETE';
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
      let tasks = null;
      try { tasks = await importDraftTasks(); } catch (e) { tasks = { found: 0, added: 0, updated: 0, errors: [e.message] }; }
      const snapRules = path.join(path.dirname(FILES_DIR), 'kb-snapshot', 'rules');
      let snapshot_at = null;
      try { snapshot_at = new Date(Math.max(...fs.readdirSync(snapRules).map(n => fs.statSync(path.join(snapRules, n)).mtimeMs))).toISOString(); } catch {}
      return sendJson(res, 200, { success: true, data: { ...meta, snapshot_at, tasks } });
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
        data: BusinessRuleStore.list({ module: urlObj.searchParams.get('module') || '', q: urlObj.searchParams.get('q') || '' })
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
    return sendJson(res, err.statusCode || 500, {
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

// Task Function realtime: lấy từ 4 dự án Super Team, Winx Team, Integrity Team, Team 1 (từ 01/01/2024 đến nay)
const functionLive = startFunctionLive({
  onChange: (rows) => FunctionStore.setLive(rows),
  onQcChange: (rows) => FunctionStore.setQcLive(rows),
  getModules: () => BusinessRuleStore.load().modules || []
});

// Notification realtime từ Haraworks
const notifyLive = startNotifyLive();

// Build / Release realtime (HRWs APP - RELEASE & HRWs - RELEASE CHECKLIST)
const buildLive = startBuildLive();

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
