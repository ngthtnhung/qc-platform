# Kế hoạch chuyển cơ sở dữ liệu (Database Migration Plan)

> Phase 0 · **[N] Proposed**. Không thực thi bất kỳ migration nào ở Phase 0.
> Điểm xuất phát đã xác minh: CSDL thật là JSON (`database/qa_platform_data.json` + các file phụ), **không phải** `schema.sql` (xem CURRENT_STATE_AUDIT §4).

## 1. Nguyên tắc

1. PostgreSQL 16 (+ `pgvector`) là nguồn sự thật cho dữ liệu có cấu trúc.
2. Schema do **Alembic** quản lý; không sửa tay. Mỗi revision có `upgrade` và `downgrade`.
3. Mọi bảng: khóa chính `uuid` (v7 nếu có, hoặc `gen_random_uuid()`), `created_at`/`updated_at` `timestamptz`, ràng buộc FK rõ (`ON DELETE RESTRICT` mặc định), `CHECK` cho enum (dùng bảng tra hoặc `CHECK`, không chuỗi tự do).
4. Giữ **định danh gốc** để đối soát: cột `legacy_id` (text, unique theo nguồn) trên bảng được import.
5. Import là **tập lệnh idempotent**, đọc nguồn **chỉ đọc**, không xóa/ghi đè nguồn, ghi `import_runs`/`import_items` để truy vết.
6. Dữ liệu nhị phân ở storage, DB chỉ giữ metadata (`files`).
7. Bí mật không lưu rõ; lưu `secrets` mã hóa phong bì.

## 2. Phân miền schema (ERD rút gọn)

### 2.1 Core
```
organizations(id, name, code UNIQUE)
users(id, org_id→organizations, username UNIQUE(org_id,lower(username)), display_name, employee_code, email, password_hash(argon2id), is_active, must_change_password, legacy_id)
-- (đã chốt) KHÔNG có roles/permissions/user_roles/organizations ở giai đoạn này: users.role CHECK (role IN ('qc')); quyền là hằng số trong mã. Thêm lại bằng migration khi có vai trò thứ hai.
approval_requests(id, subject_type, subject_id, origin 'ai'|'human', requested_by_type/id, payload jsonb, payload_hash, status, decided_by_id→users NOT NULL khi đã quyết định, decided_at, decision_note) ; ai_suggestions(id, kind, payload, status PROPOSED|ACCEPTED|REJECTED)
auth_sessions(id, user_id, refresh_token_hash, expires_at, revoked_at, user_agent, ip)
environments(id, org_id, code UNIQUE, name, type CHECK IN ('STAGING','PRODUCTION_TEST','PRODUCTION','TASK_SYSTEM'), base_url, login_url, org_identifier, allowed_actions text[], requires_org_confirmation, is_active, legacy_id)
accounts(id, environment_id, owner_user_id, name, role_label, username_ref, expected_org_ref, default_route, kb_links jsonb, kb_can_do jsonb, kb_cannot_do jsonb, secret_id→secrets, is_active, legacy_id)
account_routes(id, account_id, label, url, position)
secrets(id, kind, ciphertext bytea, nonce, wrapped_dek, key_version, aad, updated_at)   -- không có cột plaintext
audit_logs(id, at, actor_type, actor_id, action, resource_type, resource_id, decision, reason, before jsonb, after jsonb, correlation_id, ip)  -- append-only (REVOKE UPDATE/DELETE hoặc trigger)
system_settings(id, scope, key, value jsonb, version, updated_by, updated_at)
```
Chỉ mục: `users(lower(username))`, `audit_logs(at)`, `audit_logs(actor_id,at)`, `audit_logs(correlation_id)`, `accounts(environment_id)`.

