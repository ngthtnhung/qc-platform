/**
 * Kiểm thử tác vụ tự động: chuẩn hóa/chặn code, chọn tài khoản, quy tắc duyệt, tham số và runner.
 */
import { normalizeTask, normalizeParams, mergeParams, chooseAccount, isRunnable, sha } from '../packages/automation-tasks/tasks.js';
import { runTask } from '../apps/launcher/task-runner.js';
import { fetchTaskFiles } from '../apps/launcher/task-files.js';
import { analyzeLocal, analyzeAI, matchTasks } from '../packages/bug-search/analysis.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function runAutomationTaskTests() {
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const stg = { base_url: 'https://zuizui.io/' };
const base = { name: 'T', module: 'DV5S', start_url: 'https://tasks.zuizui.io/x', steps: ['a'], script: "await step('s', async () => {});" };

// 1. chuẩn hóa
assert(normalizeTask(base, stg).task, 'tác vụ hợp lệ được nhận');
assert(normalizeTask({ ...base, start_url: 'http://tasks.zuizui.io/x' }, stg).errors, 'http bị từ chối');
assert(normalizeTask({ ...base, start_url: 'https://evil.com/x' }, stg).errors, 'tên miền lạ bị từ chối');
assert(normalizeTask({ ...base, steps: [] }, stg).errors, 'thiếu steps bị từ chối');
for (const bad of ["require('fs')", 'process.exit(1)', "import('x')", 'eval("1")', 'page.constructor.constructor("return 1")']) {
  assert(normalizeTask({ ...base, script: bad }, stg).errors, `cú pháp cấm bị chặn: ${bad}`);
}
console.log('✓ Test 1 Passed: chuẩn hóa và chặn code nguy hiểm');

// 2. chọn tài khoản
const accs = [
  { id: 'a1', role: 'Người tạo phiếu', has_secret: false },
  { id: 'a2', role: 'QUẢN TRỊ HỆ THỐNG', has_secret: true },
  { id: 'a3', role: 'Người tạo phiếu', has_secret: true }
];
assert(chooseAccount({ required_roles: ['người tạo phiếu'] }, accs).id === 'a3', 'khớp vai trò và có mật khẩu được ưu tiên');
assert(chooseAccount({ required_roles: ['thủ kho'] }, accs).id === 'a2', 'không khớp vai trò thì dùng tài khoản quản trị');
assert(chooseAccount({ required_roles: ['thủ kho'] }, [accs[0]]) === null, 'không có tài khoản phù hợp thì trả null');
assert(chooseAccount({ required_roles: [] }, accs).id === 'a2' || chooseAccount({ required_roles: [] }, accs).has_secret, 'không đòi vai trò thì ưu tiên tài khoản có mật khẩu');
console.log('✓ Test 2 Passed: tự chọn tài khoản');

// 3. duyệt gắn mã băm
const t = { status: 'approved', approved_sha: sha('x'), script_sha: sha('x') };
assert(isRunnable(t), 'đã duyệt đúng mã băm thì chạy được');
assert(!isRunnable({ ...t, script_sha: sha('y') }), 'code đổi sau duyệt thì không chạy');
assert(!isRunnable({ ...t, status: 'draft' }), 'nháp thì không chạy');
console.log('✓ Test 3 Passed: duyệt gắn với mã băm');

// 4. runner
const page = { title: async () => 'ok' };
const mk = (script, params) => ({ script, sha: sha(script), startUrl: 'https://x', testPrefix: '[AI TEST]', params });
let r = await runTask({ task: mk("await step('a', async () => assert((await page.title()) === 'ok', 'x')); ctx.log('hi');"), page, username: 'u' });
assert(r.status === 'PASS' && r.steps[0].status === 'PASS' && r.log[0] === 'hi', 'script đạt');
r = await runTask({ task: mk("await step('a', async () => assert(false, 'sai rồi'));"), page, username: 'u' });
assert(r.status === 'FAIL' && r.steps[0].error === 'sai rồi', 'script lỗi báo đúng bước');
let threw = false;
try { await runTask({ task: { ...mk('1'), sha: 'sai' }, page, username: 'u' }); } catch { threw = true; }
assert(threw, 'mã băm không khớp thì từ chối chạy');
r = await runTask({ task: mk("typeof process === 'undefined' && typeof require === 'undefined' ? 0 : (() => { throw new Error('lộ'); })()"), page, username: 'u' });
assert(r.status === 'PASS', 'sandbox không có process/require');
console.log('✓ Test 4 Passed: runner chạy, báo lỗi, kiểm mã băm');

