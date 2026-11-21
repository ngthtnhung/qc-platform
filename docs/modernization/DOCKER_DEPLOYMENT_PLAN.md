# Kế hoạch triển khai Docker (Docker Deployment Plan)

> Phase 0 · **[N] Proposed**. Hiện trạng đã xác minh: `infra/compose/compose.yaml` dựng Postgres 16, Redis 7, MinIO, Keycloak (profile `identity`) và 4 service **placeholder** (api trả 501, worker/runner chỉ `/health`, web in "placeholder"); mã thật không nối Postgres/Redis/MinIO **[D]**. Chạy thật hiện nay: `node services/api/server.js` / `start-team.ps1` + launcher từng máy **[V]**.

## 1. Mục tiêu

1. **Một** quy trình khởi động có tài liệu: `docker compose --profile <dev|team> up -d`.
2. Health check thật + `depends_on: condition: service_healthy`.
3. Volume bền cho Postgres, storage, Redis (AOF), Postgres backup.
4. Cấu hình nhất quán qua `.env` + một schema kiểm tra khi khởi động.
5. Không cần mở nhiều tiến trình thủ công cho môi trường phát triển/nhóm (trừ Host Runner, xem §5).

## 2. Dịch vụ (compose)

| Service | Image/Build | Vai trò | Cổng (profile `team`) | Health check | Phụ thuộc |
|---|---|---|---|---|---|
| `proxy` | `caddy:2` hoặc `traefik` | TLS, định tuyến `/` → web, `/api` → api, giới hạn tốc độ, header bảo mật | 443 (và 80→443) | `caddy validate` / HTTP | web, api |
| `web` | build `apps/web` (Next.js, `output: standalone`) | Giao diện | nội bộ 3000 | `GET /api/health` | api (healthy) |
| `api` | build `apps/api` (FastAPI, uvicorn/gunicorn) | REST + OpenAPI | nội bộ 8000 | `GET /health` (kiểm DB + Redis + storage) | postgres, redis (healthy), `migrate` (completed) |
| `migrate` | cùng image `api` | `alembic upgrade head` rồi thoát | — | exit 0 | postgres (healthy) |
| `worker` | cùng image `api`, `celery -A app.worker worker -Q default,ai,sync,indexing,automation_post` | Tác vụ nền | — | `celery inspect ping` | redis, postgres, migrate |
| `beat` | cùng image `api`, `celery beat` | Lịch đồng bộ Haraworks, dọn dẹp, lịch chạy | — | file heartbeat/healthcheck script | redis, migrate |
| `postgres` | `pgvector/pgvector:pg16` | CSDL chính + pgvector | không publish (dev: 127.0.0.1:5432) | `pg_isready` | — |
| `redis` | `redis:7-alpine`, AOF | Broker/cache/rate limit/lease | không publish | `redis-cli ping` | — |
| `minio` (tùy chọn profile `s3`) | MinIO (ghim phiên bản) | S3-compatible storage | console 127.0.0.1:9001 | `mc ready` | — |
| `runner-docker` (tùy chọn profile `runner`) | build `apps/runner-agent` (Playwright image) | Docker Runner Agent | — | endpoint heartbeat nội bộ | api (healthy) |
| `identity` (tùy chọn profile `identity`) | Keycloak 26 | SSO sau này (chưa dùng ở Phase 2) | 127.0.0.1:8080 | TCP | postgres |
| `backup` (tùy chọn) | `pgvector/pgvector` + cron | `pg_dump` định kỳ ra volume/đĩa | — | — | postgres |

Ghi chú:
- `api`, `worker`, `beat`, `migrate` dùng **cùng một image** (một mã nghiệp vụ, nhiều điểm vào) để tránh lệch phiên bản.
- Không publish cổng Postgres/Redis/MinIO ra ngoài trong profile `team`; chỉ `proxy` mở 443.
- Giữ nguyên các hằng đã có ở compose cũ (pin MinIO theo phiên bản, `redis --appendonly yes`, healthcheck Postgres `pg_isready`).

## 3. Volume

