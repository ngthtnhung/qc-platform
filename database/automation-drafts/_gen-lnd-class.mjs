// Sinh tác vụ Tạo lớp học (LND) từ luồng đã chạy tay trên staging ngày 16/11/2026. Chạy: node database/automation-drafts/_gen-lnd-class.mjs
import fs from 'node:fs';
import { normalizeTask } from '../../packages/automation-tasks/tasks.js';

const script = String.raw`const name = ctx.testPrefix + ' ' + ctx.val('ten_lop', 'Lớp học thử');
const subject = ctx.val('mon_hoc', 'MOLOP - MỞ LỚP').trim();
const lecturer = ctx.val('giang_vien', ctx.username).trim();
const students = ctx.list('hoc_vien');
const addDays = Math.max(parseInt(ctx.val('ngay_them', '1'), 10) || 0, 0);
const dlg = page.locator('[role=dialog]');
const type = async (loc, text) => { await loc.click(); await loc.pressSequentially(text); };
// Chờ danh sách gợi ý có chữ cần tìm rồi bấm (danh sách nạp chậm vài giây)
const pickText = async (text, what) => {
  const opt = page.getByText(text).last();
  await opt.waitFor({ timeout: 15000 }).catch(() => { throw new Error('Không tìm thấy ' + what + ' "' + text + '" trong danh sách'); });
  await opt.click();
};
const next = async () => { await page.getByText('Tiếp tục', { exact: true }).last().click(); };

await step('Mở form Thêm lớp học', async () => {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.getByText('Thêm lớp học', { exact: true }).first().click();
  await page.waitForURL(/\/lnd\/class\/create/, { timeout: 20000 });
});

await step('Nhập tên lớp', async () => {
  await type(page.getByRole('textbox').nth(1), name);
});

await step('Chọn môn học (chỉ có môn Cần mở lớp) và giảng viên', async () => {
  // Khối Môn học có sẵn một dòng, không bấm Thêm môn học. Gõ để lọc rồi chọn đúng dòng "mã - tên".
  await page.getByText('Môn học', { exact: true }).last().click();
  await page.keyboard.type(subject, { delay: 40 });
  await pickText(subject, 'môn học (môn hình thức Tự học không có ở đây)');
  await page.getByText('Giảng viên', { exact: true }).last().click();
  await page.keyboard.type(lecturer, { delay: 40 });
  await pickText(lecturer, 'giảng viên');
});

await step('Tiếp tục sang bước 2', async () => { await next(); await page.getByText('Danh sách học viên').first().waitFor({ timeout: 20000 }); });

await step('Thêm học viên vào lớp', async () => {
  if (!students.length) { ctx.log('Không nhập học viên: lớp phải bật cho phép tự đăng ký mới sang được bước 3'); return; }
  await page.getByText('Thêm học viên', { exact: true }).first().click();
  await dlg.waitFor({ timeout: 10000 });
  for (const code of students) {
    await dlg.getByPlaceholder('Chọn học viên').click();
    await page.keyboard.type(code, { delay: 40 });
    await pickText(code, 'học viên');
  }
  await dlg.getByText('Thêm học viên', { exact: true }).first().click(); // đóng danh sách gợi ý
  await dlg.getByRole('button', { name: 'Thêm học viên' }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 15000 });
  await page.getByText('Học viên (' + students.length + ')').first().waitFor({ timeout: 15000 });
});

await step('Tiếp tục sang bước 3', async () => { await next(); await page.getByText('Danh sách tiết học').first().waitFor({ timeout: 20000 }); });

await step('Thêm một tiết học', async () => {
  await page.getByText('Thêm tiết học', { exact: true }).first().click();
  await page.getByText('Ngày học').last().waitFor({ timeout: 10000 });
  // ngày: mở lịch, chọn hôm nay cộng ngay_them ngày (qua cuối tháng thì lấy ngày cuối tháng; lịch chỉ hiện tháng này)
  await page.getByText('Ngày học').last().click();
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = Math.min(now.getDate() + addDays, last);
  const cell = page.getByText(String(day), { exact: true });
  await (day <= 15 ? cell.first() : cell.last()).click(); // ngày đầu tháng có thêm ô của tháng sau ở cuối lịch, ngày cuối tháng có ô của tháng trước ở đầu
  await type(page.getByPlaceholder('00:00').nth(0), ctx.val('gio_bat_dau', '09:00'));
  await type(page.getByPlaceholder('00:00').nth(1), ctx.val('gio_ket_thuc', '10:00'));
  await page.getByText(/^Môn học\s*\*?$/).last().click(); // ô Môn học của tiết, chỉ có các môn đã chọn cho lớp
  await pickText(subject, 'môn học của tiết');
  await page.getByText('Thêm tiết học', { exact: true }).last().click();
  await page.getByText(/\d{2}:\d{2} - \d{2}:\d{2}/).first().waitFor({ timeout: 15000 });
});

await step('Tạo lớp học và xác nhận', async () => {
  await page.getByText('Tạo lớp học', { exact: true }).last().click();
  await dlg.getByText('Tạo lớp học ' + name).waitFor({ timeout: 10000 }).catch(() => {});
  await dlg.getByRole('button', { name: 'Tạo', exact: true }).click();
  await page.waitForURL(/\/lnd\/class\/manager/, { timeout: 30000 });
  await page.getByText(name).first().waitFor({ timeout: 20000 });
});
ctx.log('Đã tạo lớp: ' + name + ' (môn ' + subject + ', ' + students.length + ' học viên)');`;

