/**
 * Chạy script Playwright của một tác vụ đã được duyệt, trên trang vừa đăng nhập.
 *
 * Script là thân của một hàm async, được dùng: page (Playwright Page), ctx, step(tên, async () => ...), assert(điều kiện, thông báo),
 * pickOption(locatorCácMục, 'khóa_tham_số', giáTrịTùyChọn), attachFiles(inputFile, 'khóa_tham_số'),
 * ctx.val(khóa, mặcĐịnh), ctx.has(khóa), ctx.list(khóa).  ctx.params là giá trị tham số (đổi được trên giao diện, không cần sửa code).
 *   ctx = { username, startUrl, testPrefix: '[AI TEST]', log(...) }
 * Ví dụ:
 *   await step('Mở danh sách', async () => { await page.waitForLoadState('networkidle'); });
 *   await step('Có tiêu đề', async () => assert((await page.title()).length > 0, 'Trang không có tiêu đề'));
 *
 * Lưu ý an toàn: vm chỉ là hàng rào chống lỗi vô ý, KHÔNG phải ranh giới bảo mật. Việc bảo vệ nằm ở chỗ
 * chỉ chạy code đã được người có quyền đọc và duyệt đúng mã băm, và launcher kiểm tra lại mã băm trước khi chạy.
 */
import vm from 'node:vm';
import crypto from 'node:crypto';

const TIMEOUT_MS = 120000;

export async function runTask({ task, page, username, files = {} }) {
  const sha = crypto.createHash('sha256').update(task.script).digest('hex');
  if (sha !== task.sha) throw new Error('Mã băm code không khớp bản đã duyệt, từ chối chạy');

  // Lỗi Playwright có dòng đầu chung chung ("Timeout 30000ms exceeded"); kèm dòng "waiting for locator(...)" để biết đang chờ phần tử nào
  const brief = e => {
    const lines = String(e.message || e).split('\n').map(l => l.trim()).filter(Boolean);
    const wait = lines.find(l => /waiting for/.test(l));
    return (lines[0] + (wait ? ' | ' + wait : '')).slice(0, 400);
  };
  const steps = [], log = [];
  const started = Date.now();
  const step = async (name, fn) => {
    const t = Date.now();
    try {
      const r = await fn();
      steps.push({ name, status: 'PASS', ms: Date.now() - t });
      return r;
    } catch (e) {
      steps.push({ name, status: 'FAIL', ms: Date.now() - t, error: brief(e) });
      throw e;
    }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Điều kiện không đúng'); };
  const params = {}, auto = {}, fallback = {};
  for (const p of (task.params || [])) { params[p.key] = p.value; auto[p.key] = p.auto !== false; fallback[p.key] = p.fallback === 'random' ? 'random' : 'first'; }
  const foldText = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const splitList = s => [...new Set(String(s || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean))];

  /**
   * Chọn một mục trong danh sách theo tham số (hoặc theo giá trị `want` truyền vào, dùng khi lặp qua danh sách):
   * đúng chữ, rồi chứa chữ, không phân biệt dấu và hoa thường. Danh sách gợi ý nạp chậm nên chờ tối đa 6 giây cho tới khi có mục khớp.
   * Để trống hoặc không có trong danh mục của tài khoản này: nếu auto bật thì chọn mục đầu tiên hoặc NGẪU NHIÊN
   * (theo fallback của tham số) và ghi vào log; auto tắt thì báo lỗi kèm danh sách đang có.
   * options: locator Playwright trỏ tới các mục đang hiện; key: tên tham số.
   */
  const pickOption = async (options, key, want) => {
    const target = want !== undefined ? want : params[key];
    const w = foldText(target);
    await options.first().waitFor({ state: 'visible', timeout: 10000 });
    let texts = [], idx = -1;
    for (let i = 0; i < 20; i++) {
      texts = (await options.allInnerTexts()).map(t => t.trim());
      idx = w ? texts.findIndex(t => foldText(t) === w) : -1;
      if (idx < 0 && w) idx = texts.findIndex(t => foldText(t).includes(w));
      if (!w || idx >= 0) break;
      await sleep(300);
    }
    if (idx < 0) {
      if (w && auto[key] === false) throw new Error(`Không có lựa chọn "${target}" cho "${key}". Đang có: ${texts.slice(0, 8).join(' | ')}`);
      if (!texts.length) throw new Error(`Danh sách "${key}" trống`);
      idx = fallback[key] === 'random' ? Math.floor(Math.random() * texts.length) : 0;
      ctx.log(w ? `Không có "${target}", đã chọn "${texts[idx]}" cho ${key}` : `${key} để trống, đã chọn ${fallback[key] === 'random' ? 'ngẫu nhiên' : 'mục đầu tiên'}: "${texts[idx]}"`);
    }
    await options.nth(idx).click();
    return texts[idx];
  };

  // Đính kèm các file người dùng đã tải lên cho tham số `key` vào ô input[type=file]. Không có file thì bỏ qua (trả false).
  const attachFiles = async (input, key) => {
    const paths = files[key] || [];
    if (!paths.length) return false;
    await input.setInputFiles(paths);
    return true;
  };
  const has = key => (files[key] && files[key].length > 0) || String(params[key] ?? '').trim() !== '';
  const ctx = {
    username, startUrl: task.startUrl, testPrefix: task.testPrefix || '[AI TEST]', params, log: (...a) => log.push(a.join(' ')),
    has,                                              // tham số có giá trị không (file: có file tải lên không)
    val: (key, dflt = '') => (has(key) ? String(params[key]).trim() : dflt),   // giá trị, trống thì dùng mặc định
    list: key => splitList(params[key])               // tham số kiểu danh sách: tách theo dấu phẩy, chấm phẩy hoặc xuống dòng, bỏ trùng
  };

  const sandbox = vm.createContext({ page, ctx, step, assert, pickOption, attachFiles, console: { log: ctx.log }, setTimeout, URL });
  let error = '', timer;
  try {
    const fn = vm.runInContext(`(async () => {\n${task.script}\n})`, sandbox, { timeout: 5000 });
    await Promise.race([
      fn(),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error(`Quá ${TIMEOUT_MS / 1000} giây`)), TIMEOUT_MS); })
    ]);
  } catch (e) { error = brief(e); }
  finally { clearTimeout(timer); }

  return { status: error ? 'FAIL' : 'PASS', steps, log, error, duration_ms: Date.now() - started };
}
