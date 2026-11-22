# Trạng thái triển khai (Implementation Status)

> Cập nhật 2026-11-22 · nhánh `feature/new-platform`.
> Phạm vi đã làm: **Phase 1 (hạ tầng) + lõi Phase 2 (Core) + Reference Library và nhập bug (Phase 3, chưa có đồng bộ realtime) + Automation và Runner Agent (Phase 4, phần lõi)**, theo quyết định duyệt chỉ-QC (APPROVAL_MODEL.md).
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

### Cập nhật 2026-11-22: Reference Library, nhập rule/bug, giao diện

| Hạng mục | Bằng chứng |
|---|---|
| Reference Library: `modules`, `sources`/`source_versions`, `references` (locator, quote, stance), `reference_links` (refines/conflicts_with/supersedes/depends_on), `annotations`, `business_rules` + `business_rule_versions` bất biến | migration `0002`, `tests/test_library.py` (12 test) |
| Rule vào Thư viện luôn `UNREVIEWED`; duyệt ở Kho ngoài chỉ ghi vào `legacy_approval` (tham khảo); chỉ QC mới `VALIDATED`; mỗi rule có `validated_by` là người (CHECK ở CSDL) | test + kiểm tay trên trình duyệt |
| QC viết/sửa rule ⇒ version mới + yêu cầu duyệt (không ghi đè); AI đề xuất rule chỉ thành rule khi QC chấp nhận (do chính QC đó xác nhận) | `test_library.py` |
| Xung đột: `conflicts_with` đặt cả hai bên `DISPUTED`, không thể duyệt tới khi giải quyết; không bao giờ gộp âm thầm | `test_library.py` |
| Duyệt hàng loạt `POST /approvals/bulk-decision`: từng mục vẫn phải kèm đúng `payload_hash`, lỗi một mục không ảnh hưởng mục khác | `test_library.py` |
| Nhập kb-snapshot (`import-kb-snapshot`): đọc `kb-snapshot/rules` đầy đủ trường (không dùng `business_rules.json` đã lược), chạy khô mặc định, idempotent, không ghi đè khi cùng version nhưng khác nội dung (báo xung đột) | test + **chạy trên dữ liệu thật** (xem dưới) |
| Bug: `bug_sources`, `projects`, `bugs`, `bug_snapshots` (lịch sử theo băm nội dung — bản Node không có); tìm kiếm tiếng Việt không dấu; module của bug Haraworks suy từ thẻ trong tiêu đề, **không đoán khi không khớp** | `tests/test_bugs.py` (7 test) |
| Nhập bug (`import-bugs`): bug cũ và bug Haraworks giữ riêng theo nguồn, không gộp tự động; `c` của bug cũ là `classification`, **không** suy ra trạng thái | test + chạy thật |
| Giao diện: Thư viện tham chiếu (chi tiết, nguồn gốc, ghi chú duyệt ở Kho), Tra cứu bug, Môi trường & tài khoản (mật khẩu chỉ ghi), duyệt hàng loạt | `tsc`, `vitest`, `next build`, kiểm tay trên trình duyệt |

**Chạy thật trên dữ liệu của bạn (chỉ đọc nguồn, ghi vào DB tạm SQLite, đã xóa sau khi xong):**

| Nguồn | Kết quả |
|---|---|
| `kb-snapshot` | 37 module, 195 rule / 200 phiên bản, 217 tham chiếu, 34 nguồn, 194 yêu cầu duyệt (6 bản `archived` giữ làm lịch sử, không xếp hàng duyệt); 0 lỗi, 0 xung đột; chạy lại: 200 bỏ qua, 0 tạo mới |
| `bugs.json` | 6059 bug, 0 lỗi; chạy lại: 6059 bỏ qua |
| `bugs-live.json` | 714 bug, 5 dự án, 0 lỗi; module suy ra được cho 570/714 (còn lại thẻ không khớp module nào, để trống) |

Lỗi tìm thấy nhờ chạy thật và đã sửa: CLI không nạp model `files` (khóa ngoại không phân giải) ⇒ gom nạp model vào `app/models.py`; bug Haraworks không có module ⇒ thêm suy luận từ thẻ tiêu đề.

Tổng: **60 test backend** (`pytest`), **4 test frontend**, `ruff` và `tsc` sạch.

### Cập nhật 2026-11-22 (2): Automation và Runner Agent

