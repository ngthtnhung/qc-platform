# Skills tích hợp với platform

Mỗi skill của team đặt trong một thư mục riêng: `skills/<tên-skill>/SKILL.md` (kèm file phụ nếu cần).
Skill nào ghi dữ liệu lên platform thì dùng các đường có sẵn, không viết thẳng vào `database/`:

| Việc | Cách |
|---|---|
| Đưa rule từ Kho lên platform | `node scripts/qa-sync.mjs --no-bugs` (cấu hình một lần bằng `--save-config`) |
| Đưa tác vụ tự động lên | file JSON trong `database/automation-drafts/` rồi chạy `qa-sync` (định dạng: `docs/operations/automation-tasks.md`) |
| Chạy tác vụ theo tham số | tác vụ nhận tham số `{{khoa}}`, xem `docs/operations/automation-tasks.md` |

Quy ước: không đưa mật khẩu, token, cookie hay dữ liệu thật của khách vào skill hoặc tác vụ.
