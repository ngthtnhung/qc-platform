# Đánh giá bảo mật (Security Review)

> Phase 0 · đọc mã tĩnh, **không** chạy khai thác, **không** chạm vào bí mật thật. Giá trị bí mật không được chép vào tài liệu này.
> Nhãn: **[V]** xác minh trong mã · **[P]** một phần · **[M]** thiếu · **[N]** đề xuất. Mức độ: Nghiêm trọng / Cao / Trung bình / Thấp.

## 1. Danh sách rủi ro hiện trạng (xếp theo mức độ)

| ID | Mức | Phát hiện | Bằng chứng | Nhãn | Biện pháp đích |
|---|---|---|---|---|---|
| S-01 | Nghiêm trọng | **Mật khẩu giống thật nằm trong mã nguồn được Git theo dõi**: `database/db.js` seed 6 tài khoản với chuỗi `secret_ref` giống mật khẩu (tiền tố `ENC_…` nhưng là chữ rõ). Đã nằm trong lịch sử commit | `db.js:132-205` | **[V]** | **Xoay (đổi) mật khẩu các tài khoản liên quan trên môi trường thật nếu từng là mật khẩu thật**; xóa seed khỏi mã; làm sạch lịch sử chỉ khi chủ repo quyết định (không viết lại lịch sử ở Phase 0); bật quét bí mật trong CI (gitleaks) |
| S-02 | Nghiêm trọng | **Tác vụ tự động tự duyệt** (`autoApprove`; 30/30 `approved_by:"auto"`), script chạy trên máy người dùng với phiên đã đăng nhập; chặn bằng regex blacklist, mã tự thừa nhận không phải ranh giới bảo mật | `server.js:893-914,297`; `tasks.js:44-53`; `task-runner.js:12` | **[V]** | Chỉ phiên bản `APPROVED` do người có quyền duyệt (AI không duyệt); cách ly chạy trong Runner (process/container, không dùng `vm`), danh sách cho phép API thay vì blacklist; ghim SHA |
| S-03 | Cao | **Băm mật khẩu yếu**: SHA-256 không salt, hằng số tiền tố chung | `auth.js:16-18` | **[V]** | argon2id (tham số theo OWASP), rehash dần khi đăng nhập |
| S-04 | Cao | **Mật khẩu mặc định `123456`**, tối thiểu 4 ký tự; tài khoản thiếu `password_hash` chấp nhận `123456` | `auth.js:32,33,57` | **[V]** | Cấm mật khẩu mặc định; ≥ 12 ký tự hoặc passphrase, danh sách mật khẩu yếu; `must_change_password` |
| S-05 | Cao | **Token phiên không hết hạn, lưu chữ rõ trong DB** (`session_token` cạnh `token_hash`), bị trả lại cho client mỗi lần đăng nhập, không có thu hồi theo thiết bị | `auth.js:39-44,62-70` | **[V]** | Access token ngắn (≤ 15 phút) + refresh xoay vòng lưu băm; thu hồi; không lưu token rõ |
| S-06 | Cao | **Token trong `localStorage` + `sessionStorage`**; `innerHTML` 114 chỗ trong SPA ⇒ XSS đánh cắp token | `app.js:43-56` | **[V]** | Cookie `HttpOnly; Secure; SameSite`, CSRF token, React escaping, CSP nghiêm ngặt |
| S-07 | Cao | **Không giới hạn đăng nhập sai** (brute force), không khóa tài khoản | `server.js:343-352` | **[M]** | Rate limit theo IP+user (Redis), backoff, cảnh báo |
| S-08 | Cao | **Bí mật rõ trên đĩa**: cookie phiên Haraworks (`secrets/haraworks.json`), token QA (`secrets/qa-sync.json`), `credentials.json`, khóa TLS; bảo vệ chỉ bằng `.gitignore` | `haraworks-live/index.js:36-52`; `qa-sync.mjs:22-31` | **[V]** | Đưa vào vault phong bì; quyền tệp nghiêm ngặt; cookie Haraworks ghi vào `secrets` (DB mã hóa), che khi log |
| S-09 | Cao | **Phơi server ra Internet qua ngrok** (script cục bộ, bị gitignore) nhưng server dùng token tĩnh, không rate limit, không WAF | `start-qa-ngrok.bat` | **[V]** | Không dùng ngrok cho production; reverse proxy có TLS + rate limit; VPN/LAN |
| S-10 | Trung bình | **Vault phụ thuộc DPAPI Windows** (gọi `powershell.exe`); ngoài Windows khóa lưu file thường; mất khóa/đổi user Windows ⇒ mất mật khẩu | `vault.js:23-53` | **[V]** | KEK qua biến môi trường/KMS, mã hóa phong bì, xoay khóa, sao lưu khóa có kiểm soát |
| S-11 | Trung bình | **Endpoint trả mật khẩu cho launcher**: đúng chủ phiên, một lần, 2 phút; truyền qua mạng (HTTPS nếu bật; HTTP cảnh báo nhưng vẫn chạy) | `server.js:851-864,1918` | **[V]** (thiết kế tốt) / **[P]** (cho phép HTTP) | Bắt buộc TLS ngoài loopback (từ chối khởi động nếu không); token runner riêng; thêm giới hạn IP |
| S-12 | Trung bình | **Phiên trình duyệt trong RAM** (`BrowserRunner.activeSessions`) mất khi khởi động lại; `GET/DELETE /browser-sessions/:id`, `/confirm-org`, `/execute-step` không kiểm tra chủ phiên | `server.js:866-886` | **[V]** | Phiên ở DB/Redis với chủ sở hữu; kiểm tra quyền mọi route |
| S-13 | Trung bình | **`/execute-step` là mô phỏng** nhưng công khai; có thể đánh lừa người dùng tin có kết quả thật | `browser-runner.js:150-176` | **[V]** | Gỡ trong hệ mới; không giữ mô phỏng làm "tích hợp" |
| S-14 | Trung bình | **Policy thiếu ở nhiều route**: nhiều route ghi chỉ dựa `requireAdmin(perm)` thủ công; không kiểm tra tập trung; một số route đọc chỉ cần đăng nhập | `server.js` (rải rác) | **[P]** | Dependency injection quyền ở FastAPI; test phủ từng route (ma trận route × vai trò) |
| S-15 | Trung bình | **Phục vụ file tĩnh** `path.join(WEB_DIR, pathname)` cho mọi `*.js`/`*.css` — cần xác minh chống path traversal (URL đã chuẩn hóa nhưng không có kiểm tra rõ) | `server.js:1868-1873` | **[V]** (cần xác minh khai thác) | Thay bằng Next.js; không tự phục vụ file |
| S-16 | Trung bình | **Không có header bảo mật** (CSP, HSTS, X-Content-Type-Options, frame-ancestors) và không đặt CORS rõ ràng | `server.js` | **[M]** | Cấu hình ở proxy/Next; CORS danh sách cho phép |
| S-17 | Trung bình | **Audit thiếu**: không `resource_id`, không before/after; 18 dòng; một số hành động (đăng nhập sai, sửa rule qua `sync`) chưa ghi | `policy-engine.js:97-112` | **[P]** | `audit_logs` đầy đủ, append-only |
| S-18 | Trung bình | **Giới hạn tốc độ trong RAM** (mất khi khởi động lại; không dùng chung nhiều tiến trình) | `server.js:306-324` | **[V]** | Redis |
| S-19 | Trung bình | **Cookie Haraworks cá nhân** dùng làm tài khoản dịch vụ; hết hạn ⇒ dừng đồng bộ; quyền theo người cấp cookie | `haraworks-live/*` | **[V]** | Ghi nhận rõ quyền; theo dõi hết hạn; hỏi Haraworks có token dịch vụ |
| S-20 | Trung bình | **Hồ sơ Chrome 343 MB** chứa cookie phiên các tài khoản test trong `database/browser-profiles/` (ngoài Git) | thư mục | **[V]** | Không migrate; chỉ lưu cục bộ ở Host Runner, quyền thư mục, xóa định kỳ |
| S-21 | Trung bình | **Tải file/Prompt injection**: ảnh/tài liệu từ bug được gửi cho mô hình AI; kết quả AI hiển thị trong UI | `server.js:1715-1752` | **[V]** | Coi đầu ra AI là dữ liệu không tin cậy (escape), không cho AI quyền thực thi, nhật ký prompt |
| S-22 | Thấp | **`/api/v1/health` giả** (`database:"CONNECTED"` cứng) | `server.js:1851-1859` | **[V]** | Health thật |
| S-23 | Thấp | **Thông điệp lỗi 500 trả `err.message`** cho client | `server.js:1877-1884` | **[V]** | Mã lỗi chung + correlation_id; chi tiết chỉ trong log |
| S-24 | Thấp | **Không CI/quét phụ thuộc/SAST**; `playwright-core`, `@microsoft/signalr` không kiểm | repo | **[M]** | CI: `pip-audit`, `npm audit`, gitleaks, bandit/ruff, Trivy cho image |
| S-25 | Thấp | **Tải file**: có magic bytes + giới hạn 10 MB (điểm mạnh), nhưng không quét mã độc; file lưu cùng thư mục dữ liệu | `server.js:212-231` | **[P]** | Quét (ClamAV tùy chọn), lưu ngoài thư mục có thể thực thi |