| Hạng mục | Bằng chứng |
|---|---|
| Tác vụ, tham số, **code version bất biến** (`sha256` ghim); mọi version mới (người/AI/nhập) ở `PENDING` + yêu cầu duyệt; chỉ QC mới `APPROVED` (CHECK ở CSDL: APPROVED phải có người duyệt) | migration `0003`, `tests/test_automation.py` (16 test) |
| Chạy chỉ khi có version `APPROVED`; version mới chưa duyệt không thay thế bản đang chạy; chỉ môi trường STAGING; PolicyEngine kiểm tra `AUTOMATE`; giới hạn 120 lượt/10 phút (đếm trong DB, bền); chạy nhiều lần ≤ 50 | test |
| Hàng đợi `executions`: nhận việc bằng cập nhật có điều kiện (không nhận trùng), lease 5 phút, hết lease ⇒ xếp lại, hết lượt thử ⇒ FAILED; code bị thu hồi giữa chừng ⇒ không chạy; QC hủy được | test |
| Runner: QC tạo (token `rn_…` chỉ hiện một lần, lưu băm), heartbeat, claim, mật khẩu cấp **một lần** cho mỗi lần nhận việc (audit `SECRET_READ` actor RUNNER), báo kết quả phải kèm đúng `sha256` đã duyệt, upload artifact; token runner và token QC không dùng lẫn; thu hồi có hiệu lực ngay | test |
| Nhập tác vụ (`import-automation`): từ `automation-drafts` **và** DB đang chạy của bản Node; `approved_by:"auto"` KHÔNG được coi là duyệt; script khác ⇒ version mới, không ghi đè | test + **chạy thật** (xem dưới) |
| **Runner Agent** (`apps/runner-agent`, TypeScript + Playwright): kit chạy script (port `task-runner.js`: `step/assert/pickOption/attachFiles/ctx`), tự băm lại và từ chối khi lệch sha, vòng lặp claim → mật khẩu → chạy → báo, ảnh chụp khi lỗi, đăng nhập (port `playwright-login.js`) | 15 test `vitest`, gồm **chạy script thật trên Chrome** |
| UI: Tác vụ tự động (tham số, xếp hàng, lần chạy, hủy), Runner (tạo, token một lần, thu hồi), duyệt code automation | `tsc`, `next build` |
| Docker Runner: Dockerfile (image Playwright, user không root) + service compose profile `runner` (`cap_drop ALL`, `no-new-privileges`) | cú pháp compose hợp lệ; **chưa build image** |

**Đầu-cuối thật (API thật + Runner Agent thật + Chrome, DB tạm đã xóa):** tạo tác vụ → chạy khi chưa duyệt bị chặn (`409 NOT_APPROVED`) → QC duyệt → xếp hàng → Runner nhận việc, chạy 3 bước trên Chrome, báo `PASSED`, runner `ONLINE`. Nhánh lỗi: bước tìm phần tử không có ⇒ `FAILED` với dòng "waiting for locator", ảnh chụp lỗi tải lên và tải về được (PNG). Chế độ `RUNNER_SKIP_LOGIN=1` (chỉ dev, có cảnh báo) được dùng vì chưa có Staging thật để đăng nhập.

**Chạy thật nhập tác vụ (chỉ đọc nguồn, DB tạm):** 30 mục trong `automation-drafts` + 13 tác vụ chỉ có trong DB đang chạy của bản Node ⇒ **43 tác vụ, 43 code version `PENDING`, 43 yêu cầu duyệt chờ QC**, 0 lỗi; chạy lại: 0 tạo mới. Phát hiện: tác vụ `at_359a4a7e53707e8c` dùng khóa tham số `Tab_kiem_tra` (chữ hoa) — bản Node cũ đã lưu được nên quy tắc khóa được nới cho phép chữ hoa (đổi tên sẽ làm lệch sha của script đã duyệt).

Lỗi tìm thấy nhờ test và đã sửa: `claim` truy vấn hàng đợi trước khi ghi việc tái xếp hàng (session tắt autoflush) ⇒ việc hết lease không được nhận lại.

Tổng: **76 test backend**, **6 test frontend**, **16 test runner-agent**; `ruff`, `tsc` sạch.

### Cập nhật 2026-11-22 (3): chạy thật bằng Docker Compose (Docker Desktop do bạn bật)

