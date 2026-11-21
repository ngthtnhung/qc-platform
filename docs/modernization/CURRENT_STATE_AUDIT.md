# Kiểm toán hiện trạng (Current State Audit)

> Phase 0 · nhánh `modernization/phase-0-audit` · chỉ đọc code, không sửa logic, không chạm dữ liệu chạy thật.
> Mọi kết luận dựa trên việc đọc mã nguồn; README chỉ dùng để đối chiếu, không dùng làm bằng chứng.

## Chú giải phân loại

| Nhãn | Ý nghĩa |
|---|---|
| **[V]** Verified in implementation | Đã đọc mã và thấy đang chạy thật trong luồng chính |
| **[D]** Documented but not implemented | Có trong tài liệu/schema/compose nhưng không có mã chạy thật |
| **[P]** Partially implemented | Có một phần, thiếu so với yêu cầu đích |
| **[M]** Missing | Không có |
| **[N]** Proposed | Đề xuất cho kiến trúc mới (không phải hiện trạng) |

## 1. Trạng thái Git và phạm vi kiểm tra

- Nhánh khởi điểm `main`, working tree sạch, 15 commit, remote `origin/main` và `origin/nhung`. **[V]**
- Đã tạo nhánh `modernization/phase-0-audit` từ `main`. Không push, không viết lại lịch sử. **[V]**
- 128 file được Git theo dõi (không tính `node_modules`); mã ứng dụng ≈ 18.000 dòng.
- Dữ liệu chạy thật nằm ngoài Git (theo `.gitignore`): `secrets/`, `database/*.json` (trừ `automation-drafts/`, `automation-samples/`, `test-cases-maint-iot-scm.json`), `kb-snapshot/`, `kb-drafts/`, `automation-files/`, `browser-profiles/` (≈ 343 MB). **[V]**
- **Chưa chạy bộ test** trong Phase 0: `tests/policy-engine.test.js` và `tests/state-machine.test.js` gọi `db.init()` và có thể ghi vào `database/qa_platform_data.json` (dữ liệu thật). Ghi nhận là *chưa chạy*, không suy diễn là đạt hay hỏng.

## 2. Bản đồ repository

| Thư mục | Vai trò thực tế | Nhãn |
|---|---|---|
| `apps/web/` | SPA HTML/CSS/JS thuần: `app.js` 4441 dòng, `index.html` 1225, `styles.css` 1139, `help-content.js`. Được `server.js` phục vụ tĩnh. `src/entrypoint.mjs` chỉ là placeholder cho Docker | **[V]** (SPA) / **[D]** (entrypoint) |
| `services/api/server.js` | Một file 1924 dòng: HTTP server `node:http(s)`, toàn bộ route, nạp nền 4 vòng đồng bộ Haraworks. `src/entrypoint.mjs` trả `501 not_implemented` | **[V]** / **[D]** |
| `services/ai-service/` | `bug-analyzer`, `business-rule-store`, `rag-engine`, `test-plan-generator`, `automation-code-assistant` | **[V]** |
| `services/workflow-orchestrator/` | `state-machine.js` (4 máy trạng thái), `checkpoint-manager.js` | **[P]** (chỉ `BUG_ANALYSIS` được API gọi) |
| `services/automation-runner/browser-runner.js` | Quản lý phiên trong RAM; `executeStep` là **mô phỏng** | **[P]** / mock |
| `services/worker/`, `services/automation-runner/src/` | Chỉ HTTP `/health` | **[D]** |
| `apps/launcher/` | QA Launcher chạy trên máy từng người (Playwright) | **[V]** |
| `packages/*` | `team-auth`, `secret-vault`, `policy-engine`, `automation-tasks`, `bug-search`, `haraworks-live`, `kb-sync`, `account-routes`, `diagnostics`, `tls-trust`, `test-case-schema`, `figma-adapter`, `task-adapter` | **[V]** (trừ `database/`: **[D]**) |
| `database/` | `db.js` (engine JSON), `schema.sql`, `seeds.sql`, dữ liệu | xem §4 |
| `infra/compose/compose.yaml` | Postgres, Redis, MinIO, Keycloak + 4 service placeholder | **[D]** |
| `scripts/` | `qa-sync`, `sync-bugs`, `sync-business-rules`, `automation-add`, `team-user`, `import-credentials`, `sync-environments`, `ai-check` | **[V]** |
| `start-platform.*`, `start-team.ps1`, `start-qa-ngrok.bat` | Khởi động thủ công (PowerShell/bat) | **[V]** |
| `tests/` | 5 suite tự viết + 1 spec Playwright | **[P]** |
| `docs/` | `operations/` (tiếng Việt), `superpowers/` (spec/plan thiết kế cũ), `test-cases/` | — |

