# Ma trận bảo toàn chức năng (Feature Preservation Matrix)

> Phase 0 · mỗi chức năng hiện có được gán chiến lược: **Giữ** (chuyển nguyên hành vi) · **Thay** (thay bằng cách khác, đạt cùng kết quả) · **Cải tiến** (đổi hành vi có chủ đích, cần xác nhận) · **Gỡ** (bỏ).
> Cột "Hiện trạng" dùng nhãn **[V]/[P]/[D]/[M]**. Nguyên tắc: **không tắt chức năng cũ cho tới khi bản thay thế vượt cổng kiểm tra** (cột cuối).

| # | Chức năng hiện có | Hiện trạng | Chiến lược | Phase | Cổng kiểm tra (verification gate) |
|---|---|---|---|---|---|
| F01 | Đăng nhập tài khoản/mật khẩu, bearer token | **[V]** | Thay (argon2id, access+refresh); **Cải tiến** (ép đổi mật khẩu lần đầu) | 2 | Mọi người dùng thật đăng nhập được; rehash/đặt lại thành công; token cũ ngừng hiệu lực theo kế hoạch |
| F02 | Phân quyền admin/member + quyền lẻ (tab Phân Quyền) | **[V]** | **Cải tiến**: một vai trò `qc`, 4 QC ngang quyền (APPROVAL_MODEL.md); tab Phân Quyền thành "Người dùng QC" | 2 | 4 QC đăng nhập, cùng thấy cùng làm được mọi thao tác; không có tính năng nào chỉ một QC có |
| F03 | Cấp/reset token, reset mật khẩu, thu hồi người dùng | **[V]** | Thay (UI admin; token runner tách riêng) | 2 | Admin thực hiện đủ 3 thao tác, có audit |
| F04 | Chế độ một người (không user, chỉ loopback) | **[V]** | Gỡ (đích luôn xác thực; dev dùng tài khoản seed cục bộ) — hoặc Giữ ở profile dev nếu muốn | 1–2 | Quyết định của chủ sản phẩm; profile dev khởi động được |
| F05 | Trang Tổng quan (số bug, rule, tác vụ, tài khoản, trạng thái hệ thống) | **[V]** | Thay | 3 | Số liệu khớp bản Node trên cùng dữ liệu; health thật |
| F06 | Tài Khoản & Môi Trường: bấm tài khoản để mở và tự đăng nhập | **[V]** | Giữ UX; Thay phần thực thi bằng Host Runner (`open-session`) | 2, 4 | Mở Staging và Production OrgID DEMO tự đăng nhập đúng tài khoản, đúng Org |
| F07 | Quản lý môi trường (CRUD), loại STAGING/PRODUCTION_TEST/TASK_SYSTEM | **[V]** | Thay (bảng `environments`) | 2 | Tạo/sửa/xóa mềm; chính sách theo loại không đổi |
| F08 | Quản lý tài khoản test, route đích, KB links/can-do/cannot-do | **[V]** | Thay (`accounts`, `account_routes`) | 2 | Số tài khoản/route khớp sau import |
| F09 | Kho mật khẩu mã hóa (chỉ ghi, không trả về UI) | **[V]** | Thay (vault phong bì không phụ thuộc DPAPI), giữ nguyên nguyên tắc chỉ-ghi | 2 | Giải mã bản mới == bản cũ trong bộ nhớ; UI không bao giờ nhận mật khẩu |
| F10 | Xác nhận Org với Production-test (gate) | **[V]** | Giữ (port `PolicyEngine`) | 2 | Test: PRODUCTION_TEST không chạy khi chưa xác nhận; PRODUCTION chặn ghi |
| F11 | Policy: AI không tự APPROVE/CONFIRM_ORG | **[V]** | Giữ + mở rộng cho duyệt rule/test/code | 2–5 | Test đơn vị tương đương `policy-engine.test.js` + test mới |
| F12 | Audit log | **[P]** | Cải tiến (đầy đủ trường, append-only) | 2 | Mọi thao tác ghi/duyệt/đọc-credential có dòng audit |
| F13 | Phân Tích Bug: gõ mô tả hoặc nạp từ bug realtime (mô tả + ảnh) | **[V]** | Thay (worker + `ai_analyses`), giữ UX | 3 | Cùng input cho kết quả tương đương; ảnh được nạp; có fallback khi không có khóa AI |
| F14 | Tìm rule và bug cũ liên quan (lọc bug mới/cũ), gợi ý module | **[V]** | Thay (Postgres full-text + pg_trgm; sau đó lai vector) | 3, 5 | Bộ 30 truy vấn mẫu: top-5 chồng lấn ≥ 80 % với bản Node (shadow-read) |
| F15 | AI gợi ý nguyên nhân, cách tái hiện, tác vụ tự động nên chạy/tạo | **[V]** | Thay: kết quả lưu thành `ai_suggestions`/`ai_analyses` (DRAFT) | 3 | Không có thao tác nào tự biến gợi ý thành sự thật đã duyệt |
| F16 | Fallback phân tích cục bộ khi không có khóa AI, ghi rõ chưa dùng AI | **[V]** | Giữ (`local-heuristic` provider) | 3 | Tắt khóa AI ⇒ vẫn trả kết quả + ghi chú |
| F17 | Hai đường phân tích (`/bug-analysis`, `/bug-analyses`) | **[V]** | Cải tiến (hợp nhất) | 3 | Một endpoint; cũ trả 410/redirect có thời hạn |
| F18 | Tra Cứu Bug: danh sách gọn, trạng thái, ưu tiên, nhãn Today, module, ngày, người thực hiện/duyệt | **[V]** | Giữ UX; Thay dữ liệu | 3 | Cùng bộ lọc cho cùng số lượng kết quả (±0) |
| F19 | Sắp xếp theo ngày tạo/cập nhật/ưu tiên, lọc nhiều tiêu chí | **[V]** | Giữ | 3 | Đối chiếu kết quả sắp xếp mẫu |
| F20 | Chi tiết bug: mô tả, lịch sử, bình luận, xem ảnh/video | **[P]** | Cải tiến (lưu bền `bug_snapshots`, `bug_comments`, attachments) | 3 | Mở 20 bug mẫu, đủ mô tả/bình luận/ảnh |
| F21 | Đồng bộ bug realtime ~30 s từ Haraworks (cookie), trạng thái Realtime/Chưa realtime/hết hạn | **[V]** | Thay (Celery beat) giữ chỉ-đọc; giữ hiển thị trạng thái | 3 | Bug mới xuất hiện ≤ 60 s; hết hạn cookie hiển thị đúng; không có thao tác ghi lên Haraworks |
| F22 | Function task, QC task, Build/Release live | **[V]** | Thay | 3 | Số lượng khớp (2221/1204/2485 tại thời điểm cắt) |
| F23 | Thông báo realtime Haraworks + đánh dấu đã xem | **[V]** | Thay | 3 | Thông báo mẫu hiển thị; trạng thái đã xem lưu theo người dùng |
| F24 | Tác vụ của tôi (`/my-tasks`), Today mentions | **[V]** | Thay | 3 | Kết quả khớp bản Node cho tài khoản thử |
| F25 | Kho Business Rule: xem, lọc module, tìm kiếm | **[V]** | Thay (Reference Library + `business_rules`) | 3 | 194 rule hiển thị; truy ngược nguồn |
| F26 | Thêm/sửa/xóa rule tại platform (lớp overlay) | **[V]** | Cải tiến: tạo version mới, xóa = `retired`; cần quyền `knowledge.edit` | 3 | Sửa tạo version+1, không mất lịch sử |
| F27 | Cập nhật rule từ kho (đồng bộ ghi đè) / nhập file kho | **[V]** | Cải tiến: tạo `source_version` mới, khác biệt → gợi ý/`DISPUTED`, **không ghi đè** | 3 | Đồng bộ lại cùng dữ liệu = 0 thay đổi; dữ liệu khác tạo đề xuất |
| F28 | Rule `pending` có nhãn chờ xác nhận | **[V]** | Giữ (`validation_status`) | 3 | Rule pending hiển thị `UNREVIEWED` |
| F29 | Phân biệt rule do kho vs do platform tạo (`origin`) | **[V]** | Giữ | 3 | Cột `origin` đúng |
| F30 | Tác Vụ Tự Động: danh sách, tham số chỉnh trên UI, editor nhiều dòng, chọn file từ kho file | **[V]** | Giữ UX; Thay backend | 4 | 30 tác vụ hiển thị; tham số lưu/đọc giống nhau |
| F31 | Chạy tác vụ (tự chọn tài khoản Staging theo vai trò), chạy nhiều lần (≤ 50) | **[V]** | Giữ logic `chooseAccount`; Thay điều phối (queue + runner) | 4 | Chạy 3 tác vụ mẫu end-to-end trên Staging cho kết quả PASS tương đương bản cũ |
| F32 | Chạy script trong `vm` với `step/assert/pickOption/attachFiles/ctx` | **[V]** | Giữ API cho script; Thay môi trường chạy (Runner Agent, kiểm tra SHA, cách ly mạnh hơn) | 4 | 30/30 script chạy được không sửa (hoặc báo cáo script cần chỉnh) |
| F33 | Sửa code tác vụ bằng AI (repair) — người đọc rồi lưu | **[V]** | Giữ; Cải tiến: bản sửa là `automation_code_versions(origin=ai, DRAFT)`, người duyệt | 4–5 | AI không tạo version `APPROVED` |
| F34 | Tự duyệt tác vụ (`autoApprove`) | **[V]** | **Gỡ** (đã chốt): tác vụ do AI tạo/sửa chỉ chạy được sau khi QC duyệt (APPROVAL_MODEL.md) | 4 | Test: không có đường nào AI tự duyệt; 30 tác vụ import chờ QC duyệt |
| F35 | Tải lên file đính kèm (≤ 10 MB, magic bytes, xóa sau 14 ngày) | **[V]** | Giữ quy tắc; Thay storage | 1, 3 | Tải file hợp lệ/không hợp lệ cho kết quả như cũ |
| F36 | Giới hạn tốc độ chạy (120/10 phút) và upload (30/10 phút) | **[V]** | Giữ (Redis, bền) | 4 | Vượt hạn ⇒ 429 |
| F37 | Lịch sử chạy tác vụ (30 lần gần nhất) | **[P]** | Cải tiến (đầy đủ + log + artifact) | 4 | Lịch sử đủ; xem được log/screenshot |
| F38 | QA Launcher cục bộ (mở Chrome, đăng nhập, chạy tác vụ) | **[V]** | Thay → Host Runner Agent (giữ lệnh `open-session`) | 4 | Người dùng cũ chuyển sang runner mới mà không đổi thao tác chính |
| F39 | Mật khẩu chuyển cho launcher một lần/2 phút | **[V]** | Giữ mô hình, qua kênh runner có xác thực | 4 | Lần thứ 2 bị từ chối; có audit |
| F40 | Hồ sơ Chrome theo tài khoản (giữ đăng nhập) | **[V]** | Giữ ở Host Runner; Docker Runner dùng context tạm | 4 | Đăng nhập lại không cần OTP thủ công như trước (nếu hồ sơ còn) |
| F41 | Test plan / test case generator, schema validator (generator **không được API gọi**; dữ liệu trong DB/JSON vẫn có) | **[P]** | Giữ ý tưởng; Thay vào chuỗi Flow/Test lifecycle | 4 | 13 test case hiện có hiển thị `DRAFT` |
| F42 | State machine workflow (BUG_ANALYSIS, TEST_PLAN, TEST_RUN, TASK_INTEGRATION) | **[P]** | Thay (trạng thái trên bảng + bảng chuyển hợp lệ) | 3–4 | Port test `state-machine.test.js` |
| F43 | Không gian cá nhân (todo, ghi chú) | **[V]** | Thay (bảng) | 3 | Dữ liệu từng người giữ nguyên |
| F44 | Nhãn/màu module-trạng thái-dự án, tùy chỉnh module/trạng thái | **[V]** | Thay (`system_settings`/cột màu) | 3 | Màu hiển thị khớp |
| F45 | Chủ đề sáng/tối, trợ giúp (nút ?), hướng dẫn cài theo IP | **[V]** | Giữ trong Next.js; cập nhật nội dung hướng dẫn | 3 | Chuyển theme lưu lại; trợ giúp đủ tab |
| F46 | Chạy cho cả nhóm qua LAN HTTPS (mkcert), cổng 3001 | **[V]** | Thay (Docker Compose + reverse proxy HTTPS) | 1 | Thành viên truy cập bằng địa chỉ mới, không cần sửa launcher thủ công nhiều |
| F47 | ngrok (`start-qa-ngrok.bat`) | **[V]** | Gỡ khỏi repo; nếu cần tunnel, tài liệu hóa có điều kiện | 1 | Quyết định của admin |
| F48 | Scripts vận hành: `qa-sync`, `sync-bugs`, `sync-business-rules`, `automation-add`, `team-user`, `import-credentials`, `ai-check` | **[V]** | Thay bằng lệnh CLI/endpoint mới; giữ bản Node tới khi thay xong | 1–3 | Mỗi script có tương đương và được kiểm chứng |
| F49 | Skill `business-rule-extractor` (Explore/Add/Find/Account/Run) đẩy rule/bug/tác vụ qua `qa-sync` | **[V]** (ngoài repo, qua artifact "Kho BR") | Giữ tích hợp: API mới nhận cùng định dạng dữ liệu (hoặc adapter) | 3–4 | Chạy Explore ⇒ rule + tác vụ nháp xuất hiện đúng chỗ (nháp, chờ duyệt) |
| F50 | Ghi tự động tác vụ nháp khi Explore (bộ nhớ "Explore ghi tác vụ") | **[V]** | Giữ: tác vụ vào `DRAFT` | 4 | Tác vụ do Explore tạo xuất hiện `DRAFT` |
| F51 | `packages/figma-adapter`, `packages/task-adapter`, `services/ai-service/test-plan-generator.js` | **[P]** (mã có; **không file nào trong `server.js`/scripts import**, chỉ test dùng `test-case-schema`) | Chưa quyết định; xác minh với chủ repo | 3–4 | Nếu không dùng thật ⇒ Gỡ; nếu dùng ngoài repo ⇒ Giữ ý tưởng |
| F52 | Phản hồi `/api/v1/health` | **[V]** (cứng `CONNECTED`) | Cải tiến (health thật) | 1 | Tắt DB ⇒ health báo lỗi |

## Chức năng mới (không có hiện trạng, [N])

| Chức năng | Phase |
|---|---|
| Reference Library 3 lớp, locator, annotation, xung đột | 3 |
| Lịch sử bug (`bug_snapshots`) | 3 |
| Flow Recorder → Flow Spec → Test Case → Code → Execution | 4 |
| Runner registration/heartbeat/claim/retry, Docker Runner | 4 |
| Artifact (screenshot/video/trace) | 4 |
| Lịch chạy, retry/failure handling | 4 |
| Lập chỉ mục + pgvector + truy xuất lai | 5 |
| Gợi ý flow/test bằng AI kèm duyệt | 5 |

## Quy tắc chuyển đổi

1. Mỗi chức năng có **bộ kiểm thử chấp nhận** viết **trước** khi thay (dựa trên hành vi bản Node).
2. Chạy song song (strangler): một trang chỉ chuyển sang hệ mới sau khi đạt cổng.
3. Chức năng chưa xác minh được (F51) hoặc quyết định sản phẩm (F04, F34, F47) được ghi vào danh sách quyết định đang chờ ở `IMPLEMENTATION_ROADMAP.md`.
