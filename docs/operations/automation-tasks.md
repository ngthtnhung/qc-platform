# Tác vụ tự động hóa (Playwright)

Khi khám phá module, mỗi luồng người dùng làm được từ đầu đến cuối trên Staging được ghi thành một **tác vụ**
kèm code Playwright. Người dùng bấm **Chạy tác vụ** ở tab "5. Tác Vụ Tự Động": hệ thống tự chọn tài khoản
phù hợp, QA Launcher trên máy người đó mở Chrome, đăng nhập, rồi chạy code và báo kết quả từng bước.

## Vòng đời và an toàn

1. Tác vụ do Claude (lúc khám phá) hoặc người ghi đẩy lên, hoặc sửa trên platform, **dùng được ngay**: server tự ghi nhận bản code đó (mã băm) là sẵn sàng chạy. Không còn bước duyệt thủ công (quyết định 16/11/2026). Ai có quyền sửa tác vụ thì sửa được code ngay trong nút Sửa.
3. **Chạy**: chỉ trên **Staging**. Launcher kiểm tra lại mã băm trước khi chạy. Mỗi lần chạy lưu kết quả (người chạy, tài khoản, từng bước).

Hàng rào `vm` và danh sách cú pháp cấm chỉ chặn lỗi vô ý, không phải ranh giới bảo mật. Vì không còn bước duyệt, ai có quyền đẩy hoặc sửa tác vụ đều chạy được code trên máy thành viên: chỉ cấp quyền `automation` và `automation_push` cho người tin cậy.
Code chạy với quyền của tài khoản test trên máy người bấm, nên chỉ cấp quyền `automation` cho người đọc được code.

## Định dạng tác vụ (JSON)

| Trường | Ý nghĩa |
|---|---|
| `name`, `module`, `flow` | Tên tác vụ, mã module (ví dụ DV5S), mã luồng (ví dụ TAO, XL) |
| `description` | Tác vụ làm gì, đúng với rule nào |
| `start_url` | Link https cùng tên miền Staging, nơi bắt đầu sau đăng nhập |
| `required_roles` | Vai trò tài khoản cần (khớp một phần, không phân biệt hoa thường), ví dụ `["người tạo phiếu"]`. Bỏ trống: tài khoản nào cũng được |
| `writes` | `true` nếu tạo hoặc sửa dữ liệu. Dữ liệu tạo ra phải có tiền tố `ctx.testPrefix` (`[AI TEST]`) |
| `rule_ids` | Rule liên quan trong Kho Business Rule, ví dụ `["DV5S-001"]` |
| `steps` | Các bước bằng lời để người duyệt đọc. Viết `{{khoa}}` để chèn ô giá trị (tham số) vào câu |
| `params` | Tham số: `[{ "key": "don_vi", "label": "Đơn vị phát sinh", "value": "Công nghệ thông tin", "auto": true }]`. Code đọc bằng `ctx.params.don_vi` |
| `script` | Thân hàm async. Dùng `page`, `ctx`, `step(tên, async () => ...)`, `assert(điều kiện, thông báo)` |
| `source` | `{ "explore_date": "...", "note": "..." }` |

Chọn tài khoản: ưu tiên khớp `required_roles`, nếu không có thì tài khoản quản trị; ưu tiên tài khoản đã lưu mật khẩu. Người chạy có thể chọn tay ở danh sách thả xuống trên thẻ tác vụ.

## Quy tắc khi Claude khám phá module và ghi tác vụ

- Chỉ ghi tác vụ cho luồng **đã chạy thành công thật** trên Staging. Selector lấy từ trang thật, không đoán.
- Không đưa mật khẩu, token hay dữ liệu thật của khách vào script. Dữ liệu tạo mới dùng `ctx.testPrefix`.
- Không tự động hóa thao tác xóa hàng loạt hay thay đổi cấu hình đang dùng chung; ghi chú lại thành tác vụ `writes: true` và nói rõ tác động.
- Mỗi tác vụ nhỏ, một luồng, có `assert` cho kết quả mong đợi gắn với rule.
- Ghi xong, đẩy lên server (dùng được ngay):

```powershell
$env:QA_SERVER_URL="https://172.16.13.8:3001"; $env:QA_TOKEN="qa_token"; node scripts/automation-add.mjs duong-dan\tac-vu.json
```

Tác vụ mẫu để thử khung: `database/automation-samples/sample-maintenance-list-loads.json`.

## Ví dụ script

