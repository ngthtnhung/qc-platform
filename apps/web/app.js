// Giao diện sáng / tối / tự động (icon trên thanh trên cùng). Lưu theo trình duyệt từng người.
(function setupTheme() {
  const ORDER = ['auto', 'light', 'dark'];
  const ICON = { auto: '🖥️', light: '☀️', dark: '🌙' };
  const LABEL = { auto: 'Tự động (theo máy)', light: 'Sáng', dark: 'Tối' };
  let mode = 'auto';
  try { mode = localStorage.getItem('qa_theme') || 'auto'; } catch {}
  if (!ORDER.includes(mode)) mode = 'auto';
  const apply = m => { if (m === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m); };
  const paint = () => { const b = document.getElementById('btn-theme'); if (!b) return; b.textContent = ICON[mode]; b.title = 'Giao diện: ' + LABEL[mode] + ' (bấm để đổi)'; };
  apply(mode);
  document.addEventListener('DOMContentLoaded', () => {
    paint();
    document.getElementById('btn-theme')?.addEventListener('click', () => {
      mode = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
      try { localStorage.setItem('qa_theme', mode); } catch {}
      apply(mode); paint();
    });
  });
})();

/**
 * Internal AI QA Platform - Frontend Dashboard Controller
 * Connects directly to Backend RESTful API (/api/v1)
 */

const API_BASE = '/api/v1';
const LAUNCHER_URL = 'http://127.0.0.1:3002';

// Token cá nhân của người dùng nhóm (lưu theo phiên trình duyệt)
const getToken = () => { try { return sessionStorage.getItem('qa_token') || ''; } catch { return ''; } };
const _fetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  if (typeof url === 'string' && url.startsWith(API_BASE) && getToken()) {
    opts = { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${getToken()}` } };
  }
  return _fetch(url, opts);
};
let me = null;

async function ensureLogin() {
  const res = await fetch(`${API_BASE}/me`);
  if (res.status === 401) {
    const hadToken = !!getToken();
    try { sessionStorage.removeItem('qa_token'); } catch {}
    showLoginScreen(hadToken ? 'Token không đúng hoặc đã bị thu hồi. Kiểm tra lại, không thừa dấu cách hay dấu ngoặc.' : '');
    return false;
  }
  me = (await res.json()).data;
  const nameEl = document.getElementById('current-user-name');
  if (nameEl) nameEl.textContent = me.display_name;
  const role = document.getElementById('current-user-role');
  if (role) role.textContent = me.role;
  const av = document.getElementById('sb-avatar');
  if (av) av.textContent = String(me.display_name || 'QC').split(/\s+/).map(w => w[0]).slice(-2).join('').toUpperCase();
  document.dispatchEvent(new Event('qa-me-ready'));
  return true;
}

function showLoginScreen(error = '') {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="login-screen" style="position:fixed;inset:0;background:var(--bg,#f5f6fa);display:flex;align-items:center;justify-content:center;z-index:9999;">
      <div class="card" style="max-width:420px;width:100%;">
        <div class="card-title" style="margin-bottom:8px;">Đăng nhập QA Platform</div>
        <p style="font-size:12px;color:var(--text-subtle);margin-bottom:8px;">Nhập token cá nhân do quản trị viên cấp.</p>
        <input type="password" class="form-control" id="login-token" placeholder="qa_..." autocomplete="off" />
        <div id="login-error" style="color:var(--danger);font-size:12px;margin:6px 0;">${error}</div>
        <button class="btn btn-primary" id="login-btn" style="width:100%;">Đăng nhập</button>
      </div></div>`);
  const go = () => { try { sessionStorage.setItem('qa_token', document.getElementById('login-token').value.trim().replace(/^["'\s]+|["'\s]+$/g, '')); } catch { document.getElementById('login-error').textContent = 'Trình duyệt chặn lưu phiên (sessionStorage). Tắt chế độ ẩn danh hoặc cho phép lưu dữ liệu trang.'; return; } location.reload(); };
  document.getElementById('login-btn').onclick = go;
  document.getElementById('login-token').onkeydown = e => { if (e.key === 'Enter') go(); };
}

// App State
let environments = [];
let accounts = [];
let currentEnvironment = null;
let currentSession = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await ensureLogin())) return;
  setupTabs();
  setupEventListeners();
  await checkApiHealth();
  await loadEnvironments();
  await loadAccounts();
});

// -----------------------------------------------------------
// 1. Core Tabs Navigation
// -----------------------------------------------------------
function setupTabs() {
  const buttons = document.querySelectorAll('.tab-button');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const paneId = btn.getAttribute('data-tab');
      document.getElementById(paneId)?.classList.add('active');
      const crumb = document.getElementById('crumb-page'); if (crumb) crumb.textContent = btn.textContent.trim();
      if (window.syncAtCrumb) window.syncAtCrumb(paneId);
      document.getElementById('sidebar')?.classList.remove('open');
    });
  });
}

async function checkApiHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    const json = await res.json();
    if (json.status === 'HEALTHY') {
      { const b = document.getElementById('api-status-badge'); b.className = 'srv-status'; b.lastElementChild.textContent = 'Server Online'; }
    }
  } catch {
    const b = document.getElementById('api-status-badge'); b.className = 'srv-status off'; b.lastElementChild.textContent = 'Mất kết nối server';
  }
}

// -----------------------------------------------------------
// 2. Tab 1: Environments & Accounts Management
// -----------------------------------------------------------
async function loadEnvironments() {
  try {
    const res = await fetch(`${API_BASE}/environments`);
    const json = await res.json();
    environments = json.data || [];

    const select = document.getElementById('select-env');
    select.innerHTML = '';

    environments.forEach(env => {
      const opt = document.createElement('option');
      opt.value = env.id;
      opt.textContent = `${env.name} [${env.environment_type}]`;
      select.appendChild(opt);
    });

    if (environments.length > 0) {
      currentEnvironment = environments[0];
      select.value = currentEnvironment.id;
      renderEnvironmentDetails();
    }
  } catch (err) {
    console.error('Error loading environments:', err);
  }
}

async function loadAccounts() {
  try {
    const res = await fetch(`${API_BASE}/accounts`);
    const json = await res.json();
    accounts = json.data || [];
    renderAccountsForCurrentEnv();
  } catch (err) {
    console.error('Error loading accounts:', err);
  }
}

function renderEnvironmentDetails() {
  if (!currentEnvironment) return;

  const box = document.getElementById('env-details-box');
  const prodNote = document.getElementById('prod-note');

  box.innerHTML = `
    <div><strong>Môi trường:</strong> ${currentEnvironment.name} (${currentEnvironment.id})</div>
    <div><strong>Base URL:</strong> <code>${currentEnvironment.base_url}</code></div>
    <div><strong>Login URL:</strong> <code>${currentEnvironment.login_url}</code></div>
    <div><strong>Định danh Org:</strong> ${currentEnvironment.org_identifier || 'Mặc định'}</div>
  `;

  // Check Org Gate Requirement (Section 9.1 & 9.2)
  // Production (DEMO và OrgID khác): hệ thống đã chặn bot nên chỉ hiện ghi chú, không có cổng xác nhận Org
  prodNote.style.display = ['PRODUCTION_TEST', 'PRODUCTION'].includes(currentEnvironment.environment_type) ? 'flex' : 'none';

  renderAccountsForCurrentEnv();
}

function renderAccountsForCurrentEnv() {
  if (!currentEnvironment) return;
  const container = document.getElementById('accounts-list-container');
  container.innerHTML = '';

  const filtered = accounts.filter(a => a.environment_profile_id === currentEnvironment.id);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:16px;background:var(--surface-alt);border:1px dashed var(--border);border-radius:6px;">
        Chưa có tài khoản nào được gán cho môi trường <strong>${currentEnvironment.name}</strong>.
      </div>
    `;
    return;
  }

  const canStoreSecret = ['STAGING', 'PRODUCTION_TEST'].includes(currentEnvironment.environment_type);
  filtered.forEach(acc => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.padding = '10px 14px';
    card.style.marginBottom = '8px';

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong style="font-size:13px;">${acc.name}</strong>
          <span class="badge badge-blue" style="margin-left:6px;">${acc.role}</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-primary btn-launch-acc" data-id="${acc.id}" style="padding:4px 10px;">
            🪟 Mở Browser & Đăng Nhập
          </button>
          <button class="btn btn-outline btn-del-acc" data-id="${acc.id}" style="padding:4px 8px;color:var(--danger);">
            🗑 Xóa
          </button>
        </div>
      </div>
      <div style="font-size:11.5px;color:var(--text-subtle);margin-top:4px;">
        Username: <strong>${acc.username_ref}</strong> |
        Mở link: <select class="form-control route-select" style="display:inline-block;width:auto;max-width:340px;padding:2px 6px;font-size:11.5px;">${(acc.routes || []).map(r => `<option value="${r.url}" title="${r.url}">${r.name}</option>`).join('')}</select>
        <button class="linkbtn btn-routes" style="background:none;border:0;color:var(--primary);cursor:pointer;font-size:11.5px;text-decoration:underline;">Sửa link</button> |
        ${acc.has_secret ? '<span class="badge badge-green">🔑 Đã lưu mật khẩu (mã hóa)</span>' : '<span class="badge badge-amber">Chưa có mật khẩu</span>'}
        ${canStoreSecret ? `<button class="linkbtn btn-secret" style="background:none;border:0;color:var(--primary);cursor:pointer;font-size:11.5px;text-decoration:underline;">${acc.has_secret ? 'Đổi / xóa mật khẩu' : 'Đặt mật khẩu'}</button>` : '<span class="badge badge-blue">Production chỉ đọc: không lưu mật khẩu</span>'}
      </div>
    `;

    card.querySelector('.btn-routes').addEventListener('click', () => openRoutesModal(acc));
    card.querySelector('.btn-launch-acc').addEventListener('click', async () => {
      await launchBrowserSession(acc.id, card.querySelector('.route-select')?.value || '');
    });

    card.querySelector('.btn-secret')?.addEventListener('click', () => openSecretModal(acc));

    card.querySelector('.btn-del-acc').addEventListener('click', async () => {
      if (confirm(`Bạn có chắc muốn xóa tài khoản [${acc.name}]?`)) {
        await fetch(`${API_BASE}/accounts/${acc.id}`, { method: 'DELETE' });
        await loadAccounts();
      }
    });

    container.appendChild(card);
  });
}

async function launchBrowserSession(accountId, routeUrl = '') {
  try {
    const env = currentEnvironment;
    // Production DEMO: xin phép ngay trước khi mở, mỗi lần mở một phiên mới
    if (env.environment_type === 'PRODUCTION_TEST' &&
        !confirm(`Bạn cho phép mở Production OrgID ${env.org_identifier}?\nChỉ dùng để kiểm tra bug hoặc tính năng đã build.`)) return;

    const res = await fetch(`${API_BASE}/browser-sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_profile_id: accountId, environment_profile_id: env.id, route_url: routeUrl })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Khởi tạo session thất bại');
    currentSession = json.data;

    // Playwright chạy trên MÁY CỦA BẠN qua QA Launcher; mật khẩu không đi qua trang web
    showLaunchNotice(`Đang mở ${currentSession.environmentName} cho [${currentSession.accountRole}]...`, 'ok');
    let started;
    try {
      started = await _fetch(`${LAUNCHER_URL}/launch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.sessionId, token: getToken() || 'local' })
      });
    } catch {
      showLaunchNotice('Chưa chạy QA Launcher trên máy bạn. Mở terminal ở thư mục project và chạy: node apps/launcher/launcher.js --server ' + location.origin, 'error');
      return;
    }
    if (!started.ok) throw new Error((await started.json().catch(() => ({}))).error || 'Launcher từ chối yêu cầu');
    await followAutoLogin(currentSession);
  } catch (err) {
    showLaunchNotice(`Không mở được phiên: ${err.message}`, 'error');
  }
}

const LOGIN_MSG = {
  LOGGED_IN: 'Đã đăng nhập tự động.',
  NEEDS_PASSWORD: 'Đã điền mã công ty và tên đăng nhập. Tài khoản chưa có mật khẩu lưu (hoặc môi trường không cho lưu): hãy tự nhập trong cửa sổ vừa mở, xong sẽ tự vào link đã chọn. Bấm "Đặt mật khẩu" ở thẻ tài khoản để lần sau tự điền.',
  NEEDS_USER: 'Chưa vào được hệ thống (có thể sai mật khẩu hoặc cần mã OTP). Hãy hoàn tất đăng nhập trong cửa sổ vừa mở.',
  NEEDS_USER_CAPTCHA: 'Trang yêu cầu CAPTCHA. Hãy tự hoàn tất trong cửa sổ vừa mở.',
  NEEDS_USER_ORG: 'Tài khoản chưa có mã công ty. Hãy nhập trong cửa sổ vừa mở.',
  ERROR: 'Không chạy được Playwright'
};