Đã dựng **api, web, worker, beat, migrate, PostgreSQL 16 + pgvector, Redis** bằng `docker compose` (project `qc-platform`, cổng 127.0.0.1; không đụng container/image cũ của bạn):

| Kiểm tra | Kết quả |
|---|---|
| `migrate` (Alembic 0001→0003) trên PostgreSQL thật | Thoát 0; `alembic_version=0003` |
| `/health` | `{"database":"ok","schema":"ok","redis":"ok","storage":"ok"}` (schema so với revision trong mã) |
| Worker | Kết nối Redis, nhận `system.ping`; **một tác vụ Celery thật** chạy qua worker trả `pong`; healthcheck `celery inspect ping` đạt |
| Web (Next.js standalone) | `healthz` 200; proxy `/api` tới API đạt |
| Extension | `vector`, `pg_trgm`, `unaccent` |
| Trigger | `UPDATE`/`DELETE` trên `audit_logs` bị chặn (`audit_logs is append-only`) |
| Ràng buộc | Chèn user vai trò `admin` bị `ck_users_role_qc_only` từ chối |
| Tìm kiếm | Chỉ mục trigram `ix_bugs_title_fold_trgm` được dùng |
| **Nhập dữ liệu thật vào PostgreSQL** (nguồn mount chỉ đọc) | Giống hệt lần chạy SQLite: rule 195/200 phiên bản, 217 tham chiếu, bug 6059 + 714, 43 tác vụ; **0 lỗi; chạy lại: 0 tạo mới**. Sau nhập: 237 yêu cầu duyệt chờ QC (194 rule + 43 code) |

Lỗi chỉ lộ khi chạy trong Docker và đã sửa: (1) `kombu` cần `packaging` nhưng không khai báo ⇒ worker/beat khởi động lại liên tục ⇒ thêm vào `pyproject.toml`; (2) beat thừa hưởng healthcheck HTTP của image API ⇒ thêm healthcheck riêng; (3) agent trong container Playwright không có Chrome ⇒ rơi về Chromium đi kèm khi headless; (4) compose bắt biến `RUNNER_TOKEN` ngay cả khi profile tắt.

**Sự cố đã xử lý:** các lần build làm đầy ổ C: (còn 0,3 GB) khiến Docker Desktop treo; sau khi bạn giải phóng dung lượng và Docker chạy lại, stack tự lên healthy và **dữ liệu trong volume còn nguyên** (6773 bug, 43 tác vụ).

#### Docker Runner và web trong Docker (đã chạy thật)

| Kiểm tra | Kết quả |
|---|---|
| Docker Runner (image Playwright, Chromium headless trong container) | Nhận việc từ API qua mạng Compose, chạy 2 tác vụ thử: một **PASSED** (3 bước), một **FAILED** kèm dòng `waiting for locator` và **ảnh chụp lỗi** lưu thành artifact; runner `ONLINE` |
| Cách ly container | `user=pwuser`, `cap_drop=ALL`, `no-new-privileges`, không privileged |
| Đăng nhập qua web (trình duyệt) trên stack Docker, trang Tác vụ tự động | Đạt, hiển thị 45 tác vụ (43 nhập + 2 tác vụ thử) |
| Duyệt hàng loạt qua API | Đạt (2/2) |

Lỗi chỉ lộ khi chạy trong Docker và đã sửa: (5) Next tính `rewrites` lúc build nên địa chỉ API bị đóng cứng `127.0.0.1:8000` ⇒ web trong container trả 500 khi gọi `/api` ⇒ chuyển sang `middleware.ts` đọc `API_INTERNAL_URL` lúc chạy (có test); (6) Runner từ chối `http://api:8000` (chỉ cho https/localhost) ⇒ thêm cờ tường minh `RUNNER_ALLOW_HTTP=1`, chỉ đặt cho service Docker Runner trong compose (có test); runner ngoài compose vẫn bắt buộc https.

Chế độ `RUNNER_SKIP_LOGIN=1` vẫn được dùng cho các tác vụ thử vì chưa có Staging thật; **đăng nhập thật bằng Runner chưa được kiểm chứng**.

Stack tạm đã được gỡ (container, volume, image `qc-platform-*`, file token). Image nền `pgvector`, `redis` còn lại trong Docker (bạn có thể xóa nếu cần chỗ).

