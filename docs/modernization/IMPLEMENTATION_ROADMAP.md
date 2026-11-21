# Lộ trình triển khai (Implementation Roadmap)

> Phase 0 · **[N] Proposed**. Mỗi phase độc lập kiểm thử được, có cổng nghiệm thu và đường lùi. Ước lượng thô cho 1–2 kỹ sư; chỉ để xếp thứ tự, không phải cam kết.
> Thứ tự đã điều chỉnh theo phụ thuộc phát hiện khi kiểm toán (xem §1).

## 1. Điều chỉnh so với thứ tự gợi ý ban đầu

| Điều chỉnh | Lý do (bằng chứng từ kiểm toán) |
|---|---|
| Thêm **Phase 0.5 – Bảo vệ và đóng băng đường cơ sở** (không đổi logic) | Cần bản sao lưu nguyên trạng, manifest băm, bộ kiểm thử hành vi bản Node, và xoay bí mật nếu S-01 là thật — trước mọi migration |
| **Strangler**: bản Node tiếp tục chạy song song, chuyển từng trang | 52 chức năng đang dùng hằng ngày (FEATURE_PRESERVATION_MATRIX); không thể ngưng |
| **Bí mật/vault** đưa vào Phase 2 (Core), trước Runner/Haraworks sync | Vault hiện gắn DPAPI; mọi tích hợp (Haraworks cookie, mật khẩu test) cần vault mới |
| **Storage abstraction** vào Phase 1 | Reference Library, bug attachment, artifact đều cần file; hiện chỉ 4 file |
| **Reference Library (Phase 3)** đặt **trước** automation nặng (Phase 4) và vector (Phase 5) | Embedding chỉ nên lập chỉ mục nguồn đã `VALIDATED`; Flow Spec liên kết `references` |
| **Runner Agent** tiến hóa từ launcher ở đầu Phase 4 (trước Flow Recorder) | Flow Recorder và Execution đều cần runner đăng ký/heartbeat/claim và artifact |
| Quyết định G1–G7 (GAP) chốt **trước khi vào Phase 2/4** | G1 (tự duyệt) ảnh hưởng thiết kế automation; G4 (DPAPI) ảnh hưởng vault |

## 2. Tổng quan phase

| Phase | Tên | Phụ thuộc | Độ dài thô |
|---|---|---|---|
| 0 | Kiểm toán và kế hoạch (**tài liệu này**) | — | xong khi được duyệt |
| 0.5 | Đường cơ sở, sao lưu, kiểm thử hành vi | duyệt Phase 0 | 1 tuần |
| 1 | Nền tảng hạ tầng | 0.5 | 2–3 tuần |
| 2 | Core Platform | 1 | 4–6 tuần |
| 3 | Tính năng QC hiện có (bug, rule, file) | 2 | 6–8 tuần |
| 4 | Kiến trúc automation (runner, flow, test, thực thi) | 2, 3 (Reference Library) | 8–12 tuần |
| 5 | AI và tri thức (vector, hỗ trợ điều tra) | 3, 4 | 4–6 tuần |

---

## Phase 0.5 — Đường cơ sở và an toàn

- **Phạm vi**: sao lưu bất biến `database/`, `secrets/` (ngoài repo) + manifest băm; ghi "golden outputs" (kết quả API/tìm kiếm của bản Node cho bộ truy vấn mẫu); viết test hành vi bản Node cần thiết; xoay bí mật (S-01/S-04) do chủ sở hữu thực hiện; chốt quyết định G1–G7.
- **Phụ thuộc**: Phase 0 được duyệt.
- **Deliverables**: `backups/manifest.json` (ngoài repo), bộ `golden/` truy vấn, danh sách quyết định có chữ ký.
- **Thay đổi DB**: không. **API**: không (đọc-chỉ).
- **Kiểm thử**: script đọc-chỉ gọi API Node trên dữ liệu bản sao.
- **Migration**: chưa; chỉ bản sao.
- **Nghiệm thu**: manifest băm lưu và kiểm tra lại khớp; bộ golden tái lập được; quyết định G1–G7 ghi nhận.
- **Rollback**: không có thay đổi hệ thống để lùi.

## Phase 1 — Nền tảng hạ tầng