const task = {
  name: 'Tạo lớp học [AI TEST] (môn Cần mở lớp, học viên, một tiết học)', module: 'LND', flow: 'LOP',
  description: 'Tạo một lớp học đủ ba bước: chọn môn Cần mở lớp và giảng viên, thêm học viên, thêm một tiết học rồi tạo lớp. Lớp mới ở trạng thái Chưa bắt đầu.',
  start_url: 'https://ic.zuizui.io/lnd/class/manager', required_roles: [], writes: true,
  rule_ids: ['LND-013', 'LND-014', 'LND-027', 'LND-028', 'LND-029', 'LND-030', 'LND-031', 'LND-032'],
  steps: [
    'Đăng nhập Staging bằng tài khoản quản lý học tập, mở Quản lý lớp học, bấm Thêm lớp học',
    'Nhập tên lớp: [AI TEST] {{ten_lop}}',
    'Chọn môn học {{mon_hoc}} (chỉ có môn hình thức Cần mở lớp, gõ mã hoặc tên) và giảng viên có mã {{giang_vien}} (trống: tài khoản đang chạy), bấm Tiếp tục',
    'Thêm học viên có mã nhân viên {{hoc_vien}} (nhiều người cách nhau bằng dấu phẩy), bấm Tiếp tục',
    'Thêm một tiết học: ngày hôm nay cộng {{ngay_them}} ngày, từ {{gio_bat_dau}} đến {{gio_ket_thuc}}, môn của lớp',
    'Bấm Tạo lớp học, xác nhận, kiểm tra lớp mới có trong danh sách (trạng thái Chưa bắt đầu)'
  ],
  params: [
    { key: 'ten_lop', label: 'Tên lớp (tự thêm tiền tố [AI TEST])', value: 'Lớp học thử', auto: true },
    { key: 'mon_hoc', label: 'Môn học hình thức Cần mở lớp, gõ mã hoặc tên (ví dụ MOLOP - MỞ LỚP)', value: 'MOLOP - MỞ LỚP', auto: false },
    { key: 'giang_vien', label: 'Mã nhân viên của giảng viên (trống: tài khoản đang chạy)', value: '', auto: false },
    { key: 'hoc_vien', label: 'Mã nhân viên của học viên, nhiều người cách nhau bằng dấu phẩy', value: 'VQH00652', auto: false, type: 'list' },
    { key: 'ngay_them', label: 'Số ngày cộng thêm so với hôm nay cho tiết học', value: '1', auto: true },
    { key: 'gio_bat_dau', label: 'Giờ bắt đầu tiết học (HH:MM)', value: '09:00', auto: false },
    { key: 'gio_ket_thuc', label: 'Giờ kết thúc tiết học (HH:MM)', value: '10:00', auto: false }
  ],
  script,
  source: {
    explore_date: '2026-11-16',
    note: 'Đã chạy tay đủ ba bước trên staging (THL, LNK151515, môn MOLOP, học viên VQH00652, một tiết 17/11 09:00 đến 10:00), lớp tạo ra có trạng thái Chưa bắt đầu. CHƯA replay bằng Playwright: selector theo chữ hiển thị, riêng các ô chọn Môn học, Giảng viên, ô Môn học của tiết học và ô ngày trên lịch chưa kiểm chứng trong DOM nên là chỗ dễ hỏng nhất. Khi chạy tay tôi tìm giảng viên bằng cách gõ tên, tác vụ gõ mã nhân viên. Hình thức tiết học để mặc định Online.'
  }
};
const { task: t, errors } = normalizeTask(task, { base_url: 'https://zuizui.io' });
if (errors) { console.error(errors); process.exit(1); }
fs.writeFileSync(new URL('./LND-LOP-tao-lop-hoc-ai-test.json', import.meta.url), JSON.stringify(task, null, 2));
console.log('ok', t.params.length, 'tham số');
