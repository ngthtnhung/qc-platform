# Thêm rule và bug để mọi người cùng dùng

Mọi lệnh chạy trong **Windows PowerShell**, trong thư mục `qa-platform`. Muốn đẩy được lên server nhóm cần token riêng có quyền tương ứng (admin cấp ở tab Phân Quyền).

## A. Thêm rule

Rule nằm ở hai lớp: **lớp từ Kho Business Rule** (đồng bộ, do skill Explore hoặc quản trị đẩy lên) và **lớp chỉnh sửa trên platform** (thêm, sửa, xóa trực tiếp). Đồng bộ từ Kho không ghi đè lớp chỉnh sửa.

### Cách 1. Thêm trực tiếp trên platform (nhanh nhất cho một rule)
1. Vào tab **Kho Business Rule**, bấm **+ Thêm rule** (cần quyền "Thêm, sửa, xóa rule").
2. Điền Module, Tên rule, Mô tả chi tiết (viết thành câu đầy đủ), Vai trò tương ứng (mỗi dòng một vai trò), Loại thiết lập, Flow.
3. Lưu. Mọi người thấy ngay (trang tự kiểm tra bản mới mỗi phút).
Rule thêm tay chỉ nằm trên platform, không tự ghi ngược về Kho.

### Cách 2. Explore module bằng skill, rule tự lên platform (cho nhiều rule)
1. **Cài một lần** trên máy chạy skill (token cần quyền `rules` và `automation_push`):
```powershell
node scripts/qa-sync.mjs --save-config https://IP_MAY_CHU:3001 TOKEN_CUA_BAN
```
2. Chạy skill `business-rule-extractor` (lệnh `Explore <MÃ> <LINK> <ORGID> <TÀI_KHOẢN>`). Cuối mỗi lần Explore, skill xuất rule vào `database/kb-snapshot/` rồi tự chạy:
```powershell
node scripts/qa-sync.mjs --no-bugs
```
3. Rule lên platform kèm nhãn **Chưa xác nhận** cho đến khi được xác nhận trong Kho. Tác vụ tự động sinh ra cũng lên cùng lúc và dùng được ngay.

### Cách 3. Cập nhật tay khi không đẩy tự động được
- Trên máy chạy server, tab **Kho Business Rule**, nút **⟳ Cập nhật rule từ kho**: nạp lại từ `database/kb-snapshot/`.
- Ở máy khác: tạo file gói rồi nhập trên platform.
```powershell
node scripts/sync-business-rules.mjs --export kho-rule.json
```
Sau đó trên platform bấm **Nhập file kho** và chọn `kho-rule.json` (cần quyền `rules`).

## B. Thêm bug

Có hai nguồn, hiển thị chung ở tab **Tra Cứu Bug**; bug lấy từ Haraworks được đánh dấu có trạng thái, người thực hiện và người duyệt.

### Nguồn 1. Bug realtime từ Haraworks (tự cập nhật)
Server đọc bug từ tasks.haraworks.vn bằng cookie đăng nhập, cập nhật mỗi 30 giây và ngay khi có thay đổi. Việc **admin làm một lần trên máy chạy server**, bằng tài khoản Haraworks có quyền xem các bug cần đồng bộ:

> **Phân biệt hai thông tin:** token QA (`qa_...`) dùng để đăng nhập QC Platform/đẩy dữ liệu; bug realtime cần cookie phiên Haraworks. Không dùng token QA thay cho cookie.

1. Trên máy chạy server, đăng nhập `https://tasks.haraworks.vn`. Mở DevTools bằng **F12** → **Network**, tải lại trang hoặc mở danh sách bug.
2. Chọn một request tới `tasks.haraworks.vn` → **Headers** → **Request Headers**. Sao chép toàn bộ giá trị của header `Cookie` (chỉ lấy giá trị, không lấy chữ `Cookie:`). Đây là thông tin đăng nhập nhạy cảm của tài khoản Haraworks.
3. Trong thư mục gốc project trên máy server, tạo hoặc cập nhật file `secrets\haraworks.json` (thư mục `secrets` đã bị `.gitignore` chặn):
```json
{ "cookie": "dán toàn bộ giá trị Cookie vừa sao chép vào đây" }
```
Giữ nguyên dấu chấm phẩy và khoảng trắng trong giá trị cookie. Không dán cookie vào chat, issue, mã nguồn hoặc Git; chỉ lưu ở máy server.
4. Khởi động lại server (`.\start-team.ps1`). Vào tab **Tra Cứu Bug**, bấm nút làm mới nếu cần; nhãn trạng thái phải chuyển sang **● Realtime**. Dữ liệu cũng được hỏi lại mỗi 30 giây.

Nếu nhãn báo **Chưa realtime**, di chuột lên nhãn để xem lý do. Cookie hết hạn thì đăng nhập Haraworks lại, thay giá trị trong file trên server và khởi động lại server. Cookie chỉ dùng để đọc dữ liệu Haraworks và tải chi tiết bug; không gửi xuống trình duyệt. Có thể đặt `HARAWORKS_COOKIE` trong môi trường server thay cho file, nhưng không nên ghi cookie trực tiếp vào lệnh hoặc script.

Mở một bug trong tab Tra Cứu Bug, ngăn chi tiết tự tải mô tả, lịch sử, bình luận, ảnh và video (xem trước ngay, không cần tải về) bằng cùng cookie này.

### Nguồn 2. Bug cũ (lịch sử nhiều năm)
Bug cũ nằm trong file `data/bugs.json` của Kho Business Rule (Claude xuất giúp từ artifact vào `database/kb-snapshot/data/bugs.json`).
```powershell
node scripts/sync-bugs.mjs
```
Chạy với token để đẩy lên server nhóm (quyền `rules`): đặt `QA_SERVER_URL` và `QA_TOKEN` hoặc đã lưu bằng `--save-config`. Mỗi bug trong file có dạng:
```json
{ "id": "6af2f0135316d2ca5c282235", "t": "[BUG][HRM][EH] Mô tả lỗi", "c": "Bug", "d": "2026-11-10 17:24", "m": "HRM", "g": "HRM", "u": "https://tasks.haraworks.vn/task/project/<mã dự án>/<mã bug>" }
```
(`t` tiêu đề, `c` phân loại, `d` ngày tạo, `m` module, `g` nhóm module, `u` đường dẫn tới bug). Ghi chú nguyên nhân và cách sửa của từng bug (tùy chọn) đặt trong `database/kb-snapshot/bug_notes/`.

## C. Kiểm tra sau khi thêm
- Rule: tab Kho Business Rule, tìm theo mã hoặc từ khóa; hàng đếm hiện số rule và bản đồng bộ.
- Bug: tab Tra Cứu Bug, số bug ở đầu trang; lọc theo module, trạng thái, người duyệt, thời gian.
- Phân tích bug (tab Phân Tích Bug) dùng cả rule lẫn bug này; bug có nhãn **Bug mới** (30 ngày gần đây) hoặc **Bug cũ**, và lọc được theo thời gian.
