/**
 * Mã trạng thái và độ ưu tiên của task Haraworks, đối chiếu trực tiếp với mã giao diện tasks_client (17/11/2026):
 *  - trạng thái: enum New=0, Inprogress=1, Pending=2, Wait_For_Approval=3, Rejected=4, Completed=5, NeedApproval=6, NoneProcess=10, NotPerformed=11
 *    nhãn như giao diện hiển thị (Mới, Đang thực hiện, Tạm ngưng, Chờ duyệt, Từ chối, Hoàn thành, Không thực hiện)
 *  - độ ưu tiên: 1 và 2 hiện cờ "Ưu tiên cao", 3 "Ưu tiên", 4 "Không ưu tiên"
 * Khi Haraworks đổi phiên bản client, cần đối chiếu lại các bảng này.
 */
export const STATUS_LABELS = { 0: 'Mới', 1: 'Đang thực hiện', 2: 'Tạm ngưng', 3: 'Chờ duyệt', 4: 'Từ chối', 5: 'Hoàn thành', 6: 'Cần duyệt', 10: 'Không xử lý', 11: 'Không thực hiện' };
/** Trạng thái kết thúc: Hoàn thành và Không thực hiện */
export const CLOSED_STATUS = new Set([5, 11]);
export const PRIORITY_LABELS = { 1: 'Ưu tiên cao', 2: 'Ưu tiên cao', 3: 'Ưu tiên', 4: 'Không ưu tiên' };

export const statusLabel = s => (s == null ? '' : STATUS_LABELS[s] ?? `Trạng thái ${s}`);
export const priorityLabel = p => (p == null ? '' : PRIORITY_LABELS[p] ?? `Mức ${p}`);
/** Thứ tự sắp xếp: nhỏ là quan trọng hơn (cao, thường, không ưu tiên, chưa có) */
export const priorityRank = p => ({ 1: 0, 2: 0, 3: 1, 4: 2 })[p] ?? 3;

/** Ngày hiện tại theo giờ Việt Nam, dạng YYYY-MM-DD (so với ngày tạo bug) */
export function todayVN(now = Date.now()) {
  return new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
}