- **Phạm vi**: cấu trúc monorepo mới (`apps/web`, `apps/api`, `apps/worker`, `apps/runner-agent` rỗng, `packages/*`, `legacy/`); Docker Compose thật (web, api, worker, beat, postgres+pgvector, redis, minio tùy chọn); FastAPI khung + OpenAPI + `/health` thật (kiểm DB/Redis/storage); Next.js khung + API client + layout; SQLAlchemy + Alembic (`0001_core` rỗng); `StorageBackend` (Local + S3) + bảng `files`; cấu hình `pydantic-settings`; CI (lint, type, test, gitleaks, build image); bản Node chuyển vào `legacy/` **không đổi logic** và vẫn chạy bằng lệnh cũ.
- **Phụ thuộc**: 0.5.
- **Deliverables**: một lệnh `docker compose --profile dev up`; tài liệu khởi động; CI xanh; pytest/Vitest khung.
- **Thay đổi DB**: Alembic `0001` (extension `pgvector`, `pg_trgm`, `unaccent`, `files`, `jobs`, `import_runs/items`, `system_settings`).
- **Thay đổi API**: `GET /health`, `GET /api/docs`, `POST /files`, `GET /files/{id}` (chưa có auth ⇒ chỉ profile dev).
- **Kiểm thử**: health thật (tắt Postgres ⇒ unhealthy); Alembic up/down trên DB trống; `StorageBackend` Local và S3 (MinIO) pass cùng bộ test hợp đồng; test e2e khởi động compose.
- **Migration**: chưa nhập dữ liệu.
- **Nghiệm thu**: máy sạch chạy compose ≤ 1 lệnh; mọi service healthy; `alembic downgrade base` sạch; file tải lên đọc lại đúng băm.
- **Rollback**: xóa stack Compose + volume; bản Node trong `legacy/` vẫn hoạt động; không dữ liệu thật bị đụng.

## Phase 2 — Core Platform

- **Phạm vi**: auth (argon2id, access/refresh, thu hồi, rate limit); org/user/RBAC; môi trường và tài khoản test; **vault phong bì** (KEK ngoài DB); audit log append-only; cài đặt hệ thống; port `PolicyEngine`; UI đăng nhập/quản trị (Next.js); importer M-01…M-05, M-16 (người dùng, môi trường, bí mật, tài khoản, audit); chạy song song.
- **Phụ thuộc**: 1; quyết định G4 (vault), G6.
- **Deliverables**: đăng nhập/đổi mật khẩu/phân quyền; trang Tài Khoản & Môi Trường mới; script importer + báo cáo đối soát; test ma trận route × vai trò.
- **Thay đổi DB**: Alembic `0002_core_auth`, `0003_envs_accounts_secrets`, `0004_audit`.
- **Thay đổi API**: `/api/v1/auth/*`, `/users`, `/roles`, `/permissions`, `/environments`, `/accounts`, `/secrets` (chỉ ghi), `/audit-logs`, `/system-settings`.
- **Kiểm thử**: Unit policy (port test `policy-engine.test.js`); test AI-không-duyệt; test brute force/rate limit; test mã hóa vault (giải mã khớp bản cũ trong bộ nhớ); test RBAC; import dry-run và thật trên **bản sao** dữ liệu.
- **Migration**: M-01…M-05, M-16; đặt `must_change_password`; người dùng đăng nhập bằng mật khẩu tạm.
- **Nghiệm thu**: 100 % người dùng thật đăng nhập (qua mật khẩu tạm); quyền tương đương bảng đối chiếu; vault: 5/5 bí mật giải mã đúng; PRODUCTION_TEST không chạy khi chưa xác nhận Org (test); audit ghi đủ.
- **Rollback**: bật lại đăng nhập bản Node (token cũ không bị hủy trong bản Node); xóa dữ liệu `import_run` ở DB mới; vault cũ nguyên vẹn.

## Phase 3 — Tính năng QC hiện có

Chia hai nhánh làm song song được (sau Phase 2):

**3A. Bug**
- **Phạm vi**: bug sources/projects/bugs/snapshots/comments/attachments; đồng bộ Haraworks bằng Celery beat (chỉ đọc, cookie trong vault, trạng thái hết hạn); function/build/QC task; thông báo; tra cứu (tsvector + pg_trgm); phân tích AI qua worker + `AIProvider` (`gemini`, `anthropic`, `local-heuristic`); lưu `ai_analyses`; trang Tra Cứu Bug, Phân Tích Bug, Tổng quan, workspace cá nhân.
- **DB**: Alembic `0005_bugs`, `0006_ai_analyses`, `0007_workspace_notifications`.
- **API**: `/bugs`, `/bugs/{id}`, `/bugs/{id}/history`, `/bug-sources/{id}/sync` (202+job), `/ai/analyses` (202+job), `/functions`, `/builds`, `/notifications`, `/workspace/*`, `/jobs/{id}`.
- **Test**: đồng bộ Haraworks với server giả lập tạm thời **chỉ trong test** (không dùng mô phỏng để tuyên bố hoàn thành tích hợp; nghiệm thu bằng lần đồng bộ thật chỉ-đọc); shadow-read 30 truy vấn mẫu; test fallback AI; test job không chạy trong request.
- **Migration**: M-07…M-10, M-13, M-15, M-17…M-19.

