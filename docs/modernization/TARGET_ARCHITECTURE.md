# Kiến trúc đích (Target Architecture)

> Phase 0 · toàn bộ nội dung là **[N] Proposed**, trừ những dòng ghi rõ là tái sử dụng tài sản **[V]** đã có.
> Nguyên tắc: modular monolith, PostgreSQL là nguồn sự thật, không vi dịch vụ giai đoạn đầu, không cho AI tự duyệt.

## 1. Tổng quan

```
                 ┌───────────────┐        ┌────────────────────────────────┐
 Trình duyệt ──► │ Next.js (TS)  │ ─────► │ FastAPI (modular monolith)     │
                 │ API client +  │  HTTPS │  routers → services → repos    │
                 │ auth tập trung│        │  OpenAPI /docs                 │
                 └───────────────┘        └──┬──────────┬──────────┬───────┘
                                             │          │          │
                                  SQLAlchemy │   Celery │  Storage │ abstraction
                                             ▼          ▼          ▼
                                   PostgreSQL 16     Redis     Local FS ──► S3-compatible
                                   + pgvector     (broker)     (metadata ở Postgres)
                                             ▲          │
                                             │          ▼
                                             │   Celery workers: AI, sync Haraworks, indexing, post-run
                                             │
              ┌──────────────────────────────┴─────────────────────────────┐
              │ Runner Agent (TypeScript + Playwright)                      │
              │  • Host Runner Agent (tiến hóa từ QA Launcher)              │
              │  • Docker Runner Agent (cùng mã, chạy trong container)      │
              │  đăng ký → heartbeat → nhận task → chạy → đẩy log/artifact   │
              └─────────────────────────────────────────────────────────────┘
```

## 2. Cấu trúc monorepo đề xuất

```
qc-platform/
├─ apps/
│  ├─ web/                  Next.js + TypeScript (App Router)
│  ├─ api/                  FastAPI (Python 3.12)
│  │   ├─ app/main.py
│  │   ├─ app/core/         config, security, db session, logging, errors
│  │   ├─ app/domains/
│  │   │   ├─ platform/     auth, users, orgs, rbac, environments, accounts, audit, settings
│  │   │   ├─ bugs/         sync, bug, history, ai_analysis
│  │   │   ├─ knowledge/    sources, references, suggestions, rules, retrieval
│  │   │   ├─ flows/        recorder_ingest, normalization, locators, flow_specs, test_cases
│  │   │   ├─ automation/   projects, code_versions, runners, executions, artifacts
│  │   │   └─ files/        storage abstraction + metadata
│  │   │       (mỗi domain: models.py, schemas.py, repository.py, service.py, router.py)
│  │   ├─ alembic/          migrations
│  │   └─ tests/
│  ├─ worker/               Celery app, import tasks từ apps/api/app/domains/*/tasks.py
│  └─ runner-agent/         TypeScript: host + docker (chung core)
├─ packages/
│  ├─ shared-types/         OpenAPI-generated TS client + schema dùng chung web/runner
│  └─ playwright-kit/       helper chạy task (pickOption, attachFiles, step, assert) chuyển từ task-runner.js
├─ legacy/                  bản Node hiện tại, chạy song song chỉ-đọc trong thời gian chuyển đổi (xem ROADMAP)
├─ infra/compose/           compose.yaml + overlay dev/team
├─ docs/
└─ scripts/                 migrate/import (idempotent), ops
```

Quy tắc phụ thuộc: `router → service → repository → model`; domain gọi domain khác **chỉ qua service công khai**, không import repository của nhau. Worker và API dùng chung `services` (một mã nghiệp vụ, hai điểm vào).

## 3. Miền nghiệp vụ

