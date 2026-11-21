/**
 * Internal AI QA Platform - Frontend Dashboard Controller
 * Connects directly to Backend RESTful API (/api/v1)
 */

const API_BASE = '/api/v1';
const LAUNCHER_URL = 'http://127.0.0.1:3002';
let platformLabelColors = { module: {}, status: {}, project: {} };
let labelColorsLoadedAt = 0;
async function refreshLabelColors(force = false) {
  if (!force && Date.now() - labelColorsLoadedAt < 60000) return;
  const res = await fetch(`${API_BASE}/label-colors`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'Không tải được màu nhãn.');
  platformLabelColors = json.data.colors || { module: {}, status: {}, project: {} };
  labelColorsLoadedAt = Date.now();
  return json.data;
}
const labelColorStyle = (group, code) => {
  const color = platformLabelColors[group]?.[String(code)];
  return /^#[0-9a-f]{6}$/i.test(color || '') ? ` style="--label-color:${color};--label-bg:${color}33"` : '';
};
const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('qa_theme', t); } catch {}
  const btn = document.getElementById('btn-theme-toggle');
  if (btn) btn.textContent = t === 'dark' ? '☀️' : '🌙';
}
try { applyTheme(localStorage.getItem('qa_theme') || 'light'); } catch {}
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(localStorage.getItem('qa_theme') || 'light');
  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  });
});

// Token cá nhân của người dùng nhóm (lưu bền vững trên máy người dùng cho đến khi đăng xuất)
const getToken = () => {
  try { return localStorage.getItem('qa_token') || sessionStorage.getItem('qa_token') || ''; } catch { return ''; }
};
const setStoredToken = (token) => {
  try {
    if (token) {
      localStorage.setItem('qa_token', token);
      sessionStorage.setItem('qa_token', token);
    }
  } catch {}
};
const clearStoredToken = () => {
  try {
    localStorage.removeItem('qa_token');
    sessionStorage.removeItem('qa_token');
  } catch {}
};
const _fetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  if (typeof url === 'string' && url.startsWith(API_BASE) && getToken()) {
    opts = { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${getToken()}` } };
  }
  return _fetch(url, opts);
};
let me = null;

const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function bindEyeToggle(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  btn.onclick = () => {
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF_SVG : EYE_OPEN_SVG;
  };
}

function hideTokenOnboardingGuide() {
  document.getElementById('btn-user-settings')?.classList.remove('token-guide-pulse');
  document.getElementById('token-guide-popover')?.remove();
}

function showTokenOnboardingGuide() {
  const btn = document.getElementById('tab-settings-btn') || document.getElementById('btn-user-settings');
  if (!btn) return;
  if (!me || (me.has_haraworks_token && !me.haraworks_auth_error)) {
    hideTokenOnboardingGuide();
    return;
  }
  btn.classList.add('token-guide-pulse');
  if (document.getElementById('token-guide-popover')) return;
  const rect = btn.getBoundingClientRect();
  const isExpired = !!me.haraworks_auth_error;
  const pop = document.createElement('div');
  pop.id = 'token-guide-popover';
  pop.className = 'token-guide-popover';
  pop.style.left = Math.max(12, rect.right + 12) + 'px';
  pop.style.top = Math.max(16, Math.min(window.innerHeight - 160, rect.top - 10)) + 'px';
  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
      <strong style="font-size:12.5px;">${isExpired ? '🔑 Token Haraworks đã hết hạn!' : '🔑 Chưa có Token Haraworks'}</strong>
      <button type="button" id="btn-token-guide-close" style="background:none;border:none;cursor:pointer;color:#92400e;font-size:14px;line-height:1;padding:0 2px;" title="Đóng gợi ý">✕</button>
    </div>
    <div>Vào mục <b>Cài Đặt → Tài khoản</b> để nhập Token Haraworks, hệ thống sẽ tự động đồng bộ Realtime.</div>
    <button type="button" class="btn btn-primary" id="btn-token-guide-open" style="margin-top:8px;padding:5px 10px;font-size:11.5px;width:100%;background:#d97706;border-color:#d97706;">Nhập Token ngay →</button>
  `;
  document.body.appendChild(pop);
  document.getElementById('btn-token-guide-open')?.addEventListener('click', () => openSettingsTab('st-sub-account', true));
  document.getElementById('btn-token-guide-close')?.addEventListener('click', () => {
    pop.remove();
  });
}

function renderSidebarAvatar(user) {
  const av = document.getElementById('sb-avatar');
  if (!av) return;
  if (user?.avatar && user.avatar.startsWith('data:image/')) {
    av.innerHTML = `<img src="${user.avatar}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    av.textContent = String(user?.display_name || 'QC').split(/\s+/).map(w => w[0]).slice(-2).join('').toUpperCase();
  }
}

async function ensureLogin() {
  const res = await fetch(`${API_BASE}/me`);
  if (res.status === 401) {
    const hadToken = !!getToken();
    clearStoredToken();
    showLoginScreen(hadToken ? 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại bằng tài khoản và mật khẩu.' : '');
    return false;
  }
  me = (await res.json()).data;
  const nameEl = document.getElementById('current-user-name');
  if (nameEl) nameEl.textContent = me.nickname ? `${me.display_name} (${me.nickname})` : me.display_name;
  const role = document.getElementById('current-user-role');
  if (role) role.textContent = me.job_title || me.role;
  const codeBadge = document.getElementById('current-user-code-badge');
  if (codeBadge) {
    if (me.employee_code) {
      codeBadge.textContent = me.employee_code;
      codeBadge.style.display = 'inline-block';
    } else {
      codeBadge.style.display = 'none';
    }
  }
  renderSidebarAvatar(me);
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.style.display = me.auth_required ? '' : 'none';
    logoutBtn.onclick = () => { clearStoredToken(); location.reload(); };
  }
  const settingsBtn = document.getElementById('btn-user-settings');
  if (settingsBtn) {
    settingsBtn.onclick = () => openSettingsTab('st-sub-account', !me?.has_haraworks_token || !!me?.haraworks_auth_error);
  }
  const permNav = document.getElementById('st-nav-permissions');
  if (permNav) permNav.style.display = me.role === 'admin' ? '' : 'none';

  setTimeout(showTokenOnboardingGuide, 350);
  document.dispatchEvent(new Event('qa-me-ready'));
  return true;
}

const PET_COLOR_THEMES = {
  amber:  { fur: '#fde68a', head: '#fef3c7', belly: '#fffbeb', stroke: '#d97706', tail: '#f59e0b', earIn: '#fda4af' },
  gray:   { fur: '#cbd5e1', head: '#e2e8f0', belly: '#f8fafc', stroke: '#475569', tail: '#64748b', earIn: '#fda4af' },
  white:  { fur: '#f1f5f9', head: '#ffffff', belly: '#ffffff', stroke: '#64748b', tail: '#94a3b8', earIn: '#fbcfe8' },
  black:  { fur: '#334155', head: '#475569', belly: '#94a3b8', stroke: '#0f172a', tail: '#1e293b', earIn: '#fb7185' },
  pink:   { fur: '#fbcfe8', head: '#fce7f3', belly: '#fff1f2', stroke: '#be185d', tail: '#f472b6', earIn: '#f43f5e' },
  mint:   { fur: '#a7f3d0', head: '#d1fae5', belly: '#ecfdf5', stroke: '#047857', tail: '#34d399', earIn: '#fda4af' },
  purple: { fur: '#ddd6fe', head: '#ede9fe', belly: '#f5f3ff', stroke: '#6d28d9', tail: '#a78bfa', earIn: '#f472b6' }
};

function getPetConfig() {
  const key = `qa_pet_cfg_${me?.id || 'default'}`;
  const def = { color: 'amber', customHex: '#fde68a', intervalSec: 45, reminderEnabled: true, reminderTimes: ['16:30'] };
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && typeof raw === 'object') {
      const merged = { ...def, ...raw };
      if (!Array.isArray(merged.reminderTimes)) {
        merged.reminderTimes = merged.reminderTime ? [merged.reminderTime] : ['16:30'];
      }
      return merged;
    }
  } catch {}
  return def;
}

function savePetConfig(cfg) {
  const key = `qa_pet_cfg_${me?.id || 'default'}`;
  try { localStorage.setItem(key, JSON.stringify(cfg)); } catch {}
  window.dispatchEvent(new CustomEvent('qa-pet-config-changed', { detail: cfg }));
}

let pendingAvatarDataUrl = undefined;
let stGeneralModules = [];
let stGeneralStatuses = [];
let stPetTimes = [];

function openSettingsTab(subTab = 'st-sub-account', highlightToken = false) {
  document.getElementById('tab-settings-btn')?.click();
  document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.stTab === subTab));
  document.querySelectorAll('.settings-subpane').forEach(p => p.classList.toggle('active', p.id === subTab));
  populateSettingsForms(highlightToken);
}

function populateSettingsForms(highlightToken = false) {
  // 1. Tài khoản
  const dName = document.getElementById('st-display-name');
  const nick = document.getElementById('st-nickname');
  const job = document.getElementById('st-job-title');
  const joined = document.getElementById('st-joined-at');
  const eCode = document.getElementById('st-employee-code');
  const hToken = document.getElementById('st-haraworks-token');
  const hToggle = document.getElementById('st-toggle-token');
  const nPass = document.getElementById('st-new-password');
  const avPrev = document.getElementById('st-avatar-preview');
  const msg = document.getElementById('st-account-msg');
  if (dName) dName.value = me?.display_name || '';
  if (nick) nick.value = me?.nickname || '';
  if (job) job.value = me?.job_title || '';
  if (joined) joined.value = me?.joined_at || '';
  if (eCode) eCode.value = me?.employee_code || '';
  if (nPass) nPass.value = '';
  if (msg) msg.textContent = '';
  pendingAvatarDataUrl = undefined;
  if (avPrev) {
    if (me?.avatar && me.avatar.startsWith('data:image/')) {
      avPrev.innerHTML = `<img src="${me.avatar}" alt="Avatar" />`;
    } else {
      avPrev.textContent = String(me?.display_name || 'QC').split(/\s+/).map(w => w[0]).slice(-2).join('').toUpperCase();
    }
  }
  if (hToken) {
    hToken.value = '';
    hToken.type = 'password';
    hToken.placeholder = (me?.has_haraworks_token && !me?.haraworks_auth_error)
      ? '•••••••••••••••• (Đã cấu hình — nhập mới để thay thế)'
      : 'Dán cookie/token Haraworks vào đây...';
    hToken.classList.toggle('token-field-highlight', !!highlightToken);
    if (highlightToken) setTimeout(() => { hToken.scrollIntoView({ behavior: 'smooth', block: 'center' }); hToken.focus(); }, 120);
  }
  if (hToggle) hToggle.innerHTML = EYE_OPEN_SVG;

  // 2. Pet
  const petCfg = getPetConfig();
  const pVis = document.getElementById('st-pet-visible');
  const pColor = document.getElementById('st-pet-color');
  const pHex = document.getElementById('st-pet-color-hex');
  const pInt = document.getElementById('st-pet-interval');
  const pRemEn = document.getElementById('st-pet-reminder-enabled');
  if (pVis) pVis.checked = localStorage.getItem('qa_pet_hidden') !== '1';
  if (pColor) pColor.value = petCfg.color || 'amber';
  if (pHex) {
    pHex.value = petCfg.customHex || '#fde68a';
    pHex.style.display = pColor?.value === 'custom' ? 'inline-block' : 'none';
  }
  if (pInt) pInt.value = String(petCfg.intervalSec ?? 45);
  if (pRemEn) pRemEn.checked = petCfg.reminderEnabled !== false;
  stPetTimes = [...(petCfg.reminderTimes || ['16:30'])];
  renderPetReminderTimesList();
}

function renderPetReminderTimesList() {
  const box = document.getElementById('st-pet-times-list');
  if (!box) return;
  if (!stPetTimes.length) {
    box.innerHTML = '<span style="font-size:11.5px;color:var(--text-subtle);">Chưa có mốc giờ nhắc nhở nào.</span>';
    return;
  }
  box.innerHTML = stPetTimes.map((t, i) => `
    <span class="st-rem-chip">
      <span>⏰ ${htmlEscape(t)}</span>
      <button type="button" class="linkbtn" data-del-time="${i}" style="color:var(--danger);font-weight:700;padding:0 2px;" title="Xóa mốc giờ">✕</button>
    </span>`).join('');
  box.querySelectorAll('[data-del-time]').forEach(b => {
    b.onclick = () => {
      stPetTimes.splice(Number(b.dataset.delTime), 1);
      renderPetReminderTimesList();
    };
  });
}

function renderGeneralSettingsTables() {
  const mBody = document.getElementById('st-mod-tbody');
  if (mBody) {
    mBody.innerHTML = stGeneralModules.map((m, idx) => `
      <tr>
        <td><input class="form-control" data-mod-code="${idx}" value="${htmlEscape(m.code)}" style="padding:4px 6px;font-weight:700;text-transform:uppercase;" /></td>
        <td><input class="form-control" data-mod-name="${idx}" value="${htmlEscape(m.name)}" style="padding:4px 6px;" /></td>
        <td><input type="color" data-mod-color="${idx}" value="${htmlEscape(m.color || '#3b82f6')}" style="width:42px;height:28px;padding:1px;border:1px solid var(--border);border-radius:4px;" /></td>
        <td><button type="button" class="linkbtn" data-mod-del="${idx}" style="color:var(--danger);">Xóa</button></td>
      </tr>`).join('');
    mBody.querySelectorAll('[data-mod-code]').forEach(el => el.oninput = () => { stGeneralModules[el.dataset.modCode].code = el.value.toUpperCase(); });
    mBody.querySelectorAll('[data-mod-name]').forEach(el => el.oninput = () => { stGeneralModules[el.dataset.modName].name = el.value; });
    mBody.querySelectorAll('[data-mod-color]').forEach(el => el.oninput = () => { stGeneralModules[el.dataset.modColor].color = el.value; });
    mBody.querySelectorAll('[data-mod-del]').forEach(el => el.onclick = () => { stGeneralModules.splice(Number(el.dataset.modDel), 1); renderGeneralSettingsTables(); });
  }
  const sBody = document.getElementById('st-status-tbody');
  if (sBody) {
    sBody.innerHTML = stGeneralStatuses.map((s, idx) => `
      <tr>
        <td><input class="form-control" data-st-code="${idx}" value="${htmlEscape(s.code)}" style="padding:4px 6px;font-weight:700;" /></td>
        <td><input class="form-control" data-st-name="${idx}" value="${htmlEscape(s.name)}" style="padding:4px 6px;" /></td>
        <td><input type="color" data-st-color="${idx}" value="${htmlEscape(s.color || '#6b7280')}" style="width:42px;height:28px;padding:1px;border:1px solid var(--border);border-radius:4px;" /></td>
        <td><button type="button" class="linkbtn" data-st-del="${idx}" style="color:var(--danger);">Xóa</button></td>
      </tr>`).join('');
    sBody.querySelectorAll('[data-st-code]').forEach(el => el.oninput = () => { stGeneralStatuses[el.dataset.stCode].code = el.value; });
    sBody.querySelectorAll('[data-st-name]').forEach(el => el.oninput = () => { stGeneralStatuses[el.dataset.stName].name = el.value; });
    sBody.querySelectorAll('[data-st-color]').forEach(el => el.oninput = () => { stGeneralStatuses[el.dataset.stColor].color = el.value; });
    sBody.querySelectorAll('[data-st-del]').forEach(el => el.onclick = () => { stGeneralStatuses.splice(Number(el.dataset.stDel), 1); renderGeneralSettingsTables(); });
  }
  const pBody = document.getElementById('st-project-tbody');
  if (pBody) {
    pBody.innerHTML = (window.stGeneralProjects || []).map((p, idx) => `
      <tr>
        <td style="font-weight:600;">${htmlEscape(p.name)}</td>
        <td><input type="color" data-proj-color="${idx}" value="${htmlEscape(p.color || '#3b82f6')}" style="width:42px;height:28px;padding:1px;border:1px solid var(--border);border-radius:4px;" /></td>
      </tr>`).join('');
    pBody.querySelectorAll('[data-proj-color]').forEach(el => el.oninput = () => { window.stGeneralProjects[el.dataset.projColor].color = el.value; });
  }
}

async function loadGeneralSettings() {
  try {
    const data = await refreshLabelColors(true);
    stGeneralModules = (data?.modules || []).map(m => ({ code: m.code, name: m.name, color: data.colors?.module?.[m.code] || m.color || '#3b82f6' }));
    stGeneralStatuses = (data?.statuses || []).map(s => ({ code: String(s.code), name: s.name, color: data.colors?.status?.[s.code] || s.color || '#6b7280' }));
    window.stGeneralProjects = (data?.projects || []).map(p => ({ code: p.code, name: p.name, color: data.colors?.project?.[p.code] || p.color || '#3b82f6' }));
    renderGeneralSettingsTables();
  } catch {}
}

document.addEventListener('DOMContentLoaded', () => {
  bindEyeToggle('st-haraworks-token', 'st-toggle-token');
  bindEyeToggle('st-new-password', 'st-toggle-pw');

  document.querySelectorAll('.settings-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subTab = btn.dataset.stTab;
      document.querySelectorAll('.settings-nav-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.settings-subpane').forEach(p => p.classList.toggle('active', p.id === subTab));
      if (subTab === 'st-sub-general') loadGeneralSettings();
      if (subTab === 'st-sub-account' || subTab === 'st-sub-pet') populateSettingsForms(false);
    });
  });

  document.getElementById('tab-settings-btn')?.addEventListener('click', () => {
    populateSettingsForms(false);
    loadGeneralSettings();
  });

  // Avatar: nhấn trực tiếp vào hình tròn (ở Sidebar hoặc Cài đặt) để chọn & tự động lưu ngay cho riêng tài khoản này
  async function saveAvatarImmediately(dataUrl) {
    const msg = document.getElementById('st-account-msg');
    try {
      const res = await fetch(`${API_BASE}/me/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar: dataUrl })
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message || 'Không thể lưu Avatar.');
      if (me) me.avatar = dataUrl;
      pendingAvatarDataUrl = undefined;
      renderSidebarAvatar(me);
      const avPrev = document.getElementById('st-avatar-preview');
      if (avPrev) {
        if (dataUrl && dataUrl.startsWith('data:image/')) avPrev.innerHTML = `<img src="${dataUrl}" alt="Avatar" />`;
        else avPrev.textContent = String(me?.display_name || 'QC').split(/\s+/).map(w => w[0]).slice(-2).join('').toUpperCase();
      }
      if (msg) { msg.style.color = 'var(--success, #16a34a)'; msg.textContent = dataUrl ? '✅ Đã lưu Avatar cho tài khoản của bạn!' : '✅ Đã xóa Avatar!'; }
    } catch (err) {
      if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = err.message; }
    }
  }
  document.getElementById('sb-avatar')?.addEventListener('click', () => {
    document.getElementById('st-avatar-file')?.click();
  });
  document.getElementById('st-avatar-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 160;
        const ratio = Math.min(max / img.width, max / img.height, 1);
        canvas.width = Math.round(img.width * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        saveAvatarImmediately(dataUrl);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
  document.getElementById('st-avatar-clear')?.addEventListener('click', () => {
    saveAvatarImmediately('');
  });

  // Save Account
  document.getElementById('st-account-save')?.addEventListener('click', async () => {
    const dName = document.getElementById('st-display-name')?.value.trim();
    const nick = document.getElementById('st-nickname')?.value.trim();
    const job = document.getElementById('st-job-title')?.value.trim();
    const joined = document.getElementById('st-joined-at')?.value.trim();
    const eCode = document.getElementById('st-employee-code')?.value.trim();
    const hwToken = document.getElementById('st-haraworks-token')?.value.trim();
    const nPass = document.getElementById('st-new-password')?.value;
    const msg = document.getElementById('st-account-msg');
    if (msg) { msg.style.color = 'var(--text-subtle)'; msg.textContent = 'Đang lưu...'; }

    try {
      if (hwToken) {
        const tRes = await fetch(`${API_BASE}/me/haraworks-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: hwToken })
        });
        const tj = await tRes.json().catch(() => ({}));
        if (!tRes.ok) {
          const errMsg = tRes.status === 404
            ? 'Server chưa nhận API mới. Vui lòng tắt và chạy lại start-qa-ngrok.bat rồi thử lại!'
            : (tj.error?.message || (typeof tj.error === 'string' ? tj.error : '') || 'Không thể lưu token Haraworks.');
          throw new Error(errMsg);
        }
        hideTokenOnboardingGuide();
      }
      const body = { display_name: dName, nickname: nick, job_title: job, joined_at: joined, employee_code: eCode };
      if (pendingAvatarDataUrl !== undefined) body.avatar = pendingAvatarDataUrl;
      if (nPass) body.password = nPass;
      const res = await fetch(`${API_BASE}/me/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Không thể lưu thông tin tài khoản.');
      if (j.data?.token) setStoredToken(j.data.token);
      me = { ...me, ...j.data, has_haraworks_token: me.has_haraworks_token || !!hwToken, haraworks_auth_error: hwToken ? false : me.haraworks_auth_error };
      renderSidebarAvatar(me);
      const nameEl = document.getElementById('current-user-name');
      if (nameEl) nameEl.textContent = me.nickname ? `${me.display_name} (${me.nickname})` : me.display_name;
      const roleEl = document.getElementById('current-user-role');
      if (roleEl) roleEl.textContent = me.job_title || me.role;
      if (msg) { msg.style.color = 'var(--success, #16a34a)'; msg.textContent = '✅ Đã lưu thông tin tài khoản thành công!'; }
      if (hwToken) setTimeout(() => location.reload(), 600);
    } catch (e) {
      if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = e.message; }
    }
  });

  // General Settings: Add/Save Modules & Statuses
  document.getElementById('st-add-mod-btn')?.addEventListener('click', () => {
    const code = document.getElementById('st-new-mod-code')?.value.trim().toUpperCase();
    const name = document.getElementById('st-new-mod-name')?.value.trim() || code;
    const color = document.getElementById('st-new-mod-color')?.value || '#3b82f6';
    if (!code) return;
    if (stGeneralModules.some(m => m.code === code)) return;
    stGeneralModules.unshift({ code, name, color });
    document.getElementById('st-new-mod-code').value = '';
    document.getElementById('st-new-mod-name').value = '';
    renderGeneralSettingsTables();
  });
  document.getElementById('st-add-st-btn')?.addEventListener('click', () => {
    const code = document.getElementById('st-new-st-code')?.value.trim();
    const name = document.getElementById('st-new-st-name')?.value.trim() || code;
    const color = document.getElementById('st-new-st-color')?.value || '#6b7280';
    if (code === '') return;
    if (stGeneralStatuses.some(s => String(s.code) === String(code))) return;
    stGeneralStatuses.push({ code, name, color });
    document.getElementById('st-new-st-code').value = '';
    document.getElementById('st-new-st-name').value = '';
    renderGeneralSettingsTables();
  });
  document.getElementById('st-general-save')?.addEventListener('click', async () => {
    const msg = document.getElementById('st-general-msg');
    if (msg) { msg.style.color = 'var(--text-subtle)'; msg.textContent = 'Đang lưu...'; }
    try {
      const res = await fetch(`${API_BASE}/settings/general`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: stGeneralModules, statuses: stGeneralStatuses, projects: window.stGeneralProjects || [] })
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message || 'Không thể lưu cấu hình chung.');
      platformLabelColors = j.data?.colors || platformLabelColors;
      labelColorsLoadedAt = Date.now();
      if (msg) { msg.style.color = 'var(--success, #16a34a)'; msg.textContent = '✅ Đã lưu danh sách Module, Trạng thái & Màu Dự án!'; }
    } catch (e) {
      if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = e.message; }
    }
  });

  // Pet Settings
  document.getElementById('st-pet-color')?.addEventListener('change', (e) => {
    const pHex = document.getElementById('st-pet-color-hex');
    if (pHex) pHex.style.display = e.target.value === 'custom' ? 'inline-block' : 'none';
  });
  document.getElementById('st-pet-add-time-btn')?.addEventListener('click', () => {
    const val = document.getElementById('st-pet-add-time')?.value;
    if (val && !stPetTimes.includes(val)) {
      stPetTimes.push(val);
      stPetTimes.sort();
      renderPetReminderTimesList();
    }
  });
  document.getElementById('st-pet-save')?.addEventListener('click', () => {
    const visible = document.getElementById('st-pet-visible')?.checked !== false;
    const color = document.getElementById('st-pet-color')?.value || 'amber';
    const customHex = document.getElementById('st-pet-color-hex')?.value || '#fde68a';
    const intervalRaw = parseInt(document.getElementById('st-pet-interval')?.value ?? '45', 10);
    const intervalSec = Number.isNaN(intervalRaw) ? 45 : Math.max(0, Math.min(3600, intervalRaw));
    const reminderEnabled = document.getElementById('st-pet-reminder-enabled')?.checked !== false;
    const reminderTimes = stPetTimes.length ? [...stPetTimes] : ['16:30'];

    try { localStorage.setItem('qa_pet_hidden', visible ? '0' : '1'); } catch {}
    const w = document.getElementById('qa-pet-widget');
    if (w) w.hidden = !visible;
    const r = document.getElementById('qa-pet-restore');
    if (r) r.hidden = true;

    savePetConfig({ color, customHex, intervalSec, reminderEnabled, reminderTimes });
    const msg = document.getElementById('st-pet-msg');
    if (msg) { msg.style.color = 'var(--success, #16a34a)'; msg.textContent = '✅ Đã lưu cấu hình Pet cá nhân!'; }
  });

  document.getElementById('db-btn-set-code')?.addEventListener('click', () => openSettingsTab('st-sub-account', false));
});

