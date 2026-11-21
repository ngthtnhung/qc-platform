# Ma trận chuyển dữ liệu (Data Migration Matrix)

> Phase 0 · **[N] Proposed**. Cột "Cấu trúc hiện tại" được **xác minh bằng cách đọc khóa/kiểu của dữ liệu thật** (không đọc giá trị bí mật). Số liệu tại thời điểm 2026-11-21.
> Quy tắc chung (áp dụng cho mọi dòng): nguồn **chỉ đọc**; không xóa, không ghi đè; importer idempotent và ghi `import_runs/import_items` (xem DATABASE_MIGRATION_PLAN §5); rollback chung = xóa bản ghi do `import_run` tạo hoặc dựng lại DB đích từ nguồn (nguồn không đổi).

## 1. Thứ tự chuyển (Migration order)

| Thứ tự | Nhóm | Phụ thuộc |
|---|---|---|
| 0 | Sao lưu + manifest băm `database/`, `secrets/` (ngoài repo) | — |
| 1 | `team_users`, vai trò/quyền, organization | — |
| 2 | `environment_profiles` | 1 |
| 3 | Bí mật: vault + file bí mật | 2 (+ giải mã DPAPI trên máy gốc) |
| 4 | `account_profiles`, route, `kb-snapshot/accounts` | 2, 3 |
| 5 | `automation-files/` → `files` | 1 |
| 6 | Module/function (từ `business_rules.json`/`kb-snapshot/modules`) | — |
| 7 | Bug sources/projects, `bugs.json`, `bugs-live.json`, `functions-live.json`, `builds-live.json`, `bugs-enrich.json` | 6 |
| 8 | `kb-snapshot/rules` + `business_rules*.json` + `kb-drafts` → Reference Library + rule | 5, 6 |
| 9 | `automation-drafts/*.json` + `automation_tasks` + `automation-samples` | 4, 8 |
| 10 | `test_plans`, `test_cases`, `test-cases-maint-iot-scm.json` | 6, 9 |
| 11 | `workflow_runs`, `external_tasks`, `knowledge_*` | 6 |
| 12 | `audit_events` (lịch sử) | 1 |
| 13 | Cài đặt/cá nhân: `label-colors`, `notify-seen`, `personal-workspace` | 1, 6 |
| — | `browser-profiles/` **không migrate** (xem dòng 25) | — |

## 2. Dòng chuyển chi tiết

Mỗi mục: **Nguồn** · **Cấu trúc hiện tại** · **Đích** · **Biến đổi** · **Kiểm tra** · **Trùng** · **Thứ tự** · **Rollback**.

### M-01 Người dùng và quyền (`qa_platform_data.json` → `team_users`, 4 dòng)
- **Cấu trúc**: `id, display_name, username, password_hash (SHA-256 không salt), role (admin|member), employee_code, token_hash, session_token (rõ), is_active, type, created_at, updated_at`; thêm tùy chọn `perms[]`, `nickname`, `job_title`, `joined_at`, `avatar`.
- **Đích**: `users` (một vai trò `qc`, `CHECK`); `auth_sessions` (không import).
- **Biến đổi** *(đã chốt: 4 QC ngang quyền)*: **mọi** người dùng cũ (`admin` và `member`) → vai `qc`; `perms[]` cũ **bỏ** (không còn quyền lẻ). **Không import** `password_hash` cũ và **không import** `session_token`/`token_hash`: đặt `must_change_password=true`, tạo mật khẩu tạm một lần (hiển thị một lần khi chạy lệnh nhập, không ghi log). `legacy_id=id`. **Đã triển khai**: `python -m app.cli import-legacy-users --source <file> [--apply]` (mặc định chạy khô; idempotent; có test).
- **Kiểm tra**: số user = 4; ≥ 1 admin; username duy nhất sau chuẩn hóa (`normalizeUsername`).
- **Trùng**: khóa `lower(username)`; trùng → dừng và báo (không gộp tự động).
- **Rollback**: xóa user có `legacy_id` thuộc run; token cũ vẫn dùng được trên bản Node đang chạy song song.