## 2. Điểm mạnh cần giữ

| Điểm mạnh | Bằng chứng | Nhãn |
|---|---|---|
| `PolicyEngine` fail-closed; AI không tự APPROVE/CONFIRM_ORG/TASK_WRITE; chặn ghi Production; gate Org | `policy-engine.js:29-95` | **[V]** |
| Vault AES-256-GCM, AAD theo tài khoản; chỉ ghi, không trả về UI | `vault.js:63-96` | **[V]** |
| Credentials cho launcher: một lần, 2 phút, đúng chủ, có audit `CREDENTIAL_READ` | `server.js:851-864` | **[V]** |
| Launcher: loopback, kiểm tra Origin, không ghi mật khẩu ra đĩa, chạy kiểm tra SHA lại | `launcher.js:115-123`; `task-runner.js:21-22` | **[V]** |
| Từ chối chạy ngoài loopback khi chưa có người dùng | `server.js:1914-1917` | **[V]** |
| Nhận dạng file bằng magic bytes + giới hạn kích thước | `server.js:217-231` | **[V]** |
| `start_url` bắt buộc https và cùng root domain Staging; tác vụ chỉ chạy Staging | `tasks.js:65-72`; `server.js:985` | **[V]** |
| Redactor cho diagnostics | `packages/diagnostics/redactor.js` | **[V]** |

