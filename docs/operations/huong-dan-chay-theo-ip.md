# Hướng dẫn chạy platform theo IP (admin và thành viên)

## Tóm tắt: lần đầu hay lần sau?

| Bạn là | Lần đầu (cài) | Các lần sau (mỗi ngày) |
|---|---|---|
| Admin (máy chạy server) | Phần 1, bước 1 đến 6 | Mục "Chạy hằng ngày", phần Admin |
| Thành viên (Windows) | Phần 2, mục A | Mục "Chạy hằng ngày", phần Thành viên |
| Thành viên (macOS) | Xem tab "Thành viên (macOS)" trên platform | Lệnh launcher bên dưới |

Các tab trên platform (nút ?) đã được gộp: **Cài máy chủ (Windows)** và **Thành viên (Windows)** chỉ có bước cài lần đầu; **Chạy hằng ngày** có các lệnh dùng hàng ngày. Tab "Chạy theo IP" đã bỏ vì trùng nội dung.

## Chạy hằng ngày (sau khi đã cài xong)

**Admin**, trong PowerShell ở thư mục project:
```powershell
.\start-team.ps1
```
Cửa sổ này phải mở suốt thời gian nhóm làm việc. Muốn bật AI phân tích bug, đặt khóa trước (cùng cửa sổ):
```powershell
$env:GEMINI_API_KEY = "khoa-cua-ban"
.\start-team.ps1
```
Sau khi Explore, đẩy rule và tác vụ mới:
```powershell
node scripts/qa-sync.mjs --no-bugs
```

**Thành viên**, trong PowerShell ở thư mục project (để cửa sổ mở khi làm việc):
```powershell
node apps/launcher/launcher.js --server https://IP_MAY_CHU:3001
```
Rồi mở `https://IP_MAY_CHU:3001` trong trình duyệt.

**Khi IP máy chủ đổi:** admin làm lại Phần 1, bước 4 đến 6 (IP, chứng chỉ, mở cổng). Mỗi thành viên chạy lại lệnh launcher với địa chỉ mới, và chạy lại `--save-config` nếu có.

---

## Cài lần đầu


## Phần 1: Admin (máy chạy server)

### Bước 1. Tìm IP của máy chủ
```powershell
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object IPAddress, InterfaceAlias
```
Ghi lại IP của mạng nội bộ (thường bắt đầu bằng `192.168.` hoặc `10.`). Nếu máy có nhiều IP, chọn IP của mạng mà thành viên đang dùng.

Lưu ý: IP có thể đổi khi máy đổi mạng hoặc khi router cấp lại. Nên đặt IP tĩnh hoặc đặt cho máy chủ một địa chỉ cố định trong router.

### Bước 2. Cấp chứng chỉ HTTPS cho đúng IP đó (làm lại khi IP đổi)
Chứng chỉ phải có đúng IP mà thành viên gõ vào trình duyệt. Chứng chỉ hiện có chỉ chứa `192.168.1.77` và `26.133.164.31`. Nếu IP máy chủ khác, làm như sau:

```powershell
mkcert -cert-file secrets\tls.crt -key-file secrets\tls.key localhost 127.0.0.1 <IP_MAY_CHU>
```
- Nếu lệnh `mkcert` không có, cài bằng `winget install FiloSottile.mkcert` rồi mở PowerShell mới.
- Lệnh này ghi đè `secrets\tls.crt` và `secrets\tls.key`. Chạy xong, khởi động lại server.

Đường dẫn CA (cần gửi cho thành viên để họ tin chứng chỉ):
```powershell
mkcert -CAROOT
```
Mở thư mục in ra, lấy file `rootCA.pem`. Gửi file này cho thành viên (qua chat nội bộ, không đăng công khai).

### Bước 3. Mở cổng 3001 trên tường lửa (một lần, PowerShell chạy bằng quyền Administrator)
Chuột phải vào PowerShell, chọn **Run as administrator**, rồi chạy:
```powershell
New-NetFirewallRule -DisplayName "QA Platform 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private,Domain
```
Mạng đặt là Public thì đổi `Private,Domain` thành `Private,Domain,Public`, hoặc đổi mạng sang Private.

### Bước 4. Tạo token cho từng người (một lần cho mỗi người)
Trong thư mục `qa-platform`, PowerShell thường:
```powershell
node scripts/team-user.mjs add "Tên quản trị" admin
node scripts/team-user.mjs add "Tên thành viên" member
```
Token in ra **chỉ hiện một lần**. Gửi token cho đúng người, không gửi qua nơi công khai. Quên token thì chạy `node scripts/team-user.mjs reset <id>`. Xem danh sách: `node scripts/team-user.mjs list`. Thu hồi: `node scripts/team-user.mjs revoke <id>`.

### Bước 5. Khởi động server cho nhóm
Dừng server cũ bằng Ctrl+C, rồi chạy:
```powershell
.\start-team.ps1
```
Nếu PowerShell báo không cho chạy script, chạy một lần rồi thử lại:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
Muốn bật AI phân tích bug, đặt khóa trước khi chạy (cùng cửa sổ):
```powershell
$env:GEMINI_API_KEY = "khoa-gemini-cua-ban"
$env:QA_AI_MODEL = "gemini-3.5-flash"
.\start-team.ps1
```
Màn hình sẽ in địa chỉ để gửi cho thành viên, dạng `https://<IP_MAY_CHU>:3001`.

