# Internal AI QA Testing Platform (MVP v1.0)

Hệ thống nền tảng kiểm thử tự động nội bộ ứng dụng AI, được thiết kế theo đúng tài liệu kiến trúc kỹ thuật (System Design v1.0, 25/10/2026).

---

## 🌟 Tính Năng Nổi Bật

1. **Quản lý Môi trường & Cổng Kiểm Soát Org Test (Org Confirmation Gate)**:
   - Quản lý đa môi trường: `STAGING`, `PRODUCTION_TEST`, `TASK_SYSTEM`, `PRODUCTION`.
   - **Fail-Closed Security Gate**: Kiên quyết chặn mọi thao tác chạy automation trên môi trường `PRODUCTION_TEST` cho đến khi QC nhấn nút **[✓ Xác Nhận Đúng Org Test]**.
   - Mở cửa sổ Chrome độc lập và hỗ trợ tự động điền form đăng nhập theo đúng tài khoản và vai trò.
2. **Phân Tích Bug Khách Hàng Bằng AI Grounded & RAG**:
   - Kiểm tra các trường thông tin bắt buộc, tự động cảnh báo thiếu thông tin cần CX bổ sung.
   - Tìm kiếm và trích dẫn trực tiếp các quy tắc nghiệp vụ từ cơ sở tri thức (RAG Chunks & Citations).
   - Đề xuất các bước tái hiện và cho phép lưu thành **Bug Procedure** có version để Replay.
3. **Kế Hoạch Test Function 16 Cột Chuẩn**:
   - AI đọc mô tả tính năng từ PO và link Figma (Figma URL & node id).
   - Tự động sinh bộ Test Plan tuân thủ nghiêm ngặt **16 cột theo Section 5.5**:
     `Link Task | ID | Test Type | Platform | Test objective | Module | Screen | Functional | Steps | Account | Precondition / Test Data | Expected Result | Actual Result | Image / Video | Status | Note`
   - Hỗ trợ đầy đủ các kịch bản của module **Bảo trì**: 4 mức ưu tiên, mapping dữ liệu cũ, view xem ẩn độ ưu tiên, hiển thị icon trên Desktop & Mobile, thiết lập mặc định và migration function.
   - QC có quyền Sửa, Xóa, Thêm case và bấm **[✓ QC Duyệt Kế Hoạch]**.
4. **Thực Thi Kiểm Thử (Checklist) & Tự Động Log Bug**:
   - Bảng checklist tương tác: Pass, Fail, Reset, ghi chú lỗi thực tế, đính kèm ảnh/video.
   - Bấm **[✓ Hoàn Tất Test & Tự Động Tạo Bug Subtasks]**: Gom toàn bộ case FAIL thành danh sách bug ticket chuẩn `[BUG] <Mô tả lỗi>`.
   - Gán đúng Dev PIC (`Lê Vĩnh Ngọc Châu`), tính toán hạn hoàn thành theo SLA ngày, reviewer QC, các bước tái hiện và bằng chứng đính kèm.
   - Đồng bộ sang hệ thống task với khóa **Idempotency-Key** chống trùng lặp và xác thực trạng thái từ xa (**Remote State Verification**).
5. **Bảo Vệ Dữ Liệu & Redaction**:
   - Bộ lọc `Redactor` tự động làm sạch token, session cookies, mật khẩu và dữ liệu nhạy cảm trước khi lưu vào log hoặc database.

---

## 🏗️ Cấu Trúc Thư Mục