## 3. Kiểm soát đích (Target controls) — **[N]**

### 3.1 Xác thực và phiên
- argon2id; chính sách mật khẩu; `must_change_password`; khóa tạm thời sau N lần sai; log đăng nhập.
- Access JWT ≤ 15 phút (khóa ký xoay vòng), refresh xoay vòng, lưu băm; thu hồi theo phiên/thiết bị; đăng xuất toàn bộ.
- Cookie `HttpOnly; Secure; SameSite=Lax/Strict` + CSRF cho thao tác ghi; không dùng `localStorage` cho token.
- Tùy chọn OIDC (Keycloak đã có trong compose) cho SSO sau.

### 3.2 RBAC và phạm vi
- **Một vai trò duy nhất `qc`** (4 QC ngang quyền, ràng buộc `CHECK` ở CSDL); permission mã hóa trong `app/core/principal.py` (`approvals.decide`, `users.manage`, `secrets.write`, …). Không có vai trò admin riêng; truy vết bằng audit theo từng QC.
- Quy tắc cứng (đã triển khai và có test): **chỉ người dùng vai trò `qc` được duyệt** sản phẩm/hành động của AI; AI/SYSTEM/RUNNER không bao giờ duyệt; duyệt phải gửi đúng `payload_hash`; quyết định bất biến. Chi tiết: APPROVAL_MODEL.md.
- Kiểm tra quyền bằng dependency FastAPI; ma trận test route × vai trò tự động.