### M-02 Môi trường (`environment_profiles`, 3 dòng)
- **Cấu trúc**: `id, name, base_url, login_url, environment_type (STAGING|PRODUCTION_TEST|TASK_SYSTEM), allowed_actions[], requires_org_confirmation, org_identifier, is_active`.
- **Đích**: `environments`. **Biến đổi**: 1–1, `allowed_actions`→`text[]`. **Kiểm tra**: `type` thuộc tập cho phép; `PRODUCTION_TEST` luôn `requires_org_confirmation=true`; không có `PRODUCTION` cho phép `WRITE`. **Trùng**: `legacy_id`. **Rollback**: xóa theo run.
- Lưu ý: `database/seeds` trong `db.js` tạo lại môi trường mẫu khi file DB mất — importer phải đọc DB thật, không đọc seed.

### M-03 Bí mật tài khoản (`secrets/vault.json` + `vault.key`, 5 mục)
- **Cấu trúc**: `{version, entries:{<accountId>:{iv, tag, data, updated_at}}}` AES-256-GCM, AAD = accountId; khóa bọc DPAPI (Windows, chỉ đúng người dùng Windows đó giải mã).
- **Đích**: `secrets` (mã hóa phong bì, KEK ngoài DB). **Biến đổi**: **chạy trên máy Windows gốc, dưới đúng tài khoản Windows**: giải mã từng mục trong bộ nhớ → mã hóa bằng KEK mới → ghi `secrets`; không ghi plaintext ra đĩa, không in log. **Kiểm tra**: giải mã thử bản mới == bản cũ (so băm trong bộ nhớ); số mục = 5. **Trùng**: khóa `(account legacy_id)`. **Rollback**: vault cũ giữ nguyên; xóa `secrets` mới theo run.
- Rủi ro: nếu `vault.key` mất hoặc chạy sai người dùng Windows ⇒ **không phục hồi được** — bước M0 phải sao chép nguyên `secrets/` trước.

### M-04 File bí mật khác (`secrets/credentials.json`, `qa-sync.json`, `haraworks.json`, `tls.crt|key`)
- **Cấu trúc**: `credentials.json` = 2 khóa dạng `<env>:<tên>`/`<mã>`; `qa-sync.json` = `{server, token}`; `haraworks.json` = `{cookie}`.
- **Đích**: `credentials.json` → `secrets` (liên kết `accounts` tương ứng, sau khi đối chiếu); `haraworks.json` → `secrets` gắn `bug_sources.config`; `qa-sync.json` → **không migrate** (token QA thuộc bản Node, sẽ được thay bởi token runner/API mới); `tls.*` → cấu hình reverse proxy, không vào DB.
- **Biến đổi/kiểm tra**: như M-03; cookie Haraworks kiểm tra còn hạn bằng một lời gọi chỉ-đọc trước khi dùng (nếu hết hạn → đánh dấu `AUTH_EXPIRED`, không báo lỗi import). **Rollback**: giữ nguyên file.

### M-05 Tài khoản (`account_profiles`, 3 dòng; `database/kb-snapshot/accounts/*.json`, 3 file)
- **Cấu trúc DB**: `id, owner_user_id, name, role, environment_profile_id, username_ref, secret_ref, expected_org_ref, default_route, is_active, kb_links, kb_can_do, kb_cannot_do`. **Cấu trúc kb-snapshot**: `account, env, org, roles, status, can_do, cannot_do, links, note, added_at, added_by, checked_at`.
- **Đích**: `accounts`, `account_routes`. **Biến đổi**: 1–1; `secret_ref` **không** import (là tham chiếu cũ; mật khẩu thật nằm ở vault → liên kết `secret_id` theo `account.id`); `default_route`/`routes` → `account_routes`; gộp thông tin kb-snapshot vào `kb_*` theo khóa `account+env`. **Kiểm tra**: mỗi tài khoản có `environment_id` hợp lệ; tài khoản có mật khẩu ⇒ có `secret_id`. **Trùng**: `(environment_id, lower(username_ref))`. **Rollback**: theo run.
- Phát hiện: `db.js` có 6 tài khoản seed (chuỗi giống mật khẩu trong mã); DB thật chỉ có 3 — chỉ import từ DB thật. Mã seed là rủi ro riêng (SECURITY_REVIEW).