### 2.2 Bug
```
bug_sources(id, kind 'haraworks'|'legacy_kb', config jsonb, secret_id, last_sync_at, last_sync_status)
projects(id, external_id UNIQUE, name, team)
bugs(id, source_id, external_id, project_id, title, status smallint, priority, module_code, created_at_ext, updated_at_ext, assignee, approver, is_deleted, legacy_id, UNIQUE(source_id, external_id))
bug_snapshots(id, bug_id, taken_at, payload jsonb, content_hash, UNIQUE(bug_id, content_hash))   -- lịch sử
bug_comments(id, bug_id, external_id, author, body, created_at_ext)
bug_attachments(id, bug_id, file_id→files, kind 'image'|'video'|'doc', external_ref)
function_tasks(id, source_id, external_id, ...) ; builds(id, source_id, external_id, kind, ...)   -- giữ 2 nguồn phụ (functions-live, builds-live)
ai_analyses(id, bug_id NULL, input jsonb, provider, model, prompt_version, output jsonb, citations jsonb, status 'DRAFT'|'REVIEWED'|'REJECTED', requested_by, created_at)
```
Chỉ mục: `bugs(project_id, updated_at_ext DESC)`, `bugs(module_code)`, GIN `bugs` full-text (tsvector tiếng Việt không dấu bằng `unaccent`), `bug_snapshots(bug_id, taken_at)`.

### 2.3 Knowledge (Reference Library)
```
modules(id, code UNIQUE, name, cluster_code) ; functions(id, module_id, code, name, menu, UNIQUE(module_id, code))
sources(id, kind, title, module_id NULL, created_by)
source_versions(id, source_id, version_no, file_id→files, content_hash, effective_from, supersedes_id, UNIQUE(source_id, version_no))
references(id, module_id, function_id, source_version_id, locator jsonb, summary, validation_status CHECK IN ('UNREVIEWED','VALIDATED','REJECTED','DISPUTED'), validated_by, validated_at)
reference_links(id, from_ref_id, to_ref_id, type CHECK IN ('refines','conflicts_with','supersedes','depends_on'), note)
annotations(id, reference_id, author, body, created_at)
ai_suggestions(id, kind CHECK IN ('extracted_info','suggested_rule','suggested_relation','suggested_scenario'), source_version_id, locator jsonb, payload jsonb, model, status 'PROPOSED'|'ACCEPTED'|'REJECTED', decided_by, decided_at)
business_rules(id, rule_key, module_id, function_id, state, setting_type, classification, UNIQUE(rule_key))
business_rule_versions(id, rule_id, version_no, title, description, user_roles text[], config_path, open_questions jsonb, origin 'kb'|'platform', created_by, created_at, UNIQUE(rule_id, version_no))
business_rule_references(rule_version_id, reference_id)
embeddings(id, owner_type, owner_id, chunk_no, text, embedding vector(<dim>), model, created_at)  -- HNSW (vector_cosine_ops)
```
Ràng buộc quan trọng: `ai_suggestions` **không** có FK sang `business_rule_versions`; việc chấp nhận tạo bản ghi mới có `created_by` là người (CHECK `created_by IS NOT NULL`), audit ghi cả hai.

