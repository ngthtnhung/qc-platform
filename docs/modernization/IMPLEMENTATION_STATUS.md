# Trạng thái triển khai (Implementation Status)

> Cập nhật 2026-11-21 · nhánh `modernization/phase-0-audit` · **chưa commit**.
> Phạm vi đã làm: **Phase 1 (hạ tầng) + phần lõi Phase 2 (Core Platform)**, kèm quyết định duyệt chỉ-QC (APPROVAL_MODEL.md).
> Bản Node cũ (`services/`, `apps/web`, `apps/launcher`, `packages/`, `database/`, `scripts/`) **giữ nguyên, vẫn là hệ thống đang dùng**; chưa chuyển trang nào.

## Lệch có chủ đích so với kế hoạch Phase 0

| Kế hoạch | Thực tế | Lý do |
|---|---|---|
| Chuyển bản Node vào `legacy/` | **Không chuyển**; mã mới nằm ở `apps/api`, `apps/frontend` | Mã Node dùng đường dẫn tương đối tới `database/` và `secrets/` (dữ liệu thật, bị gitignore, 343 MB hồ sơ Chrome); di chuyển có nguy cơ làm hỏng. `apps/web` (SPA cũ) và `apps/frontend` (Next.js) cùng tồn tại |
| `apps/worker` riêng | Worker nằm trong `apps/api/app/worker.py`, cùng image | Một mã nghiệp vụ, nhiều điểm vào (đúng TARGET_ARCHITECTURE §6) |
| Bảng `roles/permissions/organizations` | Bỏ; chỉ `users.role CHECK ('qc')` | Quyết định "một vai trò QC, 4 QC ngang quyền" |
| Repository riêng cho mỗi domain | Truy vấn nằm trong service | Tránh trừu tượng thừa khi chưa có nhu cầu; có thể tách sau |

## Đã làm và đã kiểm chứng

| Hạng mục | Bằng chứng |
|---|---|
| FastAPI khung, OpenAPI `/api/docs`, lỗi thống nhất kèm `correlation_id`, header bảo mật | `tests/test_auth.py` |
| Cấu hình fail-fast (`pydantic-settings`), `COOKIE_SECURE` bắt buộc ở profile `team` | `app/core/config.py` (kiểm tra khi khởi động) |
| Auth: argon2id, chính sách mật khẩu (≥ 12 ký tự, cấm mật khẩu yếu kể cả `123456`), khóa tạm sau N lần sai, phản hồi chung chung, JWT truy cập 15 phút, refresh xoay vòng lưu băm, phát hiện dùng lại refresh ⇒ thu hồi phiên, đổi mật khẩu thu hồi phiên khác | 12 test `test_auth.py` |
| Cookie `HttpOnly` + `SameSite=Strict` + CSRF double-submit (không còn token trong `localStorage`) | `test_auth.py`, kiểm tay qua trình duyệt |
| Một vai trò `qc`, 4 QC ngang quyền; không vô hiệu được QC cuối cùng | `test_auth.py`, `test_approvals.py` |
| **Quy trình duyệt**: AI chỉ tạo `PROPOSED`; chỉ QC duyệt; AI/SYSTEM/RUNNER bị từ chối + audit DENY; ghim `payload_hash`; bất biến; một yêu cầu chờ/đối tượng; ràng buộc CSDL | 16 test `test_approvals.py` |
| Audit log: che bí mật, ghi cả DENY | `test_policy_vault_files.py` |
| PolicyEngine (port): hành động chỉ-người, chặn ghi Production, gate Org cho PRODUCTION_TEST (cả ràng buộc CSDL) | `test_policy_vault_files.py` |
| Vault phong bì AES-256-GCM, KEK ngoài DB, không phụ thuộc DPAPI; chỉ ghi qua API; AI không đọc được; sửa AAD ⇒ giải mã thất bại | `test_policy_vault_files.py` |
| Môi trường, tài khoản (API; mật khẩu chỉ cho STAGING/PRODUCTION_TEST) | `test_policy_vault_files.py` |
| Storage trừu tượng + `LocalStorage` (chống path traversal), upload nhận dạng magic bytes, giới hạn kích thước, trùng băm dùng chung một bản | `test_policy_vault_files.py` |
| Alembic `0001` (up/down/up sạch trên SQLite) | `test_migration_downgrade_and_upgrade_clean` |
| Nhập người dùng cũ: chạy khô mặc định, idempotent, không nhập băm/token cũ, nguồn không bị đụng | `test_cli_import.py` |
| Frontend Next.js 15.5.29 + TS: đăng nhập, hàng đợi duyệt (Duyệt/Từ chối), người dùng QC, đổi mật khẩu, nhật ký; API client tập trung (CSRF, tự refresh 1 lần) | `tsc` sạch, `vitest` 4 test, `next build` thành công |
| **Chạy thật end-to-end** (API + Next, SQLite): đăng nhập trên trình duyệt, bấm Duyệt đề xuất AI ⇒ DB: `approval APPROVED, decided_by qcdemo`, `suggestion ACCEPTED`, audit đủ | Thực hiện một lần trong phiên này |
| Compose: cú pháp hợp lệ (`docker compose config`) | lệnh chạy được; **chưa dựng container** |