```text
qa-platform/
├── apps/
│   ├── web/                         # QA Web Dashboard (Vanilla HTML5 / CSS Pastel / JS)
│   └── chrome-extension/            # Chrome Extension Companion (Client tiện ích)
├── services/
│   ├── api/                         # Backend RESTful API Server (Port 3001)
│   ├── workflow-orchestrator/       # 4 State Machines & Checkpoint Idempotency Manager
│   ├── ai-service/                  # RAG Engine, Bug Analyzer, Test Plan Generator
│   └── automation-runner/           # Playwright Context Runner & Org Gate
├── packages/
│   ├── policy-engine/               # Security Policies & Approval Matrix
│   ├── diagnostics/                 # Sensitive Data Redactor & Collector
│   ├── test-case-schema/            # 16-Column Template Validator & Markdown Exporter
│   ├── task-adapter/                # Task System Connector (Jira / Haraworks)
│   └── figma-adapter/               # Figma Link & Metadata Parser
├── database/
│   ├── schema.sql                   # 19 Relational Database Tables
│   ├── seeds.sql                    # Initial seed data
│   └── db.js                        # Transactional Database Client & Repositories
├── tests/
│   ├── policy-engine.test.js        # Policy Engine & Org Gate tests
│   ├── state-machine.test.js        # State Machine & Idempotency tests
│   ├── test-case-schema.test.js     # 16-Column Schema tests
│   └── run-all-tests.js             # Automated Test Runner
├── start-platform.bat               # 1-click startup on Windows
└── start-platform.ps1               # PowerShell startup script
```

---

## 🚀 Hướng Dẫn Khởi Chạy

### Cách 1: Chạy Bằng PowerShell / Batch
1. Chạy file `start-platform.ps1` hoặc double-click `start-platform.bat`.
2. Mở trình duyệt và truy cập: **`http://localhost:3001`**.

### Cách 2: Chạy Thủ Công Qua Terminal
```powershell
node services/api/server.js
```
Truy cập Web Dashboard tại: `http://localhost:3001`.

---

## 🧪 Chạy Kiểm Thử Tự Động (Automated Tests)

```powershell
node tests/run-all-tests.js
```
Kết quả kiểm thử:
- ✓ Policy Engine Tests: Missing actor rejected, AI self-approval blocked, Production-test org gate blocked/allowed, Production destructive writes blocked.
- ✓ State Machine Tests: Legal & illegal transitions, Idempotent keys, Checkpoint resume.
- ✓ 16-Column Schema Tests: Exact 16 columns validated, invalid status rejected, Markdown table export verified.

---

## Kho Business Rule

Tab 5 hien thi rule da xac nhan tu artifact 'Kho Business Rule Haraworks' (read-only). Dong bo: xuat DB artifact vao database/kb-snapshot/ roi chay `node scripts/sync-business-rules.mjs`. API: GET /api/v1/business-rules?module=&q=. RAG phan tich bug tu dong trich dan rule (nguon '[Kho BR]').

## Dang nhap tu dong bang Playwright

Bam 'Mo Browser & Dang Nhap' tren tai khoan: QA Launcher (apps/launcher) mo Chrome rieng tren may ban (profile o ~/.qa-launcher/profiles); chay: node apps/launcher/launcher.js --server http://localhost:3001, tu dien ma cong ty, ten dang nhap, mat khau.
Mat khau luu ma hoa (AES-256-GCM, khoa boc bang Windows DPAPI) trong secrets/vault.json, chi cho Staging va Production OrgID DEMO. Dat mat khau bang nut 'Dat mat khau' tren the tai khoan hoac o mat khau khi them tai khoan. Khong API nao tra mat khau ve giao dien. Production chi doc: khong luu mat khau, chan request ghi. Gap CAPTCHA/OTP thi dung cho ban.
Nhap file secrets/credentials.json cu vao kho: node scripts/import-credentials.mjs


## Dung chung cho nhom

Xem docs/operations/team-deployment.md (server noi bo + QA Launcher tren may tung nguoi + day rule len server).

## Tab sau khi doi

1 Tai khoan va Moi truong, 2 Phan tich Bug (tu tim rule va bug cu khi go mo ta), 3 Bug Cu (6.059 bug tu Kho Business Rule), 4 Kho Business Rule, 5 Tac vu Tu dong. Da go tab Ke hoach test 16 cot va Thuc thi test; cac route /test-plans va /integrations/task-system/bug-subtasks da bo. Dong bo bug: node scripts/sync-bugs.mjs.

## Rule chinh tren platform

Tab 4 cho them/sua/xoa rule (quyen le rules_edit). Thay doi luu rieng o database/business_rules_local.json, dong bo tu Kho khong ghi de va khong tu ghi nguoc ve Kho. Rule tao tren platform co ma dang DV5S-P001. Trang Phan quyen (admin) va nut ? huong dan nam tren giao dien.
