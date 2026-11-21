# Mô hình duyệt và phân quyền (Approval & Authorization Model)

> **Quyết định của chủ sản phẩm (2026-11-21), thay thế mọi nội dung trái ngược trong các tài liệu Phase 0:**
> 1. Mọi sản phẩm hoặc hành động do AI tạo ra (tài liệu, business rule, test case, code automation, đề xuất chạy/ghi, …) **chỉ có đúng một vai trò được duyệt: QC**.
> 2. QC là người dùng chính của platform. Nhóm có **4 QC, quyền hạn tương đương nhau** trên toàn hệ thống. Không có vai trò admin riêng, không có QC "cấp cao".
> 3. AI, hệ thống (SYSTEM), runner không bao giờ duyệt, kể cả gián tiếp.

Trạng thái: **[V] Verified in implementation** cho các điểm ghi rõ "đã có test" (xem `apps/api/tests/`).

## 1. Chủ thể (Principal)

| Loại | Ai | Được duyệt? | Được đọc bí mật? |
|---|---|---|---|
| `USER` vai trò `qc` | 4 QC | **Có** | Có (có audit) |
| `AI` | nhà cung cấp AI, worker sinh nội dung | Không | Không |
| `SYSTEM` | beat, importer, CLI | Không | Không |
| `RUNNER` | Host/Docker Runner (Phase 4) | Không | Chỉ bí mật của phiên được cấp, có audit |

## 2. Vai trò

- Chỉ có một vai trò: `qc`. Tập quyền của `qc` là **toàn bộ** quyền (`Perm` trong `app/core/principal.py`): quản lý người dùng, môi trường, ghi bí mật, duyệt, đọc audit, file, đọc đề xuất AI.
- Ràng buộc **ở mức CSDL**: `users.role` có `CHECK (role IN ('qc'))`. Thêm vai trò khác đòi một migration có chủ đích và một quyết định mới.
- Hệ quả: một QC có thể thêm, vô hiệu hóa, đặt lại mật khẩu QC khác. Hệ thống chặn vô hiệu hóa QC hoạt động cuối cùng (không để khóa chính mình).
- Mọi thao tác nhạy cảm đều có audit gắn với từng QC cụ thể, nên "ngang quyền" không có nghĩa là "không truy vết".

## 3. Vòng đời sản phẩm AI

```
AI tạo ──► ai_suggestions (PROPOSED) + approval_requests (PENDING, origin=ai)
                        │
          QC xem đúng bản (payload_hash)
                        │
        ┌───────────────┴────────────────┐
   Duyệt (APPROVED)               Từ chối (REJECTED, bắt buộc có lý do)
   ai_suggestions → ACCEPTED      ai_suggestions → REJECTED
   hook của miền nghiệp vụ chạy   (không có hiệu lực nghiệp vụ)
   trong CÙNG giao dịch
```

Quy tắc thực thi (đều đã có test trong `tests/test_approvals.py`):

| # | Quy tắc | Cơ chế |
|---|---|---|
| R1 | AI chỉ đưa sản phẩm vào hệ thống qua `create_ai_suggestion`; luôn `PROPOSED` + một yêu cầu duyệt chờ | Điểm vào duy nhất; USER bị từ chối dùng hàm này |
| R2 | Chỉ USER vai trò `qc` có quyền `approvals.decide` mới `decide` được | Kiểm tra đầu tiên trong `approvals.decide`; AI/SYSTEM/RUNNER bị từ chối, **ghi audit DENY** |
| R3 | Cả 4 QC duyệt được mọi yêu cầu, kể cả yêu cầu do chính QC đó tạo (nhóm đã chốt ngang quyền); mọi quyết định có audit | Test 4 QC; `decided_by_id` luôn là một người |
| R4 | Người duyệt gửi `payload_hash` của đúng bản đã đọc; nội dung đã đổi ⇒ từ chối `PAYLOAD_CHANGED` | Tương tự ghim SHA của code tác vụ trong bản Node |
| R5 | Quyết định cuối (APPROVED/REJECTED) bất biến | Trạng thái ≠ PENDING ⇒ 409 |
| R6 | Từ chối phải ghi lý do | `NOTE_REQUIRED` |
| R7 | Mỗi đối tượng chỉ có một yêu cầu duyệt đang chờ | Unique partial index `uq_approval_one_pending_per_subject` |
| R8 | Bản ghi đã quyết định luôn có người quyết định | `CHECK decision_has_human` + FK `decided_by_id → users` (mà `users.role` luôn là `qc`) |
| R9 | Hành động `APPROVE/REJECT/CONFIRM_ORG/TASK_WRITE` qua PolicyEngine chỉ QC (người) làm được | `policy.evaluate_action` |