async function followAutoLogin(session) {
  for (let i = 0; i < 90; i++) {
    const login = await (await _fetch(`${LAUNCHER_URL}/status/${session.sessionId}`)).json();
    if (!['STARTING'].includes(login.status)) {
      const extra = login.status === 'ERROR' ? null : [];
      if (extra && session.environmentType === 'PRODUCTION_TEST') { extra.push(`Production đã chặn bot: nếu đăng nhập tự động không được, hãy tự đăng nhập và kiểm tra màn hình đang ở OrgID ${session.expectedOrg}.`); }
      if (extra && session.readOnly) extra.push('Môi trường chỉ đọc: mọi request ghi bị chặn.');
      const base = (LOGIN_MSG[login.status] || login.status) + (login.status === 'ERROR' ? `: ${login.detail}` : '');
      showLaunchNotice([base, ...(extra || [])].join(' '), login.status === 'LOGGED_IN' ? 'ok' : login.status === 'ERROR' ? 'error' : 'warn');
      return;
    }
    if (login.detail) showLaunchNotice(`${login.detail}...`, 'ok');
    await new Promise(r => setTimeout(r, 1000));
  }
  showLaunchNotice('Quá thời gian chờ đăng nhập tự động. Kiểm tra cửa sổ trình duyệt vừa mở.', 'warn');
}

function showLaunchNotice(text, kind) {
  let box = document.getElementById('launch-notice');
  if (!box) {
    box = document.createElement('div');
    box.id = 'launch-notice';
    box.className = 'alert-box';
    document.getElementById('accounts-list-container').before(box);
  }
  box.className = 'alert-box ' + (kind === 'error' ? 'alert-red' : kind === 'warn' ? 'alert-amber' : 'alert-amber');
  box.textContent = text;
}

// -----------------------------------------------------------
// 6. Global Event Listeners & Modals
// -----------------------------------------------------------
function setupEventListeners() {
  // Environment select change
  document.getElementById('select-env').addEventListener('change', (e) => {
    currentEnvironment = environments.find(env => env.id === e.target.value);
    renderEnvironmentDetails();
  });

  // Modals
  document.getElementById('btn-add-env').addEventListener('click', () => {
    document.getElementById('modal-env-title').textContent = 'Thêm Môi Trường Mới';
    document.getElementById('env-mode').value = 'add';
    document.getElementById('env-id-input').disabled = false;
    document.getElementById('env-id-input').value = '';
    document.getElementById('env-name-input').value = '';
    document.getElementById('env-base-url-input').value = 'https://';
    document.getElementById('env-login-url-input').value = 'https://';
    document.getElementById('modal-env').classList.add('open');
  });

  document.getElementById('btn-edit-env').addEventListener('click', () => {
    if (!currentEnvironment) return;
    document.getElementById('modal-env-title').textContent = `Chỉnh Sửa Môi Trường [${currentEnvironment.name}]`;
    document.getElementById('env-mode').value = 'edit';
    document.getElementById('env-id-input').disabled = true;
    document.getElementById('env-id-input').value = currentEnvironment.id;
    document.getElementById('env-name-input').value = currentEnvironment.name;
    document.getElementById('env-type-select').value = currentEnvironment.environment_type;
    document.getElementById('env-base-url-input').value = currentEnvironment.base_url;
    document.getElementById('env-login-url-input').value = currentEnvironment.login_url;
    document.getElementById('env-org-input').value = currentEnvironment.org_identifier || '';
    document.getElementById('modal-env').classList.add('open');
  });

  document.getElementById('btn-save-env-modal').addEventListener('click', async () => {
    const mode = document.getElementById('env-mode').value;
    const id = document.getElementById('env-id-input').value.trim();
    const name = document.getElementById('env-name-input').value.trim();
    const type = document.getElementById('env-type-select').value;
    const base = document.getElementById('env-base-url-input').value.trim();
    const login = document.getElementById('env-login-url-input').value.trim();
    const org = document.getElementById('env-org-input').value.trim();

    if (!id || !name) {
      alert('Vui lòng điền đủ ID và Tên môi trường.');
      return;
    }

    if (mode === 'add') {
      await fetch(`${API_BASE}/environments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, environment_type: type, base_url: base, login_url: login, org_identifier: org })
      });
    } else {
      await fetch(`${API_BASE}/environments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, base_url: base, login_url: login, org_identifier: org })
      });
    }

    closeModals();
    await loadEnvironments();
  });

  // Add Account modal
  document.getElementById('btn-add-account').addEventListener('click', () => {
    const select = document.getElementById('acc-env-select');
    select.innerHTML = '';
    environments.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.name;
      select.appendChild(opt);
    });
    if (currentEnvironment) select.value = currentEnvironment.id;
    document.getElementById('modal-account').classList.add('open');
  });

  document.getElementById('btn-save-account-modal').addEventListener('click', async () => {
    const name = document.getElementById('acc-name-input').value.trim();
    const role = document.getElementById('acc-role-input').value.trim();
    const envId = document.getElementById('acc-env-select').value;
    const username = document.getElementById('acc-username-input').value.trim();
    const route = document.getElementById('acc-route-input').value.trim();
    const password = document.getElementById('acc-password-input').value;

    if (!role || !username) {
      alert('Vui lòng nhập Role và Username.');
      return;
    }

    await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        role,
        environment_profile_id: envId,
        username,
        password,
        default_route: route
      })
    });

    document.getElementById('acc-password-input').value = '';
    closeModals();
    await loadAccounts();
  });

  document.getElementById('btn-save-routes').addEventListener('click', saveRoutes);
  document.getElementById('btn-save-secret').addEventListener('click', () => saveSecret('PUT'));
  document.getElementById('btn-delete-secret').addEventListener('click', () => saveSecret('DELETE'));
}

function openRoutesModal(acc) {
  document.getElementById('routes-account-id').value = acc.id;
  document.getElementById('routes-title').textContent = `Link của ${acc.name}`;
  document.getElementById('routes-text').value = (acc.routes || []).map(r => `${r.name} | ${r.url}`).join('\n');
  document.getElementById('routes-msg').textContent = '';
  document.getElementById('modal-routes').classList.add('open');
}

async function saveRoutes() {
  const id = document.getElementById('routes-account-id').value;
  const res = await fetch(`${API_BASE}/accounts/${id}/routes`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: document.getElementById('routes-text').value })
  });
  const json = await res.json();
  if (!res.ok) { document.getElementById('routes-msg').textContent = json.error?.message || 'Không lưu được.'; return; }
  closeModals();
  await loadAccounts();
}

function openSecretModal(acc) {
  document.getElementById('secret-account-id').value = acc.id;
  document.getElementById('secret-title').textContent = `Mật khẩu: ${acc.name}`;
  document.getElementById('secret-input').value = '';
  document.getElementById('secret-msg').textContent = acc.has_secret ? 'Đã có mật khẩu lưu. Nhập mới để ghi đè.' : '';
  document.getElementById('btn-delete-secret').style.display = acc.has_secret ? '' : 'none';
  document.getElementById('modal-secret').classList.add('open');
}

async function saveSecret(method) {
  const id = document.getElementById('secret-account-id').value;
  const input = document.getElementById('secret-input');
  const msg = document.getElementById('secret-msg');
  if (method === 'PUT' && !input.value) { msg.textContent = 'Vui lòng nhập mật khẩu.'; return; }
  const res = await fetch(`${API_BASE}/accounts/${id}/secret`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'PUT' ? JSON.stringify({ password: input.value }) : undefined
  });
  const json = await res.json();
  input.value = '';
  if (!res.ok) { msg.textContent = json.error?.message || 'Không lưu được.'; return; }
  closeModals();
  await loadAccounts();
}

window.closeModals = function() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open'));
};