### Bước 6. Đẩy rule và tác vụ lên server (chỉ máy đã Explore)
Lưu cấu hình một lần (token là của admin hoặc người có quyền `rules` và `automation_push`):
```powershell
node scripts/qa-sync.mjs --save-config https://<IP_MAY_CHU>:3001 <token>
```
Sau đó mỗi lần đẩy:
```powershell
node scripts/qa-sync.mjs --no-bugs
```

### Bước 7. Kiểm tra server còn sống
Trên máy admin, mở `https://localhost:3001/api/v1/health`. Kết quả có `"status":"HEALTHY"` là được. Từ máy khác trong mạng, mở `https://<IP_MAY_CHU>:3001/api/v1/health`.

---

## Phần 2: Thành viên (máy của từng người)

Mỗi người làm trên máy của mình. Cần: **Node.js bản 22** và **Google Chrome** hoặc **Microsoft Edge**. Kiểm tra Node:
```powershell
node -v
```
Phải ra `v22.x.x`. Không có thì tải Node 22 tại nodejs.org.

### Bước 1. Tin chứng chỉ của máy chủ (một lần)
Nhận file `rootCA.pem` từ admin, lưu vào `C:\Users\<tên-bạn>\Downloads\rootCA.pem`. Rồi chạy PowerShell **Run as administrator**:
```powershell
certutil -addstore -f Root "C:\Users\<tên-bạn>\Downloads\rootCA.pem"
```
Thay `<tên-bạn>` bằng tên thư mục người dùng Windows của bạn. Sau đó đóng hết trình duyệt và mở lại.

### Bước 2. Mở platform và đăng nhập
Mở trình duyệt, vào `https://<IP_MAY_CHU>:3001`, dán token cá nhân ở màn hình đăng nhập. Nếu trình duyệt vẫn báo không tin cậy, bước 1 chưa đúng: kiểm tra lại file và mở lại trình duyệt.

### Bước 3. Chạy QA Launcher (để mở tài khoản và chạy tác vụ)
Mở PowerShell trong thư mục `qa-platform` của bạn và chạy:
```powershell
node apps/launcher/launcher.js --server https://<IP_MAY_CHU>:3001
```
Để cửa sổ này mở khi làm việc. Đóng cửa sổ là launcher dừng.

### Bước 4. Cấu hình đẩy rule (chỉ khi bạn Explore module)
```powershell
node scripts/qa-sync.mjs --save-config https://<IP_MAY_CHU>:3001 <token-cua-ban>
```
Cấu hình lưu ở `secrets\qa-sync.json`, chỉ trên máy bạn. Đừng gửi file này cho ai.

---

## Đổi IP hoặc chuyển sang máy chủ khác

1. Admin làm lại Phần 1, bước 1 đến 5 với IP mới.
2. Mỗi thành viên sửa địa chỉ trong hai nơi:
   - Mở trình duyệt đúng địa chỉ mới.
   - Chạy lại lệnh `launcher.js --server` với địa chỉ mới.
   - Nếu có cấu hình đẩy, chạy lại lệnh `--save-config` với địa chỉ mới.
3. Nếu chứng chỉ được cấp lại, admin gửi lại `rootCA.pem` (thường không đổi; chỉ cần làm lại bước 1 của thành viên khi CA đổi).

## Lỗi hay gặp

| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `ECONNREFUSED` | Server không nghe ở IP đó, hoặc tường lửa chặn | Admin: kiểm tra server đang chạy bằng `start-team.ps1` và cổng 3001 đã mở |
| Trình duyệt báo "không an toàn" | Chưa tin `rootCA.pem` | Làm lại Phần 2 bước 1, mở lại trình duyệt |
| `fetch failed` khi đẩy | Địa chỉ trong `--save-config` sai hoặc chưa tin CA | Chạy lại `--save-config` đúng địa chỉ; chạy `certutil` như trên |
| Đăng nhập báo token sai | Token bị copy thừa khoảng trắng hoặc đã bị thu hồi | Admin cấp token mới bằng `team-user.mjs reset <id>` |
| Launcher báo không kết nối | Chưa chạy launcher, hoặc `--server` sai | Chạy lại lệnh launcher với đúng địa chỉ |
| Chứng chỉ không khớp địa chỉ | IP máy chủ đổi nhưng chứng chỉ chưa cấp lại | Admin chạy lại `mkcert` ở Phần 1 bước 2 |

## Mẫu gửi cho thành viên (copy, thay các chỗ trong ngoặc)

> Địa chỉ platform: https://[IP_MAY_CHU]:3001
> Token của bạn: [token] (đừng chia sẻ)
> File rootCA.pem: đính kèm. Cài theo mục "Thành viên, bước 1" trong docs/operations/huong-dan-chay-theo-ip.md.
> Sau đó chạy: node apps/launcher/launcher.js --server https://[IP_MAY_CHU]:3001