### 2.4 Flow / Test
```
flow_recordings, recorded_events, normalized_interactions, locator_candidates, resolved_locators,
flow_specs, flow_spec_versions(status), flow_reviews, test_cases, test_case_versions(status, flow_spec_version_id),
test_plans(legacy_id), test_plan_cases
```
### 2.5 Automation
```
automation_projects(id, name, module_id)
automation_tasks(id, project_id, legacy_id UNIQUE, name, module_code, flow, description, start_url, required_roles text[], writes bool, rule_ids text[], source jsonb, status)
automation_task_params(id, task_id, key, label, type, value, auto, fallback, UNIQUE(task_id,key))
automation_code_versions(id, task_id, version_no, language 'js-playwright', script text, sha256 CHAR(64), status 'DRAFT'|'APPROVED'|'RETIRED', approved_by, approved_at, origin 'import'|'human'|'ai', UNIQUE(task_id, version_no), UNIQUE(task_id, sha256))
runners(id, name, type 'host'|'docker', token_hash, capabilities jsonb, labels text[], status, last_heartbeat_at, owner_user_id)
executions(id, task_id, code_version_id, params jsonb, account_id, runner_id, status, attempt, max_attempts, queued_at, started_at, finished_at, error, batch_id)
execution_steps(id, execution_id, seq, name, status, ms, error)
execution_logs(id, execution_id, at, level, message)
execution_artifacts(id, execution_id, kind 'screenshot'|'video'|'trace'|'log', file_id)
execution_schedules(id, task_id, cron, enabled, next_run_at)
```
### 2.6 Files / Jobs / Import
```
files(id, sha256, size, mime, storage_backend, storage_key, owner_id, created_at, retention_until, legacy_id)
jobs(id, kind, status, payload jsonb, result jsonb, celery_task_id, created_by, created_at, finished_at)
import_runs(id, source, started_at, finished_at, status, summary jsonb) ; import_items(run_id, source_key, target_table, target_id, action, hash)
```

## 3. Bảo toàn lịch sử và phiên bản

- `automation_code_versions` bất biến (chỉ thêm); sửa script = version mới (`sha256` mới ⇒ chưa duyệt).
- `business_rule_versions` bất biến; overlay hiện tại (`business_rules_local.json`, chỉ giữ bản mới nhất) được import thành version kế tiếp, kèm `origin='platform'`.
- `bug_snapshots` lưu mỗi thay đổi nội dung (hash) — cung cấp "lịch sử bug" hiện đang **thiếu**.
- `audit_logs` append-only bằng `REVOKE UPDATE, DELETE` cho vai ứng dụng.

## 4. Chiến lược chuyển (cắt chuyển không gián đoạn)

| Bước | Hành động | Cổng kiểm tra |
|---|---|---|
| M0 | Sao lưu **nguyên trạng** `database/`, `secrets/` ra nơi ngoài repo (chỉ đọc, băm SHA-256 từng file lưu vào manifest) | Manifest băm khớp |
| M1 | Dựng Postgres + Alembic `0001_core`; chưa có dữ liệu | `alembic upgrade head` + `downgrade base` sạch trên DB trống |
| M2 | Importer chạy **chế độ khô** (`--dry-run`): đọc nguồn, validate, in báo cáo (số bản ghi, trùng, lỗi) | Báo cáo khớp số liệu nguồn |
| M3 | Import thật vào DB trống theo thứ tự trong DATA_MIGRATION_MATRIX | Đối soát số lượng + băm mẫu + khóa ngoại hợp lệ |
| M4 | **Chạy song song**: API mới đọc Postgres; bản Node cũ giữ nguyên (chỉ-đọc/đang dùng). Importer chạy lại theo lịch để bắt thay đổi (idempotent) | Chênh lệch = 0 trên bộ chỉ số chính |
| M5 | Shadow-read: so sánh kết quả tra cứu bug/rule giữa hai hệ cho bộ truy vấn mẫu | Chênh lệch chấp nhận được, đã giải thích |
| M6 | Cắt từng trang sang hệ mới (theo FEATURE_PRESERVATION_MATRIX); ghi từ lúc cắt chỉ vào Postgres | Mỗi trang đạt tiêu chí chấp nhận |
| M7 | Đóng băng nguồn JSON (đổi tên thư mục `legacy-frozen-<ngày>`, **không xóa**) | Chỉ thực hiện khi người phụ trách ký xác nhận |

## 5. Quy tắc importer