// -----------------------------------------------------------
// 5. Tác vụ tự động (Playwright)
// -----------------------------------------------------------
(function setupAutomation() {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let tasks = [], stagingAccounts = [];
  const notice = (t, kind) => { $('at-notice').innerHTML = t ? `<div class="alert-box ${kind === 'error' ? 'alert-red' : 'alert-amber'}" style="margin-bottom:10px;">${t}</div>` : ''; };

  // Quyền trên giao diện (server vẫn kiểm tra lại): chế độ một người, quản trị, hoặc quyền lẻ tương ứng
  const has = p => me && (!me.auth_required || me.role === 'admin' || (me.perms || []).includes(p));
  const canEdit = () => has('automation') || has('automation_push');
  const canApprove = () => has('automation');

  async function call(method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await res.json(); } catch {}
    if (!res.ok) throw new Error(j?.error?.message || (res.status === 404 ? 'Server chưa chạy bản mới (không có chức năng này). Hãy khởi động lại server rồi tải lại trang.' : `Server trả lỗi ${res.status}`));
    return j.data;
  }

  // Kho file test: file tải lên một lần, chọn lại bằng tên cho nhiều tác vụ
  let library = [];
  const nameOf = id => (library.find(f => f.id === id) || {}).name || id;
  async function loadLibrary() {
    try { library = (await call('GET', '/automation/files')) || []; } catch (e) { library = []; $('at-lib-msg').textContent = e.message; }
    renderLib();
  }
  function renderLib() {
    $('at-lib-count').textContent = library.length;
    $('at-lib-list').innerHTML = library.length ? library.map(f => `<div class="lib-item" data-id="${esc(f.id)}" style="width:120px;font-size:11px;border:1px solid var(--border);border-radius:6px;padding:4px;">
      <div class="lib-thumb" style="height:70px;display:flex;align-items:center;justify-content:center;background:var(--surface-alt);overflow:hidden;">${f.mime === 'application/pdf' ? 'PDF' : ''}</div>
      <div title="${esc(f.name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:3px;">${esc(f.name)}</div>
      <div style="color:var(--text-subtle);">${fmtSize(f.size)} ${canEdit() ? '<button type="button" class="lib-del" style="background:none;border:0;color:var(--danger);cursor:pointer;font-size:11px;">xóa</button>' : ''}</div></div>`).join('') : '<span style="font-size:11.5px;color:var(--text-subtle);">Chưa có file nào.</span>';
    document.querySelectorAll('#at-lib-list .lib-item').forEach(el => {
      const f = library.find(x => x.id === el.dataset.id);
      if (f && f.mime !== 'application/pdf') fetch(`${API_BASE}/automation/files/${f.id}/raw`).then(r => r.ok ? r.blob() : null).then(b => { if (b) el.querySelector('.lib-thumb').innerHTML = `<img src="${URL.createObjectURL(b)}" style="max-width:100%;max-height:70px;">`; }).catch(() => {});
      const d = el.querySelector('.lib-del');
      if (d) d.onclick = async () => { if (!confirm(`Xóa "${f.name}" khỏi kho? Tác vụ đang chọn ảnh này sẽ báo thiếu file.`)) return; try { await call('DELETE', `/automation/files/${f.id}`); await loadLibrary(); } catch (e) { notice(esc(e.message), 'error'); } };
    });
  }
  async function uploadToLibrary(files) {
    const msg = $('at-lib-msg'), added = [];
    for (const f of files) {
      try {
        if (f.size > 10 * 1024 * 1024) throw new Error(`"${f.name}" lớn hơn 10 MB`);
        msg.style.color = ''; msg.textContent = `Đang tải ${f.name}...`;
        added.push(await call('POST', '/automation/files', { name: f.name, data_base64: await toBase64(f) }));
      } catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = `${f.name}: ${e.message}`; await loadLibrary(); return added; }
    }
    msg.style.color = 'green'; msg.textContent = added.length ? `Đã tải ${added.length} file.` : '';
    await loadLibrary();
    return added;
  }

  async function load() {
    const mod = $('at-module').value;
    const [t, a, e] = await Promise.all([
      fetch(`${API_BASE}/automation/tasks?module=${encodeURIComponent(mod)}`).then(r => r.json()),
      fetch(`${API_BASE}/accounts`).then(r => r.json()),
      fetch(`${API_BASE}/environments`).then(r => r.json())
    ]);
    await loadLibrary();
    tasks = t.data || [];
    const stg = new Set((e.data || []).filter(x => x.environment_type === 'STAGING').map(x => x.id));
    stagingAccounts = (a.data || []).filter(x => stg.has(x.environment_profile_id));
    const sel = $('at-module');
    if (!sel.value) sel.innerHTML = '<option value="">Tất cả module</option>' + [...new Set(tasks.map(x => x.module))].map(m => `<option>${esc(m)}</option>`).join('');
    render();
  }

  // Bước mô tả: {{khóa}} thành ô nhập giá trị ngay trong câu (chữ, danh sách nhiều giá trị, hoặc chọn file)
  const fmtSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const hintOf = p => esc(p.label) + (p.type === 'list' ? ' (nhiều giá trị, cách nhau bằng dấu phẩy)' : '')
    + (p.type === 'file' ? ' (bỏ trống thì bỏ qua)' : (p.auto ? (p.fallback === 'random' ? ' (trống hoặc không có thì chọn ngẫu nhiên)' : ' (trống hoặc không có thì chọn mục đầu tiên)') : ''));
  const ML_KEYS = /^(noi_dung|mo_ta|van_de|ghi_chu|payload|du_lieu|test_data)$/;
  const isMl = p => p.type === 'multiline' || (p.type !== 'file' && p.type !== 'list' && (ML_KEYS.test(p.key) || /\n/.test(p.value || '')));
  const limitOf = p => p.type === 'multiline' ? 5000 : p.type === 'list' ? 1000 : 200;
  const chipText = p => {
    if (p.type === 'file') return String(p.value || '').split(',').filter(Boolean).map(nameOf).join(', ') || '(chưa chọn)';
    const v = String(p.value || '').replace(/\s*\n\s*/g, ' ⏎ ');
    return v ? (v.length > 40 ? v.slice(0, 40) + '…' : v) : '(trống)';
  };
  // Trong câu mô tả bước: chỉ hiện giá trị hiện tại (bấm để nhảy tới trường); sửa ở mục "Trường thông tin"
  function stepHtml(text, params) {
    return String(text).split(/\{\{([a-z][a-z0-9_]*)\}\}/g).map((seg, i) => {
      if (i % 2 === 0) return esc(seg);
      const p = params.find(x => x.key === seg);
      if (!p) return `<code>{{${esc(seg)}}}</code>`;
      return `<a class="step-chip" href="#" data-key="${esc(p.key)}" title="${hintOf(p)}">${esc(chipText(p))}</a>`;
    }).join('');
  }
  function editorHtml(p) {
    return `<div class="ed"><div class="ed-bar"><select class="ed-fmt" title="Định dạng để kiểm tra cú pháp"><option value="text">Văn bản</option><option value="json">JSON</option><option value="yaml">YAML</option><option value="xml">XML</option></select><span class="ed-keep">Giữ nguyên định dạng</span><span class="ed-spacer"></span><button type="button" class="ed-grow">Mở rộng</button><button type="button" class="ed-clear">Xóa</button></div>
      <div class="ed-wrap"><pre class="ed-gutter">1</pre><textarea class="step-param ed-area" data-key="${esc(p.key)}" rows="8" spellcheck="false" wrap="off" placeholder="Nhập nội dung. Xuống dòng và khoảng trắng được giữ nguyên khi chạy.">${esc(p.value)}</textarea></div>
      <div class="ed-status"><span class="ed-valid"></span><span class="ed-meta"></span><span class="ed-limit" data-limit="${limitOf(p)}"></span></div></div>`;
  }
  function fieldHtml(p) {
    let ctl;
    if (p.type === 'file') {
      const names = String(p.value || '').split(',').filter(Boolean).map(nameOf).map(esc).join(', ');
      ctl = `<span class="step-file" data-key="${esc(p.key)}" data-fid="${esc(p.value)}">
        <button type="button" class="step-filebtn" style="background:none;border:0;padding:0;font:inherit;">Chọn file ▾</button>
        <span class="step-fname">${names || '(chưa chọn, bỏ qua)'}</span>
        <button type="button" class="linkbtn step-fclear" style="background:none;border:0;color:var(--danger);cursor:pointer;font-size:11px;${p.value ? '' : 'display:none;'}">xóa</button></span>`;
    } else if (isMl(p)) ctl = editorHtml(p);
    else ctl = `<div class="fld-row"><input class="step-param fld-input form-control" data-key="${esc(p.key)}" value="${esc(p.value)}" placeholder="${p.type === 'list' ? 'mã1, mã2, ...' : '(trống)'}">${p.type === 'list' ? '' : '<button type="button" class="btn btn-outline fld-ed" title="Soạn bằng editor nhiều dòng">✎ Editor</button>'}</div>`;
    return `<div class="fld" data-key="${esc(p.key)}"><label class="fld-label">${esc(p.label)}</label>${ctl}<div class="fld-hint">${hintOf(p)}</div></div>`;
  }
  function wireEditor(ed) {
    const ta = ed.querySelector('.ed-area'), gut = ed.querySelector('.ed-gutter'), fmt = ed.querySelector('.ed-fmt');
    const valid = ed.querySelector('.ed-valid'), meta = ed.querySelector('.ed-meta'), lim = ed.querySelector('.ed-limit'), limit = +lim.dataset.limit;
    const upd = () => {
      const lines = ta.value ? ta.value.split('\n').length : 1;
      gut.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
      meta.textContent = `${ta.value ? lines : 0} dòng · ${ta.value.length} ký tự · UTF-8`;
      lim.textContent = `${ta.value.length}/${limit}`; lim.classList.toggle('over', ta.value.length > limit);
      const f = fmt.value;
      if (f === 'json') {
        if (!ta.value.trim()) { valid.textContent = 'JSON: chưa có nội dung'; valid.className = 'ed-valid'; return; }
        try { JSON.parse(ta.value); valid.textContent = 'JSON hợp lệ'; valid.className = 'ed-valid ok'; }
        catch (e) { valid.textContent = 'JSON chưa hợp lệ: ' + String(e.message).slice(0, 60); valid.className = 'ed-valid bad'; }
      } else { valid.textContent = f === 'text' ? 'Văn bản thuần' : f.toUpperCase() + ' (không kiểm tra cú pháp)'; valid.className = 'ed-valid'; }
    };
    ta.addEventListener('input', upd);
    ta.addEventListener('scroll', () => { gut.scrollTop = ta.scrollTop; });
    fmt.addEventListener('change', upd);
    ed.querySelector('.ed-grow').onclick = e => { const big = ta.rows < 20; ta.rows = big ? 26 : 8; e.target.textContent = big ? 'Thu gọn' : 'Mở rộng'; };
    ed.querySelector('.ed-clear').onclick = () => { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); };
    // Phím Tab chèn 2 khoảng trắng (giữ cấu trúc JSON, YAML) thay vì chuyển ô
    ta.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); } });
    upd();
  }
  function refreshChips(card, t) {
    const vals = Object.fromEntries(collect(card));
    card.querySelectorAll('.step-chip').forEach(c => { const p = (t.params || []).find(x => x.key === c.dataset.key); if (p) c.textContent = chipText({ ...p, value: vals[p.key] ?? p.value }); });
  }
  function wireFields(card, t) {
    card.querySelectorAll('.ed').forEach(wireEditor);
    card.addEventListener('input', () => refreshChips(card, t));
    card.querySelectorAll('.step-chip').forEach(c => c.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      const f = card.querySelector(`.fld[data-key="${c.dataset.key}"]`);
      if (f) { f.scrollIntoView({ block: 'center' }); const ctl = f.querySelector('.step-param, .step-filebtn'); if (ctl) ctl.focus(); }
    });
    card.querySelectorAll('.fld-ed').forEach(b => b.onclick = () => {
      const f = b.closest('.fld'), p = (t.params || []).find(x => x.key === f.dataset.key);
      f.querySelector('.fld-row').outerHTML = editorHtml({ ...p, value: f.querySelector('.step-param').value });
      wireEditor(f.querySelector('.ed')); f.querySelector('.ed-area').focus();
    });
  }

  // Danh sách gọn; bấm một tác vụ để vào trang chi tiết (chỉnh trường, chạy, xem kết quả)
  // Breadcrumb: Tác Vụ Tự Động / <tên tác vụ>; bấm "Tác Vụ Tự Động" để quay lại danh sách
  window.syncAtCrumb = pane => {
    const open = document.querySelector('#at-list .at-card.open'), on = pane === 'pane-automation' && !!open;
    $('crumb-sep2').style.display = $('crumb-sub').style.display = on ? '' : 'none';
    $('crumb-page').classList.toggle('link', on);
    if (on) $('crumb-sub').textContent = open.querySelector('strong').textContent;
  };
  function openTask(card) {
    document.querySelectorAll('#at-list .at-card').forEach(c => c.classList.toggle('open', c === card));
    $('at-list').classList.add('at-detail'); $('pane-automation').classList.add('detail-mode'); window.syncAtCrumb('pane-automation');
    $('at-lib') && ($('at-lib').style.display = 'none');
    card.scrollIntoView({ block: 'start' });
    try { sessionStorage.setItem('qa_open_task', card.dataset.id); } catch {}
  }
  function closeTask() {
    document.querySelectorAll('#at-list .at-card').forEach(c => c.classList.remove('open'));
    $('at-list').classList.remove('at-detail'); $('pane-automation').classList.remove('detail-mode'); window.syncAtCrumb('pane-automation');
    $('at-lib') && ($('at-lib').style.display = '');
    try { sessionStorage.removeItem('qa_open_task'); } catch {}
  }
  let runningCount = 0;
  function render() {
    if (runningCount > 0) return; // đang chạy: không vẽ lại để khỏi mất kết quả đang hiển thị
    renderStats();
    const keep = {}; const openId = document.querySelector('#at-list .at-card.open')?.dataset.id || '';
    document.querySelectorAll('#at-list [data-id]').forEach(c => { keep[c.dataset.id] = { res: c.querySelector('.at-result').innerHTML, vals: collect(c), acc: c.querySelector('.at-acc').value, times: (c.querySelector('.at-times') || {}).value, code: c.querySelector('.at-codebox').style.display }; });
    try { renderCards(); } finally {
      if (openId) { const oc = document.querySelector(`#at-list .at-card[data-id="${openId}"]`); if (oc) openTask(oc); }
      document.querySelectorAll('#at-list [data-id]').forEach(c => {
        const k = keep[c.dataset.id]; if (!k) return;
        c.querySelector('.at-result').innerHTML = k.res;
        c.querySelector('.at-acc').value = k.acc;
        const tm = c.querySelector('.at-times'); if (tm && k.times) tm.value = k.times;
        c.querySelector('.at-codebox').style.display = k.code;
      });
    }
  }
  const foldTxt = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
  function visibleTasks() {
    const q = foldTxt($('at-q')?.value.trim()), kind = $('at-kind')?.value || '';
    return tasks.filter(t => (!kind || (kind === 'write') === !!t.writes) && (!q || foldTxt([t.name, t.module, t.flow, t.description].join(' ')).includes(q)));
  }
  function renderStats() {
    const mods = new Set(tasks.map(t => t.module)).size, run = tasks.filter(t => t.runnable).length, w = tasks.filter(t => t.writes).length;
    const card = (k, v, sub) => `<div class="stat-card"><span>${k}</span><b>${v}</b><small>${sub}</small></div>`;
    $('at-stats').innerHTML = card('Tác vụ', tasks.length, `${mods} module`) + card('Sẵn sàng chạy', run, `${tasks.length - run} chưa sẵn sàng`) + card('Tạo hoặc sửa dữ liệu', w, 'dữ liệu có tiền tố [AI TEST]') + card('Chỉ đọc', tasks.length - w, 'không đổi dữ liệu');
  }
  function renderCards() {
    if (!tasks.length) { $('at-list').innerHTML = '<div style="padding:14px;color:var(--text-subtle);">Chưa có tác vụ. Tác vụ được ghi khi khám phá module (xem docs/operations/automation-tasks.md).</div>'; return; }
    const shown = visibleTasks();
    if (tasks.length && !shown.length) { $('at-list').innerHTML = '<div style="padding:14px;color:var(--text-subtle);">Không có tác vụ nào khớp bộ lọc.</div>'; return; }
    $('at-list').innerHTML = shown.map(t => `
      <div class="card at-card" style="padding:10px 14px;margin-bottom:8px;" data-id="${esc(t.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div><strong>${esc(t.name)}</strong>
            <span class="badge badge-blue">${esc(t.module)}${t.flow ? ' · ' + esc(t.flow) : ''}</span>
            <span class="badge ${t.runnable ? 'badge-green' : 'badge-amber'}">${t.runnable ? 'Sẵn sàng chạy' : 'Chưa sẵn sàng'}</span>
            ${t.writes ? '<span class="badge badge-red">Tạo/sửa dữ liệu</span>' : '<span class="badge badge-blue">Chỉ đọc</span>'}</div>
          <div class="at-ctl" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary at-open">Mở chi tiết</button>
            <select class="form-control at-acc" style="width:auto;font-size:11.5px;"><option value="">Tự chọn tài khoản</option>${stagingAccounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>
            ${t.runnable ? '<span style="display:inline-flex;gap:4px;align-items:center;font-size:11.5px;">Số lần <input type="number" class="form-control at-times" min="1" max="50" value="1" style="width:58px;padding:2px 6px;"> <label title="Dừng ngay khi một lần không đạt"><input type="checkbox" class="at-stop" checked> dừng khi lỗi</label></span><button class="btn btn-primary at-run">▶ Chạy tác vụ</button><button class="btn btn-outline at-halt" style="display:none;color:var(--danger);">Dừng</button>' : (canApprove() ? '<button class="btn btn-warning at-approve">Xem code & Duyệt</button>' : '<span class="badge badge-amber">Chờ người có quyền duyệt</span>')}
            <button class="btn btn-outline at-code">Xem code</button>
            ${canEdit() ? '<button class="btn btn-outline at-edit">Sửa</button>' : ''}
            ${canApprove() ? '<button class="btn btn-outline at-retire" style="color:var(--danger);">Gỡ</button>' : ''}
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--text-subtle);margin-top:4px;">${esc(t.description)}
          ${t.required_roles.length ? ` · Vai trò cần: <b>${esc(t.required_roles.join(', '))}</b>` : ''}
          ${t.rule_ids.length ? ` · Rule: ${esc(t.rule_ids.join(', '))}` : ''}</div>
        <div class="at-body">
        <h3 class="at-sec"><i>01</i> Các bước</h3>
        <ol style="margin:6px 0 0 18px;font-size:12px;line-height:1.9;">${t.steps.map(s => `<li>${stepHtml(s, t.params || [])}</li>`).join('')}</ol>
        ${(t.params || []).length ? `<h3 class="at-sec"><i>02</i> Trường thông tin</h3>
          <div class="fld-grid">${(t.params || []).map(fieldHtml).join('')}</div>
          <div class="fld-note">Sửa giá trị để chạy với giá trị khác (chỉ lần chạy này).
            ${canEdit() ? '<button class="linkbtn at-save-params" style="background:none;border:0;color:var(--primary);cursor:pointer;text-decoration:underline;font-size:11px;">Lưu làm mặc định</button>' : ''}
            Không có trong danh mục của tài khoản thì chọn mục đầu tiên (xem ghi chú sau khi chạy).</div>` : ''}
        <pre class="at-codebox" style="display:none;background:var(--surface-alt);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:11px;overflow:auto;max-height:260px;margin-top:8px;">${esc(t.script)}</pre>
        <div class="at-result" style="font-size:11.5px;margin-top:6px;"></div>
        </div>
      </div>`).join('');
    document.querySelectorAll('#at-list [data-id]').forEach(card => {
      const t = tasks.find(x => x.id === card.dataset.id);
      const box = card.querySelector('.at-codebox');
      card.querySelector('.at-open').onclick = () => openTask(card);
      card.addEventListener('click', e => { if (!card.classList.contains('open') && !e.target.closest('button,select,input,a,label')) openTask(card); });
      wireFields(card, t);
      card.querySelector('.at-code').onclick = () => { box.style.display = box.style.display === 'none' ? 'block' : 'none'; };
      const rt = card.querySelector('.at-retire');
      if (rt) rt.onclick = async () => {
        if (!confirm(`Gỡ tác vụ "${t.name}"?`)) return;
        try { await call('DELETE', `/automation/tasks/${t.id}`); load(); } catch (e) { notice(esc(e.message), 'error'); }
      };
      const ed = card.querySelector('.at-edit');
      if (ed) ed.onclick = () => openEdit(t);
      const sp = card.querySelector('.at-save-params');
      if (sp) sp.onclick = async () => {
        try { await call('PUT', `/automation/tasks/${t.id}/params`, { params: collect(card).map(([key, value]) => ({ key, value, auto: (t.params.find(p => p.key === key) || {}).auto })) }); notice('Đã lưu giá trị mặc định.', 'ok'); load(); }
        catch (e) { notice(esc(e.message), 'error'); }
      };
      const ap = card.querySelector('.at-approve');
      if (ap) ap.onclick = async () => {
        box.style.display = 'block';
        if (!confirm(`Bạn đã đọc kỹ code bên dưới và đồng ý cho tác vụ chạy trên Staging bằng tài khoản của người dùng?\n\nMã băm: ${t.script_sha.slice(0, 16)}...`)) return;
        try { await call('POST', `/automation/tasks/${t.id}/approve`, { sha: t.script_sha }); load(); } catch (e) { notice(esc(e.message), 'error'); }
      };
      card.querySelectorAll('.step-file').forEach(box => {
        box.querySelector('.step-filebtn').onclick = e => { e.stopPropagation(); openPicker(box); };
        box.querySelector('.step-fclear').onclick = () => setPicked(box, []);
      });
      const run = card.querySelector('.at-run');
      if (run) run.onclick = () => runMany(t, card);
    });
  }

  // Giá trị đang có trong các ô của một thẻ: [[khóa, giá trị], ...]
  const collect = card => [...card.querySelectorAll('.step-param, .step-file')].reduce((m, el) => {
    const key = el.dataset.key;
    return m.some(x => x[0] === key) ? m : [...m, [key, el.classList.contains('step-file') ? (el.dataset.fid || '') : el.value]];
  }, []);

  // Chọn ảnh trong mô tả bước: tick tên file trong kho ảnh test (hoặc tải ảnh mới lên kho ngay tại đó)
  const toBase64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Không đọc được file')); r.readAsDataURL(file); });
  function setPicked(box, ids) {
    box.dataset.fid = ids.join(',');
    box.querySelector('.step-fname').textContent = ids.map(nameOf).join(', ') || '(chưa chọn, bỏ qua)';
    box.querySelector('.step-fclear').style.display = ids.length ? '' : 'none';
    box.closest('.at-card')?.dispatchEvent(new Event('input'));
  }
  function closePicker() { const o = document.getElementById('at-pop'); if (o) o.remove(); }
  document.addEventListener('click', e => { if (!e.target.closest('#at-pop')) closePicker(); });
  function openPicker(box) {
    closePicker();
    const pop = document.createElement('div');
    pop.id = 'at-pop';
    pop.style.cssText = 'position:fixed;z-index:1000;background:var(--surface,#fff);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:8px;max-height:320px;overflow:auto;min-width:260px;font-size:12px;';
    const r = box.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 300)) + 'px'; pop.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 340)) + 'px';
    const picked = new Set(String(box.dataset.fid || '').split(',').filter(Boolean));
    const draw = () => {
      pop.innerHTML = (library.length ? library.map(f => `<label style="display:flex;gap:6px;align-items:center;padding:2px 0;cursor:pointer;"><input type="checkbox" value="${esc(f.id)}" ${picked.has(f.id) ? 'checked' : ''}> ${esc(f.name)} <span style="color:var(--text-subtle);">${fmtSize(f.size)}</span></label>`).join('')
        : '<div style="color:var(--text-subtle);margin-bottom:6px;">Kho file test đang trống.</div>')
        + '<hr style="margin:6px 0;"><label style="cursor:pointer;color:var(--primary);text-decoration:underline;">+ Tải file mới lên kho<input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.rtf,.zip" hidden></label><div class="pop-msg" style="color:var(--danger);margin-top:4px;"></div>';
      pop.querySelectorAll('input[type=checkbox]').forEach(c => c.onchange = () => { c.checked ? picked.add(c.value) : picked.delete(c.value); setPicked(box, [...picked]); });
      pop.querySelector('input[type=file]').onchange = async e => {
        const fs = [...e.target.files]; e.target.value = '';
        if (!fs.length) return;
        pop.querySelector('.pop-msg').textContent = 'Đang tải lên...';
        const added = await uploadToLibrary(fs);
        added.forEach(a => picked.add(a.id)); setPicked(box, [...picked]); draw();
        if (!added.length) pop.querySelector('.pop-msg').textContent = $('at-lib-msg').textContent;
      };
    };
    draw();
    document.body.appendChild(pop);
  }
  $('at-lib-input').addEventListener('change', async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await uploadToLibrary(fs); });

  // Một lần chạy: tạo phiên, nhờ launcher đăng nhập và chạy, đợi kết quả. Lỗi hạ tầng (launcher, đăng nhập) được ném ra.
  async function runOnce(t, accId, params, batch, onStatus) {
    const { session, account } = await call('POST', `/automation/tasks/${t.id}/run`, { account_id: accId || undefined, params, batch });
    onStatus(`Đang chạy bằng tài khoản <b>${esc(account.name)}</b>...`);
    let started;
    try {
      started = await _fetch(`${LAUNCHER_URL}/launch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: session.sessionId, token: getToken() || 'local' }) });
    } catch { throw new Error('Chưa chạy QA Launcher trên máy bạn. Chạy: node apps/launcher/launcher.js --server ' + location.origin); }
    if (!started.ok) throw new Error((await started.json().catch(() => ({}))).error || 'Launcher từ chối yêu cầu');
    for (let i = 0; i < 150; i++) {
      const st = await (await _fetch(`${LAUNCHER_URL}/status/${session.sessionId}`)).json();
      if (st.status === 'TASK_DONE') return { result: st.result, account };
      if (st.status === 'ERROR') throw new Error(st.detail);
      if (st.status.startsWith('NEEDS_')) throw new Error(st.detail || 'Cần bạn đăng nhập thủ công trong cửa sổ vừa mở, rồi bấm Chạy lại.');
      onStatus(`Đang chạy bằng tài khoản <b>${esc(account.name)}</b>: ${esc(st.detail || st.status)}...`);
      await new Promise(res => setTimeout(res, 1500));
    }
    throw new Error('Quá thời gian chờ');
  }

  // Chạy một tác vụ N lần liên tiếp (cùng một tài khoản, cùng giá trị trong các ô)
  async function runMany(t, card) {
    const out = card.querySelector('.at-result');
    const n = Math.min(50, Math.max(1, parseInt(card.querySelector('.at-times').value, 10) || 1));
    card.querySelector('.at-times').value = n;
    const stopOnFail = card.querySelector('.at-stop').checked;
    const runBtn = card.querySelector('.at-run'), halt = card.querySelector('.at-halt');
    let accId = card.querySelector('.at-acc').value, account = null, halted = false;
    const params = Object.fromEntries(collect(card));
    const batchId = 'b' + Date.now().toString(36);
    const rows = [];
    runningCount++;
    runBtn.disabled = true; halt.style.display = ''; halt.onclick = () => { halted = true; halt.textContent = 'Đang dừng sau lần này...'; };
    const draw = (live, final) => { out.innerHTML = n === 1 && final && rows[0] && rows[0].result ? '' : summary(rows, n, live, final, account); };
    try {
      for (let i = 1; i <= n && !halted; i++) {
        let row;
        try {
          draw(`Lần ${i}/${n}: đang chọn tài khoản...`);
          const r = await runOnce(t, accId, params, { id: batchId, index: i, total: n }, msg => draw(`Lần ${i}/${n}: ${msg}`));
          account = r.account; accId = accId || r.account.id; // các lần sau dùng đúng tài khoản đã chọn ở lần đầu
          row = { i, status: r.result.status, ms: r.result.duration_ms, result: r.result };
        } catch (e) {
          row = { i, status: 'ERROR', error: e.message };
          rows.push(row);
          break; // lỗi hạ tầng (launcher, đăng nhập): dừng cả lượt
        }
        rows.push(row);
        if (stopOnFail && row.status !== 'PASS') break;
      }
    } finally { runningCount--; runBtn.disabled = false; halt.style.display = 'none'; halt.textContent = 'Dừng'; }
    if (n === 1 && rows[0] && rows[0].result && account) showResult(out, rows[0].result, account); else draw('', true);
  }

  function summary(rows, n, live, final, account) {
    const pass = rows.filter(r => r.status === 'PASS').length, fail = rows.length - pass;
    const head = `<b>${final ? 'Kết quả' : 'Tiến độ'}:</b> ${rows.length}/${n} lần · <span style="color:green;">đạt ${pass}</span> · <span style="color:var(--danger);">không đạt ${fail}</span>${account ? ` · tài khoản ${esc(account.name)}` : ''}`;
    const body = rows.map(r => {
      if (r.status === 'ERROR') return `<li style="color:var(--danger);">Lần ${r.i}: không chạy được: ${esc(r.error)}</li>`;
      const failed = (r.result.steps || []).find(s => s.status !== 'PASS');
      return `<li><details><summary>Lần ${r.i}: ${r.status === 'PASS' ? '<span style="color:green;">ĐẠT</span>' : '<span style="color:var(--danger);">KHÔNG ĐẠT</span>'} · ${(r.ms / 1000).toFixed(1)}s${failed ? ` · lỗi ở bước "${esc(failed.name)}"` : ''}</summary>
        <ul style="margin:2px 0 4px 16px;">${(r.result.steps || []).map(s => `<li>${s.status === 'PASS' ? '✓' : '✗'} ${esc(s.name)} <span style="color:var(--text-subtle);">${s.ms}ms${s.error ? ' · ' + esc(s.error) : ''}</span></li>`).join('')}</ul>
        ${(r.result.log || []).length ? `<div style="color:var(--text-subtle);">Ghi chú: ${r.result.log.map(esc).join(' · ')}</div>` : ''}
        ${r.result.error ? `<div style="color:var(--danger);">${esc(r.result.error)}</div>` : ''}</details></li>`;
    }).join('');
    const avg = rows.filter(r => r.ms).length ? ` · trung bình ${(rows.reduce((a, r) => a + (r.ms || 0), 0) / rows.filter(r => r.ms).length / 1000).toFixed(1)}s/lần` : '';
    return `${head}${final ? avg : ''}${live ? `<div style="color:var(--text-subtle);">${live}</div>` : ''}<ol style="margin:4px 0 0 18px;padding:0;">${body}</ol>`;
  }

  function showResult(out, res, account) {
    out.innerHTML = `<b style="color:${res.status === 'PASS' ? 'green' : 'var(--danger)'};">${res.status === 'PASS' ? 'ĐẠT' : 'KHÔNG ĐẠT'}</b>
      · ${esc(account.name)} · ${(res.duration_ms / 1000).toFixed(1)}s
      <ul style="margin:4px 0 0 18px;">${res.steps.map(s => `<li>${s.status === 'PASS' ? '✓' : '✗'} ${esc(s.name)} <span style="color:var(--text-subtle);">${s.ms}ms${s.error ? ' · ' + esc(s.error) : ''}</span></li>`).join('')}</ul>
      ${(res.log || []).length ? `<div style="margin-top:4px;color:var(--text-subtle);">Ghi chú khi chạy: ${res.log.map(esc).join(' · ')}</div>` : ''}
      ${res.error ? `<div style="color:var(--danger);">${esc(res.error)}</div>` : ''}`;
  }

  // ---------- Sửa tác vụ (mô tả, bước, tham số, code) ----------
  let editing = null;
  const paramRow = (p = {}) => `<tr class="tp-row">
    <td><input class="form-control tp-key" value="${esc(p.key || '')}" placeholder="khoa_thamso" style="width:110px;"></td>
    <td><input class="form-control tp-label" value="${esc(p.label || '')}" placeholder="Tên hiển thị"></td>
    <td><textarea class="form-control tp-value" rows="1" style="resize:vertical;min-height:30px;" placeholder="Giá trị mặc định">${esc(p.value || '')}</textarea></td>
    <td><select class="form-control tp-type" title="Chữ: một giá trị. Danh sách: nhiều giá trị cách nhau bằng dấu phẩy. File: chọn file để đính kèm.">
      <option value="text" ${(p.type || 'text') === 'text' ? 'selected' : ''}>Chữ</option><option value="multiline" ${p.type === 'multiline' ? 'selected' : ''}>Nhiều dòng</option><option value="list" ${p.type === 'list' ? 'selected' : ''}>Danh sách</option><option value="file" ${p.type === 'file' ? 'selected' : ''}>File</option></select></td>
    <td><select class="form-control tp-auto" title="Khi để trống hoặc không có trong danh mục của tài khoản">
      <option value="skip" ${p.auto === false ? 'selected' : ''}>Báo lỗi nếu không có</option><option value="first" ${p.auto !== false && p.fallback !== 'random' ? 'selected' : ''}>Chọn mục đầu tiên</option><option value="random" ${p.auto !== false && p.fallback === 'random' ? 'selected' : ''}>Chọn ngẫu nhiên</option></select></td>
    <td><button type="button" class="linkbtn tp-del" style="background:none;border:0;color:var(--danger);cursor:pointer;">Xóa</button></td></tr>`;

  function openEdit(t) {
    editing = t;
    $('te-title').textContent = `Sửa tác vụ: ${t.name}`;
    $('te-name').value = t.name; $('te-desc').value = t.description || ''; $('te-url').value = t.start_url;
    $('te-roles').value = (t.required_roles || []).join(', ');
    $('te-writes').checked = !!t.writes;
    $('te-steps').value = (t.steps || []).join('\n');
    $('te-params').innerHTML = (t.params || []).map(paramRow).join('');
    $('te-script').value = t.script;
    $('te-msg').textContent = '';
    document.getElementById('modal-task').classList.add('open');
  }

  async function saveEdit() {
    const params = [...document.querySelectorAll('#te-params .tp-row')].map(r => ({
      key: r.querySelector('.tp-key').value.trim(), label: r.querySelector('.tp-label').value.trim(),
      value: r.querySelector('.tp-value').value, type: r.querySelector('.tp-type').value,
      auto: r.querySelector('.tp-auto').value !== 'skip', fallback: r.querySelector('.tp-auto').value === 'random' ? 'random' : 'first' })).filter(p => p.key);
    const body = {
      id: editing.id, module: editing.module, flow: editing.flow, rule_ids: editing.rule_ids, source: editing.source,
      name: $('te-name').value.trim(), description: $('te-desc').value, start_url: $('te-url').value.trim(),
      required_roles: $('te-roles').value.split(',').map(x => x.trim()).filter(Boolean), writes: $('te-writes').checked,
      steps: $('te-steps').value.split('\n').map(x => x.trim()).filter(Boolean), params, script: $('te-script').value
    };
    try {
      const saved = await call('POST', '/automation/tasks', body);
      closeModals();
      const codeChanged = saved.script_sha !== editing.script_sha;
      notice(codeChanged ? 'Đã lưu. Code mới dùng được ngay ở lần chạy sau.' : 'Đã lưu.', 'ok');
      load();
    } catch (e) { $('te-msg').textContent = e.message; }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('at-module').addEventListener('change', load);
    $('at-reload').addEventListener('click', load);
    $('at-backlink').addEventListener('click', closeTask);
    $('crumb-page').addEventListener('click', () => { if ($('pane-automation').classList.contains('detail-mode') && $('pane-automation').classList.contains('active')) closeTask(); });
    $('at-q').addEventListener('input', () => render());
    $('at-kind').addEventListener('change', () => render());
    { let opened = false; document.querySelector("[data-tab='pane-automation']").addEventListener('click', () => { if (!opened) { opened = true; load(); } }); } // đổi tab không nạp lại: giữ nguyên kết quả, chỉ nạp lại khi tải lại trang
    $('te-add-param').addEventListener('click', () => $('te-params').insertAdjacentHTML('beforeend', paramRow({ auto: true })));
    $('te-params').addEventListener('click', e => { if (e.target.closest('.tp-del')) e.target.closest('.tp-row').remove(); });
    $('te-save').addEventListener('click', saveEdit);
  });
})();

// -----------------------------------------------------------
// 3. Phân Tích Bug (tự tìm rule và bug cũ) và Bug Cũ
// -----------------------------------------------------------
(function setupBugTabs() {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');
  const SAMPLE = 'Cửa hàng không hoàn tất được đánh giá phiếu Bảo trì trên mobile, bấm Gửi đánh giá thì màn hình đơ';
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

  async function loadModules() {
    try {
      const j = await (await fetch(`${API_BASE}/kb/modules`)).json();
      const opts = (j.data || []).slice().sort((a, b) => a.code.localeCompare(b.code))
        .map(m => `<option value="${esc(m.code)}">${esc(m.code)} · ${esc(m.name)}${m.cluster ? ' (cụm ' + esc(m.cluster) + ')' : ''}</option>`).join('');
      $('bug-module-select').insertAdjacentHTML('beforeend', opts);
      $('bh-module').insertAdjacentHTML('beforeend', opts);
    } catch {}
  }

  // ---------- Tab 2: Phân Tích Bug ----------
  let timer, seq = 0;

  function hints(text, platform) {
    const t = fold(text), miss = [];
    if (!/tai khoan|user|role|vai tro|khach hang/.test(t)) miss.push('tài khoản hoặc vai trò thực hiện');
    if (!/buoc|khi |nhan|bam|tao |chon/.test(t)) miss.push('các bước thao tác dẫn đến lỗi');
    if (!/anh|video|screenshot|dinh kem/.test(t)) miss.push('ảnh hoặc video bằng chứng');
    if (platform === 'Mobile' && !/ios|android|phien ban|version/.test(t)) miss.push('thiết bị và phiên bản ứng dụng (Mobile)');
    $('ba-hints').innerHTML = miss.length ? `<span class="badge badge-amber">Nên bổ sung</span> ${esc(miss.join(', '))}` : '';
  }

  function renderResults(d) {
    $('ba-results').style.display = 'block';
    $('ba-summary').innerHTML = d.module_used
      ? `Đang tìm trong module <b>${esc(d.module_used)}</b>.`
      : (d.module_guess ? `Module nghi vấn: <b>${esc(d.module_guess)}</b> (đoán từ các bug cũ giống nhất; chưa dùng để lọc). Chọn module ở trên để thu hẹp kết quả.` : 'Chưa đoán được module; đang tìm trên mọi module.');
    $('ba-rules-count').textContent = d.rules.length;
    $('ba-bugs-count').textContent = d.bugs.length;
    $('ba-rules').innerHTML = d.rules.length ? d.rules.map(r => `
      <div style="margin-bottom:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
        <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener"><b>${esc(r.rule_id)}</b> · ${esc(r.title)}</a>
        <span class="badge badge-blue">${esc(r.flow || r.module)}</span>${r.state === 'pending' ? ' <span class="badge badge-amber">Chưa xác nhận</span>' : ''}
        <div style="font-size:11.5px;color:var(--text-subtle);margin-top:3px;">${esc((r.description || '').slice(0, 220))}${(r.description || '').length > 220 ? '...' : ''}</div>
        ${r.roles.length ? `<div style="font-size:11px;">Vai trò: ${esc(r.roles.join(', '))}</div>` : ''}
      </div>`).join('') : '<em style="font-size:12px;">Không có rule đã xác nhận nào giống mô tả. Có thể rule chưa được ghi hoặc đang chờ xác nhận.</em>';
    $('ba-bugs').innerHTML = d.bugs.length ? d.bugs.map(b => bugCard(b)).join('') : '<em style="font-size:12px;">Không có bug cũ nào giống mô tả.</em>';
  }

  // Mã trạng thái task Haraworks -> nhãn
  const BUG_STATUS = { 0: 'Chưa bắt đầu', 1: 'Đang thực hiện', 2: 'Tạm ngưng', 3: 'Chờ duyệt', 5: 'Hoàn thành', 11: 'Không thực hiện' };

  function bugCard(b) {
    const note = b.note ? `<div style="font-size:11.5px;margin-top:3px;background:var(--surface-alt);padding:4px 6px;border-radius:4px;">
      ${b.note.root_cause ? `<b>Nguyên nhân:</b> ${esc(b.note.root_cause)}<br>` : ''}${b.note.fix ? `<b>Cách sửa:</b> ${esc(b.note.fix)}<br>` : ''}${(b.note.rule_ids || []).length ? `Rule: ${esc(b.note.rule_ids.join(', '))}` : ''}</div>` : '';
    return `<div style="margin-bottom:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
      <a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener"><b>${esc(b.title)}</b></a>
      <div style="font-size:11px;margin-top:2px;">
        ${b.module ? `<span class="badge badge-blue">${esc(b.module)}</span>` : ''}
        ${b.category ? `<span class="badge badge-amber">${esc(b.category)}</span>` : ''}
        ${b.live && b.status != null ? `<span class="badge badge-green">${esc(BUG_STATUS[b.status] || 'Trạng thái ' + b.status)}</span>` : ''}
        <span style="color:var(--text-subtle);">${esc((b.date || '').slice(0, 16))}${b.assignee ? ' · ' + esc(b.assignee) : ''}${b.project ? ' · ' + esc(b.project) : ''}</span></div>${note}</div>`;
  }

  async function liveSearch() {
    const text = $('bug-input-desc').value.trim();
    hints(text, $('bug-platform-select').value);
    if (text.length < 8) { $('ba-results').style.display = 'none'; return; }
    const my = ++seq;
    $('ba-summary') && ($('ba-results').style.display === 'none' || ($('ba-summary').style.opacity = '.5'));
    try {
      const res = await fetch(`${API_BASE}/bug-search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, module: $('bug-module-select').value }) });
      const j = await res.json();
      if (my !== seq) return; // có lần gõ mới hơn
      if (!res.ok) throw new Error(j.error?.message || 'Lỗi tìm kiếm');
      $('ba-summary').style.opacity = '1';
      renderResults(j.data);
    } catch (e) { $('ba-results').style.display = 'block'; $('ba-summary').textContent = 'Không tìm được: ' + e.message; }
  }
  // AI phân tích: nguyên nhân có thể, nơi cần kiểm tra, tác vụ tự động gợi ý. Chạy sau khi ngừng gõ, kết quả giữ nguyên khi đổi tab.
  let aiSeq = 0, aiTimer;
  async function runAnalysis() {
    const text = $('bug-input-desc').value.trim();
    if (text.length < 20) { $('ba-ai-body').innerHTML = '<span style="color:var(--text-subtle);">Nhập mô tả đủ chi tiết (ít nhất 20 ký tự) để AI phân tích.</span>'; return; }
    const my = ++aiSeq;
    $('ba-ai-body').innerHTML = '<span style="color:var(--text-subtle);">Đang phân tích...</span>';
    try {
      const res = await fetch(`${API_BASE}/bug-analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, module: $('bug-module-select').value }) });
      let j = null; try { j = await res.json(); } catch {}
      if (my !== aiSeq) return;
      if (!res.ok) throw new Error(j?.error?.message || (res.status === 404 ? 'Server chưa chạy bản mới, hãy khởi động lại server' : 'Lỗi ' + res.status));
      const d = j.data, list = a => a.length ? `<ul style="margin:2px 0 6px 18px;padding:0;">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div style="color:var(--text-subtle);">Không có.</div>';
      $('ba-ai-body').innerHTML = `<div style="font-size:11px;color:var(--text-subtle);margin-bottom:6px;">${esc(d.engine_note)}</div>
        <b>Có thể do:</b>${list(d.causes)}<b>Cần kiểm tra:</b>${list(d.checks)}
        <b>Tác vụ tự động hóa gợi ý:</b>${d.tasks.length ? `<ul style="margin:2px 0 6px 18px;padding:0;">${d.tasks.map(t => `<li><a href="#" class="ba-task" data-id="${esc(t.id)}">${esc(t.name)}</a> <span class="badge badge-blue">${esc(t.module)}</span> <span style="color:var(--text-subtle);">${esc(t.why)}</span></li>`).join('')}</ul>` : '<div style="color:var(--text-subtle);">Chưa có tác vụ phù hợp.</div>'}
        ${d.new_task ? `<div style="margin-top:4px;"><b>Gợi ý tạo tác vụ mới:</b> ${esc(d.new_task)}</div>` : ''}`;
      $('ba-ai-body').querySelectorAll('.ba-task').forEach(a => a.onclick = e => { e.preventDefault(); document.querySelector("[data-tab='pane-automation']").click(); });
    } catch (e) { if (my === aiSeq) $('ba-ai-body').innerHTML = `<span style="color:var(--danger);">Không phân tích được: ${esc(e.message)}</span>`; }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(liveSearch, 600); clearTimeout(aiTimer); aiTimer = setTimeout(runAnalysis, 2000); };

  // ---------- Tab 3: Bug Cũ ----------
  let offset = 0, total = 0, facetsLoaded = false, bhTimer, bhItems = [];
  const bhStatusLabel = st => BUG_STATUS[st] || ('Trạng thái ' + st);
  const CLOSED_HINT = 'Đóng = Hoàn thành hoặc Không thực hiện (suy ra từ tên trạng thái, cần QC xác nhận).';

  async function loadFacets(force) {
    if (facetsLoaded && !force) return;
    try {
      const { data } = await (await fetch(`${API_BASE}/bugs/meta`)).json();
      facetsLoaded = true;
      const f = data.facets || {};
      $('bh-total').textContent = `${data.count} bug`;
      const fill = (id, html) => { const sel = $(id); const keep = sel.value; sel.innerHTML = sel.options[0].outerHTML + html; sel.value = keep; };
      // module: "Chưa rõ module" chỉ lọc trong tab này
      const mod = $('bh-module'), unk = mod.querySelector('option[value="__unknown__"]');
      if (unk) unk.textContent = `Chưa rõ module (${f.unknown || 0})`;
      else mod.insertAdjacentHTML('beforeend', `<option value="__unknown__">Chưa rõ module (${f.unknown || 0})</option>`);
      fill('bh-st', Object.entries(f.statuses || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(bhStatusLabel(+k))} (${n})</option>`).join(''));
      fill('bh-as', Object.entries(f.assignees || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      fill('bh-cat', Object.entries(f.categories || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      fill('bh-year', Object.keys(f.years || {}).sort().reverse().map(y => `<option>${esc(y)}</option>`).join(''));
    } catch {}
  }

  function bhQuery() {
    const mod = $('bh-module').value, unknown = mod === '__unknown__';
    return new URLSearchParams({
      module: unknown ? '' : mod, unknown: unknown ? '1' : '0', q: $('bh-q').value.trim(),
      category: $('bh-cat').value, year: $('bh-year').value, status: $('bh-st').value,
      assignee: $('bh-as').value, closed: $('bh-cl').value
    });
  }

  function bhCard(b, idx) {
    const st = b.live && b.status != null ? `<span class="badge ${b.closed ? 'badge-closed' : 'badge-green'}">${esc(bhStatusLabel(b.status))}</span>` : '';
    const meta = [b.category, (b.date || '').slice(0, 16), b.assignee].filter(Boolean).map(esc).join(' · ');
    return `<article class="bh-card${b.closed ? ' is-closed' : ''}" data-idx="${idx}" tabindex="0">
      <div class="bh-card-top"><span class="badge badge-blue">${b.module ? esc(b.module) : 'Chưa rõ module'}</span>${st}</div>
      <div class="bh-card-title">${esc(b.title)}</div>
      <div class="bh-card-meta">${meta}</div>
      ${b.closed ? '<span class="bh-ribbon">Đã đóng</span>' : ''}
    </article>`;
  }

  async function loadBugs(reset, keepPaging) {
    // keepPaging: làm mới do có bug mới, giữ nguyên số bug đang xem
    const limit = reset && keepPaging ? Math.min(200, Math.max(50, offset)) : 50;
    if (reset) { offset = 0; bhItems = []; $('bh-list').innerHTML = ''; }
    const qs = bhQuery(); qs.set('offset', offset); qs.set('limit', limit);
    const { data } = await (await fetch(`${API_BASE}/bugs?${qs}`)).json();
    total = data.total;
    const start = bhItems.length;
    bhItems = bhItems.concat(data.items);
    $('bh-list').insertAdjacentHTML('beforeend', data.items.map((b, k) => bhCard(b, start + k)).join(''));
    offset += data.items.length;
    $('bh-count').textContent = total ? `Hiển thị ${offset} trên ${total} bug` : 'Không có bug nào khớp bộ lọc.';
    $('bh-more').style.display = offset < total ? '' : 'none';
  }
  const reload = () => { clearTimeout(bhTimer); bhTimer = setTimeout(() => loadBugs(true), 300); };

  function openBh(i) {
    const b = bhItems[i]; if (!b) return;
    const live = !!b.live, na = '<i style="color:var(--text-muted);">chưa có dữ liệu</i>';
    const row = (k, v) => `<div class="bh-row"><span>${k}</span><b style="text-align:right;">${v}</b></div>`;
    const note = b.note ? `<div style="font-size:12px;margin-top:10px;background:var(--surface-alt);padding:8px;border-radius:6px;">
      ${b.note.root_cause ? `<b>Nguyên nhân:</b> ${esc(b.note.root_cause)}<br>` : ''}${b.note.fix ? `<b>Cách sửa:</b> ${esc(b.note.fix)}<br>` : ''}${(b.note.rule_ids || []).length ? `Rule: ${esc(b.note.rule_ids.join(', '))}` : ''}</div>` : '';
    $('bh-drawer-body').innerHTML = `
      <h3 class="bh-d-title">${esc(b.title)}</h3>
      <div style="margin:8px 0 6px;">${b.closed ? `<span class="badge badge-closed" title="${esc(CLOSED_HINT)}">Đã đóng</span>` : (live ? '<span class="badge badge-green">Đang mở</span>' : '')}</div>
      ${row('Module', esc(b.module || 'Chưa rõ'))}
      ${row('Phân loại', esc(b.category || '-'))}
      ${row('Ngày tạo', esc((b.date || '').slice(0, 16) || '-'))}
      ${live ? row('Trạng thái', esc(bhStatusLabel(b.status))) : row('Trạng thái', '<i>bản lưu cũ, không có trạng thái</i>')}
      ${live ? row('Người thực hiện', esc(b.assignee || '-')) : ''}
      ${live ? row('Dự án', esc(b.project || '-')) : ''}
      ${live ? row('Cập nhật lần cuối', esc((b.updated || '').slice(0, 16) || '-')) : ''}
      ${note}
      <p style="margin-top:12px;"><a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">Mở bug trên Haraworks ↗</a></p>
      <div id="bh-detail" style="margin-top:10px;color:var(--text-subtle);">Đang tải chi tiết từ Haraworks...</div>`;
    $('bh-drawer').classList.add('open');
    loadBhDetail(b.id);
  }

  // Chi tiết đầy đủ lấy từ Haraworks (mô tả, người, lịch sử, bình luận); cần cookie Haraworks trên server
  const vnTime = iso => { if (!iso) return '-'; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }); };
  const LOG_TYPE = { 1: 'Tạo công việc', 12: 'Thay đổi dự án' };
  const names = a => a.length ? a.map(p => esc(p.name)).join(', ') : '-';
  async function loadBhDetail(id) {
    const box = $('bh-detail'); if (!box) return;
    try {
      const res = await fetch(`${API_BASE}/bugs/${encodeURIComponent(id)}/detail`);
      let j = null; try { j = await res.json(); } catch {}
      if ($('bh-detail') !== box) return; // đã mở bug khác
      if (!res.ok) { box.innerHTML = `<div class="alert-box alert-amber" style="font-size:12px;">${esc(j?.error?.message || ('Không lấy được chi tiết (lỗi ' + res.status + ')'))}</div>`; return; }
      const d = j.data, row = (k, v) => `<div class="bh-row"><span>${k}</span><b style="text-align:right;">${v}</b></div>`;
      const att = a => a.length ? a.map(f => f.url ? `<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener">${esc(f.name || 'tệp')}</a>` : esc(f.name)).join(', ') : '-';
      const logs = d.logs.slice().sort((x, y) => String(y.at).localeCompare(String(x.at))).map(l => `<li><b>${esc(l.by || '-')}</b>: ${esc(LOG_TYPE[l.type] || ('Thay đổi (mã ' + l.type + ')'))}${l.info.Project ? ': ' + esc(l.info.Project) : ''}${l.reason ? ' · ' + esc(l.reason) : ''}<br><span style="color:var(--text-muted);">${vnTime(l.at)}</span></li>`).join('');
      const cm = d.comments.items.map(c => `<div class="bh-comment"><b>${esc(c.by || '-')}</b> <span style="color:var(--text-muted);font-size:11px;">${vnTime(c.at)}</span>
        <div style="white-space:pre-wrap;">${esc(c.text)}</div>${c.attachments.length ? `<div style="font-size:11.5px;">Đính kèm: ${att(c.attachments)}</div>` : ''}
        ${c.replies.map(r => `<div class="bh-reply"><b>${esc(r.by || '-')}</b> <span style="color:var(--text-muted);font-size:11px;">${vnTime(r.at)}</span><div style="white-space:pre-wrap;">${esc(r.text)}</div></div>`).join('')}</div>`).join('');
      box.style.color = '';
      box.innerHTML = `<h4 style="margin:6px 0;">Chi tiết từ Haraworks</h4>
        ${d.status != null ? row('Trạng thái (Haraworks)', esc(bhStatusLabel(d.status))) : ''}
        ${d.code ? row('Mã', esc(d.code)) : ''}${row('Người tạo', esc(d.created_by?.name || '-'))}${row('Người thực hiện', d.assignee ? esc(d.assignee.name) + (d.assignee.dept ? ' · ' + esc(d.assignee.dept) : '') : '-')}
        ${row('Chủ sở hữu', esc(d.owner?.name || '-'))}${d.supporters.length ? row('Người hỗ trợ', names(d.supporters)) : ''}${row('Người theo dõi (' + d.followers.length + ')', names(d.followers))}
        ${row('Hạn thực hiện', vnTime(d.plan_end_at))}${row('Ưu tiên (mã)', d.priority ?? '-')}${row('Cập nhật gần nhất', vnTime(d.updated_at) + (d.updated_by?.name ? ' · ' + esc(d.updated_by.name) : ''))}
        ${d.project ? row('Dự án', esc(d.project)) : ''}${row('File đính kèm', att(d.attachments))}
        ${d.description ? `<h4 style="margin:10px 0 4px;">Mô tả</h4><div style="white-space:pre-wrap;font-size:12px;">${esc(d.description)}</div>` : ''}
        <h4 style="margin:10px 0 4px;">Lịch sử cập nhật (${d.logs.length})</h4>${logs ? `<ul class="bh-logs">${logs}</ul>` : '<div style="color:var(--text-muted);">Không có.</div>'}
        <h4 style="margin:10px 0 4px;">Bình luận (${d.comments.total})</h4>${cm || '<div style="color:var(--text-muted);">Chưa có bình luận.</div>'}`;
    } catch (e) { if ($('bh-detail') === box) box.textContent = 'Không lấy được chi tiết: ' + e.message; }
  }
  function closeBh() { $('bh-drawer').classList.remove('open'); }

  // ---------- Realtime: hỏi nhẹ số bản mỗi 5 giây khi đang mở tab Bug Cũ, có bug mới thì làm mới danh sách ----------
  let liveRev = null, liveTimer = null;
  const REALTIME_LABEL = { connected: 'realtime', 'poll-only': 'cập nhật mỗi 30 giây', reconnecting: 'đang nối lại', disconnected: 'cập nhật mỗi 30 giây', connecting: 'đang kết nối' };
  async function checkLive() {
    if (document.hidden || !$('pane-bug-history').classList.contains('active')) return;
    try {
      const { data } = await (await fetch(`${API_BASE}/bugs/live`)).json();
      const when = data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('vi-VN') : '';
      const badge = $('bh-live');
      let cls, text, why;
      if (!data.enabled) {
        cls = 'badge-amber'; text = '● Chưa realtime';
        why = 'Chưa có cookie đăng nhập Haraworks trên server nên không cập nhật realtime. Đang dùng bản lưu gần nhất' + (when ? ' (lúc ' + when + ')' : '') + '. Admin đặt cookie vào secrets/haraworks.json rồi khởi động lại server.';
      } else if (data.error && /^AUTH:/.test(data.error)) {
        cls = 'badge-red'; text = '● Chưa realtime';
        why = 'Cookie đăng nhập Haraworks đã hết hạn. Đăng nhập lại tasks.haraworks.vn, lấy cookie mới, cập nhật secrets/haraworks.json, rồi bấm ⟳.' + (when ? ' Đang hiển thị bản lúc ' + when + '.' : '');
      } else if (data.error) {
        cls = 'badge-amber'; text = '● Chưa realtime';
        why = 'Lỗi khi lấy dữ liệu: ' + data.error.slice(0, 160) + '. Đang dùng bản lưu gần nhất.';
      } else if (data.realtime === 'connected') {
        cls = 'badge-green'; text = '● Realtime';
        why = 'Cập nhật ngay khi có thay đổi trên Haraworks.' + (when ? ' Đồng bộ lần cuối: ' + when + '.' : '');
      } else {
        cls = 'badge-amber'; text = '● Cập nhật mỗi 30 giây';
        why = 'Chưa nhận được tín hiệu tức thời nên hệ thống hỏi lại mỗi 30 giây.' + (when ? ' Đồng bộ lần cuối: ' + when + '.' : '');
      }
      badge.className = 'badge ' + cls; badge.textContent = text; badge.title = why;
      if (liveRev !== null && data.revision !== liveRev) { await loadFacets(true); await loadBugs(true, true); }
      liveRev = data.revision;
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadModules();
    $('bug-input-desc').addEventListener('input', schedule);
    $('bug-module-select').addEventListener('change', liveSearch);
    $('bug-platform-select').addEventListener('change', () => hints($('bug-input-desc').value, $('bug-platform-select').value));
    $('btn-load-sample-bug').addEventListener('click', () => { $('bug-input-desc').value = SAMPLE; liveSearch(); runAnalysis(); });
    $('ba-ai-run').addEventListener('click', runAnalysis);

    document.querySelector("[data-tab='pane-bug-history']").addEventListener('click', async () => { if (!$('bh-list').children.length) { await loadFacets(); loadBugs(true); } });
    ['bh-module', 'bh-cat', 'bh-year', 'bh-st', 'bh-as', 'bh-cl'].forEach(id => $(id).addEventListener('change', reload));
    $('bh-q').addEventListener('input', reload);
    $('bh-more').addEventListener('click', () => loadBugs(false));
    $('bh-list').addEventListener('click', e => { const c = e.target.closest('.bh-card'); if (c) openBh(+c.dataset.idx); });
    $('bh-list').addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.bh-card'); if (c && e.key === 'Enter') openBh(+c.dataset.idx); });
    $('bh-drawer-close').addEventListener('click', closeBh);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBh(); });
    $('bh-refresh').addEventListener('click', async () => { try { await fetch(`${API_BASE}/bugs/live/refresh`, { method: 'POST' }); } catch {} setTimeout(checkLive, 2500); });
    liveTimer = setInterval(checkLive, 5000);
    document.querySelector("[data-tab='pane-bug-history']").addEventListener('click', () => setTimeout(checkLive, 50));
  });
})();

