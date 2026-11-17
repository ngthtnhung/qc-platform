// Sinh tác vụ "Chuyển trạng thái phiếu" từ phần đã chạy được trên staging. Chạy: node database/automation-drafts/_gen-dv5s-status.mjs
import fs from 'node:fs';
import { normalizeTask } from '../../packages/automation-tasks/tasks.js';

const script = String.raw`const want = ctx.val('trang_thai', '').trim();
const isDone = /hoàn tất/i.test(want);
const isAccept = !want || /^tiếp nhận/i.test(want);
const note = ctx.testPrefix + ' ' + ctx.val('ghi_chu', 'Chuyển trạng thái thử');
const dlg = page.locator('[role=dialog]');
const shown = t => page.getByText(t, { exact: true }).first().isVisible().catch(() => false);
const click = t => page.getByText(t, { exact: true }).first().click();

await step('Mở phiếu cần chuyển trạng thái', async () => {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  const allTab = page.getByText('Tất cả', { exact: true }).first();
  if (await allTab.waitFor({ timeout: 12000 }).then(() => true).catch(() => false)) await allTab.click();
  else ctx.log('Không thấy tab Tất cả (tài khoản có thể là dạng người tạo), tìm trong danh sách đang hiện');
  const name = ctx.val('phieu', '');
  const row = name ? page.getByText(name).first() : page.getByText(ctx.testPrefix).first();
  await row.waitFor({ timeout: 30000 }).catch(() => { throw new Error('Không thấy phiếu trong danh sách của tài khoản này. Kiểm tra tài khoản có quyền xử lý phiếu và đã có phiếu [AI TEST] (chạy tác vụ Tạo phiếu trước), hoặc nhập tên phiếu.'); });
  ctx.log('Phiếu: ' + ((await row.textContent()) || '').trim().slice(0, 80));
  await row.click();
  await page.waitForURL(/\/maintenance\/doing\/detail\//, { timeout: 20000 });
  await page.getByText(/Tiếp nhận phiếu|Hoàn tất phiếu/).first().waitFor({ timeout: 20000 }).catch(() => { throw new Error('Phiếu đã mở nhưng không có nút Tiếp nhận phiếu hoặc Hoàn tất phiếu: tài khoản này không có quyền xử lý phiếu, hoặc phiếu đã hoàn tất. Chọn tài khoản xử lý phiếu hoặc phiếu khác.'); });
});

// Tiếp nhận: cửa sổ có ô Trạng thái điền sẵn bước kế tiếp; muốn trạng thái khác thì chọn trong ô đó
async function receive(pickStatus) {
  await click('Tiếp nhận phiếu');
  await dlg.waitFor({ timeout: 10000 });
  if (pickStatus) {
    await dlg.getByRole('button', { name: 'Open' }).first().click();
    await pickOption(page.locator('[role=listbox] li'), 'trang_thai');
  }
  const noteBox = dlg.locator('textarea').first();
  if (pickStatus && (await noteBox.count())) { await noteBox.click(); await noteBox.pressSequentially(note); }
  if (pickStatus && (await attachFiles(dlg.locator('input[type=file]').first(), 'tep'))) await page.waitForTimeout(2000);
  await dlg.getByText('Xác nhận', { exact: true }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 15000 });
}

if (isAccept || isDone) {
  await step('Tiếp nhận phiếu', async () => {
    if (await shown('Tiếp nhận phiếu')) { await receive(false); await page.getByText('Hoàn tất phiếu', { exact: true }).first().waitFor({ timeout: 20000 }); }
    else if (isAccept) throw new Error('Phiếu này đã tiếp nhận rồi (không còn nút Tiếp nhận phiếu). Chọn phiếu khác hoặc chọn trạng thái Hoàn tất xử lý.');
    else ctx.log('Phiếu đã tiếp nhận từ trước, chuyển thẳng sang Hoàn tất');
  });
} else {
  await step('Chuyển sang trạng thái ' + want, async () => {
    if (!(await shown('Tiếp nhận phiếu'))) throw new Error('Phiếu đã tiếp nhận nên không còn cửa sổ đổi trạng thái; chỉ còn nút Hoàn tất phiếu. Chọn phiếu chưa tiếp nhận.');
    await receive(true);
  });
}

if (isDone) {
  await step('Hoàn tất phiếu', async () => {
    await click('Hoàn tất phiếu');
    await dlg.waitFor({ timeout: 10000 });
    if (await attachFiles(dlg.locator('input[type=file]').first(), 'tep')) await page.waitForTimeout(2000);
    const box = dlg.locator('textarea[placeholder="Thêm nội dung ghi chú"]');
    await box.click();
    await box.pressSequentially(note);
    await dlg.getByText('Hoàn tất', { exact: true }).click();
    await dlg.waitFor({ state: 'hidden', timeout: 15000 });
    await page.getByText('Hoàn tất xử lý').first().waitFor({ timeout: 20000 });
  });
}
ctx.log('Đã chuyển phiếu: ' + (want || 'bước kế tiếp'));`;