```js
await step('Mở danh sách', async () => {
  await page.waitForLoadState('networkidle');
});
await step('Tạo phiếu thử', async () => {
  await page.getByRole('button', { name: 'Tạo phiếu' }).click();
  await page.getByLabel('Tiêu đề').fill(ctx.testPrefix + ' phiếu thử');
  await page.getByRole('button', { name: 'Gửi' }).click();
});
await step('Phiếu xuất hiện trong danh sách', async () => {
  await page.getByText(ctx.testPrefix + ' phiếu thử').waitFor({ timeout: 10000 });
});
```

## Tham số: đổi giá trị mà không sửa code

Giá trị phụ thuộc dữ liệu hoặc tài khoản (phân loại, đơn vị, giờ, ghi chú...) **không được viết cứng trong code**; đưa vào `params` và đọc bằng `ctx.params.khoa`.
Vì mỗi tài khoản thấy danh mục khác nhau, code chọn mục trong danh sách bằng `pickOption(danhSachMuc, 'khoa')`:
- tìm đúng chữ, rồi chứa chữ, không phân biệt dấu và hoa thường;
- không thấy mà `auto` bật thì chọn **mục đầu tiên** và ghi vào log ("Không có ..., đã chọn ..."); `auto` tắt thì báo lỗi kèm các lựa chọn đang có.

Trên tab 5, các `{{khoa}}` trong mô tả bước hiện thành **ô nhập**. Sửa giá trị trong ô để chạy lần đó với giá trị khác; bấm "Lưu làm mặc định" để giữ lại. Đổi tham số hoặc mô tả bước **không làm mất duyệt**, chỉ sửa code mới mất duyệt.
Nút "Sửa" mở cửa sổ chỉnh tên, mô tả, link, vai trò, các bước, tham số và **code** trực tiếp.

```js
await step('Chọn đơn vị', async () => {
  await dlg.getByRole('button', { name: 'Open' }).nth(2).click();
  await pickOption(page.locator('[role=listbox] li'), 'don_vi');
});
```

## Chạy một tác vụ nhiều lần

Ở thẻ tác vụ đã duyệt, ô **Số lần** (1 đến 50) cho chạy liên tiếp một tác vụ nhiều lần với cùng tài khoản và cùng giá trị trong các ô.
- Kết quả hiện theo từng lần (đạt hoặc không đạt, thời gian, bước lỗi) và tổng đạt/không đạt, thời gian trung bình.
- Ô **dừng khi lỗi** (mặc định bật) dừng ngay khi một lần không đạt; bỏ chọn để chạy đủ số lần. Nút **Dừng** dừng sau lần đang chạy.
- Lỗi hạ tầng (launcher chưa chạy, cần đăng nhập thủ công) dừng cả lượt.
- Mỗi lần là một phiên riêng, được lưu kèm mã lượt chạy. Server giới hạn 120 lần bắt đầu chạy trong 10 phút cho mỗi người dùng.
- Tác vụ tạo dữ liệu (ví dụ gửi thư, tạo phiếu) tạo thêm dữ liệu `[AI TEST]` sau mỗi lần; chọn số lần vừa đủ.

## Tham số danh sách, file đính kèm và ô để trống

Mỗi tham số có **loại**:
- **Chữ**: một giá trị.
- **Danh sách**: nhiều giá trị cách nhau bằng dấu phẩy, chấm phẩy hoặc xuống dòng (ví dụ người nhận thư `NTTN191919, VQH00652`). Code đọc bằng `ctx.list('khoa')`.
- **File**: người dùng bấm **Chọn file** ngay trong mô tả bước (ảnh PNG, JPG, GIF, WEBP, BMP hoặc PDF, mỗi file tối đa 10 MB, chọn nhiều file được). File tải lên server, launcher tải về máy người chạy cho lần chạy đó rồi xóa. Code gắn bằng `await attachFiles(inputFile, 'khoa')`, trả `false` nếu không có file (bỏ qua). Không được dùng `setInputFiles` trực tiếp.

**Ô để trống:**
- Tham số tùy chọn (CC, nội dung, file): code kiểm tra `ctx.has('khoa')` hoặc `ctx.val('khoa', macDinh)` rồi bỏ qua hoặc dùng mặc định.
- Tham số bắt buộc, chọn trong danh mục (phân loại, đơn vị): cột **"Khi trống hoặc không có"** quyết định: *Báo lỗi nếu không có*, *Chọn mục đầu tiên*, hoặc *Chọn ngẫu nhiên* một mục hợp lệ của tài khoản đang chạy (ghi vào log). Người nhận thư để trống thì gửi cho chính tài khoản đang chạy.
- `pickOption(danhSach, 'khoa', giaTriTuyChon)` chờ tối đa 6 giây cho danh sách gợi ý lọc xong. Truyền giá trị thứ ba khi lặp qua một danh sách (từng người nhận).