## 3. Topology chạy thật

```
Trình duyệt (SPA)  ──HTTPS──►  services/api/server.js  (1 process Node, cổng 3001)
      │                              ├─ db.js ──► database/qa_platform_data.json (cả DB, ghi đồng bộ mỗi lần)
      │                              ├─ BusinessRuleStore ► business_rules.json + business_rules_local.json
      │                              ├─ BugStore/FunctionStore ► bugs*.json, functions-live.json, builds-live.json
      │                              ├─ haraworks-live (poll ~30s, trong cùng process) ► tasks.haraworks.vn (GraphQL, cookie)
      │                              ├─ SecretVault ► secrets/vault.json + vault.key (DPAPI)
      │                              └─ AI: Gemini/Anthropic qua biến môi trường
      │
      └──http 127.0.0.1:3002──►  apps/launcher (máy từng người) ──► Chrome/Playwright ──► Staging/Production OrgID DEMO
```

- Không có Postgres/Redis/MinIO/Keycloak nào được mã nối tới. Compose chỉ dựng container rỗng. **[D]**
- Tác vụ dài (đồng bộ Haraworks, gọi AI, tải ảnh bug) chạy ngay trong tiến trình API / trong handler HTTP. **[V]**
- `server.js` nhận cả giao diện lẫn API; không có tách web/api thật. **[V]**

## 4. Persistence

| Hạng mục | Thực tế | Nhãn |
|---|---|---|
| Engine | `DatabaseClient` (`database/db.js`): object trong RAM, `persist()` = `writeFileSync(JSON.stringify(all))` sau **mỗi** insert/update/delete. Không khóa, không transaction, không versioning, không index. Hai process cùng ghi sẽ mất dữ liệu | **[V]** |
| `schema.sql` (19 bảng, kiểu SQLite, khóa `TEXT`) và `seeds.sql` | Không được thực thi ở đâu. `db.js` seed bằng mảng JS trong code | **[D]** |
| Bảng đang dùng thật | `team_users`, `automation_tasks`, `automation_files`, `automation_runs`, `environment_profiles`, `account_profiles`, `audit_events`, `workflow_runs`, `external_tasks`, `knowledge_sources`, `knowledge_chunks` | **[V]** |
| Lệch schema | `team_users`, `automation_tasks`, `automation_files`, `automation_runs` **không có** trong `schema.sql` (bảng được tạo ngầm bởi `getTable`) | **[V]** |
| Bảng khai báo nhưng rỗng/không dùng | `bug_records`, `bug_procedures`, `test_runs`, `test_results`, `evidence_assets`, `approvals` (0 dòng) | **[D]** |
| pgvector / embedding | Không có trong schema lẫn code | **[M]** |
| Migration (Alembic/tương đương) | `packages/database` `db:migrate` chỉ in "not implemented" | **[D]** |
| Sao lưu | `qa_platform_data.backup.json` (một bản tay, 16/11) | **[P]** |

Số liệu trong `qa_platform_data.json` tại thời điểm kiểm toán: 4 `team_users` (1 admin, 3 member), 3 `account_profiles`, 3 `environment_profiles`, 30 `automation_tasks`, 18 `audit_events`, 12 `workflow_runs`, 3 `test_plans`, 13 `test_cases`.