### Cập nhật 2026-11-22 (4): tra cứu trích dẫn, AI, tác vụ nền, lịch chạy, ghi luồng

**Đổi nghiệp vụ theo yêu cầu mới:** QC nhập mô tả bug ⇒ hệ thống rút từ khóa và **trích nguyên văn kèm vị trí chính xác** từ các nguồn đã nạp vào DB: (1) tài liệu BA `.docx`, (2) link Figma, (3) mô tả Task Function (toàn bộ danh sách), (4) trang wiki tổng hợp rule chạy thực tế trên code. Hướng dẫn vận hành: `docs/operations/tra-cuu-trich-dan.md`.

| Hạng mục | Cách kiểm chứng | Kết quả |
|---|---|---|
| Nạp và tra cứu trích dẫn (docx/figma/task function/wiki; phiên bản; vị trí dòng/đoạn/bảng/ký tự) | Test tự động + dữ liệu thật đọc-only: danh sách Task Function 3425 đoạn, tra cứu 0,3–0,8 giây | Đạt |
| AI phân tích bug dựa trên trích dẫn, AI gợi ý sửa code | Test với **transport giả** (kiểm tra trích dẫn phải tồn tại, code phải qua `validate_script`, luôn ở PENDING chờ QC) | Đạt với giả lập; **chưa gọi AI thật** |
| Tác vụ nền (`jobs`), đồng bộ bug trực tiếp từ Haraworks, đồng bộ mô tả Task Function, lịch chạy định kỳ, Celery beat | Test tự động (eager) + chạy trong Docker | Đạt với giả lập; **chưa gọi Haraworks thật** (cần cookie) |
| Runner tải file đính kèm của lần chạy, giao diện sửa code thành phiên bản mới, so sánh dòng khi duyệt | Test tự động (backend + runner + frontend) | Đạt |
| `scripts/migrate-accounts.mjs`: chuyển môi trường/tài khoản/mật khẩu từ bản Node | 4 test với vault và API giả; chạy khô **không giải mã** mật khẩu; chỉ `--apply` mới giải mã, mật khẩu không in ra | Đạt với giả lập; **chưa chạy với vault thật** (cần bạn có mặt) |
| Flow Recorder (lát cắt mỏng): `apps/runner-agent/src/recorder.ts` ghi thao tác ⇒ `recording.json`; API `/flows/recordings` chuẩn hóa, xếp hạng locator, sinh code tất định, tạo tác vụ **PENDING**; trang "Ghi luồng" | 5 test backend + 2 test recorder (Chrome thật: mật khẩu không bị ghi) | Đạt; **chưa ghi trên Staging thật** |

Bộ kiểm thử gần nhất: backend 122 đạt, runner 22 đạt, frontend 8 đạt + tsc/lint/build sạch.

## Chưa làm / chưa kiểm chứng (nói rõ, không coi là xong)

| Hạng mục | Tình trạng |
|---|---|
| Truy xuất theo ngữ nghĩa (pgvector/embedding) | **Chưa làm** — hiện là tra cứu từ khóa (BM25-style); đủ cho trích dẫn nguyên văn nhưng không hiểu đồng nghĩa |
| Docx: ô văn bản (textbox), chú thích, header/footer, số thứ tự tự động | Parser **chưa đọc** các phần này |
| Figma/Haraworks/AI thật | Chỉ kiểm chứng bằng transport giả; cần token/cookie/khóa của bạn (xem bảng dưới) |
| Đồng bộ mô tả Task Function | `functions-live.json` chỉ có tên/thuộc tính, **chưa có mô tả**; cần cookie Haraworks để lấy mô tả |
| Đăng nhập thật bằng Runner | Đã chạy thật một lần (bạn tự nhập mật khẩu); tác vụ ở bước chọn ngày từng ra trang trắng — đã thêm chẩn đoán, chờ bạn chạy lại và gửi các dòng `[chẩn đoán]` |
| `S3Storage` | Có mã, **chưa kiểm thử** (không có MinIO) |
| Skill `business-rule-extractor` (qa-sync) nối sang API mới | **Chưa** — luồng rule đã đổi sang tra cứu trích dẫn nên ít cấp thiết |
| Flow Recorder đầy đủ: nhiều phiên bản FlowSpec, test case, locator tự sửa, assertion | **Chưa** — chỉ có lát cắt mỏng (click/nhập/chọn/phím) |
| Isolate script Host Runner | Vẫn `vm` (không phải ranh giới bảo mật); chỉ Docker Runner cách ly container |
| Retry theo chính sách, Hybrid/API adapter | **Chưa làm** |
| Giả định múi giờ: ngày bug cũ coi là +07 | Cần bạn xác nhận |
| Bản Node vẫn tự duyệt tác vụ (`autoApprove`) | Không sửa bản Node; platform mới không có đường tự duyệt |
| CSP `script-src 'unsafe-inline'` (Next App Router chưa có nonce) | Nợ kỹ thuật (SECURITY_REVIEW S-06) |
| `npm audit`: cảnh báo postcss trong Next | Chỉ ảnh hưởng lúc build; chưa có bản Next vá hơn |
| `gitleaks` báo chuỗi giống mật khẩu trong `database/db.js` (S-01) | Cần chủ repo xử lý |

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