### M-06 File đính kèm (`database/automation-files/`, 4 file `f_xxx.*` + metadata `automation_files` trong DB)
- **Cấu trúc**: tên `f_<id>.<ext>`; metadata `{id, name, size, mime, owner, created_at}` (theo cách `server.js` dùng).
- **Đích**: storage (`LocalStorage`) + `files`. **Biến đổi**: sao chép (không di chuyển) vào `/data/storage/<sha256[0:2]>/<sha256>`, tính `sha256`, nhận dạng lại mime bằng magic bytes (logic `sniff`), `legacy_id=f_xxx`. **Kiểm tra**: `sha256(file mới)==sha256(file cũ)`; kích thước ≤ 10 MB; mime thuộc danh sách cho phép. **Trùng**: `sha256` ⇒ một bản lưu, nhiều `legacy_id` (bảng ánh xạ). **Rollback**: xóa bản sao + dòng `files` theo run. Tham số tác vụ kiểu `file` tham chiếu `f_xxx` → ánh xạ qua `legacy_id` (xem M-12).

### M-07 Bug cũ (`database/bugs.json`, 6059 bug, 1,8 MB)
- **Cấu trúc**: `{source, count, range[2], synced_at, revision, bugs[{id, t, c, d, m, g, how, u}]}`; mẫu: `id` = ObjectId 24 hex, `t` = tiêu đề (dạng `[BUG][MODULE][...]`), `c` = phân loại (ví dụ `NotBug`), `d` = ngày `YYYY-MM-DD HH:mm`, `m` = module, `g` = nhóm/module gốc, `how` = cách gán module (`tag`…), `u` = URL task.
- **Đích**: `bugs` (`source=legacy_kb`), `bug_snapshots` (1 bản/bug). **Biến đổi**: `id→external_id`, `t→title`, `c→classification` (cột riêng, chưa suy ra `status` Haraworks), `d→created_at_ext` (múi giờ cần xác minh với dữ liệu gốc, mặc định `Asia/Ho_Chi_Minh`), `m→module_code`, `u→url`; ghi `how` và `g` vào `extra jsonb`. **Kiểm tra**: `count==len(bugs)==6059`; mọi `id` khớp `^[0-9a-f]{24}$`; `module_code` ∈ `modules` hoặc `UNKNOWN`. **Trùng**: `(source, external_id)`; bug cũ trùng bug live → giữ cả hai bản ghi theo `source`, liên kết qua `external_id` (không gộp). **Rollback**: theo run.
- Không xác định được ý nghĩa đầy đủ của một số mã `c`/`how` từ code: ghi nguyên văn, **không suy diễn** (cần xác nhận với chủ Kho).

### M-08 Bug realtime (`bugs-live.json`: 714 bug, 5 dự án)
- **Cấu trúc**: `{fieldsVersion, projects[{id,name,allTasks,version}], seen{…}, bugs[{id,name,status,priority,is_Deleted,created_At,status_Updated_At,plan_Start_At,plan_End_At,project_Id,assignTo,approverEntity,additionalInfo,project_Name}]}`.
- **Đích**: `projects`, `bugs` (`source=haraworks`), `bug_snapshots`. **Biến đổi**: `project_Id→projects.external_id`; `status` số → `bugs.status smallint` (nhãn từ `STATUS_LABELS`, `bug-search/codes.js`); `assignTo`/`approverEntity` → `assignee`/`approver` (giữ JSON gốc trong `extra`). `seen`/`version` → `bug_sources.config` (con trỏ đồng bộ tăng dần). **Kiểm tra**: 714 bản ghi, 5 project; `is_Deleted=true` giữ lại, đánh dấu. **Trùng**: `(source, external_id)`. **Rollback**: theo run. Sau cắt chuyển, dữ liệu nguồn do Celery sync bổ sung; file JSON chỉ là mồi (seed).