## 4. Phạm vi áp dụng theo loại sản phẩm

| Loại sản phẩm do AI tạo | Subject type | Khi QC duyệt thì… | Phase |
|---|---|---|---|
| Đề xuất bất kỳ (tài liệu, rule, test, hành động) | `ai_suggestion` | `ACCEPTED` (đã có) | 2 ✔ |
| Business rule / reference | `rule_version`, `reference` | rule `active` / reference `VALIDATED` (hook đăng ký bằng `register_hook`) | 3B |
| Test case, flow spec | `test_case_version`, `flow_spec_version` | `APPROVED` | 4 |
| Code automation (kể cả bản sửa lỗi bằng AI) | `automation_code_version` | `APPROVED`, ghim `sha256`; Runner chỉ nhận bản `APPROVED` | 4 |
| Hành động có tác dụng phụ (chạy trên môi trường, ghi dữ liệu) | `action_request` | cho phép thực thi **một lần**, qua PolicyEngine | 4 |
| Phân tích bug AI | `ai_analysis` | `REVIEWED` | 3A |

Quy ước cho miền nghiệp vụ mới: **không** tự đặt cờ "approved"; chỉ đăng ký hook trên `approvals.register_hook(subject_type, fn)`; trạng thái đã duyệt chỉ đổi trong hook, tức là trong cùng giao dịch với quyết định của QC.

## 5. Tác động lên tài liệu Phase 0 (đã cập nhật)

| Tài liệu | Thay đổi |
|---|---|
| ARCHITECTURE_GAP_ANALYSIS (G1, #8, #18) | G1 **đã chốt**: không còn tự duyệt, không có "duyệt ngầm" |
| TARGET_ARCHITECTURE (Core/RBAC) | RBAC một vai trò `qc`; bỏ `organizations` ở giai đoạn này |
| DATABASE_MIGRATION_PLAN (Core) | `users.role CHECK qc`; không bảng `roles/permissions/user_roles` ở giai đoạn này |
| DATA_MIGRATION_MATRIX (M-01, M-12) | Mọi người dùng cũ → `qc`; tác vụ import chờ QC duyệt |
| FEATURE_PRESERVATION_MATRIX (F02, F34) | F02 đơn giản hóa; F34 **Gỡ** tự duyệt |
| SECURITY_REVIEW (3.2) | Quy tắc cứng: chỉ QC duyệt |
| IMPLEMENTATION_ROADMAP | G1 hết "đang chờ" |

## 6. Hệ quả cho bản Node hiện tại

Bản Node vẫn tự duyệt tác vụ (`autoApprove`) cho tới khi trang Tác Vụ Tự Động chuyển sang hệ mới (Phase 4). Nó **không bị sửa** ở bước này (giữ nguyên chức năng đang dùng). Khi nhập 30 tác vụ hiện có vào hệ mới (M-12), chúng vào trạng thái chờ QC duyệt; QC có thể duyệt hàng loạt sau khi đọc.

## 7. Giới hạn đã biết

- Cho phép QC tự duyệt đề xuất do chính mình yêu cầu (theo quyết định "ngang quyền"). Nếu sau này cần nguyên tắc hai người (four-eyes) cho một số loại, thêm ở tầng chính sách theo loại subject, không đổi mô hình vai trò.
- Chưa có hạn chót/hết hạn cho yêu cầu duyệt, chưa có thông báo cho QC khi có yêu cầu mới (Phase 3).
- Quyền chỉ ở mức vai trò toàn cục; phạm vi theo module không có (không cần khi 4 QC ngang quyền).
