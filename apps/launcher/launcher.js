/**
 * QA Launcher: ứng dụng nhỏ chạy trên MÁY CỦA TỪNG NGƯỜI để mở Chrome và đăng nhập tự động bằng Playwright.
 *
 *   node apps/launcher/launcher.js --server http://qa-server:3001
 *   (hoặc đặt biến môi trường QA_SERVER_URL)
 *
 * Trang web của nhóm gọi launcher qua http://127.0.0.1:3002. Launcher:
 *  - chỉ nghe trên 127.0.0.1 và chỉ nhận lời gọi từ đúng địa chỉ server nhóm đã cấu hình (kiểm tra Origin);
 *  - dùng token của người dùng để lấy thông tin phiên và mật khẩu từ server (một lần, trong 2 phút);
 *  - giữ mật khẩu trong bộ nhớ vừa đủ để điền form, không ghi ra đĩa, không trả lại cho trang web.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PlaywrightLogin } from './playwright-login.js';
import { runTask } from './task-runner.js';
import { fetchTaskFiles } from './task-files.js';

const argv = process.argv.slice(2);
const serverArg = argv[argv.indexOf('--server') + 1];
const SERVER = (argv.includes('--server') ? serverArg : process.env.QA_SERVER_URL || '').replace(/\/+$/, '');
const PORT = Number(process.env.LAUNCHER_PORT || 3002);

if (!/^https?:\/\//.test(SERVER)) {
  console.error('Thiếu địa chỉ server. Ví dụ: node apps/launcher/launcher.js --server http://qa-server:3001');
  process.exit(1);
}

// Node không dùng kho chứng chỉ của Windows. Server dùng chứng chỉ mkcert thì cần nạp rootCA.pem:
// --ca <file>, biến NODE_EXTRA_CA_CERTS, hoặc tự tìm rootCA.pem của mkcert trên máy này.
if (SERVER.startsWith('https://') && !process.env.NODE_EXTRA_CA_CERTS) {
  const caArg = argv.includes('--ca') ? argv[argv.indexOf('--ca') + 1] : '';
  const home = os.homedir();
  const candidates = [caArg, process.env.CAROOT && path.join(process.env.CAROOT, 'rootCA.pem'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'mkcert', 'rootCA.pem'),
    path.join(home, '.local', 'share', 'mkcert', 'rootCA.pem'),
    path.join(home, 'Library', 'Application Support', 'mkcert', 'rootCA.pem'),
    path.join(home, 'rootCA.pem')].filter(Boolean);
  const ca = candidates.find(f => fs.existsSync(f));
  if (ca) {
    console.log(`Dùng chứng chỉ gốc: ${ca}`);
    const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)],
      { stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: ca } });
    process.exit(r.status ?? 1);
  }
  console.warn('Chưa tìm thấy rootCA.pem. Nếu gặp lỗi chứng chỉ, chạy lại với: --ca "C:\\duong-dan\\rootCA.pem"');
}
const ALLOWED_ORIGIN = new URL(SERVER).origin;
const statuses = new Map(); // sessionId -> { status, detail }

const api = async (path, token, opts = {}) => {
  let res;
  try {
    res = await fetch(`${SERVER}/api/v1${path}`, {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${token}`, 'X-QA-Client': 'launcher', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  } catch (e) {
    const code = e.cause?.code || '';
    if (/CERT|SIGNATURE|SELF_SIGNED/.test(code)) throw new Error('Launcher không tin chứng chỉ HTTPS của server. Chạy lại launcher với --ca "đường-dẫn\\rootCA.pem" (file rootCA.pem của mkcert).');
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') throw new Error(`Launcher không kết nối được server ${SERVER} (${code}). Kiểm tra địa chỉ, server đang chạy và tường lửa.`);
    throw new Error(`Launcher gọi server thất bại: ${e.message}${code ? ` (${code})` : ''}`);
  }
  if (opts.binary) {
    if (!res.ok) throw new Error(`Server trả lỗi ${res.status} khi tải file`);
    return Buffer.from(await res.arrayBuffer());
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error?.message || `Server trả lỗi ${res.status}`);
  return json.data;
};

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
const send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 10000) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { no(new Error('JSON không hợp lệ')); } }); });

async function launch({ sessionId, token }) {
  const set = (status, detail = '') => statuses.set(sessionId, { status, detail });
  set('STARTING', 'Đang lấy thông tin phiên từ server');
  try {
    const st = await api(`/browser-sessions/${encodeURIComponent(sessionId)}`, token);
    const cred = await api(`/browser-sessions/${encodeURIComponent(sessionId)}/credentials`, token);
    const { status, page } = await PlaywrightLogin.login({
      accountId: st.accountId, envId: st.environmentId, loginUrl: st.targetUrl,
      username: cred.username, password: cred.password, orgCode: st.expectedOrg,
      landingUrl: st.routeUrl, readOnly: st.readOnly,
      onStatus: d => set('STARTING', d)
    });
    if (!st.taskId) { set(status); return; }

    // Phiên gắn với một tác vụ tự động: chỉ chạy khi đã đăng nhập xong
    if (status !== 'LOGGED_IN') { set(status, 'Cần đăng nhập xong rồi bấm Chạy lại để thực hiện tác vụ'); return; }
    set('RUNNING_TASK', 'Đang chạy tác vụ');
    const task = await api(`/browser-sessions/${encodeURIComponent(sessionId)}/task`, token);
    // Tham số kiểu file: tải các file người dùng đã chọn về thư mục tạm của máy này (chỉ cho phiên này), xóa ngay sau khi chạy
    const { files, cleanup } = await fetchTaskFiles((p, o) => api(p, token, o), sessionId, task.params);
    let result;
    try { result = await runTask({ task, page, username: cred.username, files }); } finally { cleanup(); }
    await api(`/browser-sessions/${encodeURIComponent(sessionId)}/task-result`, token, { method: 'POST', body: result }).catch(() => {});
    statuses.set(sessionId, { status: 'TASK_DONE', detail: '', result });
  } catch (e) { set('ERROR', e.message); }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  // Chỉ chấp nhận lời gọi từ trang của server nhóm (chặn website lạ gọi vào máy bạn)
  const origin = req.headers.origin;
  if (req.method !== 'OPTIONS' && url.pathname !== '/health' && origin !== ALLOWED_ORIGIN) return send(res, 403, { error: 'Origin không được phép' });
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/health') return send(res, 200, { ok: true, server: SERVER });
  if (url.pathname === '/launch' && req.method === 'POST') {
    try {
      const b = await readBody(req);
      if (!b.sessionId || !b.token) return send(res, 400, { error: 'Thiếu sessionId hoặc token' });
      launch(b); // chạy nền; theo dõi qua /status
      return send(res, 202, { started: true });
    } catch (e) { return send(res, 400, { error: e.message }); }
  }
  const m = /^\/status\/([\w-]+)$/.exec(url.pathname);
  if (m) return send(res, 200, statuses.get(m[1]) || { status: 'UNKNOWN' });
  send(res, 404, { error: 'Not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`QA Launcher sẵn sàng: http://127.0.0.1:${PORT} (server nhóm: ${SERVER})`));