- **Idempotent**: khóa tự nhiên (`source+external_id`, `legacy_id`, hoặc `sha256`) → `INSERT … ON CONFLICT DO UPDATE` chỉ khi băm nội dung đổi; mỗi lần chạy ghi `import_items.action ∈ {created, updated, skipped, error}`.
- **Giao dịch** theo lô (ví dụ 500 bản ghi); lỗi một bản ghi không hủy cả lô nhưng được ghi và làm `import_runs.status='PARTIAL'`.
- **Không đoán nghĩa**: trường không ánh xạ được lưu vào cột `extra jsonb`, không bỏ.
- **Bí mật**: importer không bao giờ in/ghi log giá trị bí mật; bộ lọc che áp dụng cho `import_items`.
- **Thứ tự**: org/users/roles → environments → secrets → accounts → files → modules/functions → bug sources/projects → bugs/snapshots → sources/references → rules → automation tasks/versions → test plans/cases → audit (lịch sử cũ) → `import_runs` cuối.

## 6. Ràng buộc, chỉ mục, hiệu năng

- FK bắt buộc ở mọi quan hệ; không dùng FK mềm trừ tham chiếu ngoài (`external_id`).
- `UNIQUE` ở khóa nghiệp vụ: `bugs(source_id, external_id)`, `business_rules(rule_key)`, `automation_code_versions(task_id, sha256)`, `source_versions(source_id, version_no)`.
- Tìm kiếm: `pg_trgm` + `unaccent` cho tra cứu tiếng Việt không dấu (thay `fold()` đang dùng trong JS); GIN cho `jsonb` chỉ khi có truy vấn thực.
- Khối lượng ước tính hiện tại nhỏ (≈ 6k bug cũ, ≈ 700 bug live, ≈ 2k function, ≈ 2,5k build, 194 rule, 30 task) → không cần phân vùng; HNSW cho `embeddings` đủ.

## 7. Phiên bản và kiểm toán

- `audit_logs` ghi: đăng nhập, đổi quyền, đọc credential, tạo/sửa/duyệt tác vụ, thay đổi rule/reference, chấp nhận gợi ý AI, đăng ký/gỡ runner, import.
- Cột `before/after` chỉ giữ trường đã che bí mật.

## 8. Rollback

| Giai đoạn | Cách hoàn nguyên |
|---|---|
| Alembic revision lỗi | `alembic downgrade -1`; revision phá hủy dữ liệu bị cấm (dùng expand → migrate → contract qua nhiều revision) |
| Import sai | Xóa **chỉ** bản ghi tạo bởi `import_run` đó (`import_items.action='created'`) trong một giao dịch, hoặc `DROP` DB import và nạp lại từ M0 (DB đích rỗng ở giai đoạn này, nguồn không bị ảnh hưởng) |
| Sau khi cắt trang | Bật lại trang cũ của bản Node (vẫn chạy); dữ liệu ghi mới ở Postgres được xuất ngược (script `export-to-legacy`, chỉ chạy khi cần) hoặc chấp nhận mất dữ liệu ghi trong cửa sổ cắt nếu người phụ trách chọn |
| Toàn bộ | Khôi phục từ manifest M0 (nguồn không đổi) và chạy lại bản Node |

## 9. Rủi ro riêng của dữ liệu

| Rủi ro | Giảm thiểu |
|---|---|
| `schema.sql` lệch thực tế (4 bảng thật không có) | Mô hình mới thiết kế từ **dữ liệu thật**, không từ `schema.sql` |
| `bugs.json` có trường rút gọn (`t,c,d,m,g,how,u`) | Bảng ánh xạ trường trong DATA_MIGRATION_MATRIX; xác minh với mẫu thực trước khi import |
| `business_rules.json` bị ghi đè mỗi lần đồng bộ | Import tạo `source_version` từ từng `revision`; các bản `kb-snapshot` đủ làm bằng chứng |
| Vault gắn DPAPI | Xem GAP G4: giải mã trên máy gốc, nhập vào vault mới, không chép khóa qua kênh không an toàn |
| ID nội bộ dạng chuỗi (`at_<sha1>`, `usr_…`) | Giữ vào `legacy_id`; tham chiếu chéo (ví dụ `rule_ids`) ánh xạ qua `legacy_id` rồi mới kiểm FK |
