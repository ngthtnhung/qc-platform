# Đóng góp cho QC Platform

## Chạy thử trên máy bạn
```powershell
npm i
node services/api/server.js      # http://localhost:3001
node apps/launcher/launcher.js --server http://localhost:3001
node tests/run-all-tests.js      # phải đạt cả 4 bộ test
```
Chạy cho cả nhóm qua mạng nội bộ: xem `docs/operations/huong-dan-chay-theo-ip.md`.

## Quy trình
1. Tạo nhánh từ `main` (`feature/<việc>` hoặc `fix/<việc>`), commit nhỏ, mô tả rõ.
2. Chạy `node tests/run-all-tests.js` trước khi mở Pull Request.
3. Pull Request cần có người khác trong nhóm xem trước khi gộp vào `main`.

## Không đưa lên repo
`secrets/`, `database/*.json` chứa dữ liệu chạy thật (tài khoản, bug, rule), token, cookie Haraworks, file tải lên. `.gitignore` đã chặn các mục này; kiểm tra `git status` trước khi commit.

## Nơi đặt code
- `apps/web`: giao diện (một trang, không dùng framework). `apps/launcher`: chương trình chạy trên máy từng người.
- `services/api`: server. `packages/*`: các module dùng chung (tìm bug, tác vụ tự động, Haraworks live...).
- `skills/`: skill của team, xem `skills/README.md`.
- `docs/operations`: tài liệu vận hành. Sửa tính năng thì cập nhật tài liệu cùng lúc.