const task = {
  name: 'Chuyển trạng thái phiếu bảo trì [AI TEST] (chọn trạng thái)',
  module: 'DV5S', flow: 'XL',
  description: 'Chuyển một phiếu bảo trì sang trạng thái bạn chọn khi chạy: Tiếp nhận, Hoàn tất xử lý hoặc một trạng thái khác trong ô Trạng thái. Kèm ghi chú và file nếu cần. Tạo phiếu là tác vụ riêng.',
  start_url: 'https://tasks.zuizui.io/maintenance/doing/list',
  required_roles: [], writes: true,
  rule_ids: ['DV5S-057', 'DV5S-087', 'DV5S-088', 'DV5S-002', 'DV5S-041', 'DV5S-043'],
  steps: [
    'Đăng nhập Staging bằng tài khoản có quyền xử lý phiếu, mở Danh sách xử lý phiếu, tab Tất cả',
    'Mở phiếu {{phieu}} (trống: phiếu [AI TEST] mới nhất ở đầu danh sách)',
    'Chuyển phiếu sang trạng thái {{trang_thai}} (trống hoặc Tiếp nhận: bấm Tiếp nhận phiếu, giữ trạng thái điền sẵn; Hoàn tất xử lý: tiếp nhận nếu chưa rồi bấm Hoàn tất phiếu; trạng thái khác: chọn trong ô Trạng thái)',
    'Nhập ghi chú hoặc lý do: [AI TEST] {{ghi_chu}} (trống: dùng ghi chú mặc định), đính kèm file {{tep}} (không chọn: bỏ qua), bấm xác nhận',
    'Kiểm tra cửa sổ đóng lại; nếu Hoàn tất thì phiếu ở trạng thái Hoàn tất xử lý'
  ],
  params: [
    { key: 'phieu', label: 'Tên hoặc nội dung phiếu cần chuyển (trống: phiếu [AI TEST] mới nhất)', value: '', auto: false },
    { key: 'trang_thai', label: 'Trạng thái cần chuyển tới (trống hoặc Tiếp nhận: bước kế tiếp; Hoàn tất xử lý; hoặc tên trạng thái trong danh sách)', value: '', auto: false },
    { key: 'ghi_chu', label: 'Ghi chú hoặc lý do (tự thêm tiền tố [AI TEST])', value: 'Chuyển trạng thái thử', auto: true },
    { key: 'tep', label: 'File đính kèm khi chuyển (ảnh, PDF, Word, Excel, zip...; không chọn: bỏ qua)', value: '', auto: false, type: 'file' }
  ],
  script,
  source: {
    explore_date: '2026-11-16',
    note: 'Đã chạy tay trên staging: Tiếp nhận phiếu (giữ trạng thái điền sẵn) và Hoàn tất phiếu kèm ghi chú. CHƯA chạy lại bằng Playwright, và CHƯA kiểm chứng nhánh chọn trạng thái khác trong ô Trạng thái của cửa sổ Tiếp nhận (dùng nút Open và danh sách như các ô chọn khác của module); nếu sai, tác vụ báo lỗi kèm danh sách lựa chọn.'
  }
};
const { task: t, errors } = normalizeTask(task, { base_url: 'https://zuizui.io' });
if (errors) { console.error(errors); process.exit(1); }
fs.writeFileSync(new URL('./DV5S-XL-chuyen-trang-thai-phieu-ai-test.json', import.meta.url), JSON.stringify(task, null, 2));
console.log('ok', t.params.length, 'tham số');
