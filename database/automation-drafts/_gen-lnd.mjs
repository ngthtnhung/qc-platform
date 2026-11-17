// Sinh hai tác vụ LND từ các luồng đã chạy tay trên staging (16/11/2026). Chạy: node database/automation-drafts/_gen-lnd.mjs
import fs from 'node:fs';
import { normalizeTask } from '../../packages/automation-tasks/tasks.js';

const NOTE = 'Đã chạy tay đủ luồng trên staging (THL, LNK151515) ngày 16/11/2026, thao tác theo chữ hiển thị trên màn hình. CHƯA replay bằng Playwright nên selector theo chữ hiển thị và placeholder, chưa kiểm chứng trong DOM.';

const taoMon = String.raw`const name = ctx.testPrefix + ' ' + ctx.val('ten_mon', 'Môn học thử');
const publish = !/^(không|khong|no|n)$/i.test(ctx.val('xuat_ban', 'Có').trim());
const type = async (loc, text) => { await loc.click(); await loc.pressSequentially(text); };

await step('Mở form Thêm môn học', async () => {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.getByText('Thêm môn học', { exact: true }).first().click();
  await page.waitForURL(/\/lnd\/create/, { timeout: 20000 });
});

await step('Nhập mã và tên môn học', async () => {
  await type(page.getByPlaceholder('Nhập mã môn học'), ctx.val('ma_mon', 'AITEST02'));
  await type(page.getByPlaceholder('Nhập tên môn học'), name);
});

await step('Chọn hình thức học', async () => {
  await page.getByPlaceholder('Chọn hình thức học').click();
  const want = ctx.val('hinh_thuc', 'Tự học');
  const opt = page.getByText(want, { exact: true }).last();
  await opt.waitFor({ timeout: 8000 }).catch(() => { throw new Error('Hình thức học "' + want + '" không có. Chọn Tự học hoặc Cần mở lớp.'); });
  await opt.click();
  // chọn xong hệ thống tự tạo bản nháp và đổi địa chỉ sang /lnd/edit/
  await page.waitForURL(/\/lnd\/edit\//, { timeout: 20000 });
});

await step('Chọn ảnh đại diện (không chọn file thì tự tạo ảnh 352x198)', async () => {
  const fileInput = page.locator('input[type=file]').first();
  if (!(await attachFiles(fileInput, 'anh'))) {
    ctx.log('Không chọn ảnh, tự tạo ảnh PNG 352x198');
    await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 352; c.height = 198;
      const g = c.getContext('2d'); g.fillStyle = '#2d6cdf'; g.fillRect(0, 0, 352, 198); g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.fillText('[AI TEST]', 110, 110);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'ai-test-352x198.png', { type: 'image/png' }));
      const inp = document.querySelectorAll('input[type=file]')[0];
      inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  // hộp cắt ảnh: bấm Lưu
  await page.getByText('Chọn vị trí và kích thước hình').waitFor({ timeout: 15000 });
  await page.getByText('Lưu', { exact: true }).last().click();
  await page.getByText('Chọn vị trí và kích thước hình').waitFor({ state: 'hidden', timeout: 10000 });
});

await step('Nhập mô tả (bắt buộc)', async () => {
  const ed = page.locator('.ck-editor__editable').first();
  await ed.scrollIntoViewIfNeeded();
  await ed.click();
  await ed.pressSequentially(ctx.testPrefix + ' ' + ctx.val('mo_ta', 'Mô tả môn học thử'));
});

await step('Tiếp tục sang bước 2', async () => {
  await page.getByText('Tiếp tục', { exact: true }).first().click();
  await page.getByText('Thêm bài học', { exact: true }).first().waitFor({ timeout: 20000 });
});

await step('Thêm một bài học (video)', async () => {
  const lesson = ctx.testPrefix + ' ' + ctx.val('ten_bai', 'Bài học thử');
  await page.getByText('Thêm bài học', { exact: true }).first().click();
  await type(page.getByPlaceholder('Tên bài học'), lesson);
  await type(page.getByPlaceholder(/Nhập link video/), ctx.val('link_video', 'https://www.youtube.com/watch?v=sELwQ4ADFGE'));
  if (ctx.has('thoi_luong')) await type(page.getByPlaceholder('Nhập số phút'), ctx.val('thoi_luong', '1'));
  await page.getByText('Tạo bài học', { exact: true }).last().click();
  await page.getByText(lesson).first().waitFor({ timeout: 20000 });
});

if (publish) {
  await step('Xuất bản môn học', async () => {
    await page.getByRole('button', { name: 'Xuất bản' }).click();
    const dlg = page.locator('[role=dialog]');
    await dlg.getByText('Xác nhận xuất bản môn học').waitFor({ timeout: 10000 });
    await dlg.getByText('Xuất bản', { exact: true }).last().click();
    await page.waitForURL(/\/lnd\/manager\/list/, { timeout: 30000 });
    await page.getByText(name).first().waitFor({ timeout: 20000 });
  });
} else {
  await step('Lưu nháp (không xuất bản)', async () => {
    await page.getByText(/Đã lưu nháp thành công/).first().waitFor({ timeout: 20000 });
  });
}
ctx.log('Đã tạo môn học: ' + name + (publish ? ' (đã xuất bản)' : ' (bản nháp)'));`;