function showLoginScreen(error = '') {
  const old = document.getElementById('login-screen');
  if (old) old.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div id="login-screen" style="position:fixed;inset:0;background:var(--bg,#f5f6fa);display:flex;align-items:center;justify-content:center;z-index:9999;">
      <div class="card" style="max-width:420px;width:100%;">
        <div class="card-title" style="margin-bottom:8px;">Đăng nhập QC Platform</div>
        <p style="font-size:12px;color:var(--text-subtle);margin-bottom:12px;">Nhập tài khoản và mật khẩu được cấp để truy cập hệ thống.</p>
        <div class="form-group">
          <label class="form-label" for="login-username">Tài khoản</label>
          <input type="text" class="form-control" id="login-username" placeholder="VD: nhung, khanh, luat, nghia" autocomplete="username" />
        </div>
        <div class="form-group">
          <label class="form-label" for="login-password">Mật khẩu</label>
          <div class="pw-wrap">
            <input type="password" class="form-control" id="login-password" placeholder="Nhập mật khẩu..." autocomplete="current-password" />
            <button type="button" class="pw-eye-btn" id="login-toggle-pw" title="Hiện / Ẩn mật khẩu" aria-label="Hiện hoặc ẩn mật khẩu">${EYE_OPEN_SVG}</button>
          </div>
        </div>
        <div id="login-error" style="color:var(--danger);font-size:12px;margin:6px 0;">${error}</div>
        <button class="btn btn-primary" id="login-btn" style="width:100%;">Đăng nhập</button>
      </div></div>`);
  bindEyeToggle('login-password', 'login-toggle-pw');
  const go = async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    if (!username || !password) { errEl.textContent = 'Vui lòng nhập đầy đủ tài khoản và mật khẩu.'; return; }
    btn.disabled = true;
    errEl.textContent = '';
    try {
      const res = await _fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || 'Đăng nhập thất bại.');
      try { sessionStorage.removeItem('qa_login_fails'); } catch {}
      setStoredToken(json.data.token);
      location.reload();
    } catch (e) {
      let fails = 1;
      try {
        fails = (parseInt(sessionStorage.getItem('qa_login_fails') || '0', 10) || 0) + 1;
        sessionStorage.setItem('qa_login_fails', String(fails));
      } catch {}
      if (fails >= 3) {
        errEl.innerHTML = `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:8px 10px;color:#b91c1c;margin-top:4px;line-height:1.45;">
          <b>Bạn đã nhập sai mật khẩu ${fails} lần!</b><br/>
          Vui lòng liên hệ <b>Admin</b> để điều chỉnh lại mật khẩu.<br/>
          <span style="color:#475569;font-size:11.5px;">Mật khẩu mặc định ban đầu là: <code style="background:#fee2e2;padding:1px 6px;border-radius:4px;font-weight:700;">123456</code></span>
        </div>`;
      } else {
        errEl.textContent = `${e.message} (Lần thử ${fails}/3)`;
      }
      btn.disabled = false;
    }
  };
  document.getElementById('login-btn').onclick = go;
  document.getElementById('login-username').onkeydown = e => { if (e.key === 'Enter') document.getElementById('login-password').focus(); };
  document.getElementById('login-password').onkeydown = e => { if (e.key === 'Enter') go(); };
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
      const labelNode = btn.querySelector('span:not(.sb-new-badge)');
      const crumb = document.getElementById('crumb-page');
      if (crumb) crumb.textContent = (labelNode ? labelNode.textContent : btn.textContent).trim();
      if (window.syncAtCrumb) window.syncAtCrumb(paneId);
      document.getElementById('sidebar')?.classList.remove('open');
    });
  });
}

let globalSyncNote = 'Đang kiểm tra trạng thái đồng bộ...';
async function checkApiHealth() {
  const b = document.getElementById('api-status-badge');
  if (!b) return;
  try {
    const res = await fetch(`${API_BASE}/health`);
    const json = await res.json();
    if (json.status !== 'HEALTHY') throw new Error('Server không phản hồi HEALTHY');

    // Kiểm tra trạng thái đồng bộ Realtime từ Haraworks
    let liveData = null;
    if (getToken() || !me?.auth_required) {
      try {
        const lr = await fetch(`${API_BASE}/bugs/live`);
        if (lr.ok) liveData = (await lr.json()).data;
      } catch {}
    }

    if (!liveData) {
      b.className = 'srv-status';
      b.lastElementChild.textContent = 'Server Online';
      globalSyncNote = 'Server đang hoạt động.';
      b.title = globalSyncNote;
      return;
    }

    const when = liveData.lastSyncAt ? new Date(liveData.lastSyncAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
    if (!liveData.enabled) {
      b.className = 'srv-status off';
      b.lastElementChild.textContent = 'Chưa realtime';
      globalSyncNote = 'Chưa cấu hình Token/Cookie Haraworks. Vào Cài Đặt → Tài khoản để nhập Token.';
    } else if (liveData.error) {
      b.className = 'srv-status off';
      b.lastElementChild.textContent = 'Chưa realtime';
      globalSyncNote = /^AUTH:/.test(liveData.error)
        ? 'Cookie/Token Haraworks đã hết hạn hoặc không hợp lệ. Vào Cài Đặt → Tài khoản để cập nhật Token mới.'
        : `Lỗi đồng bộ Haraworks: ${liveData.error}`;
    } else if (liveData.realtime === 'connected') {
      b.className = 'srv-status';
      b.lastElementChild.textContent = 'Realtime';
      globalSyncNote = `Đang kết nối Realtime tức thì với Haraworks.${when ? ' Đồng bộ lần cuối: ' + when : ''}`;
    } else {
      b.className = 'srv-status';
      b.lastElementChild.textContent = 'Realtime';
      globalSyncNote = `Hệ thống tự động đồng bộ sau mỗi 30 giây từ Haraworks.${when ? ' Đồng bộ lần cuối: ' + when : ''}`;
    }
    b.title = globalSyncNote;
  } catch {
    b.className = 'srv-status off';
    b.lastElementChild.textContent = 'Chưa realtime';
    globalSyncNote = 'Mất kết nối tới server backend. Vui lòng kiểm tra lại start-qa-ngrok.bat.';
    b.title = globalSyncNote;
  }
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('api-status-badge')?.addEventListener('click', () => {
    alert(globalSyncNote);
  });
});
document.addEventListener('qa-me-ready', () => {
  checkApiHealth();
  setInterval(checkApiHealth, 30000);
});

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

  filtered.forEach(acc => {
    const card = document.createElement('div');
    card.className = 'account-row';
    const env = environments.find(e => e.id === acc.environment_profile_id);
    const canStoreSecret = env && ['STAGING', 'PRODUCTION_TEST'].includes(env.environment_type);
    card.innerHTML = `<div class="account-identity"><strong>${htmlEscape(acc.name)}</strong><small>Username: ${htmlEscape(acc.username_ref)}</small></div>
      <label class="account-route"><span>Link mở</span><select class="form-control route-select" aria-label="Link mở">${(acc.routes || []).map(r => `<option value="${htmlEscape(r.url)}" title="${htmlEscape(r.url)}"${r.url === acc.default_route ? ' selected' : ''}>${htmlEscape(r.name || r.url)}</option>`).join('')}</select></label>
      <div class="account-actions">
        <button class="btn btn-browser btn-launch-acc" data-id="${htmlEscape(acc.id)}">Mở browser &amp; đăng nhập</button>
        <button class="btn btn-outline btn-open-direct" data-id="${htmlEscape(acc.id)}" title="Mở link trực tiếp trên trình duyệt hiện tại (không cần QA Launcher)">↗ Mở link</button>
        <button class="btn btn-outline btn-edit-acc" data-id="${htmlEscape(acc.id)}">Sửa</button>
        <button class="btn btn-outline btn-del-acc" data-id="${htmlEscape(acc.id)}" style="color:var(--danger);">Xóa</button>
      </div>${canStoreSecret ? '' : '<small class="account-note">Môi trường này không hỗ trợ lưu mật khẩu.</small>'}`;

    card.querySelector('.btn-edit-acc').addEventListener('click', () => openAccountEditModal(acc));
    card.querySelector('.btn-launch-acc').addEventListener('click', async () => {
      await launchBrowserSession(acc.id, card.querySelector('.route-select')?.value || '');
    });
    card.querySelector('.btn-open-direct').addEventListener('click', () => {
      const targetUrl = card.querySelector('.route-select')?.value || acc.default_route || env?.login_url || env?.base_url || '';
      openAccountDirect(acc, env, targetUrl);
    });

    card.querySelector('.btn-del-acc').addEventListener('click', async () => {
      if (confirm(`Bạn có chắc muốn xóa tài khoản [${acc.name}]?`)) {
        await fetch(`${API_BASE}/accounts/${acc.id}`, { method: 'DELETE' });
        await loadAccounts();
      }
    });

    container.appendChild(card);
  });
}

function openAccountDirect(acc, env, routeUrl = '') {
  const targetUrl = routeUrl || acc?.default_route || env?.login_url || env?.base_url || '';
  if (!targetUrl) {
    showLaunchNotice('Tài khoản/môi trường chưa có đường dẫn để mở.', 'error');
    return;
  }
  window.open(targetUrl, '_blank', 'noopener');
  const uname = acc?.username_ref || '';
  if (uname && navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(uname).then(() => {
      showLaunchNotice(`Đã mở link trực tiếp (chế độ không cần QA Launcher) và copy Username "${uname}" vào clipboard để bạn dán đăng nhập.`, 'warn');
    }).catch(() => {
      showLaunchNotice(`Đã mở link trực tiếp (chế độ không cần QA Launcher). Username: ${uname}`, 'warn');
    });
  } else {
    showLaunchNotice(`Đã mở link trực tiếp (chế độ không cần QA Launcher).${uname ? ' Username: ' + uname : ''}`, 'warn');
  }
}

async function launchBrowserSession(accountId, routeUrl = '') {
  try {
    const env = currentEnvironment;
    const acc = accounts.find(a => a.id === accountId);
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
      showLaunchNotice('Chưa chạy QA Launcher trên máy bạn. Nếu không dùng Launcher, hãy bấm nút "↗ Mở link" bên cạnh (hoặc chạy: node apps/launcher/launcher.js --server ' + location.origin + ').', 'error');
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
    document.getElementById('acc-name-input').value = '';
    document.getElementById('acc-role-input').value = '';
    document.getElementById('acc-username-input').value = '';
    document.getElementById('acc-password-input').value = '';
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

    const res = await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name || username,
        role,
        environment_profile_id: envId,
        username,
        password,
        default_route: route
      })
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error?.message || 'Không lưu được tài khoản.'); return; }

    document.getElementById('acc-password-input').value = '';
    closeModals();
    await loadAccounts();
  });

  document.getElementById('btn-save-account-edit').addEventListener('click', saveAccountEdit);
}

function openAccountEditModal(acc) {
  const $ = id => document.getElementById(id);
  const env = environments.find(e => e.id === acc.environment_profile_id);
  const canStoreSecret = env && ['STAGING', 'PRODUCTION_TEST'].includes(env.environment_type);
  $('account-edit-id').value = acc.id;
  $('account-edit-name').value = acc.name || '';
  $('account-edit-role').value = acc.role || '';
  $('account-edit-username').value = acc.username_ref || '';
  $('account-edit-routes').value = (acc.routes || []).map(r => `${r.name || ''} | ${r.url}`).join('\n');
  $('account-edit-password').value = '';
  $('account-edit-clear-secret').checked = false;
  $('account-edit-clear-secret').parentElement.style.display = acc.has_secret && canStoreSecret ? '' : 'none';
  $('account-edit-secret-group').style.display = canStoreSecret ? '' : 'none';
  $('account-edit-secret-status').textContent = acc.has_secret ? 'Mật khẩu hiện đang được lưu; để trống nếu không muốn đổi.' : 'Chưa có mật khẩu được lưu.';
  $('account-edit-message').style.color = '';
  $('account-edit-message').textContent = '';
  $('modal-account-edit').classList.add('open');
}

async function saveAccountEdit() {
  const $ = id => document.getElementById(id);
  const id = $('account-edit-id').value;
  const password = $('account-edit-password').value;
  const clearSecret = $('account-edit-clear-secret').checked;
  const message = $('account-edit-message');
  let profileSaved = false;
  if (password && clearSecret) { message.textContent = 'Chọn đổi mật khẩu hoặc xóa mật khẩu, không thể thực hiện cả hai cùng lúc.'; return; }
  try {
    const res = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('account-edit-name').value,
        role: $('account-edit-role').value,
        username: $('account-edit-username').value,
        routes_text: $('account-edit-routes').value
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'Không lưu được tài khoản.');
    profileSaved = true;
    if (password || clearSecret) {
      const secretRes = await fetch(`${API_BASE}/accounts/${encodeURIComponent(id)}/secret`, {
        method: clearSecret ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: clearSecret ? undefined : JSON.stringify({ password })
      });
      const secretJson = await secretRes.json();
      if (!secretRes.ok) {
        $('account-edit-password').value = '';
        message.style.color = 'var(--danger)';
        message.textContent = `Thông tin tài khoản đã lưu, nhưng không cập nhật được mật khẩu: ${secretJson.error?.message || 'Lỗi server.'}`;
        await loadAccounts();
        return;
      }
    }
    $('account-edit-password').value = '';
    closeModals();
    await loadAccounts();
  } catch (e) {
    message.style.color = 'var(--danger)';
    message.textContent = profileSaved ? `Thông tin tài khoản đã lưu, nhưng không cập nhật được mật khẩu: ${e.message}` : e.message;
  }
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

  // Đính kèm file trực tiếp từ máy tính cho các trường thông tin kiểu file của tác vụ
  const fileNames = new Map();
  const nameOf = id => fileNames.get(id) || id;

  async function load() {
    const mod = $('at-module').value;
    const [t, a, e] = await Promise.all([
      fetch(`${API_BASE}/automation/tasks?module=${encodeURIComponent(mod)}`).then(r => r.json()),
      fetch(`${API_BASE}/accounts`).then(r => r.json()),
      fetch(`${API_BASE}/environments`).then(r => r.json())
    ]);
    tasks = t.data || [];
    tasks.forEach(task => (task.params || []).forEach(p => (p.files || []).forEach(f => fileNames.set(f.id, f.name))));
    const stg = new Set((e.data || []).filter(x => x.environment_type === 'STAGING').map(x => x.id));
    stagingAccounts = (a.data || []).filter(x => stg.has(x.environment_profile_id));
    const sel = $('at-module');
    if (!sel.value) sel.innerHTML = '<option value="">Tất cả module</option>' + [...new Set(tasks.map(x => x.module))].map(m => `<option>${esc(m)}</option>`).join('');
    render();
  }

  // Bước mô tả: {{khóa}} thành ô nhập giá trị ngay trong câu (chữ, danh sách nhiều giá trị, hoặc chọn file)
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
    return `<div class="ed"><div class="ed-bar"><select class="ed-fmt" title="Định dạng để kiểm tra cú pháp"><option value="text">Văn bản</option><option value="json">JSON</option><option value="yaml">YAML</option><option value="xml">XML</option></select><span class="ed-keep">Giữ nguyên định dạng</span><span class="ed-spacer"></span><button type="button" class="ed-grow" aria-expanded="false">Mở rộng</button><button type="button" class="ed-clear">Xóa</button></div>
      <div class="ed-wrap"><pre class="ed-gutter">1</pre><textarea class="step-param ed-area" data-key="${esc(p.key)}" rows="6" spellcheck="false" wrap="off" placeholder="Nhập nội dung. Xuống dòng và khoảng trắng được giữ nguyên khi chạy.">${esc(p.value)}</textarea></div>
      <div class="ed-status"><span class="ed-valid"></span><span class="ed-meta"></span><span class="ed-limit" data-limit="${limitOf(p)}"></span></div></div>`;
  }
  function fieldHtml(p) {
    let ctl;
    if (p.type === 'file') {
      const names = String(p.value || '').split(',').filter(Boolean).map(nameOf).map(esc).join(', ');
      ctl = `<span class="step-file" data-key="${esc(p.key)}" data-fid="${esc(p.value)}">
        <label class="step-filebtn" style="cursor:pointer;margin:0;">Chọn file từ máy...<input type="file" class="step-file-input" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.rtf,.zip" hidden></label>
        <span class="step-fname">${names || '(chưa chọn, bỏ qua)'}</span>
        <button type="button" class="linkbtn step-fclear" style="background:none;border:0;color:var(--danger);cursor:pointer;font-size:11px;${p.value ? '' : 'display:none;'}">xóa</button></span>`;
    } else if (isMl(p)) ctl = editorHtml(p);
    else ctl = `<div class="fld-row"><input class="step-param fld-input form-control" data-key="${esc(p.key)}" value="${esc(p.value)}" placeholder="${p.type === 'list' ? 'mã1, mã2, ...' : '(trống)'}">${p.type === 'list' ? '' : '<button type="button" class="btn btn-outline fld-ed" title="Soạn bằng editor nhiều dòng">✎ Editor</button>'}</div>`;
    return `<div class="fld" data-key="${esc(p.key)}"><label class="fld-label" title="${hintOf(p)}">${esc(p.label)}<span class="sr-only">${hintOf(p)}</span></label>${ctl}</div>`;
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
    ed.querySelector('.ed-grow').onclick = e => {
      const big = !ed.classList.contains('expanded');
      ed.classList.toggle('expanded', big);
      ta.rows = big ? 24 : 6;
      e.target.textContent = big ? 'Thu gọn' : 'Mở rộng';
      e.target.setAttribute('aria-expanded', String(big));
    };
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
            <span class="badge badge-blue">${esc(t.module)}</span></div>
          <div class="at-ctl" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary at-open">Mở chi tiết</button>
            <select class="form-control at-acc" style="width:auto;font-size:11.5px;"><option value="">Tự chọn tài khoản</option>${stagingAccounts.map(a => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>
            ${t.runnable ? '<span style="display:inline-flex;gap:4px;align-items:center;font-size:11.5px;">Số lần <input type="number" class="form-control at-times" min="1" max="50" value="1" style="width:58px;padding:2px 6px;"> <label title="Dừng ngay khi một lần không đạt"><input type="checkbox" class="at-stop" checked> dừng khi lỗi</label></span><button class="btn btn-primary at-run">▶ Chạy tác vụ</button><button class="btn btn-outline at-halt" style="display:none;color:var(--danger);">Dừng</button>' : (canApprove() ? '<button class="btn btn-warning at-approve">Xem code & Duyệt</button>' : '<span class="badge badge-amber">Chờ người có quyền duyệt</span>')}
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
          ${canEdit() ? '<div class="at-param-footer"><button class="btn btn-outline at-save-params">Đặt làm mặc định</button></div>' : ''}` : ''}
        <pre class="at-codebox" style="display:none;background:var(--surface-alt);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:11px;white-space:pre;tab-size:2;overflow:auto;max-height:70vh;margin-top:8px;">${esc(t.script)}</pre>
        <div class="at-result" style="font-size:11.5px;margin-top:6px;"></div>
        </div>
      </div>`).join('');
    document.querySelectorAll('#at-list [data-id]').forEach(card => {
      const t = tasks.find(x => x.id === card.dataset.id);
      const box = card.querySelector('.at-codebox');
      card.querySelector('.at-open').onclick = () => openTask(card);
      card.addEventListener('click', e => { if (!card.classList.contains('open') && !e.target.closest('button,select,input,a,label')) openTask(card); });
      wireFields(card, t);
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
        const input = box.querySelector('.step-file-input');
        if (input) input.onchange = async e => {
          const fs = [...e.target.files]; e.target.value = '';
          if (!fs.length) return;
          const fnameEl = box.querySelector('.step-fname');
          fnameEl.textContent = 'Đang tải file...';
          const ids = [];
          try {
            for (const f of fs) {
              if (f.size > 10 * 1024 * 1024) throw new Error(`"${f.name}" lớn hơn 10 MB`);
              const rec = await call('POST', '/automation/files', { name: f.name, data_base64: await toBase64(f) });
              fileNames.set(rec.id, rec.name);
              ids.push(rec.id);
            }
            setPicked(box, ids);
          } catch (err) {
            notice(esc(err.message), 'error');
            setPicked(box, String(box.dataset.fid || '').split(',').filter(Boolean));
          }
        };
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

  // Chọn file đính kèm trực tiếp từ máy tính trong chi tiết tác vụ tự động
  const toBase64 = file => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('Không đọc được file')); r.readAsDataURL(file); });
  function setPicked(box, ids) {
    box.dataset.fid = ids.join(',');
    box.querySelector('.step-fname').textContent = ids.map(nameOf).join(', ') || '(chưa chọn, bỏ qua)';
    box.querySelector('.step-fclear').style.display = ids.length ? '' : 'none';
    box.closest('.at-card')?.dispatchEvent(new Event('input'));
  }

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
    $('te-ai-error').value = '';
    $('te-ai-msg').textContent = '';
    $('te-ai-msg').className = '';
    document.getElementById('modal-task').classList.add('open');
  }

  async function requestCodeFix() {
    const error = $('te-ai-error').value.trim(), button = $('te-ai-fix'), message = $('te-ai-msg');
    if (!editing) return;
    if (!error) { message.textContent = 'Hãy dán lỗi của lần chạy trước.'; message.className = 'error'; return; }
    const taskId = editing.id;
    button.disabled = true;
    message.textContent = 'AI đang phân tích lỗi và đề xuất code...';
    message.className = '';
    try {
      const result = await call('POST', `/automation/tasks/${encodeURIComponent(taskId)}/repair`, { error, script: $('te-script').value });
      if (!editing || editing.id !== taskId) return;
      $('te-script').value = result.script;
      message.textContent = `${result.engine_note || 'Đã có đề xuất sửa.'} Code đã được điền vào ô soạn thảo.`;
      message.className = 'success';
    } catch (e) {
      message.textContent = e.message;
      message.className = 'error';
    } finally { button.disabled = false; }
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
    $('at-backlink').addEventListener('click', closeTask);
    $('crumb-page').addEventListener('click', () => { if ($('pane-automation').classList.contains('detail-mode') && $('pane-automation').classList.contains('active')) closeTask(); });
    $('at-q').addEventListener('input', () => render());
    $('at-kind').addEventListener('change', () => render());
    { let opened = false; document.querySelector("[data-tab='pane-automation']").addEventListener('click', () => { if (!opened) { opened = true; load(); } }); } // đổi tab không nạp lại: giữ nguyên kết quả, chỉ nạp lại khi tải lại trang
    $('te-add-param').addEventListener('click', () => $('te-params').insertAdjacentHTML('beforeend', paramRow({ auto: true })));
    $('te-params').addEventListener('click', e => { if (e.target.closest('.tp-del')) e.target.closest('.tp-row').remove(); });
    $('te-ai-fix').addEventListener('click', requestCodeFix);
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
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

  async function loadModules() {
    try {
      const j = await (await fetch(`${API_BASE}/kb/modules`)).json();
      const opts = (j.data || []).slice().sort((a, b) => a.code.localeCompare(b.code))
        .map(m => `<option value="${esc(m.code)}">${esc(m.code)} · ${esc(m.name)}${m.cluster ? ' (cụm ' + esc(m.cluster) + ')' : ''}</option>`).join('');
      $('bug-module-select').insertAdjacentHTML('beforeend', opts);
      $('bh-module').insertAdjacentHTML('beforeend', opts);
      if ($('fn-module')) $('fn-module').insertAdjacentHTML('beforeend', opts);
    } catch {}
  }

  // ---------- Tab 2: Phân Tích Bug ----------
  let timer, seq = 0;
  const MAX_ANALYSIS_FILES = 5, MAX_ANALYSIS_BYTES = 10 * 1024 * 1024;
  let analysisFiles = [];
  let loadedBug = null; // bug realtime đang được nạp vào trang phân tích

  function hints(text, platform, files = analysisFiles) {
    const t = fold(text), miss = [];
    if (!/tai khoan|user|role|vai tro|khach hang/.test(t)) miss.push('tài khoản hoặc vai trò thực hiện');
    if (!/buoc|khi |nhan|bam|tao |chon/.test(t)) miss.push('các bước thao tác dẫn đến lỗi');
    if (!files.length && !/anh|video|screenshot|dinh kem/.test(t)) miss.push('ảnh hoặc video bằng chứng');
    if (platform === 'Mobile' && !/ios|android|phien ban|version/.test(t)) miss.push('thiết bị và phiên bản ứng dụng (Mobile)');
    $('ba-hints').innerHTML = miss.length ? `<span class="badge badge-amber">Nên bổ sung</span> ${esc(miss.join(', '))}` : '';
  }

  function renderAnalysisFiles() {
    $('ba-file-list').innerHTML = analysisFiles.map((file, i) => `
      <div class="ba-file-item"><span>${esc(file.name)} (${Math.max(1, Math.round(file.size / 1024))} KB)</span>
        <button type="button" class="ba-file-remove" data-ba-remove="${i}" aria-label="Bỏ ${esc(file.name)}">Bỏ</button></div>`).join('');
  }

  const readAnalysisFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`Không đọc được file "${file.name}"`));
    reader.readAsDataURL(file);
  });

  function renderResults(d) {
    $('ba-results').style.display = 'block';
    $('ba-summary').innerHTML = d.module_used
      ? `Đang tìm trong module <b>${esc(d.module_used)}</b>.`
      : (d.module_guess ? `Module nghi vấn: <b>${esc(d.module_guess)}</b> (đoán từ các bug cũ giống nhất; chưa dùng để lọc). Chọn module ở trên để thu hẹp kết quả.` : 'Chưa đoán được module; đang tìm trên mọi module.');
    $('ba-rules-count').textContent = d.rules.length;
    $('ba-bugs-count').textContent = d.bugs.length;
    if ($('ba-functions-count')) $('ba-functions-count').textContent = (d.functions || []).length;
    $('ba-rules').innerHTML = d.rules.length ? d.rules.map(r => `
      <div style="margin-bottom:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
        <a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener"><b>${esc(r.rule_id)}</b> · ${esc(r.title)}</a>
        <span class="badge badge-blue">${esc(r.flow || r.module)}</span>
        <div style="font-size:11.5px;color:var(--text-subtle);margin-top:3px;">${esc((r.description || '').slice(0, 220))}${(r.description || '').length > 220 ? '...' : ''}</div>
        ${r.roles.length ? `<div style="font-size:11px;">Vai trò: ${esc(r.roles.join(', '))}</div>` : ''}
      </div>`).join('') : '<em style="font-size:12px;">Không tìm thấy rule phù hợp với mô tả.</em>';
    $('ba-bugs').innerHTML = d.bugs.length ? d.bugs.map(b => bugCard(b)).join('') : '<em style="font-size:12px;">Không có bug cũ nào giống mô tả.</em>';
    if ($('ba-functions')) {
      const fns = d.functions || [];
      $('ba-functions').innerHTML = fns.length ? fns.map(f => functionRefCard(f)).join('') : '<em style="font-size:12px;">Không có task Function nào liên quan.</em>';
    }
  }

  // Mã trạng thái task Haraworks -> nhãn
  const BUG_STATUS = { 0: 'Mới', 1: 'Đang thực hiện', 2: 'Tạm ngưng', 3: 'Chờ duyệt', 4: 'Từ chối', 5: 'Hoàn thành', 6: 'Cần duyệt', 10: 'Không xử lý', 11: 'Không thực hiện' };
  // Độ ưu tiên: 1 và 2 hiện "Ưu tiên cao", 3 "Ưu tiên", 4 "Không ưu tiên" (khớp giao diện Haraworks)
  const BUG_PRIORITY = { 1: 'Ưu tiên cao', 2: 'Ưu tiên cao', 3: 'Ưu tiên', 4: 'Không ưu tiên' };
  const prioClass = p => (p === 1 || p === 2 ? 'high' : p === 3 ? 'mid' : 'low');
  const statusClass = st => ({ 0: 'new', 1: 'doing', 2: 'hold', 3: 'wait', 4: 'rej', 5: 'done', 6: 'wait', 11: 'done' })[st] || 'new';

  function bugCard(b) {
    const note = b.note ? `<div style="font-size:11.5px;margin-top:3px;background:var(--surface-alt);padding:4px 6px;border-radius:4px;">
      ${b.note.root_cause ? `<b>Nguyên nhân:</b> ${esc(b.note.root_cause)}<br>` : ''}${b.note.fix ? `<b>Cách sửa:</b> ${esc(b.note.fix)}<br>` : ''}${(b.note.rule_ids || []).length ? `Rule: ${esc(b.note.rule_ids.join(', '))}` : ''}</div>` : '';
    return `<div style="margin-bottom:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
      <a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener"><b>${esc(b.title)}</b></a>
      <div style="font-size:11px;margin-top:2px;">
        ${b.module ? `<span class="badge badge-blue">${esc(b.module)}</span>` : ''}
        ${b.is_new ? '<span class="badge badge-amber" title="Tạo trong 30 ngày gần đây">Bug mới</span>' : '<span class="badge badge-closed" title="Tạo trước đó">Bug cũ</span>'}
        ${b.category ? `<span class="badge badge-amber">${esc(b.category)}</span>` : ''}
        ${b.live && b.status != null ? `<span class="badge badge-green">${esc(BUG_STATUS[b.status] || 'Trạng thái ' + b.status)}</span>` : ''}
        <span style="color:var(--text-subtle);">${esc((b.date || '').slice(0, 16))}${b.assignee ? ' · ' + esc(b.assignee) : ''}${b.project ? ' · ' + esc(b.project) : ''}</span></div>${note}</div>`;
  }

  function functionRefCard(f) {
    return `<div style="margin-bottom:8px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;">
      <a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener"><b>${esc(f.title)}</b></a>
      <div style="font-size:11px;margin-top:2px;">
        ${f.team ? `<span class="badge badge-blue">${esc(f.team)}</span>` : ''}
        ${f.module ? `<span class="badge badge-blue">${esc(f.module)}</span>` : ''}
        ${f.status != null ? `<span class="badge badge-green">${esc(BUG_STATUS[f.status] || 'Trạng thái ' + f.status)}</span>` : ''}
        <span style="color:var(--text-subtle);">${esc((f.date || '').slice(0, 16))}${f.assignee ? ' · ' + esc(f.assignee) : ''}${f.approver ? ' · Duyệt: ' + esc(f.approver) : ''}</span>
      </div></div>`;
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
      const attachments = await Promise.all(analysisFiles.map(async file => ({ name: file.name, mime: file.type, data_base64: await readAnalysisFile(file) })));
      const res = await fetch(`${API_BASE}/bug-analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, module: $('bug-module-select').value, platform: $('bug-platform-select').value, attachments, ...(loadedBug ? { bug_id: loadedBug.id } : {}) }) });
      let j = null; try { j = await res.json(); } catch {}
      if (my !== aiSeq) return;
      if (!res.ok) throw new Error(j?.error?.message || (res.status === 404 ? 'Server chưa chạy bản mới, hãy khởi động lại server' : 'Lỗi ' + res.status));
      const d = j.data, list = a => a.length ? `<ul style="margin:2px 0 6px 18px;padding:0;">${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<div style="color:var(--text-subtle);">Không có.</div>';
      const reproduction = d.reproduction_steps?.length ? d.reproduction_steps : (d.testcases || []);
      $('ba-ai-body').innerHTML = `<div class="ba-ai-note">${esc(d.engine_note)}</div>
        <div class="ba-insight-grid">
          <section class="ba-insight"><h3>1. Nguyên nhân bug</h3>${list(d.causes || [])}</section>
          <section class="ba-insight"><h3>2. Cách tái hiện</h3>${list(reproduction)}</section>
          <section class="ba-insight"><h3>3. Tác vụ tự động đã có liên quan</h3>${d.tasks.length ? `<ul>${d.tasks.map(t => `<li><a href="#" class="ba-task" data-id="${esc(t.id)}">${esc(t.name)}</a> <span class="badge badge-blue">${esc(t.module)}</span><div class="ba-detail">${esc(t.why)}</div></li>`).join('')}</ul>` : '<p class="ba-empty">Chưa có tác vụ phù hợp với mô tả này.</p>'}</section>
          <section class="ba-insight"><h3>4. Đề xuất tác vụ tự động</h3>${d.new_task ? `<p>${esc(d.new_task)}</p>` : '<p class="ba-empty">Có thể dùng lại tác vụ liên quan ở mục trên.</p>'}</section>
        </div>
        `;
      $('ba-ai-body').querySelectorAll('.ba-task').forEach(a => a.onclick = e => { e.preventDefault(); document.querySelector("[data-tab='pane-automation']").click(); });
    } catch (e) { if (my === aiSeq) $('ba-ai-body').innerHTML = `<span style="color:var(--danger);">Không phân tích được: ${esc(e.message)}</span>`; }
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(liveSearch, 600); clearTimeout(aiTimer); aiTimer = setTimeout(runAnalysis, 2000); };

  // ---------- Nạp mô tả và ảnh từ bug realtime ----------
  const pickerMeta = b => [b.module_name || b.module, shortDate(b.date), b.assignee].filter(Boolean).map(esc).join(' · ');
  let pickerTimer;
  async function loadPicker() {
    const box = $('ba-picker-list');
    box.innerHTML = '<div class="ba-empty">Đang tải...</div>';
    try {
      const qs = new URLSearchParams({ live: '1', sort: 'created', limit: '30', offset: '0', q: $('ba-picker-q').value.trim() });
      const { data } = await (await fetch(`${API_BASE}/bugs?${qs}`)).json();
      box.innerHTML = data.items.length ? data.items.map((b, k) => `<button type="button" class="ba-pick" role="option" data-k="${k}">
          <span class="bh-st bh-st-${statusClass(b.status)}">${esc(b.status_label || bhStatusLabel(b.status))}</span>${b.is_today ? '<span class="bh-today">Today</span>' : ''}
          <span class="ba-pick-title">${esc(b.title)}</span><span class="ba-pick-meta">${pickerMeta(b)}</span></button>`).join('')
        : '<div class="ba-empty">Không có bug realtime nào khớp. Kiểm tra cookie Haraworks trên server (nhãn Realtime ở Tra cứu bug).</div>';
      box._items = data.items;
    } catch (e) { box.innerHTML = `<div class="ba-empty">Không tải được danh sách: ${esc(e.message)}</div>`; }
  }
  function renderLoaded() {
    const box = $('ba-loaded');
    if (!loadedBug) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<div class="ba-loaded-head"><span>Đang phân tích bug: <b>${esc(loadedBug.title)}</b></span>
      <span><a href="${esc(safeUrl(loadedBug.url))}" target="_blank" rel="noopener">Mở trên Haraworks ↗</a> <button type="button" class="btn btn-outline" id="ba-loaded-clear" style="padding:2px 8px;font-size:11.5px;color:var(--danger);margin-left:6px;">Xóa</button></span></div>
      <div id="ba-loaded-media" class="ba-loaded-media">Đang tải mô tả và ảnh...</div>`;
  }
  async function loadBugIntoAnalysis(b) {
    loadedBug = b;
    $('ba-picker').hidden = true;
    renderLoaded();
    $('bug-input-desc').value = b.title;
    const mod = [...$('bug-module-select').options].find(o => o.value === b.module);
    if (mod) $('bug-module-select').value = mod.value;
    liveSearch();
    try {
      const res = await fetch(`${API_BASE}/bugs/${encodeURIComponent(b.id)}/detail`);
      let j = null; try { j = await res.json(); } catch {}
      if (loadedBug !== b) return;
      const media = $('ba-loaded-media');
      if (!res.ok) { media.innerHTML = `<span style="color:var(--danger);">${esc(j?.error?.message || 'Không lấy được chi tiết bug')}. Đang dùng tên bug làm mô tả.</span>`; runAnalysis(); return; }
      const d = j.data;
      $('bug-input-desc').value = [b.title, d.description].filter(Boolean).join('\n\n').slice(0, 4000);
      const all = [...(d.description_media || []), ...(d.attachments || [])];
      const hasImg = all.concat((d.comments?.items || []).flatMap(c => [...(c.media || []), ...(c.attachments || [])])).some(m => m.kind === 'image');
      media.innerHTML = all.length ? mediaHtml(all) + (hasImg ? `<div class="ba-detail">Tối đa ${MAX_ANALYSIS_FILES} ảnh đầu tiên (kể cả ảnh trong bình luận) được gửi cho AI cùng mô tả.</div>` : '') : '<span class="ba-empty">Bug này không có ảnh hoặc video đính kèm.</span>';
      hints($('bug-input-desc').value, $('bug-platform-select').value);
      liveSearch(); runAnalysis();
    } catch (e) { if (loadedBug === b) $('ba-loaded-media').textContent = 'Không lấy được chi tiết: ' + e.message; }
  }

  // ---------- Tab 3: Bug Cũ ----------
  let page = 1, total = 0, facetsLoaded = false, bhTimer, bhItems = [];
  const PAGE_SIZE = 50;
  const bhStatusLabel = st => BUG_STATUS[st] || ('Trạng thái ' + st);
  const CLOSED_HINT = 'Đóng = Hoàn thành hoặc Không thực hiện (suy ra từ tên trạng thái, cần QC xác nhận).';

  async function loadFacets(force) {
    if (facetsLoaded && !force) return;
    try {
      const { data } = await (await fetch(`${API_BASE}/bugs/meta`)).json();
      facetsLoaded = true;
      const f = data.facets || {};
      $('bh-total').textContent = `${data.count} bug`;
        const fill = (id, html) => { const sel = $(id); const keep = sel.value; const none = id === 'bh-ap' ? '<option value="__none__">Chưa có người duyệt</option>' : ''; sel.innerHTML = sel.options[0].outerHTML + none + html; sel.value = keep; };
      // module: "Chưa rõ module" chỉ lọc trong tab này
      const mod = $('bh-module'), unk = mod.querySelector('option[value="__unknown__"]');
      if (unk) unk.textContent = `Chưa rõ module (${f.unknown || 0})`;
      else mod.insertAdjacentHTML('beforeend', `<option value="__unknown__">Chưa rõ module (${f.unknown || 0})</option>`);
      fill('bh-project', Object.entries(f.projects || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      fill('bh-st', Object.entries(f.statuses || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(bhStatusLabel(+k))} (${n})</option>`).join(''));
      fill('bh-ap', Object.entries(f.approvers || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      $('bh-ap').insertAdjacentHTML('beforeend', '');
      fill('bh-as', Object.entries(f.assignees || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      fill('bh-cat', Object.entries(f.categories || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      fill('bh-year', Object.keys(f.years || {}).sort().reverse().map(y => `<option>${esc(y)}</option>`).join(''));
    } catch {}
  }

  function bhQuery() {
    const mod = $('bh-module').value, unknown = mod === '__unknown__';
    return new URLSearchParams({
      module: unknown ? '' : mod, project: $('bh-project')?.value || '', unknown: unknown ? '1' : '0', q: $('bh-q').value.trim(),
      category: $('bh-cat').value, year: $('bh-year').value, status: $('bh-st').value,
      assignee: $('bh-as').value, closed: $('bh-cl').value, approver: $('bh-ap').value, age: $('bh-age').value, sort: $('bh-sort').value
    });
  }

  const shortDate = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; };
  const FLAG_SVG = '<svg viewBox="0 0 16 20" aria-hidden="true"><path d="M2.5 1.5a1 1 0 0 1 1 1v.5h9.8a.7.7 0 0 1 .58 1.09L11.6 7.5l2.28 3.41a.7.7 0 0 1-.58 1.09H3.5v6.5a1 1 0 1 1-2 0v-16a1 1 0 0 1 1-1z"></path></svg>';
  function renderPagination(navEl, infoEl, curPage, totalPages, onPage) {
    if (!navEl) return;
    if (infoEl) infoEl.textContent = `Trang ${curPage} / ${totalPages}`;
    const nums = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) nums.push(i);
    } else if (curPage <= 4) {
      nums.push(1, 2, 3, 4, 5, '...', totalPages);
    } else if (curPage >= totalPages - 3) {
      nums.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      nums.push(1, '...', curPage - 2, curPage - 1, curPage, curPage + 1, curPage + 2, '...', totalPages);
    }
    navEl.innerHTML = `<button type="button" class="bh-page-btn arrow" data-p="${curPage - 1}" aria-label="Trang trước" title="Trang trước" ${curPage <= 1 ? 'disabled' : ''}>‹</button>` +
      nums.map(n => n === '...' ? '<span class="bh-page-dots">…</span>' : `<button type="button" class="bh-page-btn${n === curPage ? ' active' : ''}" data-p="${n}" aria-label="Trang ${n}" ${n === curPage ? 'aria-current="page"' : ''}>${n}</button>`).join('') +
      `<button type="button" class="bh-page-btn arrow" data-p="${curPage + 1}" aria-label="Trang sau" title="Trang sau" ${curPage >= totalPages ? 'disabled' : ''}>›</button>`;
    navEl.querySelectorAll('button[data-p]').forEach(btn => {
      btn.onclick = () => {
        const target = Number(btn.dataset.p);
        if (target >= 1 && target <= totalPages && target !== curPage) onPage(target);
      };
    });
    const activeBtn = navEl.querySelector('.bh-page-btn.active');
    if (activeBtn && navEl.scrollWidth > navEl.clientWidth) {
      navEl.scrollLeft = Math.max(0, activeBtn.offsetLeft - navEl.clientWidth / 2 + activeBtn.offsetWidth / 2);
    }
  }
  const TEAM_ROW_COLORS = {
    'Super Team': { bg: '#f0f7ff', border: '#3b82f6' },
    'Winx Team': { bg: '#fdf2f8', border: '#ec4899' },
    'Integrity Team': { bg: '#f0fdf4', border: '#10b981' },
    'Team 1': { bg: '#fffbeb', border: '#f59e0b' },
    'ODOO BUG PRODUCTION': { bg: '#f8fafc', border: '#64748b' },
    'HRWs APP - RELEASE': { bg: '#faf5ff', border: '#8b5cf6' },
    'HRWs - RELEASE CHECKLIST': { bg: '#ecfeff', border: '#06b6d4' }
  };
  const TEAM_PALETTE = [
    { bg: '#eff6ff', border: '#3b82f6' },
    { bg: '#fdf2f8', border: '#ec4899' },
    { bg: '#f0fdf4', border: '#10b981' },
    { bg: '#fffbeb', border: '#f59e0b' },
    { bg: '#f5f3ff', border: '#8b5cf6' },
    { bg: '#ecfeff', border: '#06b6d4' }
  ];
  function teamRowStyle(projectOrTeam) {
    const key = String(projectOrTeam || '').trim();
    if (!key) return '';
    const customHex = platformLabelColors.project?.[key];
    if (/^#[0-9a-f]{6}$/i.test(customHex || '')) {
      return ` style="--row-bg:${customHex}14;--row-bg-dark:${customHex}24;--row-border:${customHex};"`;
    }
    let c = TEAM_ROW_COLORS[key];
    if (!c) {
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      c = TEAM_PALETTE[h % TEAM_PALETTE.length];
    }
    return ` style="--row-bg:${c.bg};--row-bg-dark:${c.border}24;--row-border:${c.border};"`;
  }
  function bhCard(b, idx) {
    const priority = Number(b.priority);
    const priorityLabel = b.priority_label || BUG_PRIORITY[priority] || 'Chưa xác định';
    const flagClass = priority >= 1 && priority <= 2 ? 'bh-pr-high' : priority === 3 ? 'bh-pr-mid' : 'bh-pr-low';
    const status = b.status == null ? null : Number(b.status);
    const statusText = status == null ? 'Bản lưu' : (b.status_label || bhStatusLabel(status));
    const statusClassName = status == null ? 'bh-st-old' : `bh-st-${statusClass(status)}`;
    const rowTeam = b.source_team || b.project;
    const rowSt = teamRowStyle(rowTeam);
    return `<article class="bh-card${b.closed ? ' is-closed' : ''}" data-idx="${idx}" tabindex="0"${rowSt} title="${rowTeam ? 'Dự án: ' + esc(rowTeam) : ''}">
      <span class="bh-mod" title="${esc(b.module_name || b.module || 'Chưa rõ module')}"${labelColorStyle('module', b.module || '')}>${esc(b.module || '—')}</span>
      <span class="bh-priority ${flagClass}" title="Độ ưu tiên: ${esc(priorityLabel)}" aria-label="Độ ưu tiên: ${esc(priorityLabel)}">${FLAG_SVG}</span>
      <span class="bh-card-title" title="${esc(b.title)}">${esc(b.title)}</span>
      <span class="bh-st ${statusClassName}" title="Trạng thái"${labelColorStyle('status', status == null ? '' : status)}>${esc(statusText)}</span>
      <span class="bh-cell" title="Người duyệt">${esc(b.approver || '—')}</span>
      <span class="bh-cell" title="Người thực hiện">${esc(b.assignee || '—')}</span>
      <span class="bh-cell bh-date" title="Ngày tạo">${esc(shortDate(b.date) || '—')}</span>
    </article>`;
  }

  function fnCard(b, idx) {
    const priority = Number(b.priority);
    const priorityLabel = b.priority_label || BUG_PRIORITY[priority] || 'Chưa xác định';
    const flagClass = priority >= 1 && priority <= 2 ? 'bh-pr-high' : priority === 3 ? 'bh-pr-mid' : 'bh-pr-low';
    const status = b.status == null ? null : Number(b.status);
    const statusText = status == null ? 'Mới' : (b.status_label || bhStatusLabel(status));
    const statusClassName = status == null ? 'bh-st-new' : `bh-st-${statusClass(status)}`;
    const teamName = b.team || b.project || '';
    const rowSt = teamRowStyle(teamName);
    return `<article class="bh-card${b.closed ? ' is-closed' : ''}" data-idx="${idx}" tabindex="0"${rowSt} title="${teamName ? 'Dự án / Team: ' + esc(teamName) : ''}">
      <span class="bh-mod" title="${esc(b.module_name || b.module || 'Chưa rõ module')}"${labelColorStyle('module', b.module || '')}>${esc(b.module || '—')}</span>
      <span class="bh-priority ${flagClass}" title="Độ ưu tiên: ${esc(priorityLabel)}" aria-label="Độ ưu tiên: ${esc(priorityLabel)}">${FLAG_SVG}</span>
      <span class="bh-card-title" title="${esc(b.title)}">${esc(b.title)}</span>
      <span class="bh-st ${statusClassName}" title="Trạng thái"${labelColorStyle('status', status == null ? '' : status)}>${esc(statusText)}</span>
      <span class="bh-cell" title="Người duyệt">${esc(b.approver || '—')}</span>
      <span class="bh-cell" title="Người thực hiện">${esc(b.assignee || '—')}</span>
      <span class="bh-cell bh-date" title="Ngày tạo">${esc(shortDate(b.date) || '—')}</span>
    </article>`;
  }

  async function loadBugs(reset, keepPaging) {
    if (reset) { if (!keepPaging) page = 1; bhItems = []; $('bh-list').innerHTML = ''; }
    let labelWarning = '';
    try {
      try { await refreshLabelColors(); } catch (e) { labelWarning = ` · Không tải được màu nhãn: ${e.message}`; }
      const offset = (page - 1) * PAGE_SIZE;
      const qs = bhQuery(); qs.set('offset', offset); qs.set('limit', PAGE_SIZE);
      const res = await fetch(`${API_BASE}/bugs?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `Lỗi ${res.status}`);
      const data = json.data;
      total = data.total;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (page > pages) { page = pages; return loadBugs(true, true); }
      bhItems = data.items;
      $('bh-list').innerHTML = data.items.map((b, k) => bhCard(b, k)).join('');
      const first = total ? offset + 1 : 0;
      $('bh-count').textContent = (total ? `Hiển thị ${first}–${offset + data.items.length} trên ${total} bug` : 'Không có bug nào khớp bộ lọc.') + labelWarning;
      renderPagination($('bh-page-nav'), $('bh-page-info'), page, pages, p => { page = p; loadBugs(true, true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    } catch (e) {
      $('bh-count').textContent = 'Không tải được danh sách bug: ' + e.message;
      $('bh-page-info').textContent = '';
      if ($('bh-page-nav')) $('bh-page-nav').innerHTML = '';
    }
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
      ${live ? row('Trạng thái', esc(b.status_label || bhStatusLabel(b.status))) : row('Trạng thái', '<i>bản lưu cũ, không có trạng thái</i>')}
      ${live ? row('Độ ưu tiên', esc(b.priority_label || BUG_PRIORITY[b.priority] || '-')) : ''}
      ${live ? row('Người thực hiện', esc(b.assignee || '-')) : ''}
      ${live ? row('Người duyệt', esc(b.approver || 'Chưa có')) : ''}
      ${live ? row('Dự án', esc(b.project || '-')) : ''}
      ${live ? row('Cập nhật lần cuối', esc((b.updated || '').slice(0, 16) || '-')) : ''}
      ${note}
      <p style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">Mở bug trên Haraworks ↗</a>
        ${live ? `<button type="button" class="btn btn-outline" data-analyze-bug="${i}">Phân tích bug này</button>` : ''}
        <button type="button" class="btn btn-outline" id="bh-check-build-btn">🔍 Kiểm tra đợt build</button></p>
      <div id="bh-build-check" class="build-check-box" hidden></div>
      <div id="bh-detail" style="margin-top:10px;color:var(--text-subtle);">Đang tải chi tiết từ Haraworks...</div>`;
    $('bh-check-build-btn')?.addEventListener('click', () => checkBuildsIntoBox($('bh-build-check'), b.id, b.title));
    $('bh-drawer').classList.add('open');
    loadBhDetail(b.id);
  }

  // Chi tiết đầy đủ lấy từ Haraworks (mô tả, người, lịch sử, bình luận); cần cookie Haraworks trên server
  const vnTime = iso => { if (!iso) return '-'; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }); };
  const LOG_TYPE = { 1: 'Tạo công việc', 12: 'Thay đổi dự án' };
  // Xem trước ảnh, video, âm thanh, PDF ngay trên trang (không cần tải về)
  const mediaHtml = list => {
    const seen = new Set(), items = (list || []).filter(m => m && /^https?:\/\//i.test(m.url || '') && !seen.has(m.url) && seen.add(m.url));
    if (!items.length) return '';
    return `<div class="bh-media">${items.map(m => {
      const u = esc(m.url), nm = esc(m.name || '');
      if (m.kind === 'image') return `<a class="bh-img" href="${u}" data-light="${u}" title="${nm || 'Xem ảnh lớn'}"><img src="${u}" loading="lazy" alt="${nm || 'ảnh'}"></a>`;
      if (m.kind === 'video') return `<video class="bh-vid" controls preload="metadata" src="${u}"></video>`;
      if (m.kind === 'audio') return `<audio class="bh-aud" controls preload="none" src="${u}"></audio>`;
      if (m.kind === 'pdf') return `<details class="bh-pdfd"><summary>📄 ${nm || 'PDF'}</summary><iframe class="bh-pdf" data-src="${u}" title="${nm || 'PDF'}"></iframe><a href="${u}" target="_blank" rel="noopener">Mở trong tab mới</a></details>`;
      return `<a class="bh-file" href="${u}" target="_blank" rel="noopener">📎 ${nm || 'tệp'}</a>`;
    }).join('')}</div>`;
  };
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
        <div style="white-space:pre-wrap;">${esc(c.text)}</div>${mediaHtml([...(c.media || []), ...c.attachments])}
        ${c.replies.map(r => `<div class="bh-reply"><b>${esc(r.by || '-')}</b> <span style="color:var(--text-muted);font-size:11px;">${vnTime(r.at)}</span><div style="white-space:pre-wrap;">${esc(r.text)}</div></div>`).join('')}</div>`).join('');
      box.style.color = '';
      box.innerHTML = `<h4 style="margin:6px 0;">Chi tiết từ Haraworks</h4>
        ${d.status != null ? row('Trạng thái (Haraworks)', esc(bhStatusLabel(d.status))) : ''}
        ${d.code ? row('Mã', esc(d.code)) : ''}${row('Người tạo', esc(d.created_by?.name || '-'))}${row('Người thực hiện', d.assignee ? esc(d.assignee.name) + (d.assignee.dept ? ' · ' + esc(d.assignee.dept) : '') : '-')}
        ${row('Chủ sở hữu', esc(d.owner?.name || '-'))}${d.supporters.length ? row('Người hỗ trợ', names(d.supporters)) : ''}${row('Người theo dõi (' + d.followers.length + ')', names(d.followers))}
        ${row('Hạn thực hiện', vnTime(d.plan_end_at))}${row('Độ ưu tiên', esc(BUG_PRIORITY[d.priority] || (d.priority ?? '-')))}${row('Cập nhật gần nhất', vnTime(d.updated_at) + (d.updated_by?.name ? ' · ' + esc(d.updated_by.name) : ''))}
        ${d.project ? row('Dự án', esc(d.project)) : ''}
        ${d.description || (d.description_media || []).length ? `<h4 style="margin:10px 0 4px;">Mô tả</h4><div style="white-space:pre-wrap;font-size:12px;">${esc(d.description)}</div>${mediaHtml(d.description_media)}` : ''}
        ${d.attachments.length ? `<h4 style="margin:10px 0 4px;">File đính kèm (${d.attachments.length})</h4>${mediaHtml(d.attachments)}` : ''}
        <h4 style="margin:10px 0 4px;">Lịch sử cập nhật (${d.logs.length})</h4>${logs ? `<ul class="bh-logs">${logs}</ul>` : '<div style="color:var(--text-muted);">Không có.</div>'}
        <h4 style="margin:10px 0 4px;">Bình luận (${d.comments.total})</h4>${cm || '<div style="color:var(--text-muted);">Chưa có bình luận.</div>'}`;
    } catch (e) { if ($('bh-detail') === box) box.textContent = 'Không lấy được chi tiết: ' + e.message; }
  }
  function closeBh() { $('bh-drawer').classList.remove('open'); }

  // ---------- Realtime: hỏi nhẹ số bản mỗi 5 giây khi đang mở tab Bug Cũ, có bug mới thì làm mới danh sách ----------
  let liveRev = null, liveTimer = null;
  const REALTIME_LABEL = { connected: 'realtime', 'poll-only': 'cập nhật mỗi 30 giây', reconnecting: 'đang nối lại', disconnected: 'cập nhật mỗi 30 giây', connecting: 'đang kết nối' };
  let liveRefreshRunning = false;
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
  async function refreshLiveNow() {
    if (liveRefreshRunning) return;
    liveRefreshRunning = true;
    const button = $('bh-refresh'), status = $('bh-refresh-status');
    button.disabled = true;
    button.classList.add('is-syncing');
    status.className = 'bh-refresh-status';
    status.textContent = 'Đang đồng bộ realtime...';
    try {
      const readStatus = async response => {
        let json = {};
        try { json = await response.json(); } catch {}
        if (!response.ok) throw new Error(json.error?.message || `Lỗi ${response.status}`);
        return json.data || {};
      };
      const before = await readStatus(await fetch(`${API_BASE}/bugs/live`));
      if (!before.enabled) throw new Error('Server chưa cấu hình cookie Haraworks nên không thể đồng bộ realtime.');
      await readStatus(await fetch(`${API_BASE}/bugs/live/refresh`, { method: 'POST' }));
      const deadline = Date.now() + 90000;
      let completedPolls = 0;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 300));
        const data = await readStatus(await fetch(`${API_BASE}/bugs/live`));
        if (!data.syncing && data.error) throw new Error(data.error);
        if (!data.syncing && data.lastSyncAt !== before.lastSyncAt) {
          completedPolls++;
          if (completedPolls >= 2) {
            liveRev = data.revision;
            await loadFacets(true);
            await loadBugs(true, true);
            await checkLive();
            status.className = 'bh-refresh-status is-success';
            status.textContent = 'Đồng bộ hoàn tất.';
            return;
          }
        } else completedPolls = 0;
      }
      throw new Error('Quá thời gian chờ đồng bộ bug.');
    } catch (e) {
      status.className = 'bh-refresh-status is-error';
      status.textContent = `Không đồng bộ được: ${e.message}`;
    } finally {
      liveRefreshRunning = false;
      button.disabled = false;
      button.classList.remove('is-syncing');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadModules();
    $('bug-input-desc').addEventListener('input', schedule);
    $('bug-module-select').addEventListener('change', liveSearch);
    $('bug-platform-select').addEventListener('change', () => hints($('bug-input-desc').value, $('bug-platform-select').value));
    $('ba-file-input').addEventListener('change', e => {
      const incoming = [...e.target.files];
      e.target.value = '';
      const msg = $('ba-file-msg');
      if (analysisFiles.length + incoming.length > MAX_ANALYSIS_FILES) {
        msg.style.color = 'var(--danger)'; msg.textContent = `Chỉ đính kèm tối đa ${MAX_ANALYSIS_FILES} file.`; return;
      }
      if (analysisFiles.concat(incoming).reduce((sum, file) => sum + file.size, 0) > MAX_ANALYSIS_BYTES) {
        msg.style.color = 'var(--danger)'; msg.textContent = 'Tổng dung lượng file đính kèm không được vượt quá 10 MB.'; return;
      }
      analysisFiles.push(...incoming);
      msg.style.color = ''; msg.textContent = '';
      renderAnalysisFiles();
      hints($('bug-input-desc').value, $('bug-platform-select').value);
      if (incoming.length) schedule();
    });
    $('ba-file-list').addEventListener('click', e => {
      const button = e.target.closest('[data-ba-remove]');
      if (!button) return;
      analysisFiles.splice(Number(button.dataset.baRemove), 1);
      renderAnalysisFiles();
      hints($('bug-input-desc').value, $('bug-platform-select').value);
      schedule();
    });
    $('ba-ai-run').addEventListener('click', runAnalysis);
    $('btn-pick-live-bug').addEventListener('click', () => { const p = $('ba-picker'); p.hidden = !p.hidden; if (!p.hidden) { $('ba-picker-q').focus(); loadPicker(); } });
    $('ba-picker-q').addEventListener('input', () => { clearTimeout(pickerTimer); pickerTimer = setTimeout(loadPicker, 300); });
    $('ba-picker-list').addEventListener('click', e => { const t = e.target.closest('.ba-pick'); if (t) loadBugIntoAnalysis($('ba-picker-list')._items[+t.dataset.k]); });
    $('ba-loaded').addEventListener('click', e => {
      if (e.target.closest('#ba-loaded-clear')) {
        clearTimeout(timer); clearTimeout(aiTimer); seq++; aiSeq++;
        loadedBug = null;
        renderLoaded();
        $('bug-input-desc').value = '';
        $('bug-module-select').value = '';
        analysisFiles = [];
        renderAnalysisFiles();
        $('ba-file-msg').textContent = '';
        $('ba-hints').innerHTML = '';
        $('ba-results').style.display = 'none';
        $('ba-ai-body').innerHTML = '';
        $('ba-rules').innerHTML = '';
        $('ba-bugs').innerHTML = '';
        if ($('ba-functions')) $('ba-functions').innerHTML = '';
      }
    });
    document.addEventListener('click', e => { const t = e.target.closest('[data-analyze-bug]'); if (!t) return; const b = bhItems[+t.dataset.analyzeBug]; if (!b) return; closeBh(); document.querySelector("[data-tab='pane-bug-analysis']").click(); loadBugIntoAnalysis(b); });

    document.querySelector("[data-tab='pane-bug-history']").addEventListener('click', () => { if (!$('bh-list').children.length) { Promise.all([loadFacets(), loadBugs(true)]); } });
    const FILTERS = ['bh-project', 'bh-module', 'bh-cat', 'bh-year', 'bh-st', 'bh-as', 'bh-ap', 'bh-age', 'bh-cl'];
    FILTERS.forEach(id => $(id).addEventListener('change', reload));
    $('bh-sort').addEventListener('change', reload);
    const countFilters = () => { const n = FILTERS.filter(id => $(id).value).length; const b = $('bh-filter-n'); b.textContent = n; b.hidden = !n; };
    FILTERS.forEach(id => $(id).addEventListener('change', countFilters));
    $('bh-filter-btn').addEventListener('click', () => { const p = $('bh-filters'); p.hidden = !p.hidden; $('bh-filter-btn').setAttribute('aria-expanded', String(!p.hidden)); });
    $('bh-filter-clear').addEventListener('click', () => { FILTERS.forEach(id => { $(id).value = ''; }); countFilters(); reload(); });
    // ảnh lớn khi bấm vào ảnh trong chi tiết; PDF chỉ nạp khi mở
    document.addEventListener('click', e => { const a = e.target.closest('[data-light]'); if (a) { e.preventDefault(); const lb = $('bh-lightbox'); lb.querySelector('img').src = a.dataset.light; lb.hidden = false; } else if (e.target.closest('#bh-lightbox')) { $('bh-lightbox').hidden = true; } });
    document.addEventListener('toggle', e => { const d = e.target; if (d.classList?.contains('bh-pdfd') && d.open) { const f = d.querySelector('iframe'); if (f && !f.src) f.src = f.dataset.src; } }, true);
    $('bh-q').addEventListener('input', reload);
    document.addEventListener('qa-label-colors-updated', () => {
      if ($('pane-bug-history').classList.contains('active')) loadBugs(true, true);
      if ($('pane-function-tasks')?.classList.contains('active')) loadFunctions(true, true);
    });
    $('bh-list').addEventListener('click', e => { const c = e.target.closest('.bh-card'); if (c) openBh(+c.dataset.idx); });
    $('bh-list').addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.bh-card'); if (c && e.key === 'Enter') openBh(+c.dataset.idx); });
    $('bh-drawer-close').addEventListener('click', closeBh);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeBh(); closeFn(); closeBd(); const lb = $('bh-lightbox'); if (lb) lb.hidden = true; } });
    $('bh-refresh')?.addEventListener('click', refreshLiveNow);
    document.addEventListener('qa-global-sync', () => { if ($('pane-bug-history')?.classList.contains('active')) { loadFacets(true); loadBugs(true, true); checkLive(); } });
    liveTimer = setInterval(checkLive, 5000);
    document.querySelector("[data-tab='pane-bug-history']").addEventListener('click', () => setTimeout(checkLive, 50));

    // Nút cuộn nhanh lên đầu trang khi cuộn xuống
    const scrollTopBtn = $('btn-scroll-top');
    if (scrollTopBtn) {
      const toggleScrollBtn = () => { scrollTopBtn.hidden = window.scrollY < 260; };
      window.addEventListener('scroll', toggleScrollBtn, { passive: true });
      scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
      toggleScrollBtn();
    }

    // ---------- Tab 3B: Tra Cứu Task Function (Super Team, Winx Team, Integrity Team, Team 1) ----------
    if ($('pane-function-tasks')) {
      const FN_FILTERS = ['fn-team', 'fn-module', 'fn-st', 'fn-cl', 'fn-as', 'fn-age'];
      const countFnFilters = () => {
        const n = FN_FILTERS.filter(id => $(id) && (id === 'fn-age' ? $(id).value !== 'week' : !!$(id).value)).length;
        const b = $('fn-filter-n'); if (b) { b.textContent = n; b.hidden = !n; }
      };
      FN_FILTERS.forEach(id => $(id)?.addEventListener('change', () => { countFnFilters(); reloadFunctions(); }));
      $('fn-sort')?.addEventListener('change', reloadFunctions);
      $('fn-filter-btn')?.addEventListener('click', () => { const p = $('fn-filters'); p.hidden = !p.hidden; $('fn-filter-btn').setAttribute('aria-expanded', String(!p.hidden)); });
      $('fn-filter-clear')?.addEventListener('click', () => { FN_FILTERS.forEach(id => { if ($(id)) $(id).value = id === 'fn-age' ? 'week' : ''; }); countFnFilters(); reloadFunctions(); });
      $('fn-q')?.addEventListener('input', reloadFunctions);
      $('fn-list')?.addEventListener('click', e => { const c = e.target.closest('.bh-card'); if (c) openFn(+c.dataset.idx); });
      $('fn-list')?.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.bh-card'); if (c && e.key === 'Enter') openFn(+c.dataset.idx); });
      $('fn-drawer-close')?.addEventListener('click', closeFn);
      $('fn-refresh')?.addEventListener('click', refreshFnLiveNow);
      document.addEventListener('qa-global-sync', () => { if ($('pane-function-tasks')?.classList.contains('active')) { loadFnFacets(true); loadFunctions(true, true); checkFnLive(); } });
      setInterval(checkFnLive, 5000);
      document.querySelector("[data-tab='pane-function-tasks']")?.addEventListener('click', () => {
        setTimeout(checkFnLive, 50);
        if (!$('fn-list').children.length) { Promise.all([loadFnFacets(), loadFunctions(true)]); }
      });
    }

    // ---------- Tab 3C: Theo Dõi Build / Release (App Mobile & Task Function) ----------
    if ($('pane-builds')) {
      const BD_FILTERS = ['bd-project', 'bd-kind', 'bd-st', 'bd-cl', 'bd-as', 'bd-year'];
      const countBdFilters = () => { const n = BD_FILTERS.filter(id => $(id)?.value).length; const b = $('bd-filter-n'); if (b) { b.textContent = n; b.hidden = !n; } };
      BD_FILTERS.forEach(id => $(id)?.addEventListener('change', () => { countBdFilters(); reloadBuilds(); }));
      $('bd-sort')?.addEventListener('change', reloadBuilds);
      $('bd-filter-btn')?.addEventListener('click', () => { const p = $('bd-filters'); p.hidden = !p.hidden; $('bd-filter-btn').setAttribute('aria-expanded', String(!p.hidden)); });
      $('bd-filter-clear')?.addEventListener('click', () => { BD_FILTERS.forEach(id => { if ($(id)) $(id).value = ''; }); countBdFilters(); reloadBuilds(); });
      $('bd-q')?.addEventListener('input', reloadBuilds);
      $('bd-list')?.addEventListener('click', e => { const c = e.target.closest('.bh-card'); if (c) openBd(+c.dataset.idx); });
      $('bd-list')?.addEventListener('keydown', e => { const c = e.target.closest && e.target.closest('.bh-card'); if (c && e.key === 'Enter') openBd(+c.dataset.idx); });
      $('bd-drawer-close')?.addEventListener('click', closeBd);
      $('bd-refresh')?.addEventListener('click', refreshBdLiveNow);
      document.addEventListener('qa-global-sync', () => { if ($('pane-builds')?.classList.contains('active')) { loadBuildFacets(true); loadBuilds(true, true); checkBdLive(); } });
      setInterval(checkBdLive, 5000);
      document.querySelector("[data-tab='pane-builds']")?.addEventListener('click', () => {
        setTimeout(checkBdLive, 50);
        if (!$('bd-list').children.length) { Promise.all([loadBuildFacets(), loadBuilds(true)]); }
      });
    }
  });

  // ---------- Logic Tra Cứu Task Function ----------
  let fnPage = 1, fnTotal = 0, fnFacetsLoaded = false, fnTimer, fnItems = [], fnLiveRev = null, fnLiveRefreshRunning = false;
  async function loadFnFacets(force) {
    if (fnFacetsLoaded && !force) return;
    try {
      const { data } = await (await fetch(`${API_BASE}/functions/meta`)).json();
      fnFacetsLoaded = true;
      const f = data.facets || {};
      if ($('fn-total')) $('fn-total').textContent = `${data.count || 0} task Function`;
      const fill = (id, html) => { const sel = $(id); if (!sel) return; const keep = sel.value; sel.innerHTML = sel.options[0].outerHTML + html; sel.value = keep; };
      const mod = $('fn-module');
      if (mod) {
        const unk = mod.querySelector('option[value="__unknown__"]');
        if (unk) unk.textContent = `Chưa rõ module (${f.unknown || 0})`;
        else mod.insertAdjacentHTML('beforeend', `<option value="__unknown__">Chưa rõ module (${f.unknown || 0})</option>`);
      }
      const defaultTeams = ['Super Team', 'Winx Team', 'Integrity Team', 'Team 1'];
      const teamCounts = f.teams || {};
      fill('fn-team', defaultTeams.map(t => `<option value="${esc(t)}">${esc(t)}${teamCounts[t] != null ? ' (' + teamCounts[t] + ')' : ''}</option>`).join(''));
      fill('fn-st', Object.entries(f.statuses || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(bhStatusLabel(+k))} (${n})</option>`).join(''));
      fill('fn-as', Object.entries(f.assignees || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      const ageSel = $('fn-age');
      if (ageSel && f.years) {
        const keepAge = ageSel.value;
        const yrs = Object.keys(f.years).sort().reverse().map(y => `<option value="year_${esc(y)}">Năm ${esc(y)} (${f.years[y]})</option>`).join('');
        ageSel.innerHTML = '<option value="week">Tuần này</option><option value="month">Tháng này</option>' + yrs + '<option value="">Tất cả</option>';
        ageSel.value = keepAge;
      }
    } catch {}
  }

  function fnQuery() {
    const mod = $('fn-module')?.value || '', unknown = mod === '__unknown__';
    return new URLSearchParams({
      team: $('fn-team')?.value || '',
      module: unknown ? '' : mod, unknown: unknown ? '1' : '0', q: ($('fn-q')?.value || '').trim(),
      status: $('fn-st')?.value || '',
      assignee: $('fn-as')?.value || '', closed: $('fn-cl')?.value || '', age: $('fn-age')?.value ?? 'week', sort: $('fn-sort')?.value || 'created'
    });
  }

  async function loadFunctions(reset, keepPaging) {
    if (!$('fn-list')) return;
    if (reset) { if (!keepPaging) fnPage = 1; fnItems = []; $('fn-list').innerHTML = ''; }
    let labelWarning = '';
    try {
      try { await refreshLabelColors(); } catch (e) { labelWarning = ` · Không tải được màu nhãn: ${e.message}`; }
      const offset = (fnPage - 1) * PAGE_SIZE;
      const qs = fnQuery(); qs.set('offset', offset); qs.set('limit', PAGE_SIZE);
      const res = await fetch(`${API_BASE}/functions?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `Lỗi ${res.status}`);
      const data = json.data;
      fnTotal = data.total;
      const pages = Math.max(1, Math.ceil(fnTotal / PAGE_SIZE));
      if (fnPage > pages) { fnPage = pages; return loadFunctions(true, true); }
      fnItems = data.items;
      const hasTeamFilter = !!($('fn-team')?.value);
      $('fn-list').innerHTML = data.items.map((b, k) => fnCard(b, k, hasTeamFilter)).join('');
      const first = fnTotal ? offset + 1 : 0;
      $('fn-count').textContent = (fnTotal ? `Hiển thị ${first}–${offset + data.items.length} trên ${fnTotal} task Function` : 'Chưa có task Function nào khớp bộ lọc.') + labelWarning;
      renderPagination($('fn-page-nav'), $('fn-page-info'), fnPage, pages, p => { fnPage = p; loadFunctions(true, true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    } catch (e) {
      $('fn-count').textContent = 'Không tải được danh sách task Function: ' + e.message;
      $('fn-page-info').textContent = '';
      if ($('fn-page-nav')) $('fn-page-nav').innerHTML = '';
    }
  }
  const reloadFunctions = () => { clearTimeout(fnTimer); fnTimer = setTimeout(() => loadFunctions(true), 300); };

  function openFn(i) {
    const b = fnItems[i]; if (!b) return;
    const row = (k, v) => `<div class="bh-row"><span>${k}</span><b style="text-align:right;">${v}</b></div>`;
    $('fn-drawer-body').innerHTML = `
      <h3 class="bh-d-title">${esc(b.title)}</h3>
      <div style="margin:8px 0 6px;">${b.closed ? `<span class="badge badge-closed" title="${esc(CLOSED_HINT)}">Đã đóng</span>` : '<span class="badge badge-green">Đang mở</span>'}</div>
      ${row('Team / Dự án', esc(b.team || b.project || '-'))}
      ${row('Module', esc(b.module_name || b.module || 'Chưa rõ'))}
      ${row('Phân loại', esc(b.category || '-'))}
      ${row('Ngày tạo', esc((b.date || '').slice(0, 16) || '-'))}
      ${row('Trạng thái', esc(b.status_label || bhStatusLabel(b.status)))}
      ${row('Độ ưu tiên', esc(b.priority_label || BUG_PRIORITY[b.priority] || '-'))}
      ${row('Người thực hiện', esc(b.assignee || '-'))}
      ${row('Người duyệt', esc(b.approver || 'Chưa có'))}
      ${row('Cập nhật lần cuối', esc((b.updated || '').slice(0, 16) || '-'))}
      <p style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">Mở task trên Haraworks ↗</a>
        <button type="button" class="btn btn-outline" id="fn-check-build-btn">🔍 Kiểm tra đợt build</button></p>
      <div id="fn-build-check" class="build-check-box" hidden></div>
      <div id="fn-detail" style="margin-top:10px;color:var(--text-subtle);">Đang tải chi tiết và bình luận từ Haraworks...</div>`;
    $('fn-check-build-btn')?.addEventListener('click', () => checkBuildsIntoBox($('fn-build-check'), b.id, b.title));
    $('fn-drawer').classList.add('open');
    loadFnDetail(b.id);
  }
  function closeFn() { $('fn-drawer')?.classList.remove('open'); }

  async function checkBuildsIntoBox(box, id, title) {
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<span style="color:var(--text-subtle);">Đang kiểm tra các đợt Build App Mobile &amp; Build Task Function...</span>';
    try {
      const qs = new URLSearchParams({ id: id || '', title: title || '' });
      const res = await fetch(`${API_BASE}/builds/check?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `Lỗi ${res.status}`);
      const d = json.data || { appBuilds: [], functionBuilds: [], total: 0 };
      if (!d.total) {
        box.innerHTML = '<b>Kết quả kiểm tra đợt build:</b> <span style="color:var(--text-subtle);">Chưa nằm trong đợt Build App Mobile hay Build Task Function nào.</span>';
        return;
      }
      const renderGroup = (label, badgeStyle, list) => !list.length ? '' : `
        <div style="margin-top:6px;">
          <span class="bh-mod" style="${badgeStyle}">${esc(label)} (${list.length})</span>
          <div style="margin-top:4px;">${list.map(it => `
            <div class="build-check-item">
              <div style="min-width:0;flex:1;">
                <a href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener" style="font-weight:600;color:var(--primary);text-decoration:none;">${esc(it.title)} ↗</a>
                <div style="font-size:11px;color:var(--text-subtle);">${esc(it.status_label || '')}${it.date ? ' · ' + esc(shortDate(it.date)) : ''}${it.assignee ? ' · ' + esc(it.assignee) : ''}</div>
              </div>
            </div>`).join('')}</div>
        </div>`;
      box.innerHTML = '<b>Đã nằm trong đợt build:</b>' +
        renderGroup('Build App Mobile', '--label-color:#2563eb;--label-bg:#eff6ff', d.appBuilds || []) +
        renderGroup('Build Task Function', '--label-color:#9333ea;--label-bg:#faf5ff', d.functionBuilds || []);
    } catch (e) {
      box.innerHTML = `<span style="color:var(--danger);">Không kiểm tra được đợt build: ${esc(e.message)}</span>`;
    }
  }

  async function loadFnDetail(id) {
    const box = $('fn-detail'); if (!box) return;
    try {
      const res = await fetch(`${API_BASE}/functions/${encodeURIComponent(id)}/detail`);
      let j = null; try { j = await res.json(); } catch {}
      if ($('fn-detail') !== box) return;
      if (!res.ok) { box.innerHTML = `<div class="alert-box alert-amber" style="font-size:12px;">${esc(j?.error?.message || ('Không lấy được chi tiết (lỗi ' + res.status + ')'))}</div>`; return; }
      const d = j.data, row = (k, v) => `<div class="bh-row"><span>${k}</span><b style="text-align:right;">${v}</b></div>`;
      const logs = d.logs.slice().sort((x, y) => String(y.at).localeCompare(String(x.at))).map(l => `<li><b>${esc(l.by || '-')}</b>: ${esc(LOG_TYPE[l.type] || ('Thay đổi (mã ' + l.type + ')'))}${l.info.Project ? ': ' + esc(l.info.Project) : ''}${l.reason ? ' · ' + esc(l.reason) : ''}<br><span style="color:var(--text-muted);">${vnTime(l.at)}</span></li>`).join('');
      const cm = d.comments.items.map(c => `<div class="bh-comment"><b>${esc(c.by || '-')}</b> <span style="color:var(--text-muted);font-size:11px;">${vnTime(c.at)}</span>
        <div style="white-space:pre-wrap;">${esc(c.text)}</div>${mediaHtml([...(c.media || []), ...c.attachments])}
        ${c.replies.map(r => `<div class="bh-reply"><b>${esc(r.by || '-')}</b> <span style="color:var(--text-muted);font-size:11px;">${vnTime(r.at)}</span><div style="white-space:pre-wrap;">${esc(r.text)}</div></div>`).join('')}</div>`).join('');
      const childsHtml = (d.childs || []).length ? `<h4 style="margin:10px 0 4px;">Task con (${d.childs.length})</h4><div style="display:flex;flex-direction:column;gap:4px;">${d.childs.map(ch => `
        <div style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface-alt);font-size:12px;">
          <a href="${esc(safeUrl(ch.url))}" target="_blank" rel="noopener" style="font-weight:600;color:var(--primary);text-decoration:none;">${esc(ch.name)} ↗</a>
          <div style="font-size:11px;color:var(--text-subtle);margin-top:2px;">
            ${ch.status != null ? `<span class="bh-st bh-st-${statusClass(ch.status)}">${esc(bhStatusLabel(ch.status))}</span>` : ''}
            ${ch.assignee ? ' · ' + esc(ch.assignee) : ''}
          </div>
        </div>`).join('')}</div>` : '';
      box.style.color = '';
      box.innerHTML = `<h4 style="margin:6px 0;">Chi tiết từ Haraworks</h4>
        ${d.status != null ? row('Trạng thái (Haraworks)', esc(bhStatusLabel(d.status))) : ''}
        ${d.code ? row('Mã', esc(d.code)) : ''}${row('Người tạo', esc(d.created_by?.name || '-'))}${row('Người thực hiện', d.assignee ? esc(d.assignee.name) + (d.assignee.dept ? ' · ' + esc(d.assignee.dept) : '') : '-')}
        ${row('Chủ sở hữu', esc(d.owner?.name || '-'))}${d.supporters.length ? row('Người hỗ trợ', names(d.supporters)) : ''}${row('Người theo dõi (' + d.followers.length + ')', names(d.followers))}
        ${row('Hạn thực hiện', vnTime(d.plan_end_at))}${row('Độ ưu tiên', esc(BUG_PRIORITY[d.priority] || (d.priority ?? '-')))}${row('Cập nhật gần nhất', vnTime(d.updated_at) + (d.updated_by?.name ? ' · ' + esc(d.updated_by.name) : ''))}
        ${d.project ? row('Dự án', esc(d.project)) : ''}
        ${d.description || (d.description_media || []).length ? `<h4 style="margin:10px 0 4px;">Mô tả</h4><div style="white-space:pre-wrap;font-size:12px;">${esc(d.description)}</div>${mediaHtml(d.description_media)}` : ''}
        ${d.attachments.length ? `<h4 style="margin:10px 0 4px;">File đính kèm (${d.attachments.length})</h4>${mediaHtml(d.attachments)}` : ''}
        ${childsHtml}
        <h4 style="margin:10px 0 4px;">Lịch sử cập nhật (${d.logs.length})</h4>${logs ? `<ul class="bh-logs">${logs}</ul>` : '<div style="color:var(--text-muted);">Không có.</div>'}
        <h4 style="margin:10px 0 4px;">Bình luận (${d.comments.total})</h4>${cm || '<div style="color:var(--text-muted);">Chưa có bình luận.</div>'}`;
    } catch (e) { if ($('fn-detail') === box) box.textContent = 'Không lấy được chi tiết: ' + e.message; }
  }

  async function checkFnLive() {
    if (document.hidden || !$('pane-function-tasks')?.classList.contains('active')) return;
    try {
      const { data } = await (await fetch(`${API_BASE}/functions/live`)).json();
      const when = data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('vi-VN') : '';
      const badge = $('fn-live');
      if (!badge) return;
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
        why = 'Hệ thống đồng bộ mỗi 30 giây.' + (when ? ' Đồng bộ lần cuối: ' + when + '.' : '');
      }
      badge.className = 'badge ' + cls; badge.textContent = text; badge.title = why;
      if (fnLiveRev !== null && data.revision !== fnLiveRev) { await loadFnFacets(true); await loadFunctions(true, true); }
      fnLiveRev = data.revision;
    } catch {}
  }

  async function refreshFnLiveNow() {
    if (fnLiveRefreshRunning) return;
    fnLiveRefreshRunning = true;
    const button = $('fn-refresh'), status = $('fn-refresh-status');
    button.disabled = true;
    button.classList.add('is-syncing');
    status.className = 'bh-refresh-status';
    status.textContent = 'Đang đồng bộ realtime từ 4 dự án Team...';
    try {
      const readStatus = async response => {
        let json = {};
        try { json = await response.json(); } catch {}
        if (!response.ok) throw new Error(json.error?.message || `Lỗi ${response.status}`);
        return json.data || {};
      };
      const before = await readStatus(await fetch(`${API_BASE}/functions/live`));
      if (!before.enabled) throw new Error('Server chưa cấu hình cookie Haraworks nên không thể đồng bộ realtime.');
      await readStatus(await fetch(`${API_BASE}/functions/live/refresh`, { method: 'POST' }));
      const deadline = Date.now() + 90000;
      let completedPolls = 0;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 400));
        const data = await readStatus(await fetch(`${API_BASE}/functions/live`));
        if (!data.syncing && data.error) throw new Error(data.error);
        if (!data.syncing && data.lastSyncAt !== before.lastSyncAt) {
          completedPolls++;
          if (completedPolls >= 2) {
            fnLiveRev = data.revision;
            await loadFnFacets(true);
            await loadFunctions(true, true);
            await checkFnLive();
            status.className = 'bh-refresh-status is-success';
            status.textContent = 'Đồng bộ hoàn tất.';
            return;
          }
        } else completedPolls = 0;
      }
      throw new Error('Quá thời gian chờ đồng bộ task Function.');
    } catch (e) {
      status.className = 'bh-refresh-status is-error';
      status.textContent = `Không đồng bộ được: ${e.message}`;
    } finally {
      fnLiveRefreshRunning = false;
      button.disabled = false;
      button.classList.remove('is-syncing');
    }
  }

  // ---------- Logic Theo Dõi Build / Release ----------
  let bdPage = 1, bdTotal = 0, bdFacetsLoaded = false, bdTimer, bdItems = [], bdLiveRev = null, bdLiveRefreshRunning = false;
  const BUILD_KIND_STYLE = {
    app: '--label-color:#2563eb;--label-bg:#eff6ff',
    function: '--label-color:#9333ea;--label-bg:#faf5ff'
  };
  function bdCard(b, idx) {
    const priority = Number(b.priority);
    const priorityLabel = b.priority_label || BUG_PRIORITY[priority] || 'Chưa xác định';
    const flagClass = priority >= 1 && priority <= 2 ? 'bh-pr-high' : priority === 3 ? 'bh-pr-mid' : 'bh-pr-low';
    const status = b.status == null ? null : Number(b.status);
    const statusText = status == null ? 'Mới' : (b.status_label || bhStatusLabel(status));
    const statusClassName = status == null ? 'bh-st-new' : `bh-st-${statusClass(status)}`;
    const rowTeam = b.source_team || b.project;
    const rowSt = teamRowStyle(rowTeam);
    return `<article class="bh-card${b.closed ? ' is-closed' : ''}" data-idx="${idx}" tabindex="0"${rowSt} title="${rowTeam ? 'Dự án: ' + esc(rowTeam) : ''}">
      <span class="bh-mod" title="${esc(b.module || b.kind_label || 'Module')}"${labelColorStyle('module', b.module || '')}>${esc(b.module || '—')}</span>
      <span class="bh-priority ${flagClass}" title="Độ ưu tiên: ${esc(priorityLabel)}" aria-label="Độ ưu tiên: ${esc(priorityLabel)}">${FLAG_SVG}</span>
      <span class="bh-card-title" title="${esc(b.title)}">${esc(b.title)}</span>
      <span class="bh-st ${statusClassName}" title="Trạng thái"${labelColorStyle('status', status == null ? '' : status)}>${esc(statusText)}</span>
      <span class="bh-cell" title="Người duyệt">${esc(b.approver || '—')}</span>
      <span class="bh-cell" title="Người thực hiện">${esc(b.assignee || '—')}</span>
      <span class="bh-cell bh-date" title="Ngày tạo">${esc(shortDate(b.date) || '—')}</span>
    </article>`;
  }

  async function loadBuildFacets(force) {
    if (bdFacetsLoaded && !force) return;
    try {
      const { data } = await (await fetch(`${API_BASE}/builds/meta`)).json();
      bdFacetsLoaded = true;
      const f = data.facets || {};
      if ($('bd-total')) $('bd-total').textContent = `${data.count || 0} đợt build`;
      const fill = (id, html) => { const sel = $(id); if (!sel) return; const keep = sel.value; sel.innerHTML = sel.options[0].outerHTML + html; sel.value = keep; };
      fill('bd-project', Object.entries(f.projects || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      fill('bd-st', Object.entries(f.statuses || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(bhStatusLabel(+k))} (${n})</option>`).join(''));
      fill('bd-as', Object.entries(f.assignees || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<option value="${esc(k)}">${esc(k)} (${n})</option>`).join(''));
      fill('bd-year', Object.keys(f.years || {}).sort().reverse().map(y => `<option>${esc(y)}</option>`).join(''));
    } catch {}
  }

  function bdQuery() {
    return new URLSearchParams({
      kind: $('bd-kind')?.value || '', project: $('bd-project')?.value || '', q: ($('bd-q')?.value || '').trim(),
      status: $('bd-st')?.value || '', closed: $('bd-cl')?.value || '',
      assignee: $('bd-as')?.value || '', year: $('bd-year')?.value || '',
      sort: $('bd-sort')?.value || 'created'
    });
  }

  async function loadBuilds(reset, keepPaging) {
    if (!$('bd-list')) return;
    if (reset) { if (!keepPaging) bdPage = 1; bdItems = []; $('bd-list').innerHTML = ''; }
    let labelWarning = '';
    try {
      try { await refreshLabelColors(); } catch (e) { labelWarning = ` · Không tải được màu nhãn: ${e.message}`; }
      const offset = (bdPage - 1) * PAGE_SIZE;
      const qs = bdQuery(); qs.set('offset', offset); qs.set('limit', PAGE_SIZE);
      const res = await fetch(`${API_BASE}/builds?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `Lỗi ${res.status}`);
      const data = json.data;
      bdTotal = data.total;
      const pages = Math.max(1, Math.ceil(bdTotal / PAGE_SIZE));
      if (bdPage > pages) { bdPage = pages; return loadBuilds(true, true); }
      bdItems = data.items;
      $('bd-list').innerHTML = data.items.map((b, k) => bdCard(b, k)).join('');
      const first = bdTotal ? offset + 1 : 0;
      $('bd-count').textContent = (bdTotal ? `Hiển thị ${first}–${offset + data.items.length} trên ${bdTotal} đợt build` : 'Chưa có đợt build nào khớp bộ lọc.') + labelWarning;
      renderPagination($('bd-page-nav'), $('bd-page-info'), bdPage, pages, p => { bdPage = p; loadBuilds(true, true); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    } catch (e) {
      $('bd-count').textContent = 'Không tải được danh sách đợt build: ' + e.message;
      $('bd-page-info').textContent = '';
      if ($('bd-page-nav')) $('bd-page-nav').innerHTML = '';
    }
  }
  const reloadBuilds = () => { clearTimeout(bdTimer); bdTimer = setTimeout(() => loadBuilds(true), 300); };

  function openBd(i) {
    const b = bdItems[i]; if (!b) return;
    const row = (k, v) => `<div class="bh-row"><span>${k}</span><b style="text-align:right;">${v}</b></div>`;
    $('bd-drawer-body').innerHTML = `
      <h3 class="bh-d-title">${esc(b.title)}</h3>
      <div style="margin:8px 0 6px;">${b.closed ? `<span class="badge badge-closed" title="${esc(CLOSED_HINT)}">Đã đóng</span>` : '<span class="badge badge-green">Đang mở</span>'}</div>
      ${row('Loại build', esc(b.kind_label || '-'))}
      ${row('Dự án', esc(b.project || '-'))}
      ${row('Team / Dự án nguồn', esc(b.source_team || '-'))}
      ${row('Task Function nguồn', b.source_function ? `<a href="${esc(safeUrl(b.source_function.url))}" target="_blank" rel="noopener">${esc(b.source_function.title)}</a>` : '<i style="color:var(--text-muted);">Không tìm thấy liên kết</i>')}
      ${row('Ngày tạo', esc((b.date || '').slice(0, 16) || '-'))}
      ${row('Trạng thái', esc(b.status_label || bhStatusLabel(b.status)))}
      ${row('Độ ưu tiên', esc(b.priority_label || BUG_PRIORITY[b.priority] || '-'))}
      ${row('Người thực hiện', esc(b.assignee || '-'))}
      ${row('Cập nhật lần cuối', esc((b.updated || '').slice(0, 16) || '-'))}
      <p style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;"><a href="${esc(safeUrl(b.url))}" target="_blank" rel="noopener">Mở đợt build trên Haraworks ↗</a></p>
      <div id="bd-detail" style="margin-top:10px;color:var(--text-subtle);">Đang tải chi tiết và bình luận từ Haraworks...</div>`;
    $('bd-drawer').classList.add('open');
    loadBdDetail(b.id);
  }
  function closeBd() { $('bd-drawer')?.classList.remove('open'); }

  async function loadBdDetail(id) {
    const box = $('bd-detail'); if (!box) return;
    try {
      const res = await fetch(`${API_BASE}/builds/${encodeURIComponent(id)}/detail`);
      let j = null; try { j = await res.json(); } catch {}
      if ($('bd-detail') !== box) return;
      if (!res.ok) { box.innerHTML = `<div class="alert-box alert-amber" style="font-size:12px;">${esc(j?.error?.message || ('Không lấy được chi tiết (lỗi ' + res.status + ')'))}</div>`; return; }
      const d = j.data, row = (k, v) => `<div class="bh-row"><span>${k}</span><b style="text-align:right;">${v}</b></div>`;
      const logs = d.logs.slice().sort((x, y) => String(y.at).localeCompare(String(x.at))).map(l => `<li><b>${esc(l.by || '-')}</b>: ${esc(LOG_TYPE[l.type] || ('Thay đổi (mã ' + l.type + ')'))}${l.info.Project ? ': ' + esc(l.info.Project) : ''}${l.reason ? ' · ' + esc(l.reason) : ''}<br><span style="color:var(--text-muted);">${vnTime(l.at)}</span></li>`).join('');
      const cm = d.comments.items.map(c => `<div class="bh-comment"><b>${esc(c.by || '-')}</b> <span style="color:var(--text-muted);font-size:11px;">${vnTime(c.at)}</span>
        <div style="white-space:pre-wrap;">${esc(c.text)}</div>${mediaHtml([...(c.media || []), ...c.attachments])}
        ${c.replies.map(r => `<div class="bh-reply"><b>${esc(r.by || '-')}</b> <span style="color:var(--text-muted);font-size:11px;">${vnTime(r.at)}</span><div style="white-space:pre-wrap;">${esc(r.text)}</div></div>`).join('')}</div>`).join('');
      box.style.color = '';
      box.innerHTML = `<h4 style="margin:6px 0;">Chi tiết từ Haraworks</h4>
        ${d.status != null ? row('Trạng thái (Haraworks)', esc(bhStatusLabel(d.status))) : ''}
        ${row('Người tạo', esc(d.created_by?.name || '-'))}${row('Người thực hiện', d.assignee ? esc(d.assignee.name) : '-')}
        ${row('Hạn thực hiện', vnTime(d.plan_end_at))}${row('Cập nhật gần nhất', vnTime(d.updated_at) + (d.updated_by?.name ? ' · ' + esc(d.updated_by.name) : ''))}
        ${d.description || (d.description_media || []).length ? `<h4 style="margin:10px 0 4px;">Mô tả (Danh sách Bug / Function)</h4><div style="white-space:pre-wrap;font-size:12px;">${esc(d.description)}</div>${mediaHtml(d.description_media)}` : ''}
        ${d.attachments.length ? `<h4 style="margin:10px 0 4px;">File đính kèm (${d.attachments.length})</h4>${mediaHtml(d.attachments)}` : ''}
        <h4 style="margin:10px 0 4px;">Lịch sử cập nhật (${d.logs.length})</h4>${logs ? `<ul class="bh-logs">${logs}</ul>` : '<div style="color:var(--text-muted);">Không có.</div>'}
        <h4 style="margin:10px 0 4px;">Bình luận (${d.comments.total})</h4>${cm || '<div style="color:var(--text-muted);">Chưa có bình luận.</div>'}`;
    } catch (e) { if ($('bd-detail') === box) box.textContent = 'Không lấy được chi tiết: ' + e.message; }
  }

  async function checkBdLive() {
    if (document.hidden || !$('pane-builds')?.classList.contains('active')) return;
    try {
      const { data } = await (await fetch(`${API_BASE}/builds/live`)).json();
      const when = data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString('vi-VN') : '';
      const badge = $('bd-live');
      if (!badge) return;
      let cls, text, why;
      if (!data.enabled) {
        cls = 'badge-amber'; text = '● Chưa realtime';
        why = 'Chưa có cookie Haraworks trên server.' + (when ? ' Bản gần nhất: ' + when : '');
      } else if (data.error) {
        cls = 'badge-red'; text = '● Lỗi đồng bộ';
        why = data.error.slice(0, 160);
      } else if (data.realtime === 'connected') {
        cls = 'badge-green'; text = '● Realtime';
        why = 'Cập nhật realtime từ Haraworks.' + (when ? ' Đồng bộ lần cuối: ' + when : '');
      } else {
        cls = 'badge-amber'; text = '● Cập nhật mỗi 30 giây';
        why = 'Đồng bộ mỗi 30 giây.' + (when ? ' Đồng bộ lần cuối: ' + when : '');
      }
      badge.className = 'badge ' + cls; badge.textContent = text; badge.title = why;
      if (bdLiveRev !== null && data.revision !== bdLiveRev) { await loadBuildFacets(true); await loadBuilds(true, true); }
      bdLiveRev = data.revision;
    } catch {}
  }

  async function refreshBdLiveNow() {
    if (bdLiveRefreshRunning) return;
    bdLiveRefreshRunning = true;
    const button = $('bd-refresh'), status = $('bd-refresh-status');
    button.disabled = true;
    button.classList.add('is-syncing');
    status.className = 'bh-refresh-status';
    status.textContent = 'Đang đồng bộ realtime các đợt build...';
    try {
      const readStatus = async response => {
        let json = {}; try { json = await response.json(); } catch {}
        if (!response.ok) throw new Error(json.error?.message || `Lỗi ${response.status}`);
        return json.data || {};
      };
      const before = await readStatus(await fetch(`${API_BASE}/builds/live`));
      if (!before.enabled) throw new Error('Server chưa cấu hình cookie Haraworks.');
      await readStatus(await fetch(`${API_BASE}/builds/live/refresh`, { method: 'POST' }));
      const deadline = Date.now() + 90000;
      let completedPolls = 0;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 400));
        const data = await readStatus(await fetch(`${API_BASE}/builds/live`));
        if (!data.syncing && data.error) throw new Error(data.error);
        if (!data.syncing && data.lastSyncAt !== before.lastSyncAt) {
          completedPolls++;
          if (completedPolls >= 2) {
            bdLiveRev = data.revision;
            await loadBuildFacets(true);
            await loadBuilds(true, true);
            await checkBdLive();
            status.className = 'bh-refresh-status is-success';
            status.textContent = 'Đồng bộ hoàn tất.';
            return;
          }
        } else completedPolls = 0;
      }
      throw new Error('Quá thời gian chờ đồng bộ.');
    } catch (e) {
      status.className = 'bh-refresh-status is-error';
      status.textContent = `Không đồng bộ được: ${e.message}`;
    } finally {
      bdLiveRefreshRunning = false;
      button.disabled = false;
      button.classList.remove('is-syncing');
    }
  }
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

  function fillModules(list) {
    if (modsFilled || !list.length) return;
    modsFilled = true;
    modules = list;
    $('br-module').innerHTML = '<option value="">Tất cả module</option>' + list.filter(m => !m.cluster || (m.flows && m.flows.length)).sort((a, b) => a.code.localeCompare(b.code))
      .map(m => `<option value="${esc(m.code)}">${esc(m.code)} · ${esc(m.name)}${m.cluster ? ' (cụm ' + esc(m.cluster) + ')' : ''}</option>`).join('');
  }

  async function load() {
    const qs = new URLSearchParams({ module: $('br-module').value, q: $('br-q').value.trim() });
    try {
      const { data } = await (await fetch(`${API_BASE}/business-rules?${qs}`)).json();
      const moduleList = data.modules || [];
      let labelWarning = '';
      fillModules(moduleList);
      try { await refreshLabelColors(); } catch (e) { labelWarning = ` · Không tải được màu nhãn: ${e.message}`; }
      current = data.rules;
      $('br-add').style.display = canEdit() ? '' : 'none';
      if (data.artifact_url) $('br-open-kb').href = data.artifact_url;
      $('br-synced').textContent = data.synced_at ? `Bản ${data.revision}, đồng bộ từ Kho lúc ${new Date(data.synced_at).toLocaleString('vi-VN')}.` : 'Chưa đồng bộ: chạy node scripts/qa-sync.mjs';
      $('br-count').textContent = `${data.rules.length} rule${labelWarning}`;
      const byModule = new Map();
      data.rules.forEach(rule => {
        const code = rule.module || '';
        if (!byModule.has(code)) byModule.set(code, []);
        byModule.get(code).push(rule);
      });
      $('br-list').innerHTML = [...byModule.entries()].sort((a, b) => {
        const nameA = moduleList.find(m => m.code === a[0])?.name || a[0];
        const nameB = moduleList.find(m => m.code === b[0])?.name || b[0];
        return nameA.localeCompare(nameB, 'vi');
      }).map(([code, rules]) => {
        const module = moduleList.find(m => m.code === code);
        const name = module?.name || code || 'Module chưa phân loại';
        return `<section class="br-module-group">
          <h3 class="br-module-heading"${labelColorStyle('module', code)}><span>${esc(name)}</span><small>${esc(code)}</small><span class="badge">${rules.length}</span></h3>
          ${rules.map(r => card(r, data.artifact_url)).join('')}
        </section>`;
      }).join('');
    } catch (e) { $('br-count').textContent = 'Không tải được rule: ' + e.message; }
  }

  function card(r, kb) {
    const ed = canEdit();
    const addedAt = r.created_at || r.approved_at || r.source?.doc_date || '';
    const fmtDate = d => {
      if (!d) return '';
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d).trim());
      if (m) return `${m[3]}/${m[2]}/${m[1]}`;
      return !Number.isNaN(Date.parse(d)) ? new Date(d).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : String(d);
    };
    const addedDate = fmtDate(addedAt);
    const sourceDate = fmtDate(r.source?.doc_date || '');
    return `
      <details class="br-rule">
        <summary><span class="br-rule-title"><strong>${esc(r.rule_id)}</strong>${r.version > 1 ? ' v' + r.version : ''} · ${esc(r.title)}</span><span class="badge badge-blue">${esc(r.flow_name)}</span>${addedDate ? `<span class="badge" style="background:var(--surface-alt);color:var(--text-subtle);border:1px solid var(--border);" title="Ngày thêm rule">📅 ${esc(addedDate)}</span>` : ''}
          ${r.local === 'created' ? ' <span class="badge badge-green">Tạo trên platform</span>' : r.local === 'edited' ? ' <span class="badge badge-green">Sửa trên platform</span>' : ''}</summary>
        <p style="font-size:12px;margin:6px 0;white-space:pre-line;">${esc(r.description)}</p>
        <div style="font-size:11px;color:var(--text-subtle);">Vai trò: ${esc((Array.isArray(r.user_roles) ? r.user_roles : (r.user_roles ? [r.user_roles] : [])).join(', ') || 'Chưa ghi')} · ${esc(r.setting_label || r.setting_type || '')}${r.config_path ? ' · ' + esc(r.config_path) : ''}
          ${addedDate ? ` · Ngày thêm: ${esc(addedDate)}` : sourceDate ? ` · Ngày trong tài liệu: ${esc(sourceDate)}` : ''}
          ${r.local === 'created' ? '' : ` · <a href="${esc(kb)}#rule-${esc(r.rule_id)}" target="_blank" rel="noopener">Mở trong kho</a>`}
          ${r.edited_by ? ` · sửa bởi ${esc(r.edited_by)}` : ''}</div>
        ${ed ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn btn-outline" data-act="edit" data-id="${esc(r.rule_id)}">Sửa</button>
          <button class="btn btn-outline" style="color:var(--danger);" data-act="del" data-id="${esc(r.rule_id)}">Xóa</button></div>` : ''}
      </details>`;
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
    const roots = modules.filter(m => !m.cluster || (m.flows && m.flows.length)).sort((a, b) => a.code.localeCompare(b.code));
    $('rf-module').innerHTML = roots.map(m => `<option value="${esc(m.code)}">${esc(m.code)} · ${esc(m.name)}${m.cluster ? ' (cụm ' + esc(m.cluster) + ')' : ''}</option>`).join('');
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
    $('rf-roles').value = creating ? '' : (Array.isArray(rule.user_roles) ? rule.user_roles : (rule.user_roles ? [rule.user_roles] : [])).join('\n');
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
        if (!confirm(`Xóa hẳn rule ${id} khỏi platform? Rule từ Kho sẽ không xuất hiện lại sau khi đồng bộ.`)) return;
        await call('DELETE', `/business-rules/${encodeURIComponent(id)}`); await load();
      }
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
    $('br-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    $('br-list').addEventListener('click', onAction);
    $('br-add').addEventListener('click', () => openForm(null));
    $('rf-save').addEventListener('click', save);
    document.addEventListener('qa-label-colors-updated', () => {
      if ($('pane-business-rules').classList.contains('active')) load();
    });
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

  function openResetPassword(u) {
    $('tk-title').textContent = `Đổi mật khẩu / Mã nhân viên: ${u.display_name}`;
    if ($('pw-uid')) $('pw-uid').value = u.id;
    if ($('pw-username')) $('pw-username').value = u.username || '';
    if ($('pw-emp-code')) $('pw-emp-code').value = u.employee_code || '';
    $('tk-value').value = '';
    if ($('pw-msg')) $('pw-msg').textContent = '';
    document.getElementById('modal-token').classList.add('open');
  }

  async function saveNewPassword() {
    const uid = $('pw-uid')?.value;
    const username = $('pw-username')?.value.trim();
    const employee_code = $('pw-emp-code')?.value.trim();
    const password = $('tk-value').value;
    const errEl = $('pw-msg');
    if (!uid) return;
    if (password && password.length < 4) { if (errEl) errEl.textContent = 'Mật khẩu mới phải từ 4 ký tự trở lên.'; return; }
    try {
      const r = await call('POST', `/team/users/${encodeURIComponent(uid)}/reset-password`, { username, password, employee_code });
      if (r && r.token && uid === me?.id) {
        setStoredToken(r.token);
      }
      closeModals();
      msg('Đã cập nhật tài khoản và thông tin.');
      await load();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
    }
  }

  async function load() {
    try {
      users = await call('GET', '/team/users');
      $('u-head').innerHTML = '<th>Người dùng</th><th>Tài khoản (Username)</th><th>Vai trò</th>' + PERMS.map(p => `<th style="font-size:10.5px;">${esc(p[1])}</th>`).join('') + '<th>Thao tác</th>';
      $('u-body').innerHTML = users.map(u => {
        const admin = u.role === 'admin', off = !u.is_active;
        return `<tr data-id="${esc(u.id)}" style="${off ? 'opacity:.5;' : ''}">
          <td><strong>${esc(u.display_name)}</strong>${u.is_me ? ' <span class="badge badge-blue">bạn</span>' : ''}${off ? ' <span class="badge badge-red">đã thu hồi</span>' : ''}<div style="font-size:10.5px;color:var(--text-subtle);">${esc(u.id)}</div></td>
          <td><code>${esc(u.username || u.display_name.toLowerCase())}</code></td>
          <td><select class="form-control u-role" ${off ? 'disabled' : ''}><option value="member" ${admin ? '' : 'selected'}>Thành viên</option><option value="admin" ${admin ? 'selected' : ''}>Quản trị viên</option></select></td>
          ${PERMS.map(p => `<td style="text-align:center;"><input type="checkbox" class="u-perm" data-p="${p[0]}" ${admin || (u.perms || []).includes(p[0]) ? 'checked' : ''} ${admin || off ? 'disabled' : ''}></td>`).join('')}
          <td style="white-space:nowrap;">${off ? '' : `<button class="btn btn-primary u-save">Lưu</button>
            <button class="btn btn-outline u-reset">Đổi mật khẩu</button>
            <button class="btn btn-outline u-revoke" style="color:var(--danger);" ${u.is_me ? 'disabled' : ''}>Thu hồi</button>`}</td></tr>`;
      }).join('');
    } catch (e) { msg('Không tải được danh sách: ' + e.message, true); }
  }

  async function loadLabelSettings() {
    const status = $('label-colors-msg');
    $('label-colors-save').disabled = true;
    try {
      const data = await refreshLabelColors(true);
      const colorInput = (group, code, name, color) => `<label class="label-color-item"><span>${esc(name)} <small>${esc(code)}</small></span><input type="color" class="label-color-input" data-group="${group}" data-code="${esc(code)}" value="${/^#[0-9a-f]{6}$/i.test(color || '') ? color : '#315c8c'}" /></label>`;
      $('label-module-colors').innerHTML = data.modules.slice().sort((a, b) => a.code.localeCompare(b.code))
        .map(m => colorInput('module', m.code, m.name, data.colors.module[m.code] || '#315c8c')).join('');
      $('label-status-colors').innerHTML = data.statuses.map(s => colorInput('status', s.code, s.name, data.colors.status[s.code])).join('');
      $('label-colors-save').disabled = false;
      status.textContent = '';
    } catch (e) {
      status.style.color = 'var(--danger)';
      status.textContent = e.message;
    }
  }

  async function saveLabelSettings() {
    const status = $('label-colors-msg'), colors = { module: {}, status: {} };
    document.querySelectorAll('.label-color-input').forEach(input => { colors[input.dataset.group][input.dataset.code] = input.value; });
    if (!Object.keys(colors.status).length) {
      status.style.color = 'var(--danger)';
      status.textContent = 'Chưa tải được danh sách nhãn; hãy tải lại trang trước khi lưu.';
      return;
    }
    $('label-colors-save').disabled = true;
    try {
      await call('PUT', '/label-colors', { colors });
      await refreshLabelColors(true);
      status.style.color = 'var(--pastel-green-text)';
      status.textContent = 'Đã lưu màu nhãn.';
      document.dispatchEvent(new Event('qa-label-colors-updated'));
    } catch (e) {
      status.style.color = 'var(--danger)';
      status.textContent = e.message;
    } finally {
      $('label-colors-save').disabled = false;
    }
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
        openResetPassword(u);
      }
      if (e.target.closest('.u-revoke')) {
        if (!confirm(`Thu hồi ${u.display_name}? Người này không đăng nhập được nữa.`)) return;
        await call('POST', `/team/users/${encodeURIComponent(id)}/revoke`);
        msg(`Đã thu hồi ${u.display_name}.`); await load();
      }
    } catch (err) { msg(err.message, true); }
  }

  function openNew() {
    $('nu-name').value = '';
    if ($('nu-username')) $('nu-username').value = '';
    if ($('nu-password')) $('nu-password').value = '123456';
    if ($('nu-emp-code')) $('nu-emp-code').value = '';
    $('nu-role').value = 'member'; $('nu-msg').textContent = '';
    $('nu-perms').innerHTML = '<label class="form-label">Quyền (với thành viên):</label>' + PERMS.map(p => `<label style="display:flex;gap:6px;font-size:12px;"><input type="checkbox" class="nu-perm" data-p="${p[0]}"> ${esc(p[1])}</label>`).join('');
    document.getElementById('modal-newuser').classList.add('open');
  }

  async function createUser() {
    try {
      const role = $('nu-role').value;
      const perms = role === 'admin' ? [] : [...document.querySelectorAll('.nu-perm:checked')].map(c => c.dataset.p);
      const username = $('nu-username')?.value.trim() || '';
      const password = $('nu-password')?.value || '123456';
      const employee_code = $('nu-emp-code')?.value.trim() || '';
      const r = await call('POST', '/team/users', { name: $('nu-name').value, username, password, role, perms, employee_code });
      closeModals();
      msg(`Đã tạo tài khoản "${r.username}" cho ${r.display_name}.`);
      await load();
    } catch (e) { $('nu-msg').textContent = e.message; }
  }

  // Chỉ quản trị viên thấy tab này, và chỉ khi đã bật chế độ nhóm
  function applyVisibility() {
    const show = me && me.auth_required && me.role === 'admin';
    const permNav = $('st-nav-permissions');
    if (permNav) permNav.style.display = show ? '' : 'none';
    if (show) { load(); }
  }

  document.addEventListener('qa-me-ready', applyVisibility);
  document.addEventListener('DOMContentLoaded', () => {
    $('u-body')?.addEventListener('click', onClick);
    $('label-colors-save')?.addEventListener('click', saveLabelSettings);
    $('u-add')?.addEventListener('click', openNew);
    $('nu-save')?.addEventListener('click', createUser);
    $('tk-copy')?.addEventListener('click', saveNewPassword);
    { let opened = false; $('st-nav-permissions')?.addEventListener('click', () => { if (!opened) { opened = true; load(); } }); }
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
// Dashboard Cá Nhân (Jira Kanban, Gantt Chart, Analytics & 16:30 Daily Reminder)
// -----------------------------------------------------------
(function setupPersonalDashboard() {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');

  let dashboardData = null;
  let activeView = 'kanban';

  // Chuyển view: kanban, gantt, analytics
  let pwData = { todos: [], notes: [] };
  let pwTodoPendingLinks = [];
  let pwNotePendingLinks = [];
  let pwPickerTarget = 'todo'; // 'todo' | 'note'
  let pwPickerTimer = null;

  function renderPwPendingLinks(target) {
    const arr = target === 'todo' ? pwTodoPendingLinks : pwNotePendingLinks;
    const box = $(target === 'todo' ? 'pw-todo-pending-links' : 'pw-note-pending-links');
    if (!box) return;
    box.innerHTML = arr.map((t, i) => `
      <span class="st-rem-chip" style="font-size:11px;">
        <span class="badge badge-blue" style="font-size:9.5px;">${esc(t.taskType.toUpperCase())}</span>
        <span style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(t.title)}">${esc(t.title)}</span>
        <button type="button" class="linkbtn" data-pw-rm-link="${target}:${i}" style="color:var(--danger);font-weight:700;padding:0 2px;">✕</button>
      </span>`).join('');
    box.querySelectorAll('[data-pw-rm-link]').forEach(b => {
      b.onclick = () => {
        const [tg, idx] = b.dataset.pwRmLink.split(':');
        if (tg === 'todo') pwTodoPendingLinks.splice(Number(idx), 1);
        else pwNotePendingLinks.splice(Number(idx), 1);
        renderPwPendingLinks(tg);
      };
    });
  }

  function renderLinkedChipsHtml(links) {
    if (!Array.isArray(links) || !links.length) return '';
    return `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;">` + links.map(t => `
      <a href="${esc(safeUrl(t.url))}" target="_blank" rel="noopener" class="st-rem-chip" style="text-decoration:none;font-size:11px;color:var(--primary);" title="${esc(t.title)}">
        <span style="font-weight:700;font-size:9.5px;opacity:0.85;">[${esc(String(t.taskType || 'TASK').toUpperCase())}]</span>
        <span style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(t.title)}</span>
      </a>`).join('') + `</div>`;
  }

  function renderPersonalWorkspace() {
    const todoBox = $('pw-todo-list');
    const noteBox = $('pw-note-list');
    if ($('pw-todo-count')) $('pw-todo-count').textContent = `${pwData.todos.filter(t => !t.done).length} cần làm / ${pwData.todos.length}`;
    if ($('pw-note-count')) $('pw-note-count').textContent = `${pwData.notes.length} ghi chú`;

    if (todoBox) {
      if (!pwData.todos.length) {
        todoBox.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-subtle);font-size:12px;">Chưa có To-do nào. Hãy thêm việc cần làm ở trên!</div>';
      } else {
        todoBox.innerHTML = pwData.todos.map(td => `
          <div style="border:1px solid var(--border);border-radius:8px;padding:9px 11px;background:var(--surface);${td.done ? 'opacity:0.62;' : ''}">
            <div style="display:flex;align-items:flex-start;gap:8px;">
              <input type="checkbox" data-pw-toggle-todo="${esc(td.id)}" ${td.done ? 'checked' : ''} style="margin-top:3px;cursor:pointer;" />
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;${td.done ? 'text-decoration:line-through;color:var(--text-subtle);' : ''}">${esc(td.text)}</div>
                ${td.dueDate ? `<div style="font-size:11px;color:var(--text-subtle);margin-top:2px;">📅 Dự kiến: ${esc(td.dueDate)}</div>` : ''}
                ${renderLinkedChipsHtml(td.linkedTasks)}
              </div>
              <button type="button" class="linkbtn" data-pw-del-todo="${esc(td.id)}" style="color:var(--danger);font-size:12px;" title="Xóa To-do">✕</button>
            </div>
          </div>`).join('');
        todoBox.querySelectorAll('[data-pw-toggle-todo]').forEach(cb => {
          cb.onchange = async () => {
            const res = await fetch(`${API_BASE}/personal-workspace/todos`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: cb.dataset.pwToggleTodo, done: cb.checked })
            });
            if (res.ok) { pwData = (await res.json()).data; renderPersonalWorkspace(); }
          };
        });
        todoBox.querySelectorAll('[data-pw-del-todo]').forEach(b => {
          b.onclick = async () => {
            const res = await fetch(`${API_BASE}/personal-workspace/todos/${encodeURIComponent(b.dataset.pwDelTodo)}`, { method: 'DELETE' });
            if (res.ok) { pwData = (await res.json()).data; renderPersonalWorkspace(); }
          };
        });
      }
    }

    if (noteBox) {
      if (!pwData.notes.length) {
        noteBox.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-subtle);font-size:12px;">Chưa có ghi chú nào.</div>';
      } else {
        const sortedNotes = [...pwData.notes].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        noteBox.innerHTML = sortedNotes.map(nt => `
          <div style="border:1px solid ${nt.pinned ? '#f59e0b' : 'var(--border)'};border-radius:8px;padding:10px 12px;background:var(--surface);">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
              <strong style="font-size:13.5px;">${nt.pinned ? '📌 ' : ''}${esc(nt.title || 'Ghi chú')}</strong>
              <span style="display:flex;gap:8px;flex-shrink:0;font-size:11.5px;">
                <button type="button" class="linkbtn" data-pw-pin-note="${esc(nt.id)}" title="Ghim / Bỏ ghim">${nt.pinned ? 'Bỏ ghim' : 'Ghim'}</button>
                <button type="button" class="linkbtn" data-pw-edit-note="${esc(nt.id)}">Sửa</button>
                <button type="button" class="linkbtn" data-pw-del-note="${esc(nt.id)}" style="color:var(--danger);">Xóa</button>
              </span>
            </div>
            ${nt.content ? `<div style="font-size:12.5px;margin-top:5px;white-space:pre-wrap;line-height:1.45;">${esc(nt.content)}</div>` : ''}
            ${renderLinkedChipsHtml(nt.linkedTasks)}
          </div>`).join('');
        noteBox.querySelectorAll('[data-pw-pin-note]').forEach(b => {
          b.onclick = async () => {
            const nt = pwData.notes.find(x => x.id === b.dataset.pwPinNote);
            const res = await fetch(`${API_BASE}/personal-workspace/notes`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: nt.id, pinned: !nt.pinned })
            });
            if (res.ok) { pwData = (await res.json()).data; renderPersonalWorkspace(); }
          };
        });
        noteBox.querySelectorAll('[data-pw-edit-note]').forEach(b => {
          b.onclick = () => {
            const nt = pwData.notes.find(x => x.id === b.dataset.pwEditNote);
            if (!nt) return;
            $('pw-note-edit-id').value = nt.id;
            $('pw-note-title').value = nt.title || '';
            $('pw-note-content').value = nt.content || '';
            pwNotePendingLinks = [...(nt.linkedTasks || [])];
            renderPwPendingLinks('note');
            if ($('pw-note-cancel')) $('pw-note-cancel').style.display = '';
          };
        });
        noteBox.querySelectorAll('[data-pw-del-note]').forEach(b => {
          b.onclick = async () => {
            const res = await fetch(`${API_BASE}/personal-workspace/notes/${encodeURIComponent(b.dataset.pwDelNote)}`, { method: 'DELETE' });
            if (res.ok) { pwData = (await res.json()).data; renderPersonalWorkspace(); }
          };
        });
      }
    }
  }

  async function loadPersonalWorkspace() {
    try {
      const res = await fetch(`${API_BASE}/personal-workspace`);
      if (res.ok) {
        pwData = (await res.json()).data || { todos: [], notes: [] };
        renderPersonalWorkspace();
      }
    } catch {}
  }

  async function searchTasksForPicker(q = '') {
    const box = $('pw-picker-results');
    if (!box) return;
    box.innerHTML = '<div style="font-size:12px;color:var(--text-subtle);padding:10px;">Đang tìm kiếm...</div>';
    try {
      const res = await fetch(`${API_BASE}/personal-workspace/task-search?q=${encodeURIComponent(q)}`);
      const items = res.ok ? ((await res.json()).data || []) : [];
      if (!items.length) {
        box.innerHTML = '<div style="font-size:12px;color:var(--text-subtle);padding:12px;text-align:center;">Không tìm thấy task phù hợp.</div>';
        return;
      }
      const curArr = pwPickerTarget === 'todo' ? pwTodoPendingLinks : pwNotePendingLinks;
      box.innerHTML = items.map((t, i) => {
        const added = curArr.some(x => x.id === t.id);
        return `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 9px;border:1px solid var(--border);border-radius:7px;">
            <div style="min-width:0;flex:1;">
              <span class="badge badge-blue" style="font-size:9.5px;">${esc(t.typeLabel)}</span>
              <span style="font-size:12.5px;font-weight:600;margin-left:4px;">${esc(t.title)}</span>
              ${t.statusLabel ? `<span style="font-size:11px;color:var(--text-subtle);margin-left:6px;">(${esc(t.statusLabel)})</span>` : ''}
            </div>
            <button type="button" class="btn ${added ? 'btn-outline' : 'btn-primary'}" data-pw-pick-idx="${i}" style="padding:3px 9px;font-size:11.5px;flex-shrink:0;">${added ? 'Đã gắn ✓' : '+ Chọn'}</button>
          </div>`;
      }).join('');
      box.querySelectorAll('[data-pw-pick-idx]').forEach(btn => {
        btn.onclick = () => {
          const item = items[Number(btn.dataset.pwPickIdx)];
          const arr = pwPickerTarget === 'todo' ? pwTodoPendingLinks : pwNotePendingLinks;
          const existIdx = arr.findIndex(x => x.id === item.id);
          if (existIdx === -1) arr.push({ id: item.id, taskType: item.taskType, title: item.title, url: item.url });
          else arr.splice(existIdx, 1);
          renderPwPendingLinks(pwPickerTarget);
          searchTasksForPicker($('pw-picker-q')?.value || '');
        };
      });
    } catch {}
  }

  function openPwTaskPicker(target) {
    pwPickerTarget = target;
    if ($('pw-picker-q')) $('pw-picker-q').value = '';
    $('modal-pw-task-picker')?.classList.add('open');
    searchTasksForPicker('');
    setTimeout(() => $('pw-picker-q')?.focus(), 100);
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('pw-todo-link-btn')?.addEventListener('click', () => openPwTaskPicker('todo'));
    $('pw-note-link-btn')?.addEventListener('click', () => openPwTaskPicker('note'));
    $('pw-picker-q')?.addEventListener('input', (e) => {
      clearTimeout(pwPickerTimer);
      pwPickerTimer = setTimeout(() => searchTasksForPicker(e.target.value.trim()), 250);
    });
    $('pw-todo-add')?.addEventListener('click', async () => {
      const text = ($('pw-todo-text')?.value || '').trim();
      const dueDate = $('pw-todo-date')?.value || '';
      if (!text) return;
      const res = await fetch(`${API_BASE}/personal-workspace/todos`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, dueDate, linkedTasks: pwTodoPendingLinks })
      });
      if (res.ok) {
        pwData = (await res.json()).data;
        $('pw-todo-text').value = '';
        $('pw-todo-date').value = '';
        pwTodoPendingLinks = [];
        renderPwPendingLinks('todo');
        renderPersonalWorkspace();
      }
    });
    $('pw-note-save')?.addEventListener('click', async () => {
      const id = $('pw-note-edit-id')?.value || '';
      const title = ($('pw-note-title')?.value || '').trim();
      const content = ($('pw-note-content')?.value || '').trim();
      if (!title && !content) return;
      const res = await fetch(`${API_BASE}/personal-workspace/notes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id || undefined, title, content, linkedTasks: pwNotePendingLinks })
      });
      if (res.ok) {
        pwData = (await res.json()).data;
        $('pw-note-edit-id').value = '';
        $('pw-note-title').value = '';
        $('pw-note-content').value = '';
        pwNotePendingLinks = [];
        renderPwPendingLinks('note');
        if ($('pw-note-cancel')) $('pw-note-cancel').style.display = 'none';
        renderPersonalWorkspace();
      }
    });
    $('pw-note-cancel')?.addEventListener('click', () => {
      $('pw-note-edit-id').value = '';
      $('pw-note-title').value = '';
      $('pw-note-content').value = '';
      pwNotePendingLinks = [];
      renderPwPendingLinks('note');
      $('pw-note-cancel').style.display = 'none';
    });
  });

  function switchView(view) {
    activeView = view;
    document.querySelectorAll('.view-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('view-kanban-container').style.display = view === 'kanban' ? '' : 'none';
    $('view-gantt-container').style.display = view === 'gantt' ? '' : 'none';
    $('view-analytics-container').style.display = view === 'analytics' ? '' : 'none';
    if ($('view-personal-container')) $('view-personal-container').style.display = view === 'personal' ? '' : 'none';
    if (view === 'gantt') renderGantt();
    if (view === 'analytics') renderAnalytics();
    if (view === 'personal') loadPersonalWorkspace();
  }

  // Lấy dữ liệu dashboard từ API /my-tasks (có cache tức thì để mở trang nhanh)
  async function loadDashboard(manual = false) {
    const btn = $('btn-refresh-dashboard');
    const periodEl = $('db-filter-period');
    const period = periodEl?.value || 'week';
    const cacheKey = `qa_dash_${me?.id || 'local'}_${period}`;
    if (!manual && !dashboardData) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        if (cached) {
          dashboardData = cached;
          syncPeriodOptions(dashboardData.years || [], period);
          syncProjectOptions(dashboardData.projects || []);
          renderKPIs();
          renderKanban();
        }
      } catch {}
    }
    if (btn && manual) {
      btn.disabled = true;
      btn.innerHTML = '<span class="spin-icon">⟳</span>';
    }
    try {
      const res = await fetch(`${API_BASE}/my-tasks?period=${encodeURIComponent(period)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error?.message || 'Không thể tải dữ liệu dashboard cá nhân.');
      dashboardData = json.data;
      try { sessionStorage.setItem(cacheKey, JSON.stringify(dashboardData)); } catch {}
      syncPeriodOptions(dashboardData.years || [], period);
      syncProjectOptions(dashboardData.projects || []);
      renderKPIs();
      renderKanban();
      if (activeView === 'gantt') renderGantt();
      if (activeView === 'analytics') renderAnalytics();
      checkDaily1630Reminder();
    } catch (e) {
      console.warn('[dashboard] lỗi tải:', e.message);
      if (manual) {
        const sub = $('ov-subheading');
        if (sub) sub.innerHTML = `<span style="color:var(--danger);">Lỗi tải dữ liệu: ${esc(e.message)}</span>`;
      }
    } finally {
      if (btn && manual) {
        btn.disabled = false;
        btn.textContent = '⟳';
      }
    }
  }

  function syncPeriodOptions(years, selected) {
    const el = $('db-filter-period');
    if (!el) return;
    const base = [
      { v: 'week', l: 'Tuần này' },
      { v: 'month', l: 'Tháng này' },
      { v: '30d', l: '30 ngày gần đây' }
    ];
    const yearOpts = (years || []).map(y => ({ v: y, l: `Năm ${y}` }));
    const all = [...base, ...yearOpts, { v: 'all', l: 'Tất cả' }];
    el.innerHTML = all.map(o => `<option value="${esc(o.v)}"${o.v === selected ? ' selected' : ''}>${esc(o.l)}</option>`).join('');
  }

  function syncProjectOptions(projects) {
    const el = $('db-filter-project');
    if (!el) return;
    const keep = el.value;
    el.innerHTML = '<option value="">Tất cả dự án</option>' + (projects || []).map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    el.value = keep;
  }

  function filterList(arr) {
    const q = ($('kb-filter-q')?.value || '').toLowerCase().trim();
    const projectFilter = $('db-filter-project')?.value || '';
    const typeFilter = $('kb-filter-type')?.value || '';
    const statusFilter = $('kb-filter-status')?.value || '';
    return (arr || []).filter(t => {
      if (projectFilter && (t.project || t.team || '') !== projectFilter) return false;
      if (typeFilter && t.taskType !== typeFilter) return false;
      if (statusFilter === 'overdue' && !t.isOverdue) return false;
      if (statusFilter === 'dueToday' && !t.isDueToday) return false;
      if (statusFilter === 'missing' && (!t.missingFields || !t.missingFields.length)) return false;
      if (statusFilter === 'new24h' && !t.isAssigned24h) return false;
      if (q) {
        const str = `${t.title} ${t.module} ${t.moduleName} ${t.customer} ${t.project}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });
  }

  function getFilteredTasks() {
    return filterList(dashboardData?.tasks || []);
  }

  function renderAllViews() {
    renderKPIs();
    renderKanban();
    if (activeView === 'gantt') renderGantt();
    if (activeView === 'analytics') renderAnalytics();
  }

  function renderKPIs() {
    if (!dashboardData) return;
    const { user } = dashboardData;
    const list = getFilteredTasks();
    const isTodayNeed = (t) => t.isNeedToDoToday && !(t.taskType === 'release' && !t.startAt && !t.endAt);
    const needTodoList = list.filter(isTodayNeed);
    const overdue = list.filter(t => t.isOverdue).length;
    const dueToday = list.filter(t => t.isDueToday).length;
    const missing = list.filter(t => t.taskType === 'bug' && t.isMissingInfo).length;
    const assigned24h = list.filter(t => t.isAssigned24h).length;

    $('db-total').textContent = needTodoList.length;
    $('db-total-sub').textContent = `Trong hôm nay (Tổng lọc: ${list.length})`;
    $('db-overdue').textContent = overdue;
    $('db-due-today').textContent = dueToday;
    $('db-missing').textContent = missing;
    $('db-assigned-24h').textContent = assigned24h;

    const warnBox = $('db-code-warning');
    if (warnBox) {
      warnBox.style.display = (!user.employee_code || !user.employee_code.trim()) ? 'flex' : 'none';
    }
  }

  function openKpiModal(kpiType) {
    if (!dashboardData) return;
    const tasks = getFilteredTasks();
    let title = 'Danh sách công việc';
    let list = tasks;
    if (kpiType === 'total') {
      list = tasks.filter(t => t.isNeedToDoToday && !(t.taskType === 'release' && !t.startAt && !t.endAt));
      title = `Tổng task cần làm hôm nay (${list.length})`;
    } else if (kpiType === 'overdue') {
      list = tasks.filter(t => t.isOverdue);
      title = `Task trễ hạn (${list.length})`;
    } else if (kpiType === 'dueToday') {
      list = tasks.filter(t => t.isDueToday);
      title = `Task hết hạn hôm nay (${list.length})`;
    } else if (kpiType === 'missing') {
      list = tasks.filter(t => t.taskType === 'bug' && t.isMissingInfo);
      title = `Bug chưa đủ thông tin (${list.length})`;
    } else if (kpiType === 'assigned24h') {
      list = tasks.filter(t => t.isAssigned24h);
      title = `Task gán mới trong 24h (${list.length})`;
    }

    const titleEl = $('kpi-modal-title');
    const bodyEl = $('kpi-modal-body');
    if (titleEl) titleEl.textContent = title;
    if (bodyEl) {
      if (!list.length) {
        bodyEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-subtle);">Không có công việc nào trong mục này.</div>';
      } else {
        bodyEl.innerHTML = list.map(t => {
          const typeBadge = t.taskType === 'bug'
            ? '<span class="badge badge-red" style="font-size:10px;">BUG</span>'
            : (t.taskType === 'release' || t.subType === 'release'
              ? '<span class="badge badge-purple" style="font-size:10px;">RELEASE</span>'
              : '<span class="badge badge-blue" style="font-size:10px;">FUNCTION</span>');
          const roleBadge = t.myRole === 'assignee'
            ? '<span class="badge badge-amber" style="font-size:10px;">Tôi thực hiện</span>'
            : '<span class="badge badge-blue" style="font-size:10px;">Tôi duyệt</span>';
          const statusBadge = `<span class="badge badge-subtle" style="font-size:10px;">${esc(t.statusLabel)}</span>`;
          const missingTxt = (t.missingFields && t.missingFields.length)
            ? `<div style="font-size:11px;color:#991b1b;margin-top:4px;">Thiếu: <b>${esc(t.missingFields.join(', '))}</b></div>` : '';
          const dueTxt = t.endAt ? `Hạn: ${esc(t.endAt.slice(0, 10))}` : `Tạo: ${esc((t.createdAt || '').slice(0, 10))}`;
          return `
            <div class="kpi-task-row">
              <div style="flex:1;min-width:0;">
                <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px;">${typeBadge}${roleBadge}${statusBadge}</div>
                <a href="${safeUrl(t.url)}" target="_blank" rel="noopener" style="font-weight:600;color:var(--primary);text-decoration:none;display:block;">${esc(t.title)}</a>
                ${missingTxt}
              </div>
              <div style="text-align:right;white-space:nowrap;font-size:11px;color:var(--text-subtle);">
                <div>${dueTxt}</div>
                <a href="${safeUrl(t.url)}" target="_blank" rel="noopener" class="btn btn-outline" style="padding:2px 8px;font-size:11px;margin-top:4px;display:inline-block;">Mở task</a>
              </div>
            </div>
          `;
        }).join('');
      }
    }
    document.getElementById('modal-kpi-tasks')?.classList.add('open');
  }

  function renderKanban() {
    if (!dashboardData) return;
    const filtered = getFilteredTasks();
    // To do: lấy từ todoTasks (hôm nay -> tương lai, chỉ trạng thái Mới, không bao gồm task đã đóng)
    const todoItems = filterList(dashboardData.todoTasks || dashboardData.kanban?.todo || [])
      .filter(t => !t.closed && t.status !== 5 && t.status !== 10 && t.status !== 11);

    const cols = [
      { key: 'todo', el: $('kb-cards-todo'), countEl: $('kb-count-todo'), items: todoItems },
      { key: 'inProgress', el: $('kb-cards-inprogress'), countEl: $('kb-count-inprogress'), items: filtered.filter(t => t.status === 1) },
      { key: 'paused', el: $('kb-cards-review'), countEl: $('kb-count-review'), items: filtered.filter(t => t.status === 2 || t.status === 3 || t.status === 4 || t.status === 6) },
      { key: 'done', el: $('kb-cards-done'), countEl: $('kb-count-done'), items: filtered.filter(t => t.status === 5) }
    ];

    cols.forEach(col => {
      if (col.countEl) col.countEl.textContent = col.items.length;
      if (!col.el) return;
      if (!col.items.length) {
        col.el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px 8px;font-size:11.5px;">Không có công việc nào</div>';
        return;
      }
      col.el.innerHTML = col.items.map(t => {
        let cardClass = 'jira-card';
        if (t.isOverdue) cardClass += ' overdue';
        else if (t.isDueToday) cardClass += ' due-today';
        if (t.isMissingInfo) cardClass += ' missing-info';

        const typeBadge = t.taskType === 'bug'
          ? '<span class="badge badge-red" style="font-size:10px;">BUG</span>'
          : (t.taskType === 'release' || t.subType === 'release'
            ? '<span class="badge badge-purple" style="font-size:10px;">RELEASE</span>'
            : '<span class="badge badge-blue" style="font-size:10px;">FUNCTION</span>');

        const roleBadge = t.myRole === 'assignee'
          ? '<span class="badge badge-amber" style="font-size:10px;">Tôi thực hiện</span>'
          : '<span class="badge badge-subtle" style="font-size:10px;">Tôi duyệt</span>';

        const modBadge = t.module ? `<span class="badge badge-purple" style="font-size:10px;">${esc(t.module)}</span>` : '';

        const priBadge = (t.priority === 1 || t.priority === 2)
          ? '<span class="badge badge-red" style="font-size:10px;">Ưu tiên cao</span>'
          : t.priority === 3 ? '<span class="badge badge-blue" style="font-size:10px;">Ưu tiên</span>' : '';

        let dueBadge = '';
        if (t.isOverdue) dueBadge = `<span class="badge badge-red" style="font-size:10px;">Quá hạn: ${esc(t.endAt.slice(0, 10))}</span>`;
        else if (t.isDueToday) dueBadge = '<span class="badge badge-amber" style="font-size:10px;font-weight:700;background:#f59e0b;color:#fff;border-color:#d97706;">🔥 Hạn hôm nay</span>';
        else if (t.endAt) dueBadge = `<span style="font-size:10px;color:var(--text-subtle);">Hạn: ${esc(t.endAt.slice(0, 10))}</span>`;

        let missingBanner = '';
        if (t.missingFields && t.missingFields.length) {
          missingBanner = `
            <div class="jira-missing-banner" title="Cần cập nhật các trường này trong Haraworks">
              <span>Chưa điền: <b>${esc(t.missingFields.join(', '))}</b></span>
            </div>`;
        }

        return `
          <div class="${cardClass}" onclick="window.open('${safeUrl(t.url)}', '_blank')">
            <div class="jira-card-tags">
              ${typeBadge}
              ${roleBadge}
              ${modBadge}
              ${priBadge}
            </div>
            <div class="jira-card-title" title="${esc(t.title)}">${esc(t.title)}</div>
            ${missingBanner}
            <div class="jira-card-footer">
              <span>${esc(t.customer || t.project || '')}</span>
              ${dueBadge}
            </div>
          </div>
        `;
      }).join('');
    });
  }

  function renderGanttSection(containerEl, tasks, mode) {
    if (!containerEl) return;
    const valid = tasks.filter(t => mode === 'release' ? (t.startAt || t.endAt) : (t.startAt || t.endAt || t.createdAt));
    if (!valid.length) {
      containerEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-subtle);">Không có công việc nào trong khoảng thời gian đã chọn.</div>';
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayMs = 24 * 60 * 60 * 1000;
    let maxEndMs = today.getTime() + 10 * dayMs;
    valid.forEach(t => {
      if (t.endAt) {
        const ms = new Date(t.endAt).getTime();
        if (!Number.isNaN(ms) && ms > maxEndMs) maxEndMs = ms;
      }
    });
    const startRange = new Date(today.getTime() - 4 * dayMs);
    const totalDays = Math.min(31, Math.max(15, Math.ceil((maxEndMs - startRange.getTime()) / dayMs) + 2));

    const daysArr = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startRange.getTime() + i * dayMs);
      const isToday = d.toDateString() === today.toDateString();
      daysArr.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, isToday });
    }

    const toVnDayStr = (v) => {
      if (!v) return '';
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s.slice(0, 10);
      return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
    };
    const dayStrToMs = (ds) => {
      const [y, m, d] = ds.split('-').map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    };
    const todayStr = toVnDayStr(today);

    const rowsHtml = valid.slice(0, 50).map(t => {
      const sStr = toVnDayStr(t.startAt || t.createdAt) || todayStr;
      const eStr = toVnDayStr(t.endAt) || sStr;
      const startIdx = Math.round((dayStrToMs(sStr) - startRange.getTime()) / dayMs);
      let endIdx = Math.round((dayStrToMs(eStr) - startRange.getTime()) / dayMs);
      if (endIdx < startIdx) endIdx = startIdx;

      const clampedStart = Math.max(0, Math.min(totalDays - 1, startIdx));
      const clampedEnd = Math.max(clampedStart, Math.min(totalDays - 1, endIdx));
      const colPct = 100 / totalDays;
      const leftPct = clampedStart * colPct;
      const widthPct = Math.max(colPct, (clampedEnd - clampedStart + 1) * colPct);

      let colorClass = 'slate';
      if (t.status === 5 || t.status === 11) colorClass = 'green'; // Hoàn thành
      else if (t.status === 4) colorClass = 'rose'; // Từ chối
      else if (t.status === 1) colorClass = 'blue'; // Đang thực hiện
      else if (t.status === 2 || t.status === 3 || t.status === 6) colorClass = 'amber'; // Tạm ngưng
      else colorClass = 'slate'; // Mới
      if (t.isDueToday) colorClass += ' due-today-bar';

      const deadlineText = eStr ? eStr.slice(5, 10) : '';
      const barLabel = `${t.isDueToday ? '🔥 ' : ''}${t.title}${deadlineText ? ' (' + deadlineText + ')' : ''}`;

      return `
        <tr>
          <td style="position:relative;padding:5px 0;">
            <div class="gantt-bar-wrap" style="height:26px;">
              <div class="gantt-bar gantt-bar-clickable ${colorClass}"
                   style="left:${leftPct.toFixed(2)}%;width:${widthPct.toFixed(2)}%;"
                   onclick="window.open('${safeUrl(t.url)}', '_blank')"
                   title="${esc(t.title)} · ${esc(t.myRoleLabel)} · ${esc(t.statusLabel)}${t.endAt ? ' · Hạn: ' + esc(eStr) : ''}">
                ${esc(barLabel)}
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    containerEl.innerHTML = `
      <table class="gantt-table">
        <thead>
          <tr>
            <th>
              <div style="display:grid;grid-template-columns:repeat(${totalDays},1fr);text-align:center;font-size:10.5px;">
                ${daysArr.map(d => `<div style="${d.isToday ? 'color:var(--primary);font-weight:700;border-bottom:2px solid var(--primary);' : ''}">${d.label}</div>`).join('')}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;
  }

  function renderGantt() {
    if (!dashboardData) return;
    // Gộp task theo bộ lọc + toàn bộ task tương lai để Gantt luôn hiện đủ kế hoạch tương lai
    const map = new Map();
    getFilteredTasks().forEach(t => map.set(t.id, t));
    filterList(dashboardData.futureTasks || []).forEach(t => map.set(t.id, t));
    const tasks = [...map.values()];
    const bugs = tasks.filter(t => t.taskType === 'bug');
    renderGanttSection($('gantt-bug-approver-body'), bugs.filter(t => t.myRole !== 'assignee'), 'bug');
    renderGanttSection($('gantt-bug-assignee-body'), bugs.filter(t => t.myRole === 'assignee'), 'bug');
    renderGanttSection($('gantt-fn-body'), tasks.filter(t => t.taskType === 'function'), 'function');
    renderGanttSection($('gantt-release-body'), tasks.filter(t => t.taskType === 'release'), 'release');
  }

  function svgDonut(segments, centerLabel, centerSub = '') {
    const total = segments.reduce((s, x) => s + x.value, 0);
    const r = 46, cx = 60, cy = 60, circ = 2 * Math.PI * r;
    if (!total) {
      return `<svg width="120" height="120" viewBox="0 0 120 120"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="16"/><text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="14" font-weight="700" fill="#64748b">0</text></svg>`;
    }
    let offset = 0;
    const arcs = segments.filter(s => s.value > 0).map(s => {
      const len = (s.value / total) * circ;
      const arc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      offset += len;
      return arc;
    }).join('');
    return `
      <svg width="120" height="120" viewBox="0 0 120 120" style="flex-shrink:0;">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="16"/>
        ${arcs}
        <text x="${cx}" y="${centerSub ? cy - 1 : cy + 5}" text-anchor="middle" font-size="18" font-weight="800" fill="#1e293b">${esc(centerLabel)}</text>
        ${centerSub ? `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="10" fill="#64748b">${esc(centerSub)}</text>` : ''}
      </svg>
    `;
  }

  function renderAnalytics() {
    if (!dashboardData) return;
    const tasks = getFilteredTasks();
    const total = tasks.length;
    const statusItems = [
      { label: 'Mới', value: tasks.filter(t => t.status === 0 || t.status == null).length, color: '#64748b' },
      { label: 'Đang làm', value: tasks.filter(t => t.status === 1).length, color: '#3b82f6' },
      { label: 'Tạm ngưng', value: tasks.filter(t => t.status === 2 || t.status === 3 || t.status === 6).length, color: '#f59e0b' },
      { label: 'Từ chối', value: tasks.filter(t => t.status === 4).length, color: '#e11d48' },
      { label: 'Hoàn thành', value: tasks.filter(t => t.status === 5 || t.status === 11).length, color: '#10b981' }
    ];
    const priItems = [
      { label: 'Ưu tiên cao', value: tasks.filter(t => t.priority === 1 || t.priority === 2).length, color: '#ef4444' },
      { label: 'Ưu tiên', value: tasks.filter(t => t.priority === 3).length, color: '#3b82f6' },
      { label: 'Không ưu tiên', value: tasks.filter(t => t.priority === 4).length, color: '#10b981' },
      { label: 'Chưa gắn', value: tasks.filter(t => t.priority == null || t.priority < 1 || t.priority > 4).length, color: '#94a3b8' }
    ];
    const typeItems = [
      { label: 'Bug (Tôi duyệt)', value: tasks.filter(t => t.taskType === 'bug' && t.myRole !== 'assignee').length, color: '#3b82f6' },
      { label: 'Bug (Tôi thực hiện)', value: tasks.filter(t => t.taskType === 'bug' && t.myRole === 'assignee').length, color: '#f59e0b' },
      { label: 'Task Function (QC)', value: tasks.filter(t => t.taskType === 'function').length, color: '#8b5cf6' },
      { label: 'Release Function', value: tasks.filter(t => t.taskType === 'release').length, color: '#10b981' }
    ];

    // 1. SVG Vertical Column Chart cho Trạng Thái
    const statusEl = $('chart-status-bars');
    if (statusEl) {
      const maxVal = Math.max(1, ...statusItems.map(s => s.value));
      const chartH = 120;
      const colW = 44, gap = 18;
      const svgW = statusItems.length * (colW + gap) + 20;
      const bars = statusItems.map((s, idx) => {
        const h = Math.round((s.value / maxVal) * chartH);
        const x = 16 + idx * (colW + gap);
        const y = chartH - h + 20;
        return `
          <rect x="${x}" y="${y}" width="${colW}" height="${Math.max(2, h)}" rx="5" fill="${s.color}"><title>${esc(s.label)}: ${s.value}</title></rect>
          <text x="${x + colW / 2}" y="${y - 5}" text-anchor="middle" font-size="11" font-weight="700" fill="#1e293b">${s.value}</text>
          <text x="${x + colW / 2}" y="${chartH + 36}" text-anchor="middle" font-size="10.5" fill="#475569">${esc(s.label)}</text>
        `;
      }).join('');
      statusEl.innerHTML = `<div style="overflow-x:auto;"><svg width="${svgW}" height="${chartH + 46}" viewBox="0 0 ${svgW} ${chartH + 46}" style="display:block;margin:0 auto;">
        <line x1="8" y1="${chartH + 20}" x2="${svgW - 8}" y2="${chartH + 20}" stroke="#cbd5e1" stroke-width="1"/>
        ${bars}
      </svg></div>`;
    }

    // 2. SVG Donut Chart cho Độ Ưu Tiên
    const priEl = $('chart-priority-bars');
    if (priEl) {
      const legend = priItems.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;margin-bottom:6px;">
        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;"></span>${esc(s.label)}</span>
        <b>${s.value}</b>
      </div>`).join('');
      priEl.innerHTML = `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">${svgDonut(priItems, String(total), 'task')}<div style="flex:1;min-width:140px;">${legend}</div></div>`;
    }

    // 3. SVG Donut Chart cho Loại Công Việc
    const typeEl = $('chart-type-bars');
    if (typeEl) {
      const legend = typeItems.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;margin-bottom:6px;">
        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;"></span>${esc(s.label)}</span>
        <b>${s.value}</b>
      </div>`).join('');
      typeEl.innerHTML = `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">${svgDonut(typeItems, String(total), 'tổng')}<div style="flex:1;min-width:140px;">${legend}</div></div>`;
    }

    // 4. SVG Ring Chart + Bar breakdown cho Chất lượng thông tin Bug
    const qualityEl = $('chart-quality-box');
    if (qualityEl) {
      const myBugs = tasks.filter(t => t.taskType === 'bug');
      const totalBug = myBugs.length;
      const validBug = myBugs.filter(t => !t.isMissingInfo).length;
      const invalidBug = totalBug - validBug;
      const validPct = totalBug ? Math.round((validBug / totalBug) * 100) : 100;

      const missingCounts = { 'Khách hàng': 0, 'Ứng dụng': 0, 'Nền tảng': 0, 'Phân loại': 0, 'Độ nghiêm trọng': 0 };
      myBugs.forEach(b => {
        (b.missingFields || []).forEach(f => {
          if (missingCounts[f] !== undefined) missingCounts[f]++;
        });
      });

      const qSegments = [
        { label: 'Đủ thông tin', value: validBug, color: '#10b981' },
        { label: 'Thiếu trường', value: invalidBug, color: '#ef4444' }
      ];
      const missingHtml = Object.entries(missingCounts).map(([field, cnt]) => `
        <span class="badge ${cnt > 0 ? 'badge-amber' : 'badge-subtle'}" style="font-size:11px;">${field}: ${cnt}</span>
      `).join('');

      qualityEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">
          ${svgDonut(qSegments, `${validPct}%`, `${validBug}/${totalBug}`)}
          <div style="flex:1;min-width:160px;">
            <div style="font-size:11.5px;color:var(--text-subtle);margin-bottom:8px;">Tỷ lệ bug điền đủ 5 trường bắt buộc.</div>
            <div style="font-size:11px;font-weight:600;margin-bottom:5px;">Các trường đang thiếu:</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">${missingHtml}</div>
          </div>
        </div>
      `;
    }

    // 5. SVG Donut Chart cho Task Release Function
    const relEl = $('chart-release-bars');
    if (relEl) {
      const relTasks = tasks.filter(t => t.taskType === 'release');
      const relItems = [
        { label: 'Mới', value: relTasks.filter(t => t.status === 0 || t.status == null).length, color: '#64748b' },
        { label: 'Đang thực hiện', value: relTasks.filter(t => t.status === 1).length, color: '#3b82f6' },
        { label: 'Tạm ngưng', value: relTasks.filter(t => t.status === 2 || t.status === 3 || t.status === 6).length, color: '#f59e0b' },
        { label: 'Từ chối', value: relTasks.filter(t => t.status === 4).length, color: '#e11d48' },
        { label: 'Hoàn thành', value: relTasks.filter(t => t.status === 5 || t.status === 11).length, color: '#10b981' }
      ];
      const legend = relItems.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:12px;margin-bottom:5px;">
        <span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:10px;height:10px;border-radius:2px;background:${s.color};display:inline-block;"></span>${esc(s.label)}</span>
        <b>${s.value}</b>
      </div>`).join('');
      relEl.innerHTML = `<div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap;">${svgDonut(relItems, String(relTasks.length), 'release')}<div style="flex:1;min-width:140px;">${legend}</div></div>`;
    }
  }

  // -----------------------------------------------------------
  // Noti Báo Cáo Nhắc Nhở Hằng Ngày (theo cấu hình Pet cá nhân, không lặp lại khi reload)
  // & Báo khi có task mới được gán (Bug / Task Function / Release)
  // -----------------------------------------------------------
  let seenMyTaskIds = null;
  function checkMyNewAssignedTasks() {
    if (!dashboardData || !me) return;
    const key = `qa_seen_assigned_tasks_${me.id}`;
    if (seenMyTaskIds === null) {
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        seenMyTaskIds = Array.isArray(saved) ? new Set(saved) : null;
      } catch { seenMyTaskIds = null; }
    }
    const openMine = (dashboardData.tasks || []).filter(t => !t.closed && t.myRole === 'assignee');
    if (seenMyTaskIds === null) {
      seenMyTaskIds = new Set(openMine.map(t => t.id));
      try { localStorage.setItem(key, JSON.stringify([...seenMyTaskIds].slice(-300))); } catch {}
      return;
    }
    const fresh = openMine.filter(t => !seenMyTaskIds.has(t.id));
    if (fresh.length > 0) {
      fresh.forEach(t => seenMyTaskIds.add(t.id));
      try { localStorage.setItem(key, JSON.stringify([...seenMyTaskIds].slice(-300))); } catch {}
      const first = fresh[0];
      if (typeof window.startTabBlink === 'function') window.startTabBlink('Có task mới gán cho bạn!');
      window.qaPetAlert?.({
        text: `📌 Bạn vừa được gán ${fresh.length > 1 ? fresh.length + ' task mới' : first.typeLabel}: ${first.title.slice(0, 95)}`,
        onOpen: () => {
          if (first.url && /^https?:\/\//i.test(first.url)) {
            window.open(first.url, '_blank', 'noopener');
          } else {
            document.querySelector("[data-tab='pane-overview']")?.click();
            openKpiModal('total');
          }
        }
      });
    }
  }

  function checkDaily1630Reminder() {
    if (!dashboardData) return;
    checkMyNewAssignedTasks();

    const cfg = typeof getPetConfig === 'function' ? getPetConfig() : { reminderEnabled: true, reminderTimes: ['16:30'] };
    if (cfg.reminderEnabled === false) return;
    const timesList = (Array.isArray(cfg.reminderTimes) && cfg.reminderTimes.length ? cfg.reminderTimes : ['16:30'])
      .filter(t => /^\d{2}:\d{2}$/.test(t || ''));

    const now = new Date();
    const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);
    const vnTimeParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(now).split(':').map(Number);
    const hours = vnTimeParts[0], minutes = vnTimeParts[1];

    for (const targetTime of timesList) {
      const [targetH, targetM] = targetTime.split(':').map(Number);
      const remKey = `qa_pet_reminded_${me?.id || 'local'}_${targetTime}`;
      let alreadyReminded = false;
      try { alreadyReminded = localStorage.getItem(remKey) === todayStr; } catch {}

      if ((hours > targetH || (hours === targetH && minutes >= targetM)) && !alreadyReminded) {
        try { localStorage.setItem(remKey, todayStr); } catch {}
        const { summary } = dashboardData;
        if (summary.overdue > 0 || summary.dueToday > 0 || summary.missingInfoBugs > 0 || summary.assigned24h > 0) {
          let msg = `[${targetTime} Báo Cáo Hằng Ngày]: Bạn có `;
          const parts = [];
          if (summary.dueToday > 0) parts.push(`${summary.dueToday} task hết hạn hôm nay`);
          if (summary.overdue > 0) parts.push(`${summary.overdue} task trễ hạn`);
          if (summary.missingInfoBugs > 0) parts.push(`${summary.missingInfoBugs} bug chưa điền đủ thông tin`);
          if (summary.assigned24h > 0) parts.push(`${summary.assigned24h} bug mới gán 24h`);
          msg += parts.join(', ') + '. Hãy kiểm tra và cập nhật tiến độ nhé!';

          if (typeof window.qaPetAlert === 'function') {
            window.qaPetAlert({
              text: msg,
              onOpen: () => {
                document.querySelector("[data-tab='pane-overview']")?.click();
                const targetKpi = summary.dueToday > 0 ? 'dueToday' : (summary.overdue > 0 ? 'overdue' : (summary.missingInfoBugs > 0 ? 'missing' : 'total'));
                openKpiModal(targetKpi);
              }
            });
          }
          if (typeof window.startTabBlink === 'function') {
            window.startTabBlink(`${targetTime} Nhắc báo cáo task!`);
          }
        }
      }
    }
  }

  setInterval(checkDaily1630Reminder, 60000);

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.view-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    document.querySelectorAll('.stat-card.kpi-clickable').forEach(card => {
      card.addEventListener('click', () => openKpiModal(card.dataset.kpi));
    });

    $('db-filter-period')?.addEventListener('change', () => loadDashboard(true));
    $('btn-refresh-dashboard')?.addEventListener('click', () => loadDashboard(true));
    document.addEventListener('qa-global-sync', () => loadDashboard(true));
    $('kb-filter-q')?.addEventListener('input', renderAllViews);
    $('db-filter-project')?.addEventListener('change', renderAllViews);
    $('kb-filter-type')?.addEventListener('change', renderAllViews);
    $('kb-filter-status')?.addEventListener('change', renderAllViews);
  });

  document.addEventListener('qa-me-ready', () => {
    loadDashboard();
    // Refresh mỗi 30s để cập nhật task realtime
    setInterval(loadDashboard, 30000);
  });
  if (typeof me !== 'undefined' && me) {
    loadDashboard();
  }
})();