Kho dữ liệu phụ (đều là file JSON, đọc/ghi bằng `fs` trực tiếp trong code, bỏ qua `db.js`):

| File | Nội dung | Kích thước/số lượng |
|---|---|---|
| `bugs.json` | Bug cũ từ kho (trường rút gọn `id,t,c,d,m,g,how,u`) | 6059 bug, 1,8 MB |
| `bugs-live.json` | Bug realtime Haraworks | 714 bug, 5 dự án |
| `functions-live.json` | Task function + task QC | 2221 + 1204 |
| `builds-live.json` | Build/release | 2485 |
| `business_rules.json` | Rule gốc có `revision`, `synced_at`, `artifact_url` | 194 rule, 37 module |
| `business_rules_local.json` | Lớp chỉnh sửa (`changes{rule_id: {op: upsert|delete}}`) | rev nhỏ |
| `bugs-enrich.json`, `label-colors.json`, `notify-seen.json`, `personal-workspace.json` | Bổ sung nhãn, màu, đã xem thông báo, todo/ghi chú cá nhân | nhỏ |
| `kb-snapshot/{rules,modules,accounts,data}` | Bản xuất từ "Kho Business Rule Haraworks" | ≈ 3,2 MB |
| `kb-drafts/` | Bản nháp rule theo module/ngày | ≈ 52 KB |
| `automation-drafts/*.json` | 30 file tác vụ Playwright nháp (được Git theo dõi) | 216 KB |
| `automation-files/` | File người dùng tải lên (ảnh, PDF) | 4 file |
| `browser-profiles/` | Hồ sơ Chrome theo tài khoản | ≈ 343 MB |

## 5. Xác thực và phân quyền

(`packages/team-auth/auth.js`, `services/api/server.js:339-440`)

| Mục | Phát hiện | Nhãn |
|---|---|---|
| Đăng nhập username/password + Bearer token | Chạy thật | **[V]** |
| Băm mật khẩu | SHA-256 không salt, không work factor (`auth.js:16-18`) | **[V]** (yếu) |
| Mật khẩu mặc định | `123456` khi tạo user không có mật khẩu và khi `password_hash` trống (`auth.js:32,57`); độ dài tối thiểu 4 | **[V]** (yếu) |
| Token | `qa_`+24 byte ngẫu nhiên, **lưu rõ** ở `session_token` cạnh `token_hash`; không hết hạn, không xoay vòng, không thu hồi theo phiên | **[V]** (yếu) |
| Chống dò mật khẩu | Không giới hạn số lần đăng nhập sai | **[M]** |
| Vai trò | `admin`, `member` + 6 quyền lẻ: `environments, secrets, rules, rules_edit, automation, automation_push` | **[P]** |
| Tổ chức/tenant, nhóm, vai trò QC/DEV/PO/CX | Bảng `users`/`module_ownerships` có trong seed nhưng RBAC thật không dùng | **[M]** |
| Chưa có user nào | Server chạy không xác thực với `LOCAL_USER` cứng, chỉ cho phép khi `HOST` là loopback (`server.js:1914`) | **[V]** |
| Token ở trình duyệt | `localStorage` + `sessionStorage` (`app.js:43-56`); `innerHTML` xuất hiện 114 lần trong `app.js` | **[V]** (rủi ro XSS) |
| Keycloak | Có trong compose (profile `identity`), không mã nào dùng | **[D]** |

## 6. Bí mật và lưu trữ file

