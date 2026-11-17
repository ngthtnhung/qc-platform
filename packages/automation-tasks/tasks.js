/**
 * Tác vụ tự động hóa (Playwright) ghi lại khi khám phá module.
 *
 * Vòng đời: draft (Claude hoặc người ghi) -> approved (người có quyền đã đọc code và duyệt đúng bản code đó)
 * -> chạy được. Sửa code thì mất duyệt. Chỉ chạy trên Staging.
 */
import crypto from 'node:crypto';

/**
 * Tham số của tác vụ: giá trị có thể đổi mà không cần sửa code (phân loại, đơn vị, giờ, ghi chú...).
 * Code đọc qua ctx.params.<key>. auto = true: không tìm thấy giá trị thì chọn lựa chọn đầu tiên thay vì báo lỗi.
 * Đổi tham số không làm mất duyệt, vì code không đổi; giá trị chỉ là chữ đưa vào code đã duyệt.
 */
export const MAX_LEN = { text: 200, multiline: 5000, list: 1000, file: 400 };
export const FILE_ID = /^f_[a-z0-9]{8,24}$/;

export function normalizeParams(input) {
  const errors = [], out = [], seen = new Set();
  for (const p of Array.isArray(input) ? input : []) {
    const key = String(p?.key || '').trim();
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(key)) { errors.push(`Khóa tham số "${key}" không hợp lệ (chữ thường, số, gạch dưới, tối đa 31 ký tự)`); continue; }
    if (seen.has(key)) { errors.push(`Trùng khóa tham số "${key}"`); continue; }
    seen.add(key);
    const type = ['text', 'multiline', 'list', 'file'].includes(p.type) ? p.type : 'text';
    const value = String(p.value ?? '');
    if (value.length > MAX_LEN[type]) { errors.push(`Giá trị của "${key}" tối đa ${MAX_LEN[type]} ký tự`); continue; }
    if (type === 'file' && value && !value.split(',').every(v => FILE_ID.test(v.trim()))) { errors.push(`Giá trị của "${key}" phải là mã file đã tải lên`); continue; }
    // fallback: khi để trống hoặc không có trong danh mục (và auto bật) thì chọn mục đầu tiên hay ngẫu nhiên
    out.push({ key, label: String(p.label || key).slice(0, 80), value, auto: p.auto !== false, type, fallback: p.fallback === 'random' ? 'random' : 'first' });
  }
  if (out.length > 30) errors.push('Tối đa 30 tham số');
  return { params: out, errors };
}

/** Trộn giá trị ghi đè (lúc chạy) vào tham số đã lưu; chỉ nhận khóa có sẵn */
export function mergeParams(task, override) {
  const base = Array.isArray(task.params) ? task.params : [];
  return base.map(p => (override && typeof override[p.key] === 'string' && override[p.key].length <= (MAX_LEN[p.type] || 200)) ? { ...p, value: override[p.key] } : p);
}

export const sha = script => crypto.createHash('sha256').update(String(script)).digest('hex');
const rootDomain = h => h.split('.').slice(-2).join('.');

// Hàng rào chống lỗi vô ý, KHÔNG phải ranh giới bảo mật. Kiểm soát thật là người duyệt đọc code và duyệt đúng mã băm.
// setInputFiles/setFiles/filechooser: chỉ được đính kèm file người dùng đã tải lên, qua attachFiles(); không được trỏ tới đường dẫn tùy ý trên máy
const FORBIDDEN = /\b(require|process|child_process|eval|Function|globalThis|constructor|__proto__|setInputFiles|setFiles|filechooser)\b|\bimport\s*\(|\bfs\./;

export function validateScript(script) {
  const errors = [];
  if (typeof script !== 'string' || script.length > 20000) errors.push('Script quá dài (tối đa 20000 ký tự)');
  if (typeof script === 'string' && FORBIDDEN.test(script)) errors.push('Script dùng cú pháp bị cấm (require, process, import(), eval, Function, constructor, fs, setInputFiles). Chỉ dùng page, ctx, step, assert, pickOption, attachFiles.');
  return errors;
}

/** Kiểm tra và chuẩn hóa một tác vụ; trả { task } hoặc { errors } */
export function normalizeTask(input, stagingEnv) {
  const errors = [];
  const t = input || {};
  const str = (v, n) => (typeof v === 'string' && v.trim() ? v.trim() : (errors.push(`Thiếu ${n}`), ''));
  const name = str(t.name, 'name');
  const module_ = str(t.module, 'module');
  const script = typeof t.script === 'string' && t.script.trim() ? t.script : (errors.push('Thiếu script'), '');
  errors.push(...validateScript(script));

  let start_url = '';
  try {
    const u = new URL(t.start_url);
    const base = new URL(stagingEnv.base_url);
    if (u.protocol !== 'https:') errors.push('start_url phải là https');
    else if (rootDomain(u.hostname) !== rootDomain(base.hostname)) errors.push(`start_url phải thuộc ${rootDomain(base.hostname)}`);
    else start_url = u.toString();
  } catch { errors.push('start_url không hợp lệ'); }

  const steps = Array.isArray(t.steps) ? t.steps.map(String).filter(Boolean) : [];
  if (!steps.length) errors.push('Cần ghi các bước (steps) bằng lời để người duyệt đọc');
  const np = normalizeParams(t.params);
  errors.push(...np.errors);
  if (errors.length) return { errors };

  return {
    task: {
      id: t.id || undefined,
      name, module: module_, flow: String(t.flow || ''), description: String(t.description || ''),
      start_url, steps,
      required_roles: Array.isArray(t.required_roles) ? t.required_roles.map(String).filter(Boolean) : [],
      writes: t.writes === true,           // true: tạo/sửa dữ liệu (dùng tiền tố [AI TEST])
      rule_ids: Array.isArray(t.rule_ids) ? t.rule_ids.map(String) : [],
      source: t.source || {},              // { explore_date, note }
      params: np.params,
      script, script_sha: sha(script)
    }
  };
}

/**
 * Tự chọn tài khoản Staging phù hợp vai trò của tác vụ.
 * Ưu tiên: khớp vai trò > tài khoản quản trị > bất kỳ (khi tác vụ không đòi vai trò); rồi tài khoản đã có mật khẩu lưu.
 */
export function chooseAccount(task, accounts) {
  const roles = task.required_roles.map(r => r.toLowerCase());
  const text = a => (a.role || '').toLowerCase();
  const matches = a => !roles.length || roles.some(r => text(a).includes(r));
  const isAdmin = a => /qu[aả]n tr[iị]/i.test(a.role || '');
  const pool = accounts.filter(matches);
  const candidates = pool.length ? pool : accounts.filter(isAdmin);
  const scored = candidates.map(a => ({ a, score: (matches(a) ? 4 : 0) + (a.has_secret ? 2 : 0) + (isAdmin(a) ? 1 : 0) }));
  scored.sort((x, y) => y.score - x.score);
  return scored.length ? scored[0].a : null;
}

export const isRunnable = task => task.status === 'approved' && task.approved_sha === task.script_sha;