## Kho file test và dữ liệu do tác vụ tạo
- Tab 5 có mục **Kho file test**: tải file lên một lần (ảnh, PDF, Word doc/docx, Excel xls/xlsx, PowerPoint ppt/pptx, txt, csv, md, rtf, zip; tối đa 10 MB mỗi file, 100 file; server kiểm tra theo nội dung, không nhận chương trình, script hay file có macro), file lưu lâu dài. Khi tác vụ cần đính kèm, bấm **Chọn ảnh** trong mô tả bước rồi tick tên file; cũng tải ảnh mới lên kho ngay trong hộp chọn. Xóa ảnh khỏi kho thì tác vụ đang chọn ảnh đó báo thiếu file.
- Dữ liệu do tác vụ tạo ra dùng đúng nội dung đã nhập trong mô tả bước (cộng tiền tố `[AI TEST]`), không gắn dãy số thời gian.
- Đổi tab không làm mất kết quả hoặc lần chạy đang diễn ra, chỉ tải lại trang mới làm mới.

## AI phân tích bug (tab 2)
Gõ mô tả, sau khoảng 2 giây ngừng gõ hệ thống hiện mục **AI phân tích**: có thể do đâu, cần kiểm tra module và màn hình nào, tác vụ tự động hóa gợi ý. Đặt biến môi trường `GEMINI_API_KEY` (Google Gemini, mặc định `gemini-3.5-flash`) hoặc `ANTHROPIC_API_KEY` (Claude) trên server để dùng mô hình AI; có cả hai thì dùng Gemini. Tùy chọn `QA_AI_MODEL`, `GEMINI_BASE_URL`, `ANTHROPIC_BASE_URL`; mô tả và dữ liệu liên quan sẽ được gửi tới dịch vụ AI đó. Không có khóa thì hệ thống phân tích theo dữ liệu (thống kê bug cũ, rule, khớp từ khóa) và ghi rõ là chưa dùng AI.

## Mỗi tác vụ một hành động
Tạo phiếu, tiếp nhận, chuyển trạng thái, hoàn tất, đánh giá là các tác vụ riêng, mỗi tác vụ bắt đầu từ một phiếu có sẵn (tham số nêu tên phiếu; trống là phiếu `[AI TEST]` mới nhất). Các thao tác cùng một màn hình chỉ khác đích đến gộp thành một tác vụ có tham số chọn đích, ví dụ **Chuyển trạng thái phiếu bảo trì** có ô Trạng thái (trống hoặc Tiếp nhận, Hoàn tất xử lý, hoặc tên một trạng thái khác). Chọn sai thì báo lỗi kèm danh sách lựa chọn, không tự chọn thay.

## Đưa rule và tác vụ từ Explore lên platform
Sau mỗi lần Explore, skill tự xuất rule từ Kho vào `database/kb-snapshot/` rồi chạy `node scripts/qa-sync.mjs --no-bugs`. Lệnh này đẩy rule và mọi tác vụ trong `database/automation-drafts/` lên server nhóm; rule được nhóm theo module trên platform. Mọi người nhận bản mới trong vòng 1 phút, không cần thao tác thêm.

Cài đặt **một lần** trên máy chạy skill (token do quản trị platform cấp, cần quyền `rules` và `automation_push`):
```
node scripts/qa-sync.mjs --save-config https://<địa-chỉ-server>:3001 <token>
```
Cấu hình lưu ở `secrets/qa-sync.json` (chỉ máy này, không chia sẻ file). Chưa cài thì skill báo và đưa lệnh trên.

Khi không đẩy tự động được, có hai cách cập nhật tay trên tab Kho Business Rule (cần quyền `rules`):
- **Cập nhật rule từ kho**: server nạp lại từ `database/kb-snapshot/` trên chính máy chạy server (dùng khi Explore chạy trên máy đó).
- **Nhập file kho**: tạo file bằng `node scripts/sync-business-rules.mjs --export kho-rule.json` trên máy đã Explore, rồi chọn file đó trên platform.
Lý do không thể "kéo" tự động từ Kho: Kho là artifact riêng của tài khoản Claude, chỉ Claude đọc được, server platform không truy cập được.