### M-09 Function / QC task / Build (`functions-live.json`: 2221 + 1204; `builds-live.json`: 2485)
- **Cấu trúc**: như M-08 cộng `is_Group_Task, parent_Id, team_Name` (function); build có `kind, kindLabel, module, assignee, approver, sourceTitle, contentText, linkedIds, linkedNames`.
- **Đích**: `function_tasks`, `builds` (+ `parent_id` tự tham chiếu). **Kiểm tra**: số bản ghi; `parent_Id` trỏ tới task tồn tại (nếu không → NULL + ghi cảnh báo). **Trùng**: `(source, external_id)`; `qcTasks` là tập con/giao với `tasks` (xác minh bằng giao `id`) ⇒ cờ `is_qc`, không nhân đôi. **Rollback**: theo run.

### M-10 Làm giàu bug (`bugs-enrich.json`, 375 mục)
- **Cấu trúc**: `{fetched_at, note, names[], map{<bugId>: <chỉ số vào names>}}`. **Đích**: `bugs.extra.enrich` hoặc `bug_enrichment(bug_id, name)`. **Biến đổi**: `names[map[id]]`. **Kiểm tra**: mọi chỉ số hợp lệ; `bugId` tồn tại. **Trùng**: khóa `bug_id`. **Rollback**: theo run.

### M-11 Rule và tri thức (`kb-snapshot/rules/*.json` 200 file; `kb-snapshot/modules/*.json` 37 file; `business_rules.json` 194 rule/37 module; `business_rules_local.json`; `kb-drafts/`)
- **Cấu trúc `kb-snapshot/rules` (giàu hơn bản đang dùng)**: `rule_id, version, state, module, source_modules, menu, flow, flow_name, title, description, user_roles, setting_type, setting_label, config_path, classification, open_questions, related_rules, source_reference, source_type, evidence, business_logic, expected_behavior, input_conditions, preconditions, exceptions, regression_risk, ai_interpretation, verification_status, previous_version, legacy_id, approved_at/by, extracted_at, ingested_at, batch_id, notes, setting_checked_at, feature, config_note`.
- **Phát hiện quan trọng [V]**: `buildBundle` (`packages/kb-sync/bundle.js`) chỉ giữ ~20 trường và **bỏ** `evidence`, `business_logic`, `exceptions`, `regression_risk`, `previous_version`, `verification_status`, `ai_interpretation`...; `business_rules.json` (194 rule `active|pending`) là bản đã lược; còn 6 rule ở trạng thái khác chỉ có trong `kb-snapshot/rules` (200 file). Importer **phải đọc `kb-snapshot/rules`** để không mất trường.
- **Đích**: `sources` + `source_versions` (một nguồn "Kho BR" theo `batch_id`/`revision`), `references` (locator từ `source_reference`/`evidence`), `business_rules` + `business_rule_versions` (+ `business_rule_references`), `ai_suggestions` cho nội dung do AI diễn giải (`ai_interpretation`, `analysis`), `modules`/`functions` từ `modules/*.json` (`code,name,cluster,flows,usage_flow`).
- **Biến đổi / quy tắc quản trị**:
  - Mọi rule nhập vào `validation_status`: `approved_at` có và `state=active` ⇒ `VALIDATED` **chỉ khi** có `approved_by` là người; còn lại `UNREVIEWED`. `state=pending` ⇒ `UNREVIEWED`.
  - Nội dung `ai_interpretation`/`analysis` ⇒ `ai_suggestions(status=PROPOSED)`, **không** vào `description` đã duyệt.
  - `business_rules_local.json` (`changes{id:{op,rule}}`) ⇒ version kế tiếp của `rule_key` tương ứng, `origin='platform'`; `op=delete` ⇒ `state='retired'` (không xóa vật lý); rule tạo tại chỗ (`<MOD>-P###`) ⇒ rule mới `origin='platform'`.
  - `previous_version` ⇒ `business_rule_versions.version_no` liền trước nếu tìm được.
  - Hai file xung đột cùng `rule_id`, `version` nhưng nội dung khác ⇒ tạo `reference_links(conflicts_with)` + `DISPUTED`, **không** chọn bản nào.
