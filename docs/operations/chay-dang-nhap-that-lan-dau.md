# Chạy đăng nhập thật lần đầu (Runner → Staging)

Mục tiêu: kiểm chứng Runner đăng nhập được vào Staging bằng tài khoản test và chạy một tác vụ đã được QC duyệt.
**Người nhập mật khẩu là bạn**, trên giao diện của platform (trường chỉ ghi). Tài liệu này không chứa thông tin đăng nhập nào.

## 0. Trước khi bắt đầu
- Dùng tài khoản test riêng cho Staging, không phải tài khoản cá nhân hay Production.
- Mật khẩu từng gửi qua chat/log/ticket là đã lộ: đổi lại sau đợt thử.
- Tác vụ đầu tiên nên là tác vụ **chỉ đọc** (`writes=false`). Tác vụ ghi dữ liệu dùng tiền tố `[AI TEST]`.

## 1. Dựng platform (máy của bạn hoặc máy chủ nhóm)
```powershell
Copy-Item .env.example .env        # điền POSTGRES_*, JWT_SIGNING_KEY, SECRET_KEK (xem chú thích trong file)
docker compose -f infra/compose/compose.yaml --env-file .env up -d --build
docker compose -f infra/compose/compose.yaml --env-file .env exec api python -m app.cli bootstrap --username <tên> --display-name "<Tên>"
```
Mở http://localhost:3000, đăng nhập, đổi mật khẩu nếu được yêu cầu. Giữ bản sao `SECRET_KEK` ngoài máy: mất khóa là mất mọi bí mật trong vault.

## 2. Môi trường và tài khoản (trang "Môi trường & tài khoản")
1. Thêm môi trường loại **STAGING**: URL và URL đăng nhập của Staging, mã Org (nếu form đăng nhập có bước mã công ty).
2. Thêm tài khoản test (tên đăng nhập, vai trò).
3. Nhập mật khẩu vào ô "Mật khẩu mới" → Lưu. Mật khẩu được mã hóa, không hiển thị lại.

## 3. Nhập tác vụ và duyệt
```powershell
docker compose ... run --rm --no-deps -v "${PWD}/database:/src:ro" api python -m app.cli import-automation --drafts /src/automation-drafts --legacy-db /src/qa_platform_data.json            # chạy khô
docker compose ... run --rm --no-deps -v "${PWD}/database:/src:ro" api python -m app.cli import-automation --drafts /src/automation-drafts --legacy-db /src/qa_platform_data.json --apply
```
Vào trang **Duyệt** → loại "Code automation" → đọc code của 1 tác vụ chỉ đọc → Duyệt.

## 4. Runner trên máy Windows của bạn (Host Runner, Chrome thật)
1. Trang **Runner** → tạo runner loại Host → sao chép token (chỉ hiện một lần).
2. Trong `apps/runner-agent`: `npm ci`, `npm run build`, rồi
```powershell
$env:QC_SERVER_URL="http://localhost:8000"   # hoặc https://<máy chủ nhóm>; http chỉ được phép với localhost
$env:RUNNER_TOKEN="rn_..."
node dist/index.js
```
Đừng đặt `RUNNER_SKIP_LOGIN` (cờ đó bỏ đăng nhập, chỉ để thử giao thức).

## 5. Chạy
Trang **Tác vụ tự động** → mở tác vụ đã duyệt → "Xếp hàng chạy". Runner mở Chrome, đăng nhập (dừng nếu gặp CAPTCHA/OTP, không vượt qua), chạy script và báo kết quả. Xem bước, log, ảnh chụp lỗi ở danh sách lần chạy.

## 6. Nếu lỗi
| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| "Đăng nhập chưa hoàn tất (NEEDS_USER_CAPTCHA/NEEDS_PASSWORD…)" | Có CAPTCHA/OTP hoặc chưa lưu mật khẩu cho tài khoản |
| Việc ở trạng thái "Đang chờ" mãi | Runner chưa chạy/offline, hoặc không có tài khoản Staging khớp vai trò của tác vụ |
| `NOT_APPROVED` khi xếp hàng | Chưa có phiên bản code nào được QC duyệt |
| `POLICY_BLOCKED` | Môi trường chưa cho phép hành động `AUTOMATE` |

Gửi cho tôi kết quả (trạng thái, các bước, thông báo lỗi; **không** gửi mật khẩu hay token) nếu cần chẩn đoán.