// -----------------------------------------------------------
// 4. Kho Business Rule (xem, thêm, sửa, xóa)
// -----------------------------------------------------------
(function setupBusinessRules() {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let timer, modules = [], modsFilled = false, current = [];

  // Người được sửa rule: chế độ một người, quản trị, hoặc có quyền lẻ rules_edit
  const canEdit = () => me && (!me.auth_required || me.role === 'admin' || (me.perms || []).includes('rules_edit'));

  // Người cập nhật rule từ kho: chế độ một người, quản trị, hoặc có quyền lẻ rules
  const canSync = () => me && (!me.auth_required || me.role === 'admin' || (me.perms || []).includes('rules'));
  async function syncCall(path, body) {
    const msg = $('br-refresh-msg'); msg.style.color = ''; msg.textContent = 'Đang cập nhật...';
    try {
      const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await res.json(); } catch {}
      if (!res.ok) throw new Error(j?.error?.message || (res.status === 404 ? 'Server chưa chạy bản mới, hãy khởi động lại server' : 'Lỗi ' + res.status));
      msg.style.color = 'green'; msg.textContent = `Đã cập nhật ${j.data.count} rule, bản ${j.data.revision}. Mọi người nhận bản mới trong vòng 1 phút.`;
      load();
    } catch (e) { msg.style.color = 'var(--danger)'; msg.textContent = e.message; }
  }

  function fillModules(list) {
    if (modsFilled || !list.length) return;
    modsFilled = true;
    modules = list;
    $('br-module').innerHTML = '<option value="">Tất cả module</option>' + list.filter(m => !m.cluster).sort((a, b) => a.code.localeCompare(b.code))
      .map(m => `<option value="${esc(m.code)}">${esc(m.code)} · ${esc(m.name)}</option>`).join('');
  }

  async function load() {
    const qs = new URLSearchParams({ module: $('br-module').value, q: $('br-q').value.trim(), confirmed: $('br-confirmed') && $('br-confirmed').checked ? '1' : '0' });
    try {
      const { data } = await (await fetch(`${API_BASE}/business-rules?${qs}`)).json();
      fillModules(data.modules || []);
      current = data.rules;
      $('br-add').style.display = canEdit() ? '' : 'none';
      $('br-refresh').style.display = $('br-import-l').style.display = canSync() ? '' : 'none';
      if (data.artifact_url) $('br-open-kb').href = data.artifact_url;
      $('br-synced').textContent = data.synced_at ? `Bản ${data.revision}, đồng bộ từ Kho lúc ${new Date(data.synced_at).toLocaleString('vi-VN')}.` : 'Chưa đồng bộ: chạy node scripts/qa-sync.mjs';
      const pend = data.rules.filter(r => r.state === 'pending').length;
      $('br-count').textContent = `${data.rules.length} rule${pend ? ` (${pend} chưa xác nhận)` : ''}`;
      $('br-list').innerHTML = data.rules.map(r => card(r, data.artifact_url)).join('') + deletedBox(data.deleted || []);
    } catch (e) { $('br-count').textContent = 'Không tải được rule: ' + e.message; }
  }

  function card(r, kb) {
    const ed = canEdit();
    return `
      <details style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;">
        <summary><strong>${esc(r.rule_id)}</strong>${r.version > 1 ? ' v' + r.version : ''} · ${esc(r.title)} <span class="badge badge-blue">${esc(r.flow_name)}</span>
          ${r.state === 'pending' ? ' <span class="badge badge-amber" title="Claude vừa khám phá, chưa có người xác nhận">Chưa xác nhận</span>' : ''}
          ${r.local === 'created' ? ' <span class="badge badge-green">Tạo trên platform</span>' : r.local === 'edited' ? ' <span class="badge badge-green">Sửa trên platform</span>' : ''}</summary>
        ${r.state === 'pending' ? '<p style="font-size:11.5px;margin:6px 0;color:var(--text-subtle);">Rule do AI khám phá, <b>chưa có người xác nhận</b>: dùng để tham khảo, đối chiếu lại trước khi dựa vào.' + (r.analysis ? ' ' + esc(r.analysis.explanation || '') : '') + '</p>' : ''}
        <p style="font-size:12px;margin:6px 0;white-space:pre-line;">${esc(r.description)}</p>
        <div style="font-size:11px;color:var(--text-subtle);">Vai trò: ${esc((r.user_roles || []).join(', ') || 'Chưa ghi')} · ${esc(r.setting_label || r.setting_type || '')}${r.config_path ? ' · ' + esc(r.config_path) : ''}
          ${r.local === 'created' ? '' : ` · <a href="${esc(kb)}#rule-${esc(r.rule_id)}" target="_blank" rel="noopener">Mở trong kho</a>`}
          ${r.edited_by ? ` · sửa bởi ${esc(r.edited_by)}` : ''}</div>
        ${ed ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-outline" data-act="edit" data-id="${esc(r.rule_id)}">Sửa</button>
          <button class="btn btn-outline" style="color:var(--danger);" data-act="del" data-id="${esc(r.rule_id)}" data-local="${esc(r.local || '')}">Xóa</button>
          ${r.local === 'edited' ? `<button class="btn btn-outline" data-act="restore" data-id="${esc(r.rule_id)}">Hoàn tác thay đổi trên platform</button>` : ''}</div>` : ''}
      </details>`;
  }

  function deletedBox(del) {
    if (!del.length || !canEdit()) return '';
    return `<details style="margin-top:10px;"><summary style="font-size:12px;">Rule đã ẩn trên platform (${del.length})</summary>
      ${del.map(d => `<div style="font-size:12px;padding:4px 0;">${esc(d.rule_id)} · ${esc(d.title)} <button class="btn btn-outline" data-act="restore" data-id="${esc(d.rule_id)}">Khôi phục</button></div>`).join('')}</details>`;
  }

  async function call(method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || 'Không thực hiện được');
    return j.data;
  }

  function openForm(rule) {
    const creating = !rule;
    $('rule-form-title').textContent = creating ? 'Thêm rule' : `Sửa rule ${rule.rule_id}`;
    $('rf-id').value = creating ? '' : rule.rule_id;
    $('rf-module-row').style.display = creating ? '' : 'none';
    const roots = modules.filter(m => !m.cluster).sort((a, b) => a.code.localeCompare(b.code));
    $('rf-module').innerHTML = roots.map(m => `<option value="${esc(m.code)}">${esc(m.code)} · ${esc(m.name)}</option>`).join('');
    const sel = $('br-module').value || (roots[0] && roots[0].code);
    if (creating && sel) $('rf-module').value = sel;
    const fillFlows = code => {
      const fl = (modules.find(m => m.code === code)?.flows) || [];
      $('rf-flow').innerHTML = '<option value="">Chưa phân luồng</option>' + fl.map(f => `<option value="${esc(f.code)}">${esc(f.menu)} · ${esc(f.name)}</option>`).join('');
    };
    fillFlows(creating ? $('rf-module').value : rule.module);
    $('rf-module').onchange = () => fillFlows($('rf-module').value);
    $('rf-title').value = creating ? '' : rule.title;
    $('rf-desc').value = creating ? '' : rule.description;
    $('rf-roles').value = creating ? '' : (rule.user_roles || []).join('\n');
    $('rf-flow').value = creating ? '' : (rule.flow || '');
    $('rf-setting').value = creating ? 'unknown' : (rule.setting_type || 'unknown');
    $('rf-msg').textContent = '';
    document.getElementById('modal-rule').classList.add('open');
  }

  async function save() {
    const id = $('rf-id').value;
    const body = { module: $('rf-module').value, title: $('rf-title').value, description: $('rf-desc').value, user_roles: $('rf-roles').value, flow: $('rf-flow').value, setting_type: $('rf-setting').value };
    try {
      await (id ? call('PUT', `/business-rules/${encodeURIComponent(id)}`, body) : call('POST', '/business-rules', body));
      closeModals();
      await load();
    } catch (e) { $('rf-msg').textContent = e.message; }
  }

  async function onAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    try {
      if (b.dataset.act === 'edit') openForm(current.filter(r => r.rule_id === id).sort((a, c) => (c.version || 0) - (a.version || 0))[0]);
      if (b.dataset.act === 'del') {
        const created = b.dataset.local === 'created';
        if (!confirm(created ? `Xóa hẳn rule ${id}? Không khôi phục được.` : `Ẩn rule ${id} trên platform?\nRule vẫn còn trong Kho và có thể khôi phục ở mục "Rule đã ẩn".`)) return;
        await call('DELETE', `/business-rules/${encodeURIComponent(id)}`); await load();
      }
      if (b.dataset.act === 'restore') { await call('POST', `/business-rules/${encodeURIComponent(id)}/restore`); await load(); }
    } catch (err) { alert(err.message); }
  }

  let rev = null;
  async function checkRevision() {
    try {
      const { data } = await (await fetch(`${API_BASE}/business-rules/meta`)).json();
      if (rev !== null && data.revision !== rev) load();
      rev = data.revision;
    } catch {}
  }
  document.addEventListener('DOMContentLoaded', () => {
    checkRevision(); setInterval(checkRevision, 60000); // mọi người tự nhận bản rule mới trong vòng 1 phút
    $('br-module').addEventListener('change', load);
    $('br-confirmed').addEventListener('change', load);
    $('br-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    $('br-list').addEventListener('click', onAction);
    $('br-add').addEventListener('click', () => openForm(null));
    $('br-refresh').addEventListener('click', () => syncCall('/business-rules/refresh'));
    $('br-import').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      if (f.size > 20 * 1024 * 1024) { $('br-refresh-msg').textContent = 'File quá lớn'; return; }
      let b; try { b = JSON.parse(await f.text()); } catch { $('br-refresh-msg').style.color = 'var(--danger)'; $('br-refresh-msg').textContent = 'File không phải JSON hợp lệ'; return; }
      syncCall('/business-rules/sync', { rules: b.rules, modules: b.modules, artifact_url: b.artifact_url });
    });
    $('rf-save').addEventListener('click', save);
    { let opened = false; document.querySelector("[data-tab='pane-business-rules']").addEventListener('click', () => { if (!opened) { opened = true; load(); } }); } // đổi tab không nạp lại: giữ nguyên kết quả, chỉ nạp lại khi tải lại trang
  });
})();

// -----------------------------------------------------------
// 6. Phân quyền người dùng (chỉ quản trị viên)
// -----------------------------------------------------------
(function setupUsers() {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PERMS = [
    ['environments', 'Sửa môi trường'], ['secrets', 'Đặt/xóa mật khẩu'], ['rules', 'Đẩy rule và bug'],
    ['rules_edit', 'Thêm, sửa, xóa rule'], ['automation_push', 'Đẩy tác vụ nháp'], ['automation', 'Duyệt tác vụ']
  ];
  let users = [];
  const msg = (t, bad) => { $('u-msg').style.color = bad ? 'var(--danger)' : 'var(--text-main)'; $('u-msg').textContent = t || ''; };

  async function call(method, path, body) {
    const res = await fetch(`${API_BASE}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error?.message || 'Không thực hiện được');
    return j.data;
  }

  function showToken(title, token) {
    $('tk-title').textContent = title;
    $('tk-value').value = token;
    $('tk-copy').textContent = 'Sao chép token';
    document.getElementById('modal-token').classList.add('open');
  }

  async function load() {
    try {
      users = await call('GET', '/team/users');
      $('u-head').innerHTML = '<th>Người dùng</th><th>Vai trò</th>' + PERMS.map(p => `<th style="font-size:10.5px;">${esc(p[1])}</th>`).join('') + '<th>Thao tác</th>';
      $('u-body').innerHTML = users.map(u => {
        const admin = u.role === 'admin', off = !u.is_active;
        return `<tr data-id="${esc(u.id)}" style="${off ? 'opacity:.5;' : ''}">
          <td><strong>${esc(u.display_name)}</strong>${u.is_me ? ' <span class="badge badge-blue">bạn</span>' : ''}${off ? ' <span class="badge badge-red">đã thu hồi</span>' : ''}<div style="font-size:10.5px;color:var(--text-subtle);">${esc(u.id)}</div></td>
          <td><select class="form-control u-role" ${off ? 'disabled' : ''}><option value="member" ${admin ? '' : 'selected'}>Thành viên</option><option value="admin" ${admin ? 'selected' : ''}>Quản trị viên</option></select></td>
          ${PERMS.map(p => `<td style="text-align:center;"><input type="checkbox" class="u-perm" data-p="${p[0]}" ${admin || (u.perms || []).includes(p[0]) ? 'checked' : ''} ${admin || off ? 'disabled' : ''}></td>`).join('')}
          <td style="white-space:nowrap;">${off ? '' : `<button class="btn btn-primary u-save">Lưu</button>
            <button class="btn btn-outline u-reset">Cấp token mới</button>
            <button class="btn btn-outline u-revoke" style="color:var(--danger);" ${u.is_me ? 'disabled' : ''}>Thu hồi</button>`}</td></tr>`;
      }).join('');
    } catch (e) { msg('Không tải được danh sách: ' + e.message, true); }
  }

  async function onClick(e) {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id, u = users.find(x => x.id === id);
    try {
      if (e.target.closest('.u-save')) {
        const role = tr.querySelector('.u-role').value;
        const perms = [...tr.querySelectorAll('.u-perm:checked')].map(c => c.dataset.p);
        await call('PUT', `/team/users/${encodeURIComponent(id)}`, { role, perms: role === 'admin' ? [] : perms });
        msg(`Đã lưu quyền của ${u.display_name}.`); await load();
      }
      if (e.target.closest('.u-reset')) {
        if (!confirm(`Cấp token mới cho ${u.display_name}? Token cũ mất hiệu lực ngay.`)) return;
        const r = await call('POST', `/team/users/${encodeURIComponent(id)}/reset-token`);
        showToken(`Token mới của ${u.display_name}`, r.token);
      }
      if (e.target.closest('.u-revoke')) {
        if (!confirm(`Thu hồi ${u.display_name}? Người này không đăng nhập được nữa.`)) return;
        await call('POST', `/team/users/${encodeURIComponent(id)}/revoke`);
        msg(`Đã thu hồi ${u.display_name}.`); await load();
      }
    } catch (err) { msg(err.message, true); }
  }

  function openNew() {
    $('nu-name').value = ''; $('nu-role').value = 'member'; $('nu-msg').textContent = '';
    $('nu-perms').innerHTML = '<label class="form-label">Quyền (với thành viên):</label>' + PERMS.map(p => `<label style="display:flex;gap:6px;font-size:12px;"><input type="checkbox" class="nu-perm" data-p="${p[0]}"> ${esc(p[1])}</label>`).join('');
    document.getElementById('modal-newuser').classList.add('open');
  }

  async function createUser() {
    try {
      const role = $('nu-role').value;
      const perms = role === 'admin' ? [] : [...document.querySelectorAll('.nu-perm:checked')].map(c => c.dataset.p);
      const r = await call('POST', '/team/users', { name: $('nu-name').value, role, perms });
      closeModals();
      showToken(`Token của ${r.display_name}`, r.token);
      await load();
    } catch (e) { $('nu-msg').textContent = e.message; }
  }

  // Chỉ quản trị viên thấy tab này, và chỉ khi đã bật chế độ nhóm
  function applyVisibility() {
    const show = me && me.auth_required && me.role === 'admin';
    $('tab-users-btn').style.display = show ? '' : 'none';
    const adm = document.getElementById('sb-admin-label'); if (adm) adm.style.display = show ? '' : 'none';
    if (show) load();
  }

  document.addEventListener('qa-me-ready', applyVisibility);
  document.addEventListener('DOMContentLoaded', () => {
    $('u-body').addEventListener('click', onClick);
    $('u-add').addEventListener('click', openNew);
    $('nu-save').addEventListener('click', createUser);
    $('tk-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('tk-value').value); $('tk-copy').textContent = 'Đã sao chép'; }
      catch { $('tk-value').select(); $('tk-copy').textContent = 'Bôi đen rồi nhấn Ctrl+C'; }
    });
    { let opened = false; document.querySelector("[data-tab='pane-users']").addEventListener('click', () => { if (!opened) { opened = true; load(); } }); } // đổi tab không nạp lại: giữ nguyên kết quả, chỉ nạp lại khi tải lại trang
  });
})();