const taoLuot = String.raw`const subject = ctx.val('mon_hoc', ctx.testPrefix + ' Môn học thử');
const code = ctx.val('hoc_vien', ctx.username).trim();
const force = /^(có|co|yes|y)$/i.test(ctx.val('van_tao', 'Không').trim());
const dlg = page.locator('[role=dialog]');

await step('Mở hộp Tạo lượt học', async () => {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.getByText('Tạo lượt học', { exact: true }).first().click();
  await dlg.waitFor({ timeout: 10000 });
});

await step('Chọn môn học (gõ tên môn)', async () => {
  const box = dlg.getByRole('textbox').first();
  await box.click();
  await box.pressSequentially(subject);
  const opt = page.getByText(subject, { exact: true }).last();
  await opt.waitFor({ timeout: 15000 }).catch(() => { throw new Error('Không tìm thấy môn học "' + subject + '". Môn học tìm theo tên, không tìm theo mã.'); });
  await opt.click();
});

await step('Chọn học viên theo mã nhân viên', async () => {
  await dlg.getByText('Học viên').first().click();
  await page.keyboard.type(code, { delay: 40 });
  const opt = page.getByText(code).last();
  await opt.waitFor({ timeout: 15000 }).catch(() => { throw new Error('Không tìm thấy học viên có mã ' + code); });
  await opt.click();
  await dlg.getByText('Tạo lượt học', { exact: true }).first().click(); // đóng danh sách gợi ý
});

if (ctx.has('thoi_han')) {
  await step('Nhập thời hạn học (ngày)', async () => {
    const n = dlg.locator('input[type=number]');
    await n.click(); await n.pressSequentially(ctx.val('thoi_han', ''));
  });
}
if (force) {
  await step('Tích Vẫn tạo lượt học mới dù học viên đã đạt môn học', async () => {
    await dlg.getByText('Vẫn tạo lượt học mới dù học viên đã đạt môn học').click();
  });
}

await step('Bấm Tạo và kiểm tra lượt học mới', async () => {
  await dlg.getByRole('button', { name: 'Tạo', exact: true }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 20000 });
  await page.getByText(subject).first().waitFor({ timeout: 20000 });
});
ctx.log('Đã tạo lượt học: ' + subject + ' cho ' + code);`;