| Mục | Phát hiện | Nhãn |
|---|---|---|
| `SecretVault` | AES-256-GCM, AAD = mã tài khoản, khóa bọc DPAPI trên Windows hoặc `QA_VAULT_KEY` (base64 32 byte) trên Linux. Chỉ ghi, API không trả mật khẩu về UI (`vault.js`) | **[V]** |
| Ràng buộc nền tảng | Bọc khóa gọi `powershell.exe`; ngoài Windows khóa lưu file thường quyền 0600 | **[P]** |
| File bí mật dạng rõ trên đĩa | `secrets/credentials.json`, `secrets/qa-sync.json` (địa chỉ + token), `secrets/haraworks.json` (cookie phiên Haraworks), `secrets/tls.key`; `.gitignore` chặn nhưng không mã hóa | **[V]** |
| Seed trong mã nguồn | `database/db.js` (được Git theo dõi) chứa chuỗi `secret_ref` giống mật khẩu cho 6 tài khoản seed. Không chép giá trị vào tài liệu này; xem SECURITY_REVIEW | **[V]** (rủi ro) |
| Trả mật khẩu cho launcher | `GET /api/v1/browser-sessions/:id/credentials`: đúng chủ phiên, một lần, trong 2 phút, có ghi audit `CREDENTIAL_READ` | **[V]** |
| Lưu file đính kèm | Thư mục cục bộ `database/automation-files`, ≤ 10 MB, nhận dạng theo magic bytes, xóa sau 14 ngày, mã `f_xxx`; metadata nằm trong `automation_files` | **[V]** |
| Lớp trừu tượng storage, S3, metadata quan hệ đầy đủ, ảnh/video/artifact thực thi | Không có | **[M]** |

## 7. Quản lý bug và phân tích AI

| Mục | Phát hiện | Nhãn |
|---|---|---|
| Đồng bộ bug realtime | `packages/haraworks-live/*`: GraphQL `tasks.haraworks.vn/call/ta_api/graphql`, **chỉ đọc**, cookie phiên, poll ~30 s trong tiến trình API, đã có xử lý hết hạn cookie (`AuthError`) | **[V]** |
| Tra cứu/lọc bug | `BugStore`/`FunctionStore` (`packages/bug-search/search.js`): tìm theo từ khóa, lọc nhiều tiêu chí, nhãn Today | **[V]** |
| Chi tiết bug: mô tả, lịch sử, bình luận, ảnh/video | `haraworks-live/detail.js` lấy theo yêu cầu; không lưu bền | **[P]** |
| Lịch sử bug lưu trong DB | `bug_records`, `bug_procedures` rỗng | **[M]** |
| Phân tích AI | `POST /api/v1/bug-analysis`: Gemini hoặc Anthropic, nạp ảnh bug, **có fallback phân tích cục bộ** (`analysis.js`) và ghi rõ chưa dùng AI | **[V]** |
| Trừu tượng nhà cung cấp AI | Chọn bằng `if` theo biến môi trường ở `server.js:936,1741`; không interface | **[P]** |
| `POST /api/v1/bug-analyses` (số nhiều) | Đường cũ qua `BugAnalyzer` + `RagEngine` + `CheckpointManager`; ghi `workflow_runs` | **[V]** (song song với đường mới, trùng chức năng) |
| Gợi ý root cause, tái hiện, test | Trong phản hồi AI; không lưu thành thực thể có duyệt | **[P]** |
| Tác vụ nền (queue) | Không có; tải ảnh, gọi AI chạy trong request | **[M]** |

## 8. Business rule và tri thức

| Mục | Phát hiện | Nhãn |
|---|---|---|
| Kho rule | `BusinessRuleStore`: lớp gốc (đồng bộ từ "Kho Business Rule Haraworks", mỗi lần ghi đè) + lớp cục bộ (upsert/delete); `load()` gộp | **[V]** |
| Trường rule | `rule_id, version, state, module, source_modules, flow, title, description, user_roles, setting_type, classification, analysis, open_questions, source, related_rules, approved_at` | **[V]** |
| Provenance | `source` (URL/tham chiếu), `version`, `origin: platform` cho rule tạo tại chỗ | **[P]** |
| Tách 3 lớp (nguồn gốc / thư viện tham chiếu / gợi ý AI) | Không có; rule đã duyệt và rule do AI trích xuất cùng một kho, phân biệt chỉ bằng `state` (`active`/`pending`) | **[M]** |
| Vị trí trích dẫn (locator), annotation, trạng thái validate, quan hệ giữa tham chiếu | `related_rules` là mảng mã; không có locator/annotation | **[P]** |
| Xử lý xung đột tài liệu | Không; bản đồng bộ mới **ghi đè** lớp gốc (`replace`) | **[M]** |
| Phiên bản/kiểm toán rule | `version` có; sửa tại chỗ tạo `version+1` nhưng trong overlay chỉ giữ bản mới nhất, không lịch sử | **[P]** |
| Truy xuất (RAG) | `rag-engine.js`: chấm điểm từ khóa + khớp module, top 5. Không embedding, không pgvector | **[V]** (từ khóa) / **[M]** (vector) |
| Nguồn gốc: SOP, video, ảnh, tài liệu | Không lưu; chỉ có `knowledge_sources` 1 dòng seed | **[M]** |

