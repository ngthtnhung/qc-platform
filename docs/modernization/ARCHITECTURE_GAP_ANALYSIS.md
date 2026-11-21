# Phân tích khoảng cách kiến trúc (Gap Analysis)

> Cột "Hiện trạng" dùng nhãn từ `CURRENT_STATE_AUDIT.md`: **[V]** Verified · **[D]** Documented-not-implemented · **[P]** Partial · **[M]** Missing. Cột "Đích" là **[N]** Proposed.
> Công sức: S ≤ 1 tuần · M 1–3 tuần · L 3–6 tuần · XL > 6 tuần (một người, ước lượng thô). Rủi ro: T/V/C = thấp/vừa/cao.

## 1. Bảng khoảng cách theo năng lực

| # | Năng lực | Hiện trạng | Đích | Khoảng cách | Công sức | Rủi ro |
|---|---|---|---|---|---|---|
| 1 | Frontend | **[V]** SPA JS thuần 4441 dòng, `innerHTML`, không build/type | Next.js + TypeScript, module theo miền, API client tập trung | Viết lại toàn bộ UI, giữ chức năng | XL | C (hồi quy chức năng) |
| 2 | Backend | **[V]** `server.js` 1924 dòng, ≈ 80 route trong một handler | FastAPI modular monolith, OpenAPI | Viết lại, tách domain/service/repo | XL | C |
| 3 | CSDL | **[V]** JSON in-memory ghi toàn bộ file; **[D]** schema.sql không chạy | PostgreSQL + SQLAlchemy + Alembic | Mô hình quan hệ mới + import dữ liệu | L | C (mất/sai dữ liệu) |
| 4 | Vector retrieval | **[M]** (chỉ khớp từ khóa) | pgvector + truy xuất lai | Mới hoàn toàn | M | V |
| 5 | Tác vụ nền | **[M]** (chạy trong request/process API) | Celery + Redis + beat | Tách đồng bộ, AI, tải ảnh thành task | L | V |
| 6 | Lưu trữ file | **[P]** thư mục cục bộ + metadata JSON | `StorageBackend` local/S3, metadata Postgres | Trừu tượng + migrate 4 file + artifact mới | M | T |
| 7 | Xác thực | **[P]** SHA-256 không salt, token không hết hạn | argon2id, access+refresh, thu hồi | Viết lại, ép đổi mật khẩu | M | C (khóa người dùng) |
| 8 | RBAC/Org | **[P]** 2 vai + 6 quyền lẻ, không org | **Một vai trò `qc`, 4 QC ngang quyền** (xem APPROVAL_MODEL.md); không org | Mô hình mới, nhập người dùng cũ → `qc` | S | T |
| 9 | Môi trường/tài khoản | **[V]** `environment_profiles`, `account_profiles`, vault | Giữ khái niệm; vault không phụ thuộc DPAPI | Chuyển và đổi cơ chế khóa | M | C (giải mã bí mật) |
| 10 | Audit | **[P]** 18 dòng, thiếu resource id/before-after | `audit_logs` append-only đầy đủ | Mở rộng + chuẩn hóa | S | T |
| 11 | Bug sync + lịch sử | **[V]** poll Haraworks, **[M]** lịch sử | Celery beat + snapshot/history | Chuyển mã + thêm lịch sử | L | V |
| 12 | Phân tích bug AI | **[V]** Gemini/Anthropic + fallback | Provider abstraction, lưu `ai_analyses`, chạy ở worker | Tái cấu trúc + lưu kết quả | M | T |
| 13 | Reference Library | **[M]** (một kho rule trộn lẫn) | 3 lớp: nguồn/tham chiếu/gợi ý AI, có duyệt | Mô hình + UI duyệt + import rule hiện có | XL | C (sai nghĩa nghiệp vụ) |
| 14 | Provenance/xung đột | **[P]** `source`, `version`; **[M]** xung đột | Locator, version nguồn, `conflicts_with` | Mới | L | V |
| 15 | Flow Recorder → Flow Spec | **[M]** | Chuỗi 10 bước có trạng thái/version | Mới hoàn toàn | XL | C |
| 16 | Test case lifecycle | **[P]** schema + generator, không vòng đời | Version + duyệt + liên kết code/spec | Mở rộng | L | V |
| 17 | Quản lý code automation | **[P]** script lưu trong task, ghim SHA | `automation_code_versions` bất biến | Tách khỏi task, giữ SHA | M | T |
| 18 | Duyệt automation | **[V]** `autoApprove` (30/30 tự duyệt) | **Chỉ QC duyệt** sản phẩm/hành động của AI; AI không duyệt (APPROVAL_MODEL.md) | **Đảo ngược hành vi hiện tại** | S | V (đổi quy trình người dùng) |
| 19 | Runner | **[P]** launcher cục bộ | Host + Docker Runner Agent, đăng ký/heartbeat/claim | Tiến hóa launcher + service điều phối | XL | C |
| 20 | Artifact thực thi | **[M]** | Log/screenshot/video/trace trong storage | Mới | M | T |
| 21 | Lịch chạy/retry | **[M]** | Schedule + retry + xử lý lỗi | Mới | M | V |
| 22 | Triển khai | **[D]** compose placeholder; khởi động tay | Một lệnh `docker compose up`, healthcheck thật, volume bền | Viết lại infra | M | V |
| 23 | CI/kiểm thử | **[P]** 5 suite, chưa CI | pytest + Vitest + Playwright + CI | Xây mới, port test cũ | L | T |
| 24 | Quan sát | **[M]** (health giả `CONNECTED`) | Health thật, log có cấu trúc + che bí mật | Mới | S | T |
| 25 | Cấu hình | **[P]** env rải rác | `pydantic-settings`, fail-fast | Mới | S | T |