**3B. Reference Library và Rule**
- **Phạm vi**: `sources/source_versions`, `references` (locator, annotation, validation), `reference_links`, `ai_suggestions`, `business_rules/versions`; UI duyệt (hàng đợi `UNREVIEWED`/`DISPUTED`); đồng bộ từ Kho (kb-snapshot) tạo `source_version` + so sánh; skill `business-rule-extractor` đẩy qua API tương thích (adapter) — F49.
- **DB**: Alembic `0008_knowledge`, `0009_rules`.
- **API**: `/sources`, `/sources/{id}/versions`, `/references`, `/references/{id}/links`, `/suggestions` (+ `/accept`, `/reject` đòi quyền), `/rules`, `/rules/{key}/versions`, `/kb/sync`.
- **Test**: AI không tạo `VALIDATED`/rule `active` (test hợp đồng); xung đột ⇒ `DISPUTED`; đồng bộ lại cùng dữ liệu = 0 thay đổi; rule import đủ trường (không mất như `buildBundle`).
- **Migration**: M-06 (file), M-11, M-12 phần `rule_ids`, M-14 liên kết.

**Chung Phase 3**
- **Phụ thuộc**: 2.
- **Nghiệm thu**: chức năng F05, F13–F29, F35, F43–F45, F52 đạt cổng (FEATURE_PRESERVATION_MATRIX); số lượng khớp nguồn (6059/714/2221/1204/2485/194 tại thời điểm cắt); mọi rule truy ngược nguồn.
- **Rollback**: từng trang quay lại bản Node; Alembic downgrade từng revision; xóa dữ liệu `import_run`; cờ tính năng (feature flag) cho mỗi trang.

## Phase 4 — Kiến trúc automation

- **Phạm vi** (theo thứ tự con):
  1. **Runner Agent** (TypeScript): đăng ký, heartbeat, claim có lease, đẩy log/artifact; Host Runner (tiến hóa launcher, giữ `open-session`); Docker Runner (cùng mã, image Playwright); `playwright-kit` (port `task-runner.js`, `playwright-login.js`, `task-files.js`).
  2. **Automation management**: `automation_projects/tasks/params/code_versions`; duyệt đúng nghĩa (G1); lịch chạy; retry/timeout/hủy; lịch sử; artifact (screenshot/video/trace) vào storage.
  3. **Flow & Test**: Flow Recorder (ghi sự kiện, ảnh/DOM), Interaction Normalization, Locator Resolution, Flow Spec Draft → Review → Approved, Test Case (+version), Automation Code (+SHA), Execution.
  4. Adapter Web + API + Hybrid; khung `ExecutionAdapter` sẵn cho mobile (không triển khai).
- **Phụ thuộc**: 2 (auth, vault); 3B (Reference Library) cho liên kết spec ↔ reference; 3A không bắt buộc.
- **Deliverables**: runner chạy trên Windows (host) và container; trang Tác Vụ Tự Động mới; 30 tác vụ import ở `DRAFT`/đã ký; Flow Recorder MVP; báo cáo thực thi có artifact.
- **DB**: Alembic `0010_automation`, `0011_runners_executions`, `0012_flows_tests`.
- **API**: `/automation/projects|tasks|code-versions|executions|schedules`, `/runners/register|heartbeat|claim|report`, `/flows/recordings|specs|reviews`, `/test-cases`, `/executions/{id}/artifacts`.
- **Kiểm thử**: unit task-runner (port `automation-tasks.test.js`); test hợp đồng runner (claim idempotent, lease hết hạn, retry); test "chỉ `APPROVED` + SHA khớp mới chạy"; test AI không duyệt; e2e: 3 tác vụ mẫu chạy thật trên **Staging** (hành vi tương đương bản cũ), artifact lưu đúng; test cách ly Docker Runner; không ghi Production.
- **Migration**: M-12, M-13, M-14, M-22 (không migrate hồ sơ Chrome).
- **Nghiệm thu**: F30–F34, F36–F41, F49–F50; 30/30 tác vụ import đúng SHA; runner mất kết nối ⇒ việc được cấp lại; mọi lần chạy có log + ảnh; không đường nào AI tự duyệt/chạy rộng.
- **Rollback**: người dùng quay lại launcher cũ (bản Node giữ nguyên); đặt runner `disabled`; xóa `executions` do thử nghiệm; Alembic downgrade.