// -----------------------------------------------------------
// 7. Thông báo Haraworks, Nhấp nháy Tab Browser & Bé Pet QA
// -----------------------------------------------------------
(function setupNotificationsAndPet() {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim();
  const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : '#');

  // ---- Dấu hiệu nhấp nháy trên tab trình duyệt (Title + Favicon) ----
  const BASE_TITLE = 'QC Platform';
  const BASE_ICON = 'logo.svg';
  const ALERT_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#e11d48"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>'
  );
  let blinkTimer = null, blinkTick = false, blinkLabel = '';

  function startTabBlink(label) {
    blinkLabel = label || 'Thông báo mới!';
    if (blinkTimer) return;
    blinkTick = false;
    const fav = $('app-favicon');
    const step = () => {
      blinkTick = !blinkTick;
      document.title = blinkTick ? `🔔 ${blinkLabel} · ${BASE_TITLE}` : BASE_TITLE;
      if (fav) fav.href = blinkTick ? ALERT_ICON : BASE_ICON;
    };
    step();
    blinkTimer = setInterval(step, 900);
  }

  function stopTabBlink() {
    if (blinkTimer) { clearInterval(blinkTimer); blinkTimer = null; }
    document.title = BASE_TITLE;
    const fav = $('app-favicon');
    if (fav) fav.href = BASE_ICON;
  }

  // ---- Bé Pet QA dễ thương ----
  const MODES = ['typing', 'dancing', 'singing'];
  let petMode = 'typing';
  let petScale = 1;
  let petHidden = false;
  let petAlertAction = null;
  let autoCycleTimer = null;

  function applyPetMode(mode) {
    const w = $('qa-pet-widget');
    if (!w) return;
    w.classList.remove('mode-typing', 'mode-dancing', 'mode-singing', 'mode-alert');
    w.classList.add('mode-' + mode);
    document.querySelectorAll('.qa-pet-toolbar button[data-pet-mode]').forEach(b => {
      b.classList.toggle('active', b.dataset.petMode === mode);
    });
  }

  function applyPetScale() {
    const w = $('qa-pet-widget');
    if (w) w.style.transform = `scale(${petScale.toFixed(2)})`;
  }

  function setPetHidden(hidden) {
    petHidden = !!hidden;
    try { localStorage.setItem('qa_pet_hidden', petHidden ? '1' : '0'); } catch {}
    const w = $('qa-pet-widget'), r = $('qa-pet-restore');
    if (w) w.hidden = petHidden;
    if (r) r.hidden = true;
  }

  window.qaPetAlert = function({ text, onOpen } = {}) {
    if (!text) return;
    petAlertAction = typeof onOpen === 'function' ? onOpen : null;
    const bubble = $('qa-pet-bubble'), txtEl = $('qa-pet-bubble-text'), openBtn = $('qa-pet-bubble-open');
    if (txtEl) txtEl.textContent = text;
    if (openBtn) openBtn.style.display = petAlertAction ? '' : 'none';
    if (bubble) bubble.hidden = false;
    if (petHidden) {
      $('qa-pet-restore')?.classList.add('has-alert');
    } else {
      applyPetMode('alert');
    }
  };

  function dismissPetAlert() {
    const bubble = $('qa-pet-bubble');
    if (bubble) bubble.hidden = true;
    $('qa-pet-restore')?.classList.remove('has-alert');
    applyPetMode(petMode);
  }

  function applyPetConfig(cfg) {
    const w = $('qa-pet-widget');
    if (!w) return;
    const c = cfg || (typeof getPetConfig === 'function' ? getPetConfig() : { color: 'amber', intervalSec: 45 });
    let theme = PET_COLOR_THEMES[c.color] || PET_COLOR_THEMES.amber;
    if (c.color === 'custom' && /^#[0-9a-f]{6}$/i.test(c.customHex || '')) {
      theme = {
        fur: c.customHex,
        head: c.customHex,
        belly: '#ffffff',
        stroke: '#334155',
        tail: c.customHex,
        earIn: '#fda4af'
      };
    }
    w.style.setProperty('--pet-fur', theme.fur);
    w.style.setProperty('--pet-head', theme.head);
    w.style.setProperty('--pet-belly', theme.belly);
    w.style.setProperty('--pet-stroke', theme.stroke);
    w.style.setProperty('--pet-tail', theme.tail);
    w.style.setProperty('--pet-ear-in', theme.earIn);

    if (autoCycleTimer) { clearInterval(autoCycleTimer); autoCycleTimer = null; }
    const sec = Number(c.intervalSec ?? 45);
    if (sec > 0) {
      autoCycleTimer = setInterval(() => {
        if (petHidden || ($('qa-pet-bubble') && !$('qa-pet-bubble').hidden)) return;
        petMode = MODES[(MODES.indexOf(petMode) + 1) % MODES.length];
        applyPetMode(petMode);
      }, sec * 1000);
    }
  }

  function initPet() {
    const w = $('qa-pet-widget'), stage = $('qa-pet-stage'), restore = $('qa-pet-restore');
    if (!w || !stage) return;

    try {
      const savedScale = parseFloat(localStorage.getItem('qa_pet_scale'));
      if (!Number.isNaN(savedScale)) petScale = Math.min(1.6, Math.max(0.65, savedScale));
      const savedPos = JSON.parse(localStorage.getItem('qa_pet_pos') || 'null');
      if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        w.style.left = Math.max(8, Math.min(window.innerWidth - 110, savedPos.left)) + 'px';
        w.style.top = Math.max(8, Math.min(window.innerHeight - 110, savedPos.top)) + 'px';
        w.style.right = 'auto';
        w.style.bottom = 'auto';
      }
      petHidden = localStorage.getItem('qa_pet_hidden') === '1';
      petMode = localStorage.getItem('qa_pet_mode') || 'typing';
    } catch {}

    applyPetScale();
    applyPetMode(petMode);
    setPetHidden(petHidden);
    applyPetConfig();
    window.addEventListener('qa-pet-config-changed', e => applyPetConfig(e.detail));
    document.addEventListener('qa-me-ready', () => applyPetConfig());

    document.querySelectorAll('.qa-pet-toolbar button[data-pet-mode]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        petMode = btn.dataset.petMode;
        try { localStorage.setItem('qa_pet_mode', petMode); } catch {}
        dismissPetAlert();
      });
    });
    $('qa-pet-config')?.addEventListener('click', e => {
      e.stopPropagation();
      if (typeof openUserSettingsModal === 'function') {
        openUserSettingsModal(false);
        setTimeout(() => document.getElementById('us-pet-section')?.scrollIntoView({ behavior: 'smooth' }), 120);
      }
    });
    $('qa-pet-smaller')?.addEventListener('click', e => {
      e.stopPropagation();
      petScale = Math.max(0.65, petScale - 0.15);
      try { localStorage.setItem('qa_pet_scale', String(petScale)); } catch {}
      applyPetScale();
    });
    $('qa-pet-larger')?.addEventListener('click', e => {
      e.stopPropagation();
      petScale = Math.min(1.6, petScale + 0.15);
      try { localStorage.setItem('qa_pet_scale', String(petScale)); } catch {}
      applyPetScale();
    });
    $('qa-pet-hide')?.addEventListener('click', e => {
      e.stopPropagation();
      setPetHidden(true);
    });
    restore?.addEventListener('click', () => {
      setPetHidden(false);
      restore.classList.remove('has-alert');
      if ($('qa-pet-bubble') && !$('qa-pet-bubble').hidden) applyPetMode('alert');
    });
    $('qa-pet-bubble-close')?.addEventListener('click', e => {
      e.stopPropagation();
      dismissPetAlert();
      stopTabBlink();
    });
    $('qa-pet-bubble-open')?.addEventListener('click', e => {
      e.stopPropagation();
      const fn = petAlertAction;
      dismissPetAlert();
      stopTabBlink();
      if (fn) fn();
    });

    // Kéo thả di chuyển hoặc bấm đổi hành động
    let drag = null;
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const rect = w.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drag.moved) {
        const left = Math.max(4, Math.min(window.innerWidth - 96, drag.ox + dx));
        const top = Math.max(4, Math.min(window.innerHeight - 96, drag.oy + dy));
        w.style.left = left + 'px';
        w.style.top = top + 'px';
        w.style.right = 'auto';
        w.style.bottom = 'auto';
      }
    });
    stage.addEventListener('pointerup', e => {
      if (!drag) return;
      if (drag.moved) {
        try {
          localStorage.setItem('qa_pet_pos', JSON.stringify({ left: parseFloat(w.style.left), top: parseFloat(w.style.top) }));
        } catch {}
      } else {
        // Bấm nhẹ vào bé Pet để đổi biểu cảm
        if ($('qa-pet-bubble') && !$('qa-pet-bubble').hidden) {
          dismissPetAlert();
        } else {
          const next = MODES[(MODES.indexOf(petMode) + 1) % MODES.length];
          petMode = next;
          try { localStorage.setItem('qa_pet_mode', petMode); } catch {}
          applyPetMode(petMode);
        }
      }
      drag = null;
    });
  }

  // ---- Chuông Notification Haraworks & Kiểm tra Bug gán cho tài khoản ----
  let notiRev = null, seenNotiIds = new Set(), notiInitialized = false;
  let seenAssignedBugs = null;

  const fmtNotiTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diff < 1) return 'Vừa xong';
    if (diff < 60) return `${diff} phút trước`;
    return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
  };

  function renderNotifications(data) {
    const badge = $('noti-badge'), btn = $('btn-noti'), list = $('noti-list');
    if (!list) return;
    if (!data.enabled) {
      if (badge) badge.hidden = true;
      list.innerHTML = '<div class="noti-empty">Chưa cấu hình cookie Haraworks trên server.</div>';
      return;
    }
    if (data.error && !(data.items || []).length) {
      if (badge) badge.hidden = true;
      list.innerHTML = `<div class="noti-empty" style="color:var(--danger);">${esc(data.error)}</div>`;
      return;
    }
    const items = data.items || [];
    const count = data.unseenCount || data.unreadCount || 0;
    if (badge) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count <= 0;
    }
    if (btn) btn.classList.toggle('has-new', count > 0);

    list.innerHTML = items.length ? items.map(n => `
      <a class="noti-item${n.isRead ? '' : ' is-unread'}" data-noti-id="${esc(n.id)}" href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">
        <div class="noti-item-top">
          <span><b>${esc(n.actor || n.moduleName || 'Haraworks')}</b> · ${esc(n.moduleName)}</span>
          <span style="display:inline-flex;align-items:center;gap:5px;">${esc(fmtNotiTime(n.createdAt))}${n.isRead ? '' : '<i class="noti-item-dot" title="Chưa đọc"></i>'}</span>
        </div>
        <div class="noti-item-msg">${esc(n.content || n.title)}</div>
      </a>`).join('') : '<div class="noti-empty">Không có thông báo nào.</div>';
    list.querySelectorAll('.noti-item[data-noti-id]').forEach(el => {
      el.addEventListener('click', () => {
        el.classList.remove('is-unread');
        el.querySelector('.noti-item-dot')?.remove();
        fetch(`${API_BASE}/notifications/mark-seen`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: el.dataset.notiId })
        }).then(r => r.ok ? r.json() : null).then(j => { if (j?.data) renderNotifications(j.data); }).catch(() => {});
      });
    });
  }

  async function pollNotifications() {
    if (!me) return;
    try {
      const res = await fetch(`${API_BASE}/notifications`);
      if (!res.ok) return;
      const { data } = await res.json();
      if (!data) return;
      if (notiRev === null || data.revision !== notiRev) {
        renderNotifications(data);
        notiRev = data.revision;
      }
      const items = data.items || [];
      const petNotiKey = `qa_seen_noti_pet_${me.id}`;
      let seenPetNotis = null;
      try {
        const saved = JSON.parse(localStorage.getItem(petNotiKey) || 'null');
        seenPetNotis = Array.isArray(saved) ? new Set(saved) : new Set();
      } catch { seenPetNotis = new Set(); }

      const todayStr = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
      const freshNotis = items.filter(n => {
        if (!n || !n.id || n.isRead || seenPetNotis.has(n.id)) return false;
        const nDate = n.createdAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(n.createdAt)) : '';
        if (nDate !== todayStr) return false;
        const msg = `${n.content || ''} ${n.title || ''}`;
        return /(nhắc|mention|bình luận|comment|tag|gán|giao)/i.test(msg);
      });
      if (freshNotis.length > 0) {
        freshNotis.forEach(n => seenPetNotis.add(n.id));
        try { localStorage.setItem(petNotiKey, JSON.stringify([...seenPetNotis].slice(-200))); } catch {}
        const first = freshNotis[0];
        startTabBlink('Có thông báo mới cho bạn!');
        window.qaPetAlert?.({
          text: `🔔 ${first.actor || 'Haraworks'}: ${(first.content || first.title || '').slice(0, 100)}`,
          onOpen: () => {
            if (first.link && /^https?:\/\//i.test(first.link)) {
              window.open(first.link, '_blank', 'noopener');
            } else {
              $('btn-noti')?.click();
            }
          }
        });
      }
      if (!notiInitialized) {
        items.forEach(i => seenNotiIds.add(i.id));
        notiInitialized = true;
      }
    } catch {}
  }

  // ---- Badge bug mới trên Left Menu (Tra Cứu Bug) ----
  let seenMenuBugIds = null, latestLiveBugIds = [];
  function updateLeftMenuBugBadge(count) {
    const badge = $('sb-bug-badge');
    if (!badge) return;
    if (count > 0 && !$('pane-bug-history')?.classList.contains('active')) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
  function markMenuBugsSeen() {
    if (!me) return;
    const key = `qa_seen_menu_bugs_${me.id}`;
    if (seenMenuBugIds === null) seenMenuBugIds = new Set();
    latestLiveBugIds.forEach(id => seenMenuBugIds.add(id));
    try { localStorage.setItem(key, JSON.stringify([...seenMenuBugIds].slice(-300))); } catch {}
    updateLeftMenuBugBadge(0);
  }
  async function pollNewBugsBadge() {
    if (!me) return;
    try {
      const key = `qa_seen_menu_bugs_${me.id}`;
      if (seenMenuBugIds === null) {
        try {
          const saved = JSON.parse(localStorage.getItem(key) || 'null');
          seenMenuBugIds = Array.isArray(saved) ? new Set(saved) : null;
        } catch { seenMenuBugIds = null; }
      }
      const res = await fetch(`${API_BASE}/bugs?live=1&sort=created&limit=40&offset=0`);
      if (!res.ok) return;
      const { data } = await res.json();
      const items = data?.items || [];
      latestLiveBugIds = items.map(b => b.id);
      if (seenMenuBugIds === null) {
        seenMenuBugIds = new Set(latestLiveBugIds);
        try { localStorage.setItem(key, JSON.stringify([...seenMenuBugIds].slice(-300))); } catch {}
        updateLeftMenuBugBadge(0);
        return;
      }
      if ($('pane-bug-history')?.classList.contains('active')) {
        markMenuBugsSeen();
        return;
      }
      const unseenCount = latestLiveBugIds.filter(id => !seenMenuBugIds.has(id)).length;
      updateLeftMenuBugBadge(unseenCount);
    } catch {}
  }

  // ---- Chỉ thông báo (nhấp nháy tab + bé Pet) khi:
  // 1. Có bình luận nhắc đến tên user trong các task bug hôm nay
  // 2. Có bug được gán cho user làm người thực hiện ----
  let seenMentionIds = null;
  async function pollTodayCommentMentions() {
    if (!me) return;
    try {
      const storageKey = `qa_seen_mentions_${me.id}`;
      if (seenMentionIds === null) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
          seenMentionIds = Array.isArray(saved) ? new Set(saved) : null;
        } catch { seenMentionIds = null; }
      }
      const res = await fetch(`${API_BASE}/bugs/today-mentions`);
      if (!res.ok) return;
      const { data } = await res.json();
      const list = Array.isArray(data) ? data : [];
      if (seenMentionIds === null) {
        seenMentionIds = new Set(list.map(m => m.commentId));
        try { localStorage.setItem(storageKey, JSON.stringify([...seenMentionIds].slice(-200))); } catch {}
        return;
      }
      const fresh = list.filter(m => !seenMentionIds.has(m.commentId));
      if (fresh.length > 0) {
        fresh.forEach(m => seenMentionIds.add(m.commentId));
        try { localStorage.setItem(storageKey, JSON.stringify([...seenMentionIds].slice(-200))); } catch {}
        const first = fresh[0];
        startTabBlink(`Nhắc tên bạn trong bug!`);
        window.qaPetAlert?.({
          text: `💬 ${first.by || 'Ai đó'} nhắc bạn trong "${first.bugTitle.slice(0, 60)}": ${first.text.slice(0, 70)}`,
          onOpen: () => {
            if (first.bugUrl && /^https?:\/\//i.test(first.bugUrl)) window.open(first.bugUrl, '_blank', 'noopener');
            else document.querySelector("[data-tab='pane-bug-history']")?.click();
          }
        });
      }
    } catch {}
  }

  function matchesMyAccount(assignee) {
    if (!me || !assignee) return false;
    const a = fold(assignee);
    const dn = fold(me.display_name);
    const un = fold(me.username);
    if (!a) return false;
    if (dn && (a === dn || a.split(/\s+/).includes(dn))) return true;
    if (un && (a === un || a.replace(/\s+/g, '').includes(un))) return true;
    return false;
  }

  async function pollAssignedBugs() {
    if (!me) return;
    try {
      const storageKey = `qa_seen_assigned_${me.id}`;
      if (seenAssignedBugs === null) {
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
          seenAssignedBugs = Array.isArray(saved) ? new Set(saved) : null;
        } catch { seenAssignedBugs = null; }
      }
      const res = await fetch(`${API_BASE}/bugs?live=1&closed=open&sort=created&limit=40&offset=0`);
      if (!res.ok) return;
      const { data } = await res.json();
      const mine = (data?.items || []).filter(b => matchesMyAccount(b.assignee));
      if (seenAssignedBugs === null) {
        seenAssignedBugs = new Set(mine.map(b => b.id));
        try { localStorage.setItem(storageKey, JSON.stringify([...seenAssignedBugs].slice(-200))); } catch {}
        return;
      }
      const fresh = mine.filter(b => !seenAssignedBugs.has(b.id));
      if (fresh.length > 0) {
        fresh.forEach(b => seenAssignedBugs.add(b.id));
        try { localStorage.setItem(storageKey, JSON.stringify([...seenAssignedBugs].slice(-200))); } catch {}
        const first = fresh[0];
        startTabBlink(`Bug mới gán cho bạn!`);
        window.qaPetAlert?.({
          text: `🐞 Bạn vừa được gán bug mới: ${first.title.slice(0, 110)}`,
          onOpen: () => {
            if (first.url && /^https?:\/\//i.test(first.url)) {
              window.open(first.url, '_blank', 'noopener');
            } else {
              document.querySelector("[data-tab='pane-bug-history']")?.click();
            }
          }
        });
      }
    } catch {}
  }

  document.addEventListener('DOMContentLoaded', () => {
    initPet();
    document.querySelector("[data-tab='pane-bug-history']")?.addEventListener('click', () => {
      markMenuBugsSeen();
    });
    const btn = $('btn-noti'), panel = $('noti-panel');
    if (btn && panel) {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const willOpen = panel.hidden;
        panel.hidden = !willOpen;
        btn.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) {
          stopTabBlink();
          btn.classList.remove('has-new');
          pollNotifications();
        }
      });
      document.addEventListener('click', e => {
        if (!panel.hidden && !e.target.closest('#noti-wrap')) {
          panel.hidden = true;
          btn.setAttribute('aria-expanded', 'false');
        }
      });
      $('noti-mark-seen')?.addEventListener('click', async () => {
        stopTabBlink();
        btn.classList.remove('has-new');
        if ($('noti-badge')) $('noti-badge').hidden = true;
        dismissPetAlert();
        try {
          const res = await fetch(`${API_BASE}/notifications/mark-seen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          if (res.ok) {
            const j = await res.json();
            if (j?.data) {
              notiRev = j.data.revision;
              renderNotifications(j.data);
            }
          }
        } catch {}
      });
      $('noti-refresh')?.addEventListener('click', async () => {
        try { await fetch(`${API_BASE}/notifications/refresh`, { method: 'POST' }); } catch {}
        setTimeout(pollNotifications, 800);
      });
    }
    const gSync = $('btn-global-sync');
    if (gSync) {
      gSync.addEventListener('click', async () => {
        if (gSync.disabled) return;
        gSync.disabled = true;
        gSync.classList.add('is-syncing');
        const label = gSync.querySelector('span:last-child');
        if (label) label.textContent = 'Đang đồng bộ...';
        try {
          await fetch(`${API_BASE}/sync-all`, { method: 'POST' });
          setTimeout(() => {
            document.dispatchEvent(new CustomEvent('qa-global-sync'));
            pollNotifications();
            checkApiHealth();
          }, 900);
        } catch {}
        setTimeout(() => {
          gSync.disabled = false;
          gSync.classList.remove('is-syncing');
          if (label) label.textContent = 'Đồng bộ';
        }, 1600);
      });
    }
  });

  document.addEventListener('qa-me-ready', () => {
    refreshLabelColors().catch(() => {});
    pollNotifications();
    pollNewBugsBadge();
    pollAssignedBugs();
    pollTodayCommentMentions();
    setInterval(pollNotifications, 20000);
    setInterval(pollNewBugsBadge, 25000);
    setInterval(pollAssignedBugs, 30000);
    setInterval(pollTodayCommentMentions, 35000);
  });
})();