- **Kiểm tra**: đếm rule theo `state`; mọi `module` ∈ `modules`; `related_rules` trỏ tới `rule_id` có thật (không thì ghi lại, giữ nguyên chuỗi); số `version` liên tục. **Trùng**: `(rule_key, version_no)`; cùng `rule_id` nhiều `version` giữ hết. **Rollback**: theo run (không động nguồn).
- `kb-drafts/DV5S-2026-11-16-rules.json`: bản nháp ⇒ `ai_suggestions` hoặc `rule` `UNREVIEWED`, đối chiếu với `kb-snapshot/rules` để tránh trùng.

### M-12 Tác vụ tự động (`database/automation-drafts/*.json` 30 file Git-tracked; `automation_tasks` 30 dòng trong DB; `automation-samples/`)
- **Cấu trúc**: `id (at_<sha1(module|name)[0:16]>), name, module, flow, description, start_url, required_roles[], writes, rule_ids[], source{explore_date,note}, steps[], params[{key,label,value,auto,type,fallback}], script, script_sha, status, approved_sha, approved_by ('auto'), approved_at, created_by, created_at, updated_at`.
- **Đích**: `automation_projects` (theo module), `automation_tasks`, `automation_task_params`, `automation_code_versions`.
- **Biến đổi**: `id→legacy_id` (giữ nguyên để đối soát với `scripts/automation-add.mjs` và `importDraftTasks`); `script`→`automation_code_versions(version_no=1, origin='import', sha256=script_sha)`; **kiểm tra `sha256(script)==script_sha`** trước khi nhận; **không** sao chép `approved_by='auto'` thành duyệt thật: đặt `status='DRAFT'` kèm một `approval_requests` chờ QC; chỉ QC mới chuyển thành `APPROVED` sau khi đọc (đã chốt, APPROVAL_MODEL.md); `rule_ids` ánh xạ qua `business_rules.legacy_id`/`rule_key` (không có ⇒ giữ ở `extra`); `params` kiểu `file` giá trị `f_xxx` ánh xạ qua M-06 (`files.legacy_id`).
- **Kiểm tra**: 30 task, 30 `legacy_id` duy nhất (đã xác minh không trùng); `start_url` https cùng root domain Staging; `validateScript` (cùng danh sách cấm) pass; `automation-drafts/*.json` và `automation_tasks` cùng `id` ⇒ so sánh `script_sha`; khác ⇒ ghi cả hai thành hai version, báo cáo cho người duyệt.
- **Trùng**: `(legacy_id)`; nội dung giống nhưng `id` khác (do đổi tên) ⇒ báo cáo, không tự gộp. **Rollback**: theo run; file `.json` trong Git không bị đụng. **Không ghi đè** tác vụ hiện có: bản Node tiếp tục dùng nguồn cũ cho tới khi cắt chuyển.

### M-13 Lịch sử chạy tác vụ (`automation_runs`; `automation_tasks`...)
- Nguồn: bảng `automation_runs` trong DB (nếu có dòng; mã chỉ giữ 30 dòng gần nhất khi trả API, dữ liệu lưu đầy đủ). **Đích**: `executions` + `execution_steps` (`status`, `steps[]`, `log`, `error`, `duration_ms`). **Biến đổi**: `task_id` → `legacy_id`; thiếu `code_version`/`runner` ⇒ để NULL, đánh dấu `origin='legacy'`. **Kiểm tra**: số dòng; task tồn tại. **Rollback**: theo run.