// -----------------------------------------------------------
// Nút ? hướng dẫn cài đặt và sử dụng
// -----------------------------------------------------------
(function setupHelp() {
  const $ = id => document.getElementById(id);
  const fill = html => html.replace(/\{\{ORIGIN\}\}/g, location.origin).replace(/\{\{HOST\}\}/g, location.hostname);

  function show(page) {
    document.querySelectorAll('#help-tabs button').forEach(b => b.classList.toggle('active', b.dataset.help === page));
    const body = $('help-body');
    body.innerHTML = fill((window.HELP_PAGES || {})[page] || '');
    body.querySelectorAll('pre.help-code').forEach(pre => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'help-copy'; btn.textContent = 'Sao chép';
      btn.onclick = async () => {
        try { await navigator.clipboard.writeText(pre.innerText.replace(/Sao chép$|Đã chép$/, '').trim()); btn.textContent = 'Đã chép'; }
        catch { btn.textContent = 'Bôi đen rồi Ctrl+C'; }
        setTimeout(() => btn.textContent = 'Sao chép', 2000);
      };
      pre.appendChild(btn);
    });
    body.scrollTop = 0;
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btn-help').addEventListener('click', () => { show('overview'); document.getElementById('modal-help').classList.add('open'); });
    $('help-tabs').addEventListener('click', e => { const b = e.target.closest('button[data-help]'); if (b) show(b.dataset.help); });
  });
})();