// 5. tham số: chuẩn hóa, ghi đè lúc chạy, và chọn mục theo tham số
assert(normalizeParams([{ key: 'don_vi', value: 'A' }]).params[0].auto === true, 'auto mặc định bật');
assert(normalizeParams([{ key: 'Sai Khoa', value: 'A' }]).errors.length === 1, 'khóa sai bị từ chối');
assert(normalizeParams([{ key: 'a', value: 'x' }, { key: 'a', value: 'y' }]).errors.length === 1, 'trùng khóa bị từ chối');
assert(normalizeParams([{ key: 'a', value: 'x'.repeat(201) }]).errors.length === 1, 'giá trị quá dài bị từ chối');
const withParams = normalizeTask({ ...base, params: [{ key: 'don_vi', label: 'Đơn vị', value: 'Văn phòng 1' }] }, stg).task;
assert(withParams.params[0].value === 'Văn phòng 1', 'tác vụ lưu tham số');
assert(mergeParams(withParams, { don_vi: 'Trụ sở chính', la: 'bỏ' })[0].value === 'Trụ sở chính', 'giá trị ghi đè lúc chạy được dùng');
assert(mergeParams(withParams, { khong_co: 'x' }).length === 1, 'khóa lạ không được thêm vào');

// danh sách giả: mỗi mục có innerText; locator giả có first/allInnerTexts/nth(i).click()
const fakeList = items => { const clicked = []; return { clicked, first: () => ({ waitFor: async () => {} }), allInnerTexts: async () => items, nth: i => ({ click: async () => { clicked.push(items[i]); } }) }; };
const L1 = fakeList(['Máy lạnh', 'Máy in', 'Khác']);
// danh sách được truyền qua page giả để code trong sandbox gọi pickOption(page.list, 'k')
const mkList = (list, params) => runTask({ task: mk("await step('c', async () => { await pickOption(page.list, 'k'); });", params), page: { list }, username: 'u' });
r = await mkList(L1, [{ key: 'k', value: 'may in', auto: true }]);
assert(r.status === 'PASS' && L1.clicked[0] === 'Máy in', 'chọn đúng mục, bỏ dấu và hoa thường');
const L2 = fakeList(['Văn phòng 1', 'Trụ sở chính']);
r = await mkList(L2, [{ key: 'k', value: 'Cửa hàng không tồn tại', auto: true }]);
assert(r.status === 'PASS' && L2.clicked[0] === 'Văn phòng 1' && /Không có/.test(r.log[0]), 'không có thì chọn mục đầu tiên và ghi log');
const L3 = fakeList(['Văn phòng 1', 'Trụ sở chính']);
r = await mkList(L3, [{ key: 'k', value: 'Cửa hàng không tồn tại', auto: false }]);
assert(r.status === 'FAIL' && /Đang có: Văn phòng 1/.test(r.error) && L3.clicked.length === 0, 'tắt auto thì báo lỗi kèm danh sách đang có');
const L4 = fakeList(['A', 'B']);
r = await mkList(L4, [{ key: 'k', value: '', auto: true }]);
assert(r.status === 'PASS' && L4.clicked[0] === 'A', 'để trống thì lấy mục đầu tiên');
r = await runTask({ task: mk("await step('p', async () => assert(ctx.params.x === '5', 'sai'));", [{ key: 'x', value: '5', auto: true }]), page, username: 'u' });
assert(r.status === 'PASS', 'code đọc được ctx.params');
console.log('✓ Test 5 Passed: tham số, ghi đè khi chạy, chọn mục tự thích ứng');