### M-14 Test plan / test case (`test_plans` 3, `test_cases` 13; `database/test-cases-maint-iot-scm.json`; `docs/test-cases/MAINT-IOT-SCM-test-cases.md`)
- **Cấu trúc `test_cases`**: `id, test_plan_id, link_task, case_key, test_type, platform, objective, module_name, screen_name, functional_area, steps, account, preconditions_test_data, expected_result, actual_result, image_video_ref, status, notes, requirement_refs`.
- **Đích**: `test_plans`, `test_cases`, `test_case_versions` (version 1, `DRAFT`), `test_plan_cases`. **Biến đổi**: `requirement_refs` ⇒ liên kết `references`/`business_rules` nếu khớp `rule_key`; `image_video_ref` ⇒ `files` nếu là tệp có thật; JSON 952 dòng ⇒ đối chiếu với DB 13 dòng, báo cáo phần chỉ có ở một phía. **Kiểm tra**: `case_key` duy nhất trong plan. **Rollback**: theo run. Trạng thái sau import: `DRAFT` (không tự `APPROVED`).

### M-15 Workflow, external task, knowledge (`workflow_runs` 12, `external_tasks` 1, `knowledge_sources`/`chunks` 1/1)
- `workflow_runs` ⇒ `jobs`/`ai_analyses` (loại `BUG_ANALYSIS`) với `input_payload` đã che bí mật; `external_tasks` ⇒ `function_tasks` hoặc `bugs` (xác minh `task_type`); `knowledge_*` (1 dòng seed về MAINT) ⇒ `sources`/`references` `UNREVIEWED`, đối chiếu M-11. Là dữ liệu mẫu/nhỏ; chuyển để không mất lịch sử. **Kiểm tra**: số dòng. **Rollback**: theo run.

### M-16 Audit (`audit_events`, 18 dòng: READ, APPROVE, REPRODUCE_READ_ONLY, WRITE, REPRODUCE, USER_LOGIN, USER_RESET_PASSWORD)
- **Cấu trúc**: `actor_type, actor_id, action, resource_type, decision, reason, correlation_id, metadata_redacted, id, created_at`. **Đích**: `audit_logs` (`source='legacy'`). **Biến đổi**: giữ nguyên thời gian; `metadata_redacted` (chuỗi JSON) → `jsonb`; `resource_id` NULL. Quét `reason` tìm bí mật trước khi nhập. **Kiểm tra**: 18 dòng, thứ tự thời gian. **Rollback**: theo run (bảng append-only ⇒ dùng cờ `import_run_id` để xóa, được ngoại lệ có kiểm soát).

### M-17 Nhãn/màu và trạng thái giao diện (`label-colors.json`)
- **Cấu trúc**: `{module{<mã>:#hex}(37), status{<mã>:#hex}(9), project?, deleted_modules?, custom_modules?, module_names?, …}`. **Đích**: `system_settings` (`scope=org`, key `ui.label_colors`) hoặc cột `color` trên `modules`/`projects`. **Kiểm tra**: hex hợp lệ. **Trùng**: khóa `(scope,key)`. **Rollback**: xóa theo run.

### M-18 Thông báo đã xem (`notify-seen.json`)
- **Cấu trúc**: `{<id thông báo>:{…}}` (2 mục). **Đích**: `notification_seen(user_id?, notification_id, seen_at)`. **Lưu ý**: không biết người dùng sở hữu ⇒ gán cho `admin` hoặc **bỏ qua** (dữ liệu có thể tái tạo, quyết định cho chủ sản phẩm). **Rollback**: theo run.

### M-19 Không gian cá nhân (`personal-workspace.json`; `todos`, `notes` theo `userId`)
- **Cấu trúc**: `{<userId>:{todos[], notes[]}}`. **Đích**: `personal_todos`, `personal_notes` (FK `users`). **Biến đổi**: `userId` → `users.legacy_id`; userId không tồn tại ⇒ báo cáo, không tạo mồ côi. **Kiểm tra**: tổng todo/note khớp. **Rollback**: theo run. (File có thể chưa tồn tại trên máy; xử lý "không có dữ liệu" bình thường.)