## Phase 5 — AI và tri thức

- **Phạm vi**: pipeline lập chỉ mục nguồn (chunk → embedding → `embeddings` pgvector, HNSW), chỉ nguồn `VALIDATED` (hoặc gắn nhãn); truy xuất lai (từ khóa + vector) có trích dẫn; điều tra bug hỗ trợ AI (RCA, tái hiện, test gợi ý) lưu `ai_suggestions`; sinh Flow/Test nháp; quy trình duyệt người.
- **Phụ thuộc**: 3 (nguồn đã có), 4 (Flow/Test).
- **DB**: Alembic `0013_embeddings` (+ chỉ mục), `0014_ai_governance` (log prompt, đánh giá).
- **API**: `/search`, `/ai/investigate`, `/ai/suggest-flow`, `/ai/suggest-tests`, `/index/rebuild` (202+job).
- **Kiểm thử**: bộ đánh giá truy xuất (đã gán nhãn từ 30 truy vấn mẫu) — precision@5 ≥ bản từ khóa; test "AI không tự duyệt"; test không đưa nguồn `UNREVIEWED` vào câu trả lời nếu bật chế độ nghiêm ngặt; chi phí/độ trễ ghi nhận.
- **Migration**: lập chỉ mục từ dữ liệu đã nhập; không đổi nguồn.
- **Nghiệm thu**: trả lời luôn kèm nguồn/version/locator; kết quả không tệ hơn bản từ khóa trên bộ đánh giá; mọi đề xuất AI ở `PROPOSED`.
- **Rollback**: tắt chỉ mục vector (fallback từ khóa); drop bảng `embeddings` (tái tạo được).

---

## 3. Cắt chuyển và ngừng bản cũ

1. Mỗi trang chuyển bằng cờ tính năng sau khi đạt cổng; bản Node giữ nguyên ≥ 2 tuần sau trang cuối.
2. Ngừng bản Node (`legacy/`) khi: toàn bộ F-xx đạt cổng hoặc bị gỡ có quyết định; dữ liệu JSON được đóng băng (đổi tên, không xóa); runner mới thay launcher cho mọi người dùng.
3. Việc xóa dữ liệu cũ **không** thuộc kế hoạch này; nếu cần, một quyết định riêng và sao lưu ngoại tuyến.

## 4. Quản trị rủi ro xuyên phase

| Rủi ro | Giảm thiểu |
|---|---|
| Hồi quy | Golden outputs + shadow-read; cổng kiểm tra từng chức năng |
| Mất dữ liệu | Importer chỉ đọc nguồn; đối soát số lượng/băm; sao lưu M0 |
| Quá cỡ | Mỗi phase ≤ 12 tuần, nghiệm thu độc lập, không vi dịch vụ |
| Phụ thuộc người (một người hiểu bản Node) | Tài liệu hóa hành vi trong golden tests; ghi quyết định |
| AI vượt quyền | Test hợp đồng ở mọi phase; quyền `*.approve` không gán cho AI |

## 5. Quyết định đang chờ (cần chủ sản phẩm/admin trước Phase 2–4)

| ID | Quyết định | Cần trước |
|---|---|---|
| G1 | ~~Tác vụ tự duyệt~~ **ĐÃ CHỐT**: chỉ QC duyệt, 4 QC ngang quyền (APPROVAL_MODEL.md) | xong |
| G2 | Đồng bộ kho rule: tạo gợi ý khác biệt thay vì ghi đè | Phase 3B |
| G4 | Cách giải mã vault DPAPI và nơi giữ KEK mới | Phase 2 |
| G5 | Cookie Haraworks cá nhân vs token dịch vụ | Phase 3A |
| G6 | Phạm vi cho phép của `PRODUCTION_TEST` | Phase 2 |
| Q1 | Dữ liệu `notify-seen` có cần chuyển không | Phase 3A |
| Q2 | `figma-adapter`, `task-adapter`, `test-plan-generator` không được route nào gọi: giữ hay gỡ | Phase 3–4 |
| Q3 | Mã/ý nghĩa các giá trị `c`/`how` trong `bugs.json` | Phase 3A |
| Q4 | Ngôn ngữ UI và i18n (hiện tiếng Việt cứng) | Phase 1 |