Tổng: **41 test backend** (`pytest`), **4 test frontend**, `ruff` và `tsc` sạch.

## Chưa làm / chưa kiểm chứng (nói rõ, không coi là xong)

| Hạng mục | Tình trạng |
|---|---|
| Chạy trên **PostgreSQL thật**: extension `pgvector`, trigger audit append-only, partial index | **Chưa chạy**: máy này không có Postgres và Docker daemon không chạy. Có job CI `api-postgres` để kiểm chứng; **chưa chạy CI** |
| Dựng toàn bộ stack bằng `docker compose up` (build image, healthcheck, worker, beat) | **Chưa**. Dockerfile và compose viết xong, chưa build |
| Redis/Celery: worker chỉ có tác vụ `system.ping`; `/health` báo Redis lỗi khi không có Redis (đúng hành vi, đã thấy) | Chưa chạy với Redis thật |
| `S3Storage` | Có mã, **chưa kiểm thử** (không có MinIO); `boto3` không nằm trong phụ thuộc mặc định |
| Giao diện quản lý Môi trường/Tài khoản/Bí mật | API có và có test; **chưa có trang UI** |
| Nhập dữ liệu thật từ bản Node: môi trường, tài khoản, vault (cần giải mã DPAPI trên máy gốc), file, bug, rule, tác vụ | **Chưa**. Chỉ có importer người dùng; **chưa chạy với dữ liệu thật** (chỉ test trên dữ liệu giả) |
| Phase 3–5: bug sync + lịch sử, AI analysis, Reference Library, Flow Recorder, Runner Agent, pgvector retrieval | **Chưa bắt đầu** |
| Bản Node vẫn tự duyệt tác vụ (`autoApprove`) | **Không sửa** cho tới khi chuyển trang Tác Vụ Tự Động (Phase 4); xem APPROVAL_MODEL §6 |
| CSP dùng `script-src 'unsafe-inline'` (yêu cầu của Next App Router chưa có nonce) | Nợ kỹ thuật, ghi ở SECURITY_REVIEW S-06 |
| `npm audit`: 2 cảnh báo (postcss ≤ 8.5.22 nằm trong Next, XSS khi stringify CSS) | Không có bản Next 15.x vá hơn (15.5.29 là mới nhất); chỉ ảnh hưởng thời điểm build, không xử lý CSS do người dùng nhập. Theo dõi nâng cấp |
| `gitleaks` trong CI sẽ báo chuỗi giống mật khẩu trong `database/db.js` (S-01) | Đúng như dự kiến; cần chủ repo xử lý (xoay mật khẩu nếu là thật) |

## Cách chạy cục bộ (không cần Docker)

```powershell
cd apps/api
python -m venv .venv ; .\.venv\Scripts\python -m pip install -e ".[dev]"
$env:DATABASE_URL="sqlite:///.data/dev.sqlite"; $env:JWT_SIGNING_KEY="<>=32 ký tự>"; $env:SECRET_KEK="<base64 32 byte>"
.\.venv\Scripts\python -m alembic upgrade head
.\.venv\Scripts\python -m app.cli bootstrap --username <tên> --display-name "<Tên>"   # mật khẩu: nhập tay hoặc BOOTSTRAP_PASSWORD
.\.venv\Scripts\python -m uvicorn app.main:create_app --factory --port 8000
# terminal khác
cd apps/frontend ; npm ci ; $env:API_INTERNAL_URL="http://127.0.0.1:8000" ; npm run dev
.\.venv\Scripts\python -m pytest        # trong apps/api
```

Với Docker (khi daemon chạy): sao chép `.env.example` → `.env`, điền giá trị, rồi
`docker compose -f infra/compose/compose.yaml --env-file .env up -d --build`.

## Bước tiếp theo đề xuất

1. Chạy CI trên GitHub (hoặc dựng Postgres cục bộ) để kiểm chứng phần PostgreSQL; sửa nếu có lỗi.
2. `docker compose up --build` trên máy có Docker chạy; kiểm tra health, worker, beat.
3. Trang UI Môi trường/Tài khoản/Bí mật; nhập môi trường + tài khoản + vault từ bản Node (M-02…M-05) sau bước giải mã DPAPI.
4. Phase 3: đồng bộ bug Haraworks bằng Celery beat, lịch sử bug, phân tích AI qua `create_ai_suggestion`.