### M-20 Người dùng/nhóm từ seed (`users`, `projects`, `modules`, `module_ownerships` trong `qa_platform_data.json`: 4/1/3/4)
- Là dữ liệu seed `usr_qc_lead`, `usr_dev_chau`… (email `…@erp.local`) **không phải** người dùng đăng nhập thật. **Đích**: `module_ownerships` ⇒ `user_roles(scope=module)` **chỉ khi** người dùng thật tương ứng được xác nhận; nếu không ⇒ bỏ qua, lưu vào `import_items.action='skipped'` kèm lý do. **Rollback**: không đổi gì.

### M-21 Seed SQL và schema (`database/schema.sql`, `seeds.sql`)
- Không phải dữ liệu chạy thật. **Không migrate**; lưu làm tài liệu lịch sử (`docs/modernization/legacy/`) nếu muốn. Schema mới thiết kế từ dữ liệu thật (DATABASE_MIGRATION_PLAN).

### M-22 Hồ sơ trình duyệt (`database/browser-profiles/<accountId>/`, ≈ 343 MB)
- Hồ sơ Chrome (cookie phiên, cache) theo tài khoản. **Không migrate** (chứa phiên đăng nhập; không nên nhân bản). Kiến trúc mới: Host Runner giữ hồ sơ cục bộ theo máy; Docker Runner dùng context tạm. Người dùng sẽ đăng nhập lại. **Rollback**: không đổi.

### M-23 Các file không phải dữ liệu
- `start-qa-ngrok.bat/.lnk`, `start-*.ps1`: script vận hành ⇒ thay bằng Docker Compose (DOCKER_DEPLOYMENT_PLAN); giữ lại nhánh `legacy`.

## 3. Duplicate handling tổng hợp

| Thực thể | Khóa nhận diện trùng | Hành vi |
|---|---|---|
| User | `lower(username)` | Dừng + báo, không gộp |
| Môi trường | `legacy_id` | Cập nhật nếu băm khác |
| Tài khoản | `(environment, lower(username_ref))` | Báo cáo; không tạo trùng |
| File | `sha256` | Một bản lưu, nhiều `legacy_id` |
| Bug | `(source, external_id)` | Upsert theo băm nội dung; sinh `bug_snapshots` nếu đổi |
| Rule | `(rule_key, version_no)` | Giữ mọi version; khác nội dung cùng version ⇒ `DISPUTED` |
| Tác vụ | `legacy_id`, `(task_id, sha256)` | Hai script khác nhau ⇒ hai version, không ghi đè |
| Test case | `(plan, case_key)` | Upsert theo băm |
| Audit | `(created_at, action, actor_id, correlation_id)` | Bỏ qua trùng |

## 4. Kiểm tra dữ liệu (Validation) chung

1. Đếm nguồn == đếm đích + bỏ qua + lỗi (báo cáo đối soát in cho từng dòng M-xx).
2. Băm nội dung (file, script) khớp.
3. Toàn vẹn khóa ngoại sau import; không bản ghi mồ côi.
4. Quét bí mật trong mọi cột văn bản được nhập (mẫu: token `qa_`, cookie, chuỗi giống mật khẩu) — phát hiện ⇒ dừng dòng đó.
5. Mẫu ngẫu nhiên 20 bản ghi mỗi loại so sánh bằng mắt với nguồn.

## 5. Chiến lược Rollback tổng

| Tình huống | Hành động |
|---|---|
| Một dòng M-xx sai | Xóa bản ghi đích của `import_run` đó theo `import_items`, sửa importer, chạy lại |
| Cả đợt sai | Hủy DB đích (rỗng trước cắt chuyển), dựng lại, import lại từ nguồn |
| Sau cắt chuyển một trang | Bật lại trang cũ của bản Node; nguồn JSON vẫn nguyên vẹn |
| Mất vault | Khôi phục `secrets/` từ bản sao M0 trên máy Windows gốc |