### A. Core Platform
- **Auth**: argon2id, access token ngắn hạn + refresh token xoay vòng lưu băm ở DB, thu hồi theo phiên; giới hạn đăng nhập sai; bắt buộc đổi mật khẩu lần đầu (thay cho `123456`). Tùy chọn OIDC (Keycloak) sau này.
- **User/RBAC** *(đã chốt 2026-11-21)*: bảng `users` với MỘT vai trò `qc` (`CHECK`), 4 QC ngang quyền; quyền là hằng số mã hóa (`Perm`); **bỏ `organizations` và bảng `roles/permissions/user_roles`** ở giai đoạn này (thêm lại bằng migration khi có vai trò thứ hai). Chỉ QC duyệt mọi sản phẩm/hành động của AI — xem APPROVAL_MODEL.md.
- **Environments/Accounts**: `environments(type: STAGING|PRODUCTION_TEST|PRODUCTION|TASK_SYSTEM)`, `accounts` tham chiếu secret trong `secrets_vault`; **không** lưu mật khẩu trong bảng nghiệp vụ.
- **Audit**: `audit_logs` append-only (actor, action, resource_type/id, decision, before/after đã che bí mật, correlation_id, ip). Tái sử dụng ngữ nghĩa của `PolicyEngine.logAudit` **[V]**.
- **Config**: `system_settings` có phạm vi (global/org) và lịch sử.
- **Policy engine**: port nguyên quy tắc fail-closed hiện có **[V]** sang Python (AI không APPROVE/CONFIRM_ORG; chặn ghi Production; gate Org).

### B. Bug Management & AI Analysis
- `bug_sources`, `bugs` (id ngoài, project, status, priority, ngày…), `bug_snapshots` (mỗi lần đồng bộ thấy thay đổi → một bản, giữ lịch sử), `bug_comments`, `bug_attachments` (→ `files`).
- Đồng bộ Haraworks = Celery beat + task `sync_bugs(project)`; cookie/token Haraworks là secret trong vault; chỉ đọc; xử lý hết hạn → trạng thái `AUTH_EXPIRED` hiển thị trên UI (giữ hành vi hiện tại **[V]**).
- `ai_analyses` (input, provider, model, prompt_version, output JSON, citations, trạng thái `DRAFT|REVIEWED|REJECTED`), do worker chạy; **provider abstraction** `AIProvider` (`gemini`, `anthropic`, `local-heuristic`) — giữ fallback phân tích cục bộ **[V]**.
- Root cause / reproduction / test suggestions là **AI Suggestions** (xem C), không phải sự thật đã duyệt.

### C. QC Knowledge Management (Reference Library có quản trị)
Ba lớp tách biệt, không gộp tự động:

1. **Original Sources** — `sources` (loại: SOP, tài liệu nghiệp vụ, ảnh, video, rule hiện có, khác), `source_versions` (băm nội dung, file trong storage, ngày hiệu lực). Bất biến sau khi tạo; bản mới = version mới.
2. **QC Reference Library** — `modules`, `functions`, `references` (module, function, `source_version_id`, `locator` JSON: trang/đoạn/timestamp/vùng ảnh), `annotations`, `reference_links` (quan hệ có loại: `refines`, `conflicts_with`, `supersedes`, `depends_on`), `validation_status` (`UNREVIEWED|VALIDATED|REJECTED|DISPUTED`) + người duyệt + thời điểm.
3. **AI Suggestions** — `ai_suggestions` (loại: extracted_info, suggested_rule, suggested_relation, suggested_scenario; trỏ về `source_version_id`/locator; trạng thái `PROPOSED|ACCEPTED|REJECTED`). Chỉ người có quyền `knowledge.approve` mới chuyển thành `reference`/`business_rule`; thao tác này ghi audit.

- `business_rules` (có `rule_key`, ràng buộc `unique(rule_key, version)`), `business_rule_versions`, `business_rule_references(rule_id, reference_id)` → mọi rule truy ngược được nguồn.
- **Xung đột**: hai nguồn mâu thuẫn tạo `reference_links(type=conflicts_with)` và trạng thái `DISPUTED`; không có rule "authoritative" cho tới khi người duyệt chọn và ghi lý do.
- **Truy xuất**: `embeddings` (pgvector, cột `vector(N)`, chỉ cho nguồn `VALIDATED` hoặc gắn nhãn rõ), HNSW index; kết quả luôn kèm trích dẫn (source/version/locator). Giữ lọc từ khóa hiện có làm chế độ lai.