## 9. Tác vụ tự động và QA Launcher

| Mục | Phát hiện | Nhãn |
|---|---|---|
| Mô hình tác vụ | `normalizeTask` (`packages/automation-tasks/tasks.js`): `name, module, flow, start_url (https, cùng root domain Staging), steps, required_roles, writes, rule_ids, params (text/multiline/list/file, tối đa 30), script (≤ 20000 ký tự), script_sha` | **[V]** |
| Script | Thân hàm async chạy trong `node:vm` với `page, ctx, step, assert, pickOption, attachFiles` | **[V]** |
| Hàng rào script | Regex `FORBIDDEN` (require, process, eval, Function, constructor, fs...). Chính mã ghi rõ **không phải ranh giới bảo mật** (`tasks.js:44`, `task-runner.js:12`); blacklist regex có thể bị vòng | **[P]** |
| Vòng đời `draft → approved` | Mã có `isRunnable` (cần `approved_sha == script_sha`) và endpoint `/approve` đòi quyền + khớp sha, **nhưng** mọi tác vụ bị **tự duyệt**: `autoApprove` trong danh sách (`server.js:893-896`), khi lưu (`:912-914`), khi nạp nháp (`:297`); 30/30 tác vụ hiện có `approved_by:"auto"`. README ghi "không cần duyệt" | **[V]** (trái với yêu cầu đích) |
| Chặn ghi Production | `PolicyEngine`: chặn WRITE/MIGRATE/RELEASE/DELETE trên `PRODUCTION`; tác vụ chỉ chạy Staging; gate xác nhận Org với `PRODUCTION_TEST` | **[V]** |
| Giới hạn tốc độ | 120 lượt chạy/10 phút/người; 30 upload/10 phút — trong RAM, mất khi khởi động lại | **[V]** |
| Launcher | Nghe `127.0.0.1:3002`, kiểm tra `Origin`, lấy phiên + mật khẩu từ server, đăng nhập Playwright (`playwright-login.js`), tải file đính kèm vào thư mục tạm, chạy script, kiểm tra lại SHA, gửi kết quả (`task-result`), xóa file tạm | **[V]** |
| Kết quả chạy | Chỉ `status`, `steps[]`, `log`, `error`, `duration_ms` → `automation_runs`, trả 30 lần gần nhất | **[P]** |
| Đăng ký runner, heartbeat, hàng đợi, điều phối, lịch chạy | Không có; trình duyệt người dùng gọi launcher cục bộ để kích hoạt | **[M]** |
| Screenshot/video/trace/artifact | Không lưu | **[M]** |
| Retry/xử lý thất bại | Không (người dùng bấm chạy lại) | **[M]** |
| Docker Runner | Service `automation-runner` chỉ có `/health` | **[D]** |
| `BrowserRunner.executeStep` ở server | **Mô phỏng**: trả PASS hoặc lỗi 500 giả theo cờ `shouldFail` (`browser-runner.js:150-176`). Endpoint `/execute-step` vẫn công khai | **[V]** (mock, không được coi là tích hợp thật) |
| Sửa code bằng AI | `/automation/tasks/:id/repair`: AI đề xuất, kiểm tra `validateScript`, người dùng đọc rồi lưu | **[V]** |
| Flow Recorder, chuẩn hóa tương tác, phân giải locator, Flow Spec, test case → code có version | Không có | **[M]** |
| Tác vụ chạy hàng loạt | `cleanBatch` tối đa 50 lần/lượt | **[V]** |