const tasks = [
  {
    file: 'LND-TAOMH-tao-mon-hoc-ai-test.json',
    task: {
      name: 'Tạo môn học [AI TEST] (thông tin chung, một bài học, xuất bản)', module: 'LND', flow: 'TAOMH',
      description: 'Tạo một môn học mới gồm thông tin chung, ảnh đại diện, mô tả, một bài học video, rồi xuất bản hoặc để bản nháp. Mã môn học phải khác mọi môn đã có, chạy lại thì đổi mã.',
      start_url: 'https://ic.zuizui.io/lnd/manager/list', required_roles: [], writes: true,
      rule_ids: ['LND-004', 'LND-005', 'LND-006', 'LND-007', 'LND-008', 'LND-009', 'LND-011', 'LND-012'],
      steps: [
        'Đăng nhập Staging bằng tài khoản quản lý học tập, mở Quản lý môn học, bấm Thêm môn học',
        'Nhập mã môn học {{ma_mon}} (phải chưa có) và tên môn học: [AI TEST] {{ten_mon}}',
        'Chọn hình thức học {{hinh_thuc}} (Tự học hoặc Cần mở lớp); hệ thống tự lưu nháp',
        'Chọn ảnh đại diện {{anh}} (không chọn file: tự tạo ảnh 352x198), cắt ảnh và bấm Lưu',
        'Nhập mô tả: [AI TEST] {{mo_ta}}, bấm Tiếp tục sang bước 2',
        'Thêm bài học video: [AI TEST] {{ten_bai}}, liên kết {{link_video}}, thời lượng {{thoi_luong}} phút (trống: bỏ qua), bấm Tạo bài học',
        'Xuất bản môn học: {{xuat_ban}} (Có: bấm Xuất bản và xác nhận; Không: chỉ để bản nháp)'
      ],
      params: [
        { key: 'ma_mon', label: 'Mã môn học (phải khác các môn đã có)', value: 'AITEST02', auto: false },
        { key: 'ten_mon', label: 'Tên môn học (tự thêm tiền tố [AI TEST])', value: 'Môn học thử', auto: true },
        { key: 'hinh_thuc', label: 'Hình thức học: Tự học hoặc Cần mở lớp (mới chạy thử với Tự học)', value: 'Tự học', auto: false },
        { key: 'anh', label: 'Ảnh đại diện (png hoặc jpeg; không chọn: tự tạo ảnh 352x198)', value: '', auto: false, type: 'file' },
        { key: 'mo_ta', label: 'Mô tả môn học (tự thêm tiền tố [AI TEST])', value: 'Mô tả môn học thử', auto: true },
        { key: 'ten_bai', label: 'Tên bài học (tự thêm tiền tố [AI TEST])', value: 'Bài học thử', auto: true },
        { key: 'link_video', label: 'Liên kết video của bài học', value: 'https://www.youtube.com/watch?v=sELwQ4ADFGE', auto: true },
        { key: 'thoi_luong', label: 'Thời lượng học (phút; trống: bỏ qua)', value: '1', auto: false },
        { key: 'xuat_ban', label: 'Xuất bản ngay: Có hoặc Không (Không: để bản nháp)', value: 'Có', auto: false }
      ],
      script: taoMon,
      source: { explore_date: '2026-11-16', note: NOTE + ' Ô thời lượng nhập 1 phút nhưng hiển thị 3, nghi hệ thống tự lấy độ dài video (xem LND-011). Mã môn học trùng chưa thử nên chưa biết thông báo lỗi.' }
    }
  },
  {
    file: 'LND-LUOT-tao-luot-hoc-ai-test.json',
    task: {
      name: 'Tạo lượt học cho học viên [AI TEST]', module: 'LND', flow: 'LUOT',
      description: 'Giao một môn học cho học viên bằng cách tạo lượt học. Chọn môn theo tên, học viên theo mã nhân viên (trống: chính tài khoản đang chạy).',
      start_url: 'https://ic.zuizui.io/lnd/manager/learning_turn', required_roles: [], writes: true,
      rule_ids: ['LND-020', 'LND-021'],
      steps: [
        'Đăng nhập Staging bằng tài khoản quản lý học tập, mở Quản lý lượt học, bấm Tạo lượt học',
        'Chọn môn học {{mon_hoc}} (gõ đúng tên môn, không tìm theo mã)',
        'Chọn học viên có mã nhân viên {{hoc_vien}} (trống: chính tài khoản đang chạy)',
        'Thời hạn học {{thoi_han}} ngày (trống: bỏ qua); tích Vẫn tạo lượt học mới dù học viên đã đạt môn: {{van_tao}} (Có hoặc Không)',
        'Bấm Tạo, kiểm tra lượt học mới xuất hiện đầu danh sách'
      ],
      params: [
        { key: 'mon_hoc', label: 'Tên môn học đã có (mặc định là môn do tác vụ Tạo môn học tạo)', value: '[AI TEST] Môn học thử', auto: false },
        { key: 'hoc_vien', label: 'Mã nhân viên của học viên (trống: tài khoản đang chạy)', value: '', auto: false },
        { key: 'thoi_han', label: 'Thời hạn học, số ngày (trống: bỏ qua)', value: '', auto: false },
        { key: 'van_tao', label: 'Vẫn tạo lượt học mới dù học viên đã đạt môn: Có hoặc Không', value: 'Không', auto: false }
      ],
      script: taoLuot,
      source: { explore_date: '2026-11-16', note: NOTE + ' Tìm học viên theo mã nhân viên trong hộp này chưa thử (đã thử gõ tên); ở hộp Thêm học viên của kỳ thi thì tìm theo mã được.' }
    }
  }
];

for (const { file, task } of tasks) {
  const { task: t, errors } = normalizeTask(task, { base_url: 'https://zuizui.io' });
  if (errors) { console.error(file, errors); process.exit(1); }
  fs.writeFileSync(new URL('./' + file, import.meta.url), JSON.stringify(task, null, 2));
  console.log('ok', file, t.params.length, 'tham số');
}