### D. Flow & Test Management
Chuỗi có chủ sở hữu, trạng thái, version ở từng bước:

| Bước | Thực thể | Trạng thái | Chủ sở hữu |
|---|---|---|---|
| Flow Recorder | `flow_recordings` + `recorded_events` (sự kiện thô: click/type/navigate + DOM snapshot/ảnh) | `RECORDING→CAPTURED` | người ghi |
| Interaction Normalization | `normalized_interactions` | `NORMALIZED` | hệ thống (worker) |
| Locator Resolution | `locator_candidates` (role/text/testid/css, điểm tin cậy), `resolved_locators` | `RESOLVED|NEEDS_REVIEW` | hệ thống + QC |
| Flow Spec Draft | `flow_specs` + `flow_spec_versions` | `DRAFT` | QC/AI đề xuất |
| QC Review | `flow_reviews` | `IN_REVIEW→APPROVED|REJECTED` | QC có quyền |
| Approved Flow Spec | version bất biến | `APPROVED` | QC |
| Test Case | `test_cases` + `test_case_versions` liên kết spec version | `DRAFT→APPROVED` | QC |
| Automation Code | `automation_code_versions` (script TS, `sha256`, liên kết test case version) | `DRAFT→APPROVED` | QC/dev |
| Execution | `executions`, `execution_steps` | `QUEUED→RUNNING→PASSED|FAILED|CANCELLED` | runner |
| Results/Artifacts | `execution_artifacts` → `files` | — | runner |

Flow Recorder: tiện ích Playwright (codegen-style) hoặc extension ghi sự kiện; đẩy lên API; **không** sinh code chạy được trực tiếp từ bản ghi thô. Mỗi bước chuyển trạng thái do người có quyền thực hiện; AI chỉ tạo bản `DRAFT`.

### E. Automation Management
- `automation_projects`, `automation_code_versions` (bất biến, ghim sha), `runners` (`type: host|docker`, `capabilities` JSON gồm `web`, `api`, `hybrid`, `labels`, `status`, `last_heartbeat_at`), `execution_schedules`, `executions` (retry_count, max_retries, lý do thất bại), `execution_logs`, `execution_artifacts`.
- Web + API + Hybrid trong MVP. Runner nhận `ExecutionAdapter` có giao diện chung (`prepare/execute/collect`); chỉ cài `playwright-web` và `playwright-api` ở MVP. Mobile native: để trống adapter (`appium`/`maestro`) cho tương lai, **không** triển khai.
- Quy tắc duyệt: chỉ `automation_code_versions.status=APPROVED` và `sha` khớp mới được xếp hàng chạy. Thay cho `autoApprove` hiện tại (xem SECURITY_REVIEW).

## 4. Runner Agent (tiến hóa từ QA Launcher)

| Năng lực | Launcher hiện tại | Runner Agent đích |
|---|---|---|
| Đăng nhập tự động Playwright, profile theo tài khoản | **[V]** giữ nguyên logic `playwright-login.js` | giữ, tách thành module dùng chung |
| Chạy script có `step/assert/pickOption/attachFiles/params` | **[V]** `task-runner.js` | chuyển nguyên vào `packages/playwright-kit` |
| Kiểm tra SHA trước khi chạy | **[V]** | giữ, bắt buộc |
| Đăng ký + token riêng của runner, rotate | [M] | thêm (`POST /runners/register`) |
| Heartbeat, trạng thái, nhãn | [M] | thêm |
| Nhận việc (pull có lease, idempotent) | [M] (trình duyệt gọi launcher) | thêm: runner chủ động poll `POST /runners/{id}/claim` |
| Đẩy log, screenshot, video, trace | [M] | thêm → storage abstraction |
| Retry/timeout/hủy | [M] | thêm (server quyết định, runner thực thi) |
| Docker mode (Chromium trong container, không DPAPI) | [D] | thêm: cùng image, bí mật nạp qua API ngắn hạn |
| Chế độ cục bộ cho "mở Chrome và tự đăng nhập" (tab Tài khoản) | **[V]** | giữ như lệnh `open-session` của Host Runner (giữ UX hiện tại) |

