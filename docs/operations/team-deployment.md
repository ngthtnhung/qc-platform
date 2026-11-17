# Triển khai dùng chung cho nhóm

Mô hình: một server nội bộ giữ rule, môi trường, tài khoản, link và mật khẩu mã hóa. Mỗi người chạy
**QA Launcher** nhỏ trên máy mình để Playwright mở Chrome của chính họ.

```
Trình duyệt người dùng --(token)--> Server nhóm (rule, tài khoản, kho mật khẩu)
        |                                   ^
        +--> QA Launcher 127.0.0.1:3002 ----+  (lấy mật khẩu 1 lần cho đúng phiên, điền form, không ghi đĩa)
                    |
                    +--> Chrome của người đó (Playwright)
```

## 1. Cài server (máy chủ nội bộ)

```bash
npm i
node scripts/team-user.mjs add "Tên quản trị" admin      # in token một lần
node scripts/team-user.mjs add "Tên thành viên" member   # mỗi người một token
HOST=0.0.0.0 PORT=3001 node services/api/server.js
```

- Server **từ chối chạy** khi HOST không phải localhost mà chưa có người dùng nào.
- **Bắt buộc dùng HTTPS** khi chạy trên mạng: đặt `TLS_CERT` và `TLS_KEY`, hoặc đặt sau reverse proxy HTTPS.
  Nếu không, token và mật khẩu đi dạng chữ rõ trên mạng nội bộ.
- Server Linux/Docker: đặt khóa kho mật khẩu qua `QA_VAULT_KEY` (base64 của 32 byte ngẫu nhiên):
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Giữ khóa này ở nơi an toàn, mất khóa là mất mật khẩu đã lưu.
- Sao lưu thư mục `secrets/` và `database/qa_platform_data.json`.

## 2. Mỗi thành viên

1. Nhận token riêng từ quản trị viên (gửi qua kênh riêng).
2. Cài Node 22, Chrome hoặc Edge, rồi lấy project về và chạy `npm i`.
3. Chạy launcher (giữ cửa sổ này mở khi dùng):

```bash
node apps/launcher/launcher.js --server https://ten-server:3001
```

4. Mở `https://ten-server:3001`, nhập token, bấm tài khoản để mở và đăng nhập.

## 3. Cập nhật rule cho cả nhóm

Quản trị viên (có token admin) chạy sau khi rule được xác nhận trên Kho Business Rule và đã xuất vào `database/kb-snapshot/`:

```bash
QA_SERVER_URL=https://ten-server:3001 QA_TOKEN=qa_token_admin node scripts/sync-business-rules.mjs
```

Server ghi bản mới (tăng `revision`). Tab "Kho Business Rule" của mọi người tự nạp lại trong vòng 1 phút,
phân tích bug bằng RAG dùng bản mới ngay.

## 4. Quyền

| Việc | admin | member |
|---|---|---|
| Xem rule, mở tài khoản, thêm tài khoản, sửa link | có | có |
| Đặt/xóa mật khẩu, sửa môi trường, đẩy rule | có | không (cấp quyền lẻ `secrets`, `environments`, `rules`) |
| Đẩy tác vụ tự động nháp | có | quyền lẻ `automation_push` |
| Duyệt, gỡ tác vụ tự động | có | quyền lẻ `automation` |

Quản lý người dùng: `team-user.mjs list | reset <id> | revoke <id>`.

## 5. Giới hạn an toàn cần biết

- Mật khẩu chỉ rời server cho launcher của đúng người tạo phiên, một lần, trong 2 phút, chỉ cho Staging và Production OrgID DEMO.
  Mỗi lần lấy đều ghi vào nhật ký kiểm toán. Nhưng thành viên có token vẫn có thể gọi API này bằng công cụ khác, nên chỉ cấp token cho người được phép dùng các tài khoản test đó.
- Mất token: `reset` rồi gửi token mới; token cũ mất hiệu lực ngay.
- Production OrgID khác DEMO: không lưu mật khẩu, launcher chặn request ghi.

## 6. Bug cũ cho tab "Phân Tích Bug" và "Bug Cũ"

Danh sách bug (file `data/bugs.json` của Kho Business Rule) được đưa vào platform bằng cách tương tự rule:

1. Nhờ Claude xuất `data/bugs.json` (và ghi chú bug nếu có) từ artifact vào `database/kb-snapshot/`.
2. Chạy, bằng token admin hoặc người có quyền `rules`:

```bash
QA_SERVER_URL=https://ten-server:3001 QA_TOKEN=qa_token_admin node scripts/sync-bugs.mjs
```

Khi người dùng gõ mô tả ở tab "Phân Tích Bug", server tự tìm rule đã xác nhận và bug cũ giống nhất (tìm theo từ khóa, không dùng mô hình ngôn ngữ).

## 7. Đẩy kết quả Explore lên platform trong một lệnh

Cài đặt một lần trên máy chạy skill Explore (lưu vào `secrets/qa-sync.json`, chỉ máy này):

```bash
node scripts/qa-sync.mjs --save-config https://ten-server:3001 qa_token
```

Từ đó, sau mỗi lần Explore skill tự xuất artifact vào `database/kb-snapshot/` và chạy `node scripts/qa-sync.mjs --no-bugs`. Lệnh này đẩy rule (gồm cả rule **chờ xác nhận**, hiện trên platform với nhãn "Chưa xác nhận"), bug cũ (bỏ `--no-bugs`) và tác vụ trong `database/automation-drafts/`. Chạy lại nhiều lần không tạo bản trùng. Cũng dùng được biến `QA_SERVER_URL`, `QA_TOKEN` thay cho file cấu hình.
Token chỉ cần quyền lẻ `rules` và `automation_push`; không dùng token admin. Tác vụ đẩy lên dùng được ngay, không còn bước duyệt.
Không đẩy được tự động thì dùng nút **Cập nhật rule từ kho** hoặc **Nhập file kho** trên tab Kho Business Rule (xem `automation-tasks.md`).

Hướng dẫn chạy theo từng IP (admin và thành viên, lệnh PowerShell): [huong-dan-chay-theo-ip.md](huong-dan-chay-theo-ip.md). Cũng có trong nút ? trên platform, các tab "Cài máy chủ", "Thành viên" và "Chạy hằng ngày".