Với Docker: sao chép `.env.example` → `.env` (hoặc chạy `scripts/init-env.ps1`), rồi
`docker compose -f infra/compose/compose.yaml --env-file .env up -d --build`. **Stack đang chạy của bạn phải build lại** để có migration 0004–0006 (volume giữ nguyên dữ liệu).

Ghi luồng: `cd apps/runner-agent ; npm run build ; $env:QC_RECORD_URL="https://<staging>" ; node dist/recorder.js`, thao tác xong đóng trình duyệt, nạp `recording.json` ở trang "Ghi luồng".

## Cần bạn xác nhận hoặc cấp quyền hạ tầng

| # | Việc | Vì sao cần bạn | Hiện tại |
|---|---|---|---|
| 1 | **Cookie phiên Haraworks (chỉ đọc)** — nhập ở trang Nguồn tài liệu → Tích hợp | Bật đồng bộ bug realtime và lấy mô tả Task Function. Là thông tin đăng nhập của bạn, chỉ ghi vào vault, không gửi cho tôi | Chưa |
| 2 | **Token Figma** — cùng chỗ nhập trên | Để hệ thống đọc chữ trong thiết kế (không có token vẫn dán tay được) | Chưa |
| 3 | **Khóa AI** (Gemini hoặc Anthropic) — cùng chỗ nhập trên | Bật phân tích bug bằng AI và gợi ý code (luôn chờ QC duyệt) | Chưa |
| 4 | **Chạy lại tác vụ Staging lỗi bước chọn ngày** và gửi các dòng `[chẩn đoán]` | Tôi chưa có thông tin đăng nhập; chỉ bạn nhập mật khẩu | Chờ bạn |
| 5 | **Chuyển tài khoản/mật khẩu từ vault cũ**: `node scripts/migrate-accounts.mjs --server https://… --apply` | Giải mã DPAPI chỉ đúng người dùng Windows gốc; cần bạn có mặt và đồng ý. Chạy khô trước (không giải mã) | Chưa |
| 6 | **Đổi mật khẩu Staging** đã gửi trong khung chat | Mật khẩu đã lộ trong hội thoại; tôi không dùng nó | Nên làm |
| 7 | **S-01**: chuỗi giống mật khẩu trong `database/db.js` (đã nằm trong lịch sử Git) | Nếu là thật, cần đổi | Chưa xác nhận |
| 8 | **Quyết định** hạ tầng nhóm: Docker trên Windows hay Linux; HTTPS dùng mkcert hay CA nội bộ/ACME | Ảnh hưởng profile `team` và cách thành viên cài Runner | Chưa chốt |
| 9 | **Múi giờ** ngày bug cũ (+07) | Giả định chưa được xác nhận | Chưa |

## Bước tiếp theo đề xuất

1. Build lại stack Docker, đăng nhập, nạp các nguồn (BA .docx, Figma, Task Function, wiki) rồi thử tra cứu bằng mô tả bug thật.
2. Cấu hình cookie/token/khóa AI (mục 1–3) để bật đồng bộ và AI; kiểm tra từng kết nối bằng nút “Kiểm tra”.
3. Nếu tra cứu từ khóa chưa đủ tốt trên mô tả thật, thêm pgvector làm lớp gợi ý phụ (vẫn trích nguyên văn).
4. Mở rộng Flow Recorder thành FlowSpec có phiên bản + assertion khi cần.