| Volume | Nội dung | Sao lưu |
|---|---|---|
| `postgres-data` | Dữ liệu Postgres | `pg_dump` hằng ngày + WAL tùy chọn; kiểm thử khôi phục hàng tháng |
| `storage-data` | Storage local (`/data/storage`) khi `STORAGE_BACKEND=local` | `rsync`/snapshot; manifest `sha256` |
| `minio-data` | Khi dùng profile `s3` | MinIO mirror |
| `redis-data` | AOF | Không bắt buộc (tái tạo được) |
| `caddy-data` | Chứng chỉ TLS | Sao lưu cùng cấu hình |
| `runner-cache` | Cache trình duyệt của Docker Runner | Không |

Tuyệt đối không dùng bind-mount vào `database/` và `secrets/` cũ làm nguồn ghi; nguồn cũ chỉ được mount **chỉ-đọc** vào container `migrate-import` khi chạy importer (xem DATABASE_MIGRATION_PLAN).

## 4. Cấu hình môi trường

- File: `.env` (không commit), mẫu `.env.example` (khóa, không giá trị bí mật), và `.env.dev`/`.env.team` tách theo profile.
- Biến chính (đề xuất):

| Nhóm | Biến |
|---|---|
| Chung | `APP_ENV=dev|team`, `PUBLIC_BASE_URL`, `LOG_LEVEL` |
| DB | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL` (dựng từ trên) |
| Redis | `REDIS_URL` |
| Storage | `STORAGE_BACKEND=local|s3`, `STORAGE_LOCAL_PATH`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| Bảo mật | `JWT_SIGNING_KEY`, `SECRET_KEK` (base64 32 byte, **không** lưu trong DB), `COOKIE_SECURE`, `ALLOWED_ORIGINS` |
| AI | `AI_PROVIDER_ORDER=gemini,anthropic,local`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `QA_AI_MODEL` |
| Haraworks | `HARAWORKS_BASE_URL` (cookie lưu trong vault, không phải env) |
| Runner | `RUNNER_REGISTRATION_TTL` |

- `pydantic-settings` kiểm tra khi khởi động; thiếu biến bắt buộc → dừng với thông báo rõ (fail-fast). `compose` dùng `${VAR:?message}` như hiện tại cho biến bắt buộc.
- Bí mật: ưu tiên Docker secrets/file (`*_FILE`) thay cho biến môi trường thuần khi triển khai nhóm; không in ra log; `docker compose config` không lộ giá trị trong tài liệu.

## 5. Host Runner Agent (ngoài Compose)

- Playwright mở **Chrome thật trên máy người dùng** (tab Tài Khoản & Môi Trường, hồ sơ Chrome, đăng nhập tự động) — không đóng gói được vào container một cách hữu ích. Vì vậy Host Runner là **tiến trình cài trên máy từng người** (tiến hóa launcher), cài một lần, đăng ký bằng mã dùng một lần.
- Cung cấp trình cài đặt/đường dẫn: `npx @qc/runner init --server https://<host>` hoặc gói cài đặt Windows/macOS; tự cập nhật; không cần `pnpm i` toàn repo như hiện tại.
- Docker Runner (`runner-docker`) dành cho tác vụ chạy máy chủ/CI, không dùng hồ sơ Chrome cá nhân.
- Hiện hữu **[V]**: launcher cần Node 22, `npm i`, `rootCA.pem` (mkcert) cho HTTPS. Đích: proxy dùng chứng chỉ tin cậy (CA nội bộ phân phối một lần hoặc Let's Encrypt/DNS) để giảm bước cài đặt.

## 6. Profile và quy trình

| Profile | Thành phần | Dùng khi |
|---|---|---|
| `dev` | postgres, redis, api (reload), web (dev server), worker, beat; cổng publish 127.0.0.1 | Phát triển trên một máy |
| `team` | thêm `proxy` (TLS), không publish cổng nội bộ, `backup` | Máy chủ nhóm (thay `start-team.ps1`) |
| `s3` | thêm `minio`, `STORAGE_BACKEND=s3` | Thử S3-compatible |
| `runner` | `runner-docker` | Chạy tự động trong container |
| `identity` | Keycloak | Khi cần SSO |

Quy trình chuẩn:
```powershell
Copy-Item .env.example .env        # điền giá trị riêng, không commit
docker compose --profile dev up -d --build
docker compose ps                  # mọi service healthy
```
`migrate` chạy tự động trước `api`; không cần chạy `alembic` tay.

## 7. Health check và thứ tự khởi động

```
postgres, redis ─► migrate ─► api ─► web ─► proxy
                         └──► worker, beat
```
- `api /health` kiểm: kết nối Postgres (`SELECT 1`), Redis (`PING`), storage (ghi/đọc tệp thử), phiên bản schema (khớp Alembic head). Khác `/api/v1/health` hiện tại luôn trả `CONNECTED` **[V]**.
- Worker/beat có health check riêng; compose dùng `restart: unless-stopped`.
- `start_period` đủ dài cho Next.js và lần `migrate` đầu.

## 8. Mạng và bảo mật triển khai

- Mạng `internal` cho postgres/redis/minio; `edge` chỉ cho proxy; api/web trên `internal`+`edge` qua proxy.
- Image: build nhiều giai đoạn, user không root, `HEALTHCHECK`, `read_only` nơi khả thi, không cài công cụ dev trong image production; quét Trivy trong CI.
- Không gắn `docker.sock`; Docker Runner không privileged; `--cap-drop=ALL`, `--security-opt=no-new-privileges`.
- Thay các script `start-qa-ngrok.bat`/`.lnk` (S-09): không phơi Internet; nếu cần truy cập từ xa → VPN.

## 9. Sao lưu và khôi phục

| Mục | Cách |
|---|---|
| Postgres | `pg_dump` hằng ngày (service `backup`) + giữ 14 bản; kiểm thử khôi phục sang DB tạm |
| Storage | snapshot volume + manifest `sha256` (đối chiếu `files`) |
| Cấu hình/bí mật | `.env` và `SECRET_KEK` lưu ở trình quản lý bí mật/két ngoại tuyến của admin; **mất KEK = mất toàn bộ bí mật vault** |
| Khôi phục | Tài liệu từng bước + một lệnh `scripts/restore.ps1`; kiểm tra bằng `alembic current` và đối soát số lượng |

## 10. Lộ trình triển khai hạ tầng (liên kết Roadmap)

| Phase | Việc hạ tầng |
|---|---|
| 1 | Compose thật (dev), CI build image, `migrate`, health thật, Local + S3 storage |
| 2 | Profile `team` + proxy TLS, Docker secrets, `backup`; Keycloak tùy chọn |
| 3 | Beat (đồng bộ Haraworks), hàng đợi `ai`/`sync` |
| 4 | Gói cài Host Runner, `runner-docker`, hàng đợi `automation_post` |
| 5 | Hàng đợi `indexing`, tài nguyên cho embedding |

## 11. Rollback hạ tầng

- `docker compose down` (giữ volume) trả về trạng thái trước; bản Node (`legacy/`) chạy lại bằng lệnh cũ (`start-team.ps1`) vì dữ liệu JSON không bị đụng.
- Volume Postgres/storage chỉ bị xóa khi người phụ trách chạy lệnh xóa tường minh (không có trong script mặc định).
- Image gắn thẻ phiên bản; quay lại thẻ trước + `alembic downgrade` theo từng revision.

## 12. Rủi ro và điểm cần quyết định

| Mục | Ghi chú |
|---|---|
| Máy chủ nhóm hiện là máy Windows (DPAPI, `start-team.ps1`) | Docker Desktop/WSL2 trên Windows hoặc chuyển sang Linux — cần xác nhận hạ tầng thực |
| Chứng chỉ HTTPS | mkcert thủ công hiện tại (**[V]**) vs CA nội bộ/ACME — chọn trước Phase 2 |
| Host Runner trên macOS/Windows | Cần đóng gói và ký; ngoài phạm vi Compose |
| Tài nguyên | Postgres + Redis + Next + FastAPI + worker ≈ 3–4 GB RAM; MinIO/Keycloak tùy chọn |
