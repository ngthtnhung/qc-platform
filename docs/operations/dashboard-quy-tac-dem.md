# Dashboard: quy tắc đếm và hiển thị

Áp dụng cho trang **Dashboard** (5 thẻ số và 4 cột Kanban). Nguồn dữ liệu: `GET /api/v1/my-tasks` trong `services/api/server.js`, hiển thị ở `apps/web/app.js` (phần Dashboard Cá Nhân). Cập nhật lần cuối 24/11/2026.

Mọi mốc ngày tính theo giờ Việt Nam (Asia/Ho_Chi_Minh). Dữ liệu tự làm mới 30 giây một lần, hoặc bấm **Đồng bộ**.

## 1. Task nào được đưa vào Dashboard

Server quét ba loại công việc rồi giữ lại những task thuộc về người đang đăng nhập.

| Loại | Nhận khi | Vai trò hiển thị |
|---|---|---|
| Bug | Bạn là người thực hiện hoặc người duyệt | Tôi thực hiện / Tôi duyệt |
| Task Function (task con có tiền tố QC) | Bạn là người thực hiện | Tôi thực hiện |
| Release Function (dự án HRWs - RELEASE CHECKLIST) | Bạn là người thực hiện | Tôi thực hiện |

- Nhận ra "bạn" bằng mã nhân viên Haraworks và tên hiển thị (không phân biệt hoa thường và dấu). Chưa cài mã nhân viên thì chỉ dò theo tên, có thể sót; Dashboard sẽ báo.
- Task có trạng thái **Không xử lý (10)** hoặc **Không thực hiện (11)** không bao giờ hiện.
- Task **đóng** là Hoàn thành (5) hoặc Không thực hiện (11).

### Bộ lọc thời gian (Tuần này, Tháng này, 30 ngày, năm, Tất cả)
Lọc theo **ngày tạo**. Ba ngoại lệ, những task này luôn hiện dù ngày tạo nằm ngoài khoảng:
1. Task chưa đóng đã **trễ hạn** hoặc **hết hạn hôm nay** (sửa ngày 24/11/2026; trước đó bug tạo từ tuần trước bị ẩn khỏi mục Trễ hạn).
2. Release Function chưa đóng có hạn hoặc ngày bắt đầu từ hôm nay trở đi.
3. Cột TO DO và Gantt tự lấy theo quy tắc riêng bên dưới.

Sau đó, ô lọc Dự án, Loại, Trạng thái cảnh báo và ô tìm kiếm trên Dashboard cắt tiếp danh sách. Số trên các thẻ và cột đều tính **sau** các bộ lọc này.

## 2. Năm thẻ số

| Thẻ | Đếm những task | Ghi chú |
|---|---|---|
| **Tổng task cần làm** (phụ đề "Trong hôm nay (Tổng lọc: N)") | Chưa đóng và "cần làm hôm nay" (xem dưới) | N là tổng số task sau lọc, kể cả đã đóng |
| **Trễ hạn** | Chưa đóng, ngày hạn (`plan_end_at`) trước hôm nay | Task không có hạn thì không bao giờ trễ hạn |
| **Hết hạn hôm nay** | Chưa đóng, ngày hạn đúng hôm nay | |
| **Bug chưa đủ thông tin** | Chỉ Bug, thiếu ít nhất một trong 5 trường | Khách hàng, Ứng dụng (module), Nền tảng, Phân loại, Độ nghiêm trọng |
| **Gán mới trong 24h** | Chỉ Bug bạn là người thực hiện, tạo trong 24 giờ gần nhất | Không loại task đã đóng |

"Cần làm hôm nay" theo loại:
- **Bug:** chưa đóng và (trễ hạn, hoặc bạn là người thực hiện, hoặc bạn là người duyệt và hôm nay nằm trong khoảng thực hiện).
- **Task Function:** chưa đóng và (trễ hạn, hoặc hôm nay nằm trong khoảng thực hiện).
- **Release Function:** chưa đóng, có ngày bắt đầu hoặc hạn, và (trễ hạn hoặc hôm nay nằm trong khoảng thực hiện). Release không có ngày nào thì không đếm.

"Hôm nay nằm trong khoảng thực hiện": có cả ngày bắt đầu và hạn thì bắt đầu ≤ hôm nay ≤ hạn; chỉ có hạn thì hôm nay ≤ hạn; chỉ có ngày bắt đầu thì bắt đầu ≤ hôm nay; không có ngày nào thì tính theo ngày tạo bằng hôm nay.

Bấm vào thẻ để mở danh sách đúng các task đã đếm. Thẻ Trễ hạn, Hết hạn hôm nay cũng có trong ô lọc "Trạng thái cảnh báo".

## 3. Bốn cột Kanban

| Cột | Trạng thái | Phạm vi |
|---|---|---|
| **TO DO · MỚI** | Mới (0) | Chưa đóng, và hạn từ hôm nay trở đi (hoặc ngày bắt đầu từ hôm nay, hoặc không có ngày nào nhưng tạo từ hôm nay), **hoặc đã trễ hạn**. Không bị bộ lọc thời gian giới hạn. Sắp xếp ngày tạo mới nhất trước, rồi ưu tiên cao trước |
| **IN PROGRESS · ĐANG THỰC HIỆN** | Đang thực hiện (1) | Theo bộ lọc thời gian |
| **TẠM NGƯNG** | Tạm ngưng (2), Chờ duyệt (3), Từ chối (4), Cần duyệt (6) | Theo bộ lọc thời gian. Task bạn duyệt ở trạng thái Chờ duyệt nằm ở cột này |
| **HOÀN THÀNH** | Hoàn thành (5) | Theo bộ lọc thời gian (ngày tạo) |

Mỗi thẻ task hiện: loại (BUG, FUNCTION, RELEASE), vai trò, module, nhãn "Ưu tiên cao" hoặc "Ưu tiên", hạn (đỏ "Quá hạn: ngày" khi trễ, "🔥 Hạn hôm nay"), và dải cảnh báo "Chưa điền" cho Bug thiếu trường.

## 4. Lỗi đã sửa liên quan

- **Task bạn duyệt trễ hạn không hiện** (24/11/2026): bộ lọc thời gian mặc định "Tuần này" tính theo ngày tạo nên loại bug tạo từ trước đó, dù đã trễ hạn. Nay task chưa đóng đã trễ hạn hoặc hết hạn hôm nay luôn được đưa vào.
- **Task Mới đã trễ hạn không nằm ở cột nào** (cùng ngày): cột TO DO chỉ lấy từ hôm nay trở đi nên task Mới trễ hạn được đếm ở thẻ Trễ hạn nhưng không có trên bảng. Nay cột TO DO gồm cả các task này.

## 5. Điểm cần biết

- Trạng thái Chờ duyệt, Từ chối, Cần duyệt gộp chung cột "TẠM NGƯNG"; muốn tách cột cần đổi thiết kế.
- Thẻ "Gán mới trong 24h" không loại task đã đóng.
- Hạn (`plan_end_at`) lấy từ Haraworks; task không đặt hạn sẽ không bao giờ vào Trễ hạn.