## 10. Quy trình, test case, state machine

- `state-machine.js`: 4 máy trạng thái (Bug Analysis, Test Plan, Test Run, Task Integration) có bảng chuyển trạng thái và test. **[V]**; chỉ `BUG_ANALYSIS` được API dùng. **[P]**
- `checkpoint-manager.js`: tạo/tiến `workflow_runs` kèm `idempotency_key`. **[V]**
- Kiểm tra bằng grep: `figma-adapter`, `task-adapter` và `test-plan-generator.js` **không được import** bởi `server.js` hay scripts (chỉ test dùng `test-case-schema`) ⇒ mã không nằm trong luồng chạy chính. **[V]**
- `test-case-schema/validator.js` + `test-plan-generator.js` + `database/test-cases-maint-iot-scm.json` (952 dòng): sinh/kiểm tra test case MAINT/IOT/SCM; `test_plans`=3, `test_cases`=13 trong DB. **[P]** (không có vòng đời duyệt → code → chạy)
- Bảng `approvals`, `test_runs`, `test_results`, `evidence_assets` không có dữ liệu. **[D]**

## 11. Phân tích API (≈ 80 route trong một handler)

Nhóm route (`services/api/server.js`), đếm theo mẫu `pathname`:

| Nhóm | Route tiêu biểu |
|---|---|
| Auth/Team | `/auth/login`, `/team/users[/:id/(reset-token|reset-password|revoke)]`, `/me`, `/me/profile`, `/me/haraworks-token` |
| Workspace/Cài đặt | `/personal-workspace/*`, `/label-colors`, `/settings/general`, `/notifications*` |
| Môi trường & tài khoản | `/environments`, `/accounts[/:id/(routes|secret)]` |
| Phiên trình duyệt | `/browser-sessions[/:id/(credentials|task|task-result|files/:fid|confirm-org|execute-step)]` |
| Tự động hóa | `/automation/tasks[/:id/(repair|approve|run|params)]`, `/automation/runs`, `/automation/files[/:id/(raw|meta)]` |
| Bug/Function/Build | `/bugs*`, `/functions*`, `/builds*`, `/sync-all`, `/my-tasks` |
| Tri thức | `/kb/modules`, `/business-rules[/(meta|refresh|sync)]`, `/bug-search`, `/bug-analysis`, `/bug-analyses` |
| Hệ thống | `/health`, tĩnh `/`, `*.js`, `*.css` |

Phát hiện kỹ thuật chung:
- Không có router/middleware, không OpenAPI, không schema validation đầu vào thống nhất. **[M]**
- Phản hồi dạng `{success, data|error}` thống nhất một phần; riêng lỗi 500 trả `{error:{...}}`. **[P]**
- Quyền kiểm tra bằng `requireAdmin(perm)` gọi tay từng route; một số route đọc (ví dụ `/browser-sessions/:id`) chỉ cần đăng nhập, không kiểm tra chủ phiên. **[P]**
- Phục vụ file tĩnh dùng `path.join(WEB_DIR, pathname)` cho mọi đường dẫn kết thúc `.js`/`.css` (`server.js:1868-1873`): cần kiểm tra path traversal kỹ ở Phase 1 trước khi tái sử dụng. **[V]** (điểm cần xác minh khai thác)
- `Access-Control-Allow-Origin` không được đặt (chỉ same-origin); header bảo mật (CSP, HSTS...) không có. **[M]**

## 12. Giao diện