// 6. kiểu tham số list và file, helper ctx.*, attachFiles, chọn ngẫu nhiên, chờ danh sách, và tải file về máy
assert(normalizeParams([{ key: 'a', value: 'x', type: 'list' }]).params[0].type === 'list', 'kiểu list được nhận');
assert(normalizeParams([{ key: 'a', value: 'x', type: 'la' }]).params[0].type === 'text', 'kiểu lạ về text');
assert(normalizeParams([{ key: 'a', value: 'f_abc12345', type: 'file' }]).errors.length === 0, 'mã file hợp lệ được nhận');
assert(normalizeParams([{ key: 'a', value: '../../etc/passwd', type: 'file' }]).errors.length === 1, 'mã file lạ bị từ chối (chống thoát thư mục)');
assert(normalizeParams([{ key: 'a', value: 'x'.repeat(900), type: 'list' }]).errors.length === 0, 'danh sách dài tới 1000 ký tự');
assert(normalizeParams([{ key: 'a', value: 'x'.repeat(201), type: 'text' }]).errors.length === 1, 'chữ tối đa 200 ký tự');
assert(normalizeTask({ ...base, script: "await page.locator('input').setInputFiles('C:/x')" }, stg).errors, 'setInputFiles tùy ý bị chặn');
assert(normalizeTask({ ...base, script: "await attachFiles(page.locator('input'), 'tep')" }, stg).task, 'attachFiles được phép');

const calls = [];
const fakeInput = { setInputFiles: async p => { calls.push(p); } };
r = await runTask({ task: mk("await step('f', async () => { ctx.log(String(await attachFiles(page.input, 'tep'))); });", [{ key: 'tep', value: 'f_abc12345', type: 'file' }]), page: { input: fakeInput }, username: 'u', files: { tep: ['/tmp/a.png', '/tmp/b.png'] } });
assert(r.status === 'PASS' && calls[0].length === 2 && r.log[0] === 'true', 'attachFiles gắn đúng các file đã tải về');
calls.length = 0;
r = await runTask({ task: mk("await step('f', async () => { ctx.log(String(await attachFiles(page.input, 'tep'))); });", [{ key: 'tep', value: '', type: 'file' }]), page: { input: fakeInput }, username: 'u', files: {} });
assert(r.status === 'PASS' && calls.length === 0 && r.log[0] === 'false', 'không có file thì bỏ qua');

const helpers = "await step('h', async () => { ctx.log(JSON.stringify([ctx.list('ds'), ctx.has('trong'), ctx.has('co'), ctx.val('trong', 'mặc định'), ctx.val('co', 'x')])); });";
r = await runTask({ task: mk(helpers, [{ key: 'ds', value: 'A1, b2;A1\nc3,, ', type: 'list' }, { key: 'trong', value: '  ', type: 'text' }, { key: 'co', value: ' g ', type: 'text' }]), page, username: 'u' });
assert(r.log[0] === '[["A1","b2","c3"],false,true,"mặc định","g"]', 'ctx.list/has/val: tách, bỏ trùng, bỏ trống, mặc định');

// chọn theo giá trị truyền vào (lặp qua danh sách người nhận), không dùng tham số
const L5 = fakeList(['Nguyễn A • NV001', 'Trần B • NV002']);
r = await runTask({ task: mk("await step('c', async () => { await pickOption(page.list, 'k', 'nv002'); });", [{ key: 'k', value: 'khong dung', type: 'list', auto: false }]), page: { list: L5 }, username: 'u' });
assert(r.status === 'PASS' && L5.clicked[0] === 'Trần B • NV002', 'pickOption theo giá trị truyền vào');

// để trống + random: chọn ngẫu nhiên trong danh sách (kiểm 40 lần: luôn hợp lệ, và không phải lần nào cũng là mục đầu)
const seen = new Set();
for (let i = 0; i < 40; i++) {
  const L = fakeList(['A', 'B', 'C', 'D']);
  r = await mkList(L, [{ key: 'k', value: '', auto: true, fallback: 'random' }]);
  assert(r.status === 'PASS' && ['A', 'B', 'C', 'D'].includes(L.clicked[0]), 'random chọn mục hợp lệ');
  seen.add(L.clicked[0]);
}
assert(seen.size > 1, 'random không luôn chọn một mục');
const L6 = fakeList(['A', 'B']);
r = await mkList(L6, [{ key: 'k', value: 'khong co', auto: true, fallback: 'random' }]);
assert(r.status === 'PASS' && /Không có "khong co"/.test(r.log[0]), 'không có giá trị thì chọn ngẫu nhiên và ghi log');