## 2. Khoảng cách theo miền nghiệp vụ

| Miền | Giữ được (tái dùng ý tưởng/mã) | Phải làm mới |
|---|---|---|
| Core | `PolicyEngine` (luật), `SecretVault` (thiết kế), audit | Auth/RBAC/Org, vault không DPAPI |
| Bug & AI | Logic GraphQL `haraworks-live`, `analysis.js`, `search.js` (điểm số), nhãn Today/ưu tiên | Lịch sử, queue, lưu phân tích, provider interface |
| Knowledge | Lớp gốc + overlay (ý tưởng), `state/version/source` của rule | 3 lớp, locator, annotation, xung đột, pgvector |
| Flow/Test | `state-machine.js`, schema test case, generator | Recorder, normalization, locator, flow spec, vòng đời đầy đủ |
| Automation | `task-runner.js`, `playwright-login.js`, `tasks.js` (params/validate), `task-files.js` | Điều phối runner, artifact, lịch, retry, duyệt đúng nghĩa |

## 3. Các mâu thuẫn giữa hiện trạng và đích cần quyết định

| # | Mâu thuẫn | Đề xuất xử lý | Cần ai quyết |
|---|---|---|---|
| G1 | ~~Tác vụ tự duyệt ↔ AI không được tự duyệt~~ | **ĐÃ CHỐT (2026-11-21)**: mọi sản phẩm/hành động của AI chỉ QC duyệt; không còn tự duyệt hay "duyệt ngầm"; 4 QC ngang quyền. Xem APPROVAL_MODEL.md | Chủ sản phẩm (xong) |
| G2 | Kho rule do kho ngoài đẩy (ghi đè mỗi lần) ↔ "không gộp xung đột âm thầm" | Mỗi lần đồng bộ tạo `source_version` mới + so sánh với bản trước; khác biệt thành `ai_suggestions`/`DISPUTED` thay vì ghi đè | Chủ Kho BR |
| G3 | Launcher cục bộ ↔ Runner Agent | Giữ lệnh `open-session` cục bộ; thêm chế độ runner có đăng ký | Dev |
| G4 | Mật khẩu vault khóa DPAPI (Windows) ↔ Docker/Linux | Khóa KEK qua biến môi trường/KMS; script giải mã-một-lần trên máy Windows hiện tại để nhập vào vault mới | Admin máy chủ |
| G5 | Đồng bộ Haraworks bằng cookie cá nhân ↔ vận hành server | Giữ cookie làm secret của `bug_sources`; có cảnh báo hết hạn; xem xét token dịch vụ riêng nếu Haraworks hỗ trợ | Admin |
| G6 | Production OrgID DEMO trong phạm vi tab Tài khoản ↔ "không ghi Production" | Giữ `PRODUCTION_TEST` chỉ đọc + xác nhận Org; mọi thao tác ghi cần phê duyệt rõ ràng | QC lead |
| G7 | Hai đường phân tích bug (`/bug-analysis`, `/bug-analyses`) | Hợp nhất thành một `ai_analyses` | Dev |

## 4. Thứ tự phụ thuộc rút ra

1. Hạ tầng + CSDL + auth là điều kiện cho mọi thứ.
2. Bí mật/vault phải sẵn sàng trước khi Runner và đồng bộ Haraworks chạy trên kiến trúc mới.
3. Storage trước Reference Library (nguồn gốc cần file) và trước artifact thực thi.
4. Reference Library trước AI-intelligence (embedding cần nguồn `VALIDATED`).
5. Runner Agent có thể làm song song một phần với Reference Library sau khi Core xong.
6. Flow Recorder cần Runner/Playwright kit + Reference Library (liên kết spec ↔ tham chiếu).

## 5. Rủi ro tổng hợp

| Rủi ro | Tác động | Giảm thiểu |
|---|---|---|
| Hồi quy chức năng khi viết lại UI/API | Đội QC mất công cụ hằng ngày | Strangler: chạy bản Node song song, chuyển từng trang, ma trận bảo toàn (FEATURE_PRESERVATION_MATRIX) |
| Mất dữ liệu khi import | Mất bug/rule/tác vụ | Chỉ đọc nguồn, importer idempotent, đối soát số lượng/băm, không xóa nguồn |
| Không giải mã được vault cũ | Mất mật khẩu tài khoản test | Giải mã trên máy Windows gốc (DPAPI) trước khi chuyển, nhập lại qua UI an toàn; giữ bản sao `secrets/` nguyên vẹn ngoài Git |
| Khóa người dùng do đổi băm mật khẩu | Không đăng nhập được | SHA-256 → argon2id **khi đăng nhập thành công** (rehash dần) hoặc buộc đặt lại; admin có đường khôi phục |
| Sai nghĩa khi chuyển rule | Test sai | Rule cũ vào Reference Library trạng thái `UNREVIEWED` kèm nguồn; không tự `VALIDATED` |
| Quá phức tạp | Chậm, khó bảo trì | Modular monolith, không vi dịch vụ, tiêu chí chấp nhận cho từng phase |