- SPA một file, thao tác DOM bằng `innerHTML`, không build, không type, không component, không test. **[V]**
- Trang: Tổng quan, Tài Khoản & Môi Trường, Phân Tích Bug, Tra Cứu Bug (+ Function, Build), Kho Business Rule, Tác Vụ Tự Động, Phân Quyền, workspace cá nhân, thông báo, trợ giúp, chủ đề sáng/tối. **[V]**
- Gọi API bằng hàm `fetch` rải rác kèm `Authorization: Bearer` từ `localStorage`. Chưa có API client tập trung. **[P]**

## 13. Kiểm thử và công cụ

| Hạng mục | Phát hiện | Nhãn |
|---|---|---|
| Unit | `policy-engine`, `state-machine`, `test-case-schema`, `automation-tasks`, `bug-labels` | **[V]** (chưa chạy trong Phase 0) |
| e2e | `tests/e2e/maint-iot-scm.spec.js` (Playwright) | **[P]** |
| Test API/giao diện/đồng bộ Haraworks/vault/auth | Không có | **[M]** |
| CI | Không có `.github` | **[M]** |
| Lint/format | `eslint.config.mjs`, `.prettierrc.json`, `tsconfig.base.json` có nhưng `lint`/`typecheck` chỉ chạy trên các `src/entrypoint.mjs` placeholder | **[P]** |

## 14. Triển khai

| Hạng mục | Phát hiện | Nhãn |
|---|---|---|
| Khởi động thật | `node services/api/server.js` hoặc `start-team.ps1` (HTTPS mkcert, `0.0.0.0:3001`) + mỗi người chạy launcher | **[V]** |
| Tài liệu vận hành | `docs/operations/*` (theo IP, nhóm, ngrok, thêm rule/bug) | **[V]** |
| Docker Compose | Có file, nhưng 4 service là placeholder; web/api/worker/runner không dùng Postgres/Redis/MinIO | **[D]** |
| `start-qa-ngrok.bat`, `.lnk` | Phơi server ra Internet qua ngrok (file bị `.gitignore`) | **[V]** |
| Healthcheck | `/api/v1/health` luôn trả `database: "CONNECTED"` cứng (không kiểm tra thật) | **[V]** (không đáng tin) |
| Cấu hình môi trường | `.env.example` chỉ có biến cho compose; server đọc biến từ `process.env` (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `HARAWORKS_*`, `TLS_*`, `QA_VAULT_KEY`...) không có bản liệt kê chung | **[P]** |

## 15. Điểm mạnh cần giữ

1. `PolicyEngine` fail-closed, AI không tự duyệt, gate Org cho Production-test. **[V]**
2. `SecretVault` AES-GCM với AAD theo tài khoản; mật khẩu không trả về UI. **[V]**
3. Ghim SHA của script và launcher kiểm tra lại trước khi chạy. **[V]**
4. Lớp rule gốc + overlay giúp chỉnh sửa không bị đồng bộ ghi đè. **[V]**
5. Nhận dạng file bằng magic bytes, giới hạn kích thước, giới hạn tốc độ. **[V]**
6. Launcher chỉ nghe loopback, kiểm tra Origin, không ghi mật khẩu ra đĩa. **[V]**
7. Cơ chế chạy tác vụ có tham số (`params`, `pickOption`, `attachFiles`) — tài sản nghiệp vụ lớn, phải bảo toàn khi chuyển. **[V]**

## 16. Hạn chế lớn nhất (tóm tắt)

1. Dữ liệu phân tán trong ≥ 14 file JSON, không quan hệ, không transaction, không phiên bản.
2. Hạ tầng đích (Postgres, Redis, MinIO, Keycloak, worker, runner) chỉ là giàn giáo rỗng.
3. Tác vụ tự động tự duyệt; mô phỏng `executeStep` còn trong API.
4. Bí mật dạng rõ trên đĩa; mật khẩu băm yếu; token không hết hạn.
5. Tri thức không tách nguồn/tham chiếu/gợi ý AI; đồng bộ kho ghi đè.
6. Runner phụ thuộc máy người dùng, không có điều phối, không có artifact.
7. Không CI, test phủ thấp, chưa có test API/UI.