Bảo mật runner: token runner chỉ quyền `runner:*`; mật khẩu cấp qua kênh một lần, ngắn hạn (kế thừa mô hình 1 lần/2 phút **[V]**); runner không ghi bí mật ra đĩa (**[V]** hiện tại).

## 5. Lưu trữ file

```
StorageBackend (Protocol): put(stream, key, content_type) / get / delete / presign / exists
  ├─ LocalStorage    (volume /data/storage, khóa theo hash, thư mục theo ngày)
  └─ S3Storage       (boto3, endpoint tùy chỉnh: MinIO/AWS)
Bảng `files`: id, sha256, size, mime (nhận dạng magic bytes — tái dùng `sniff` **[V]**), storage_backend, storage_key,
              owner_id, org_id, created_at, retention_until, scan_status
Bảng liên kết: bug_attachments, source_versions.file_id, execution_artifacts.file_id, automation_inputs...
```
Không lưu nhị phân trong Postgres. Chọn backend bằng `STORAGE_BACKEND=local|s3`. Giới hạn kích thước/loại, quét loại file theo magic bytes giữ lại từ hiện trạng.

## 6. Nền tảng và tác vụ nền

- Celery + Redis; hàng đợi tách: `default`, `ai`, `sync`, `indexing`, `automation_post`.
- Mọi việc dài (AI, đồng bộ Haraworks, tải ảnh bug, lập chỉ mục, hậu xử lý artifact) là task; API chỉ tạo `jobs` và trả `202` + id; trạng thái truy vấn được.
- Celery beat thay cho `setInterval` poll trong `server.js`. Khóa phân tán (Redis) tránh đồng bộ chồng lặp. Tác vụ idempotent; có `jobs` bảng theo dõi.

## 7. API và frontend

- FastAPI + Pydantic v2; OpenAPI tại `/api/docs`; versioned `/api/v1`; lỗi theo một định dạng (`{error:{code,message,details,correlation_id}}`); phân trang/lọc thống nhất.
- Next.js (TypeScript): `lib/api` client sinh từ OpenAPI; một `AuthProvider`; middleware chặn route; quản lý token qua cookie `HttpOnly` + CSRF (không lưu `localStorage`); module theo miền (`features/bugs`, `features/knowledge`, …); thiết kế lại trang giữ nguyên chức năng (xem FEATURE_PRESERVATION_MATRIX).

## 8. Môi trường, cấu hình, bí mật

- `.env` theo môi trường (`dev`, `team`), một schema cấu hình `pydantic-settings` đọc & kiểm tra khi khởi động (thiếu biến → fail fast).
- Bí mật: bảng `secrets` mã hóa phong bì (KEK từ biến môi trường/KMS, DEK theo bản ghi, AES-GCM — nâng cấp mô hình `SecretVault` **[V]** để bỏ phụ thuộc DPAPI).
- Logging có bộ lọc che bí mật (port `packages/diagnostics/redactor.js` **[V]**).
- Tách môi trường: mỗi `environment` có `type` và chính sách; `PRODUCTION` không bao giờ cho phép ghi tự động; mọi thao tác ghi Production cần xác nhận rõ ràng của người dùng.

## 9. Kiểm thử đích

| Thành phần | Công cụ |
|---|---|
| API/domain | pytest + testcontainers (Postgres thật), không mock DB |
| Migration | Alembic upgrade/downgrade trong CI trên DB trống và DB đã seed |
| Worker | pytest với Redis thật |
| Web | Vitest + Playwright (e2e) |
| Runner | Vitest + Playwright chạy trên trang cục bộ |
| Contract | OpenAPI → client TS, kiểm tra không lệch |

## 10. Không làm trong MVP

Vi dịch vụ, Kubernetes, mobile native, đa vùng, thay đổi nhà cung cấp Haraworks, ghi ngược lên Haraworks/Production.
