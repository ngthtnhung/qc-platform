# QC Platform

Nền tảng nội bộ cho QC của Haraworks: tra cứu bug và business rule, phân tích bug có AI hỗ trợ, tự động đăng nhập đúng tài khoản test, và chạy các tác vụ Playwright (tạo phiếu, gửi thư, tạo môn học...) với tham số chỉnh ngay trên giao diện. Một máy chạy **server** cho cả nhóm, mỗi người chạy **launcher** trên máy mình để mở Chrome và chạy tác vụ.

## Có gì trong platform

| Trang | Làm gì |
|---|---|
| Tổng quan | Số bug, rule, tác vụ, tài khoản; lối tắt; trạng thái hệ thống |
| Tài Khoản & Môi Trường | Bấm tài khoản để mở và tự đăng nhập (Staging, Production OrgID DEMO); lưu mật khẩu mã hóa trên server |
| Phân Tích Bug | Mô tả bug, tìm rule và bug cũ liên quan (lọc bug mới hoặc cũ), AI gợi ý nguyên nhân, test case cần tạo, người nên tạo, tác vụ tự động nên chạy hoặc tạo thêm |
| Tra Cứu Bug | Thẻ bug có trạng thái, người thực hiện, người duyệt; lọc nhiều tiêu chí; mở chi tiết (mô tả, lịch sử, bình luận, xem trước ảnh và video) |
| Kho Business Rule | Rule đã trích xuất kèm trạng thái xác nhận; thêm, sửa, xóa; cập nhật từ Kho |
| Tác Vụ Tự Động | Chọn tác vụ, chỉnh trường thông tin (có editor cho nội dung nhiều dòng), chọn file đính kèm từ kho file, chạy nhiều lần |
| Phân Quyền | Admin cấp token và quyền cho từng người |

## Chạy nhanh trên máy của bạn (một người dùng)

Cần Node.js 22 và Google Chrome hoặc Microsoft Edge.
```powershell
npm i
node services/api/server.js      # mở http://localhost:3001
node apps/launcher/launcher.js --server http://localhost:3001
```

## Chạy cho cả nhóm (mạng nội bộ)

Một máy làm server (luôn bật), HTTPS bằng chứng chỉ mkcert theo đúng IP của máy. Mỗi người dùng token riêng.

| Bạn là | Cài lần đầu | Các lần sau |
|---|---|---|
| Admin (máy chạy server) | `docs/operations/huong-dan-chay-theo-ip.md`, phần Admin | `.\start-team.ps1` |
| Thành viên (Windows) | cùng file, phần Thành viên: cài Node 22, `npm i`, cài `rootCA.pem` | `node apps/launcher/launcher.js --server https://IP_MAY_CHU:3001` |
| Thành viên (macOS) | tab **Thành viên (macOS)** trong nút ? của platform | lệnh launcher như trên |

Tóm tắt cho admin:
```powershell
node scripts/team-user.mjs add "Tên thành viên" member         # cấp token, chỉ hiện một lần
mkcert -cert-file secrets\tls.crt -key-file secrets\tls.key localhost 127.0.0.1 IP_MAY_CHU
.\start-team.ps1                                                 # nghe mọi địa chỉ mạng, HTTPS, cổng 3001
```
Đổi IP máy chủ thì cấp lại chứng chỉ và gửi lại `rootCA.pem`. Hướng dẫn đầy đủ từng bước, bảng lỗi thường gặp: `docs/operations/huong-dan-chay-theo-ip.md` (cũng có trong nút ? của platform, tab "Cài máy chủ", "Thành viên", "Chạy hằng ngày").

## Thêm rule và bug cho mọi người

Chi tiết: `docs/operations/them-rule-va-bug.md` (cũng có trong nút ?, tab "Thêm rule và bug").

**Rule**
- Một rule: tab Kho Business Rule, nút **+ Thêm rule**.
- Nhiều rule: chạy skill `business-rule-extractor` (lệnh `Explore`), skill tự đẩy lên bằng `node scripts/qa-sync.mjs --no-bugs`. Cài một lần: `node scripts/qa-sync.mjs --save-config https://IP_MAY_CHU:3001 TOKEN`.
- Không đẩy được tự động: nút **Cập nhật rule từ kho** hoặc **Nhập file kho** (file tạo bằng `node scripts/sync-business-rules.mjs --export kho-rule.json`).

**Bug**
- Realtime từ Haraworks: admin lưu cookie vào `secrets\haraworks.json` rồi khởi động lại server.
- Bug cũ: `node scripts/sync-bugs.mjs` (đọc `database/kb-snapshot/data/bugs.json`).

## AI phân tích bug (tùy chọn)

Đặt khóa trước khi khởi động server: `$env:GEMINI_API_KEY = "..."` (Gemini, mặc định `gemini-3.5-flash`) hoặc `ANTHROPIC_API_KEY`. Chưa có khóa thì hệ thống phân tích theo dữ liệu (thống kê bug cũ, rule, khớp từ khóa) và ghi rõ là chưa dùng AI. Kiểm tra kết nối: `node scripts/ai-check.mjs`.

## Tác vụ tự động

Tác vụ là file JSON trong `database/automation-drafts/` (định dạng và quy tắc: `docs/operations/automation-tasks.md`). Skill Explore tự sinh tác vụ cho mỗi luồng đã chạy thành công; đẩy lên bằng `qa-sync`. Tác vụ dùng được ngay, không cần duyệt. Chỉ chạy trên Staging.

## Cấu trúc thư mục

```text
apps/web/            giao diện (HTML, CSS, JS thuần, không framework)
apps/launcher/       chương trình chạy trên máy từng người (mở Chrome, chạy Playwright)
services/api/        server (Node, không phụ thuộc thư viện ngoài)
packages/            module dùng chung: bug-search, haraworks-live, automation-tasks, secret-vault...
scripts/             lệnh vận hành: qa-sync, team-user, sync-bugs, sync-business-rules, ai-check
database/            schema, db.js, tác vụ mẫu (dữ liệu chạy thật không nằm trong repo)
docs/operations/     tài liệu vận hành
skills/              skill của team (xem skills/README.md)
tests/               bộ test: node tests/run-all-tests.js
```

## Đóng góp

Xem `CONTRIBUTING.md`. Dữ liệu thật (`secrets/`, `database/*.json`, token, cookie) không bao giờ đưa lên repo; `.gitignore` đã chặn.