### 3.3 Bí mật
- `secrets` mã hóa phong bì (DEK/KEK), KEK nạp từ biến môi trường/KMS, xoay khóa theo phiên bản; mọi đọc bí mật có audit.
- Cookie Haraworks, khóa API AI, mật khẩu tài khoản test: cùng một cơ chế; không bao giờ có trong log/response.
- `gitleaks` pre-commit/CI; `.env` không commit; `.env.example` chỉ có khóa trống.
- Quy trình xoay bí mật khi lộ (S-01).

### 3.4 AI và tự động hóa
- AI chỉ sinh **bản nháp**: `ai_suggestions`, `automation_code_versions(origin=ai, DRAFT)`, `ai_analyses(DRAFT)`.
- Chuyển sang `APPROVED` đòi quyền người dùng, audit, và (cho code) khớp SHA.
- Runner chỉ nhận `automation_code_versions` đã duyệt; kiểm tra SHA; thực thi trong tiến trình/container riêng, không `vm`; mạng egress hạn chế theo môi trường; thời gian tối đa; không đọc bí mật ngoài phạm vi tài khoản được cấp.
- Production: không có đường tự động cho thao tác ghi; `PRODUCTION_TEST` yêu cầu xác nhận Org và đọc-chỉ (giữ luật hiện có **[V]**). "Không thực hiện thao tác ghi Production nếu chưa được cho phép rõ ràng."
- Prompt/response AI được lưu có che bí mật; đầu ra AI được render như văn bản không tin cậy.

### 3.5 Runner
- Đăng ký bằng mã dùng một lần do admin cấp; token runner băm + xoay; quyền `runner:claim`, `runner:report`; heartbeat; thu hồi runner.
- Lease/idempotency cho nhận việc; mật khẩu tài khoản cấp theo phiên (một lần, ngắn), runner không ghi đĩa.
- Docker Runner: image tối thiểu, user không root, `--cap-drop=ALL`, `read_only` nơi có thể, không mount `docker.sock`.

### 3.6 Truyền tải, mạng và dữ liệu
- TLS bắt buộc ngoài loopback (từ chối khởi động nếu thiếu); HSTS; proxy HTTPS (Caddy/Traefik/nginx) thay mkcert thủ công.
- CSP, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- Rate limit API (Redis) cho đăng nhập, upload, chạy tác vụ, gọi AI.
- Postgres/Redis/MinIO không publish cổng ra ngoài trong profile `team`; mạng nội bộ Docker.
- Sao lưu Postgres + storage được mã hóa; kiểm thử khôi phục.

### 3.7 Giám sát và log
- Log JSON có `correlation_id`, bộ lọc che bí mật (port từ `redactor.js`); không log body request chứa mật khẩu/token/cookie.
- `audit_logs` append-only (REVOKE UPDATE/DELETE); cảnh báo cho: đăng nhập sai liên tục, đọc secret, duyệt, đổi quyền, đăng ký runner.

## 4. Việc cần làm ngay (không đợi Phase 1) — khuyến nghị cho chủ repo

1. **S-01**: xác định các chuỗi trong `db.js` có phải mật khẩu thật không; nếu có thì **đổi mật khẩu trên Staging/Production DEMO** (việc của chủ tài khoản; tài liệu này không tự thực hiện).
2. **S-04/S-03**: đặt lại mật khẩu cho người dùng còn dùng mật khẩu mặc định (kiểm tra bằng quy trình admin, không in mật khẩu).
3. **S-09**: không bật ngrok khi chưa có rate limit/HTTPS đúng.
4. Sao lưu `secrets/` và `database/` ra nơi an toàn (bước M0) trước mọi thay đổi.

Các việc này **không** được thực hiện trong Phase 0 (không sửa logic, không đổi dữ liệu).

## 5. Giả định và giới hạn của đánh giá

- Chỉ phân tích tĩnh; chưa kiểm thử xâm nhập, chưa chạy `npm audit`, chưa kiểm tra lịch sử Git để tìm bí mật đã bị loại bỏ khỏi cây hiện tại.
- Chưa xác minh khai thác path traversal (S-15), nội dung thực tế của `secrets/` (chỉ đọc tên khóa), và hành vi cấu hình mạng thực tế của máy chủ.
- Chưa chạy bộ test (có thể ghi vào DB thật).