// -----------------------------------------------------------
// Tổng quan: số liệu thật từ các API sẵn có, lối tắt sang các trang
// -----------------------------------------------------------
(function setupOverview() {
  const $ = id => document.getElementById(id);
  const open = pane => document.querySelector(`[data-tab='${pane}']`)?.click();
  document.addEventListener('DOMContentLoaded', () => {
    $('sb-toggle')?.addEventListener('click', () => $('sidebar').classList.toggle('open'));
    document.querySelectorAll('.quick[data-go]').forEach(b => b.addEventListener('click', () => open(b.dataset.go)));
  });
  const get = async p => { try { const r = await fetch(`${API_BASE}${p}`); return r.ok ? (await r.json()).data : null; } catch { return null; } };
  async function load() {
    const hour = new Date().getHours();
    const hello = hour < 11 ? 'Chào buổi sáng' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
    $('ov-greeting').textContent = `${hello}, ${me?.display_name || 'bạn'}`;
    const [bugs, rules, tasks, accounts, live] = await Promise.all([get('/bugs/meta'), get('/business-rules/meta'), get('/automation/tasks'), get('/accounts'), get('/bugs/live')]);
    if (bugs) { $('ov-bugs').textContent = bugs.count; const f = bugs.facets || {}; $('ov-bugs-sub').textContent = f.unknown != null ? `${f.unknown} chưa rõ module` : ''; }
    if (rules) { $('ov-rules').textContent = rules.count; $('ov-rules-sub').textContent = rules.synced_at ? `Bản ${rules.revision}` : 'Chưa đồng bộ'; }
    if (tasks) { $('ov-tasks').textContent = tasks.length; $('ov-tasks-sub').textContent = `${tasks.filter(t => t.runnable).length} sẵn sàng chạy`; }
    if (accounts) { $('ov-accounts').textContent = accounts.length; }
    const row = (k, v) => `<div class="status-row"><span>${k}</span><b>${v}</b></div>`;
    const rt = live ? (!live.enabled ? 'Chưa có cookie Haraworks' : live.error ? 'Lỗi hoặc cookie hết hạn' : 'Đang cập nhật') : 'Không rõ';
    $('ov-status').innerHTML = row('Server', 'Online') + row('Bug realtime từ Haraworks', rt) + row('Dữ liệu bug', bugs ? bugs.count + ' bug' : '-');
  }
  document.addEventListener('qa-me-ready', load);
})();