// danh sách nạp chậm: lần đầu chưa có mục khớp, lần sau mới có
let polls = 0; const slowClicked = [];
const slow = { first: () => ({ waitFor: async () => {} }), allInnerTexts: async () => (++polls < 3 ? ['Mục cũ'] : ['Mục cũ', 'Nguyễn Văn Mới • NV009']), nth: i => ({ click: async () => { slowClicked.push(i); } }) };
r = await runTask({ task: mk("await step('c', async () => { await pickOption(page.list, 'k', 'NV009'); });", [{ key: 'k', value: '', type: 'list', auto: false }]), page: { list: slow }, username: 'u' });
assert(r.status === 'PASS' && slowClicked[0] === 1 && polls >= 3, 'chờ danh sách lọc xong rồi mới chọn');

// tải file về máy: chỉ file của tham số, xóa sau khi chạy, mã lạ bị từ chối
const stubApi = async (p, o = {}) => (p.endsWith('/meta') ? { name: 'ảnh thử?.png' } : Buffer.from('PNGDATA'));
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-test-'));
const got = await fetchTaskFiles(stubApi, 'sess_1', [{ key: 'anh', type: 'file', value: 'f_abc12345,f_def67890' }, { key: 'x', type: 'text', value: 'bỏ qua' }], tmpBase);
assert(got.files.anh.length === 2 && got.files.anh.every(f => fs.readFileSync(f, 'utf8') === 'PNGDATA' && f.startsWith(tmpBase)), 'tải đủ file về thư mục tạm');
assert(!('x' in got.files), 'chỉ tham số kiểu file');
got.cleanup();
assert(!fs.existsSync(path.join(tmpBase, 'qa-launcher', 'sess_1')), 'xóa file sau khi chạy');
let rejected = false;
try { await fetchTaskFiles(stubApi, 'sess_2', [{ key: 'anh', type: 'file', value: '../../etc/passwd' }], tmpBase); } catch { rejected = true; }
assert(rejected, 'mã file lạ bị từ chối');
fs.rmSync(tmpBase, { recursive: true, force: true });
console.log('✓ Test 6 Passed: danh sách, file, ngẫu nhiên khi trống, chờ danh sách, tải file an toàn');

// phân tích bug: khớp tác vụ, AI chỉ nhận mã tác vụ có thật
const tasksX = [{ id: 'at_1', name: 'Tạo phiếu bảo trì', module: 'DV5S', steps: ['Chọn phân loại'], flow: 'TAO' }, { id: 'at_2', name: 'Soạn thư', module: 'MAIL', steps: [] }];
assert(matchTasks('không tạo được phiếu bảo trì', tasksX)[0].id === 'at_1', 'khớp tác vụ theo từ khóa');
const loc = analyzeLocal({ text: 'xyz', moduleUsed: '', moduleGuess: '', rules: [], bugs: [], tasks: tasksX });
assert(loc.engine === 'local' && loc.causes.length && loc.new_task, 'không có dữ liệu thì nói rõ và gợi ý tạo tác vụ');
const fakeFetch = async () => ({ ok: true, json: async () => ({ content: [{ text: 'Kết quả: {"causes":["a"],"checks":["b"],"task_ids":["at_2","at_bia"],"new_task":""}' }] }) });
const ai = await analyzeAI({ text: 'mô tả bug dài đủ', rules: [], bugs: [], tasks: tasksX }, { apiKey: 'k', fetchImpl: fakeFetch });
assert(ai.engine === 'ai' && ai.tasks.length === 1 && ai.tasks[0].id === 'at_2', 'mã tác vụ bịa bị loại');
const gemFetch = async (url, o) => { assert(url.includes('gemini-3.5-flash:generateContent') && o.headers['x-goog-api-key'] === 'g' && !url.includes('key='), 'Gemini: đúng địa chỉ, khóa nằm trong header'); return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"causes":["c"],"checks":[],"task_ids":["at_1"],"new_task":""}' }] } }] }) }; };
const gm = await analyzeAI({ text: 'mô tả bug dài đủ', rules: [], bugs: [], tasks: tasksX }, { provider: 'gemini', apiKey: 'g', fetchImpl: gemFetch });
assert(gm.engine === 'ai' && gm.tasks[0].id === 'at_1' && /gemini/.test(gm.engine_note), 'Gemini trả kết quả đúng');
console.log('✓ Test 7 Passed: phân tích bug (khớp tác vụ, AI lọc mã bịa)');
}
