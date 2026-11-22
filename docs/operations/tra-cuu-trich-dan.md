# Tra cứu trích dẫn theo mô tả bug

Thay cho việc "lưu business rule rồi tra": QC nhập **mô tả bug**, hệ thống tách từ khóa và **trích nguyên văn** từ các nguồn đã nạp, kèm vị trí để đối chiếu. Không có AI viết lại hay tóm tắt nội dung.

## 1. Bốn loại nguồn

| Nguồn | Cách nạp (trang **Nguồn tài liệu**) | Được tách thành | Vị trí ghi lại |
|---|---|---|---|
| **Tài liệu BA** (.docx) | Upload tệp | Tiêu đề, đoạn văn, hàng bảng | đường dẫn tiêu đề, dòng, đoạn, bảng/hàng, ký tự (khi đoạn dài bị cắt) |
| **Link Figma** | Dán link; hệ thống đọc chữ trong thiết kế bằng **token Figma** (mục Tích hợp), hoặc bạn dán văn bản/chú thích | Mỗi nút TEXT một đoạn | node Figma, đường dẫn Frame, link tới node |
| **Mô tả Task Function** (toàn bộ danh sách) | Nạp `functions-live.json` (tên + thuộc tính), rồi **Đồng bộ mô tả** lấy mô tả đầy đủ từ Haraworks bằng **cookie Haraworks** (chỉ đọc) | Mỗi task một đoạn (tên + mô tả) | mã task, link task, module/khách hàng/nền tảng/build |
| **Wiki rule chạy thực tế trên code** | Upload tệp wiki đã lưu (.html/.md/.txt/.docx); tải từ URL chỉ bật khi admin đặt `WIKI_FETCH_ALLOWED_HOSTS` | Tiêu đề, đoạn, hàng bảng, khối code | đường dẫn tiêu đề, anchor, dòng, bảng/hàng |

Bí mật (cookie Haraworks, token Figma) chỉ ghi, lưu mã hóa trong vault, không bao giờ hiển thị lại.

## 2. Phiên bản
- Nạp lại **cùng tên** nguồn = thêm **phiên bản mới** (đặt nhãn hoặc để tự động v1, v2…). Tệp giống hệt phiên bản đã nạp thì không tạo mới.
- Tra cứu mặc định chỉ dùng phiên bản **mới nhất** (đoạn hiện hành). Tích "gồm phiên bản cũ" qua API (`include_old_versions`) để đối chiếu bản cũ.
- Task Function là nguồn "sống": đoạn nào đổi nội dung thì đoạn cũ ngưng hiện hành, đoạn mới thay thế.
- "Ngừng dùng" một nguồn: không còn xuất hiện trong tra cứu; dữ liệu và các tra cứu đã lưu vẫn được giữ.

## 3. Cách tra cứu hoạt động
1. Tách từ khóa từ mô tả: chuỗi trong ngoặc kép, định danh (`MAINT-502`, `[FUNCTION]`), cụm từ liền nhau trong cùng mệnh đề (ví dụ "độ ưu tiên mặc định"), và từ đơn. Từ dừng bị bỏ; từ quá phổ biến trong kho bị bỏ.
2. Tìm không phân biệt dấu/hoa thường, rồi chấm điểm kiểu BM25: từ hiếm có trọng số cao, mỗi từ chỉ tính một lần, cụm dài nhất khớp được thưởng thêm, đoạn khớp nhiều từ khóa khác nhau được ưu tiên. Đoạn chỉ khớp **một từ đơn lẻ** (khi mô tả có nhiều từ khóa) bị loại.
3. Kết quả gom theo loại nguồn (mỗi loại tối đa 5 đoạn, chỉnh được), mỗi trích dẫn có: nguyên văn đoạn, vị trí, nguồn + phiên bản, các từ khớp được tô sáng, nút **Sao chép trích dẫn** và **Xem ngữ cảnh** (các đoạn liền kề, vẫn nguyên văn).

## 4. Cam kết "nguyên văn"
- Văn bản lưu = văn bản trích xuất, chỉ chuẩn hóa Unicode NFC và khoảng trắng (không sửa chữ). Đoạn dài bị cắt có `char_start/char_end` trong đoạn gốc.
- `excerpt` luôn là chuỗi con chính xác của `quote` (có `start/end` để kiểm chứng); test tự động kiểm điều này.
- Mỗi lần tra cứu được lưu (mô tả, từ khóa, ảnh chụp trích dẫn, ghi chú) để xem lại dù nguồn đổi phiên bản sau này.

## 5. Giới hạn cần biết
- Chất lượng phụ thuộc vào việc nguồn **có chứa** nội dung liên quan. Danh sách Task Function chưa có mô tả (chỉ tên) thì ít khi chứa quy tắc nghiệp vụ; hãy đồng bộ mô tả.
- Tìm theo **từ khóa**, chưa hiểu ngữ nghĩa (đồng nghĩa, diễn đạt khác). Muốn bắt được cách diễn đạt khác, mô tả bug nên dùng đúng thuật ngữ của nguồn (tên màn hình, tên trường, tên chức năng). Tìm theo ngữ nghĩa (vector) là bước sau.
- Docx: chưa đọc hộp văn bản, chú thích (comment), đầu/chân trang, và số thứ tự tự động của tiêu đề Word (ví dụ "3.4.5" do Word tự đánh số không có trong tệp); vị trí dùng đường dẫn tiêu đề + số dòng/đoạn.
- Figma và Haraworks **chưa được kiểm chứng với dịch vụ thật** (cần token/cookie của bạn); đã kiểm thử bằng máy chủ giả.

## 6. Xử lý sự cố
| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| "Chưa nạp nguồn loại: …" | Loại nguồn đó chưa có đoạn nào |
| "Không có đoạn nào khớp từ khóa" | Thêm từ khóa theo cách nguồn viết (tên màn hình, tên trường) |
| Thêm Figma báo `NO_FIGMA_CONTENT` | Chưa có token Figma và chưa dán văn bản |
| Đồng bộ mô tả báo `NO_COOKIE` / `HARAWORKS_AUTH` | Chưa cấu hình hoặc cookie Haraworks hết hạn: dán cookie mới ở mục Tích hợp |
| Tải wiki báo `WIKI_FETCH_DISABLED` | Admin chưa đặt `WIKI_FETCH_ALLOWED_HOSTS`; hãy upload tệp đã lưu |
