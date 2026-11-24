"use client";

import { useEffect, useState } from "react";

type HelpTab = {
  key: string;
  label: string;
  title: string;
  summary: string;
  steps: string[];
  tips?: string[];
};

const HELP_TABS: HelpTab[] = [
  {
    key: "start",
    label: "Bắt đầu nhanh",
    title: "Tổng quan hệ thống QC Platform",
    summary:
      "QC Platform kết nối với Haraworks (chỉ đọc) để theo dõi tập trung 3 danh sách công việc (Bug, Task Function, Theo dõi Build), đồng thời cung cấp kho Nguồn tài liệu theo Module để tra cứu trích dẫn nguyên văn và bộ công cụ Automation Playwright.",
    steps: [
      "Bước 1 — Cấu hình kết nối: Vào Cài đặt → Tích hợp (Token & Cookie), dán Cookie phiên Haraworks (và Token Figma / Khóa AI nếu có) rồi bấm Lưu.",
      "Bước 2 — Đồng bộ dữ liệu: Bấm nút “Đồng bộ” duy nhất ở góc trên bên phải để kéo toàn bộ Bug, Task Function (kèm mô tả) và Theo dõi Build về hệ thống.",
      "Bước 3 — Nạp nguồn tài liệu theo Module: Vào Nguồn tài liệu, chọn đúng Module khi nạp file BA (.docx), Link Figma hoặc Wiki để phục vụ Tra cứu Bug.",
      "Bước 4 — Tra cứu & làm việc hằng ngày: Dùng Dashboard Cá Nhân để theo dõi Kanban/To-do, dùng Tra cứu Bug để đối chiếu chính xác với tài liệu nguồn.",
    ],
    tips: [
      "Mọi Cookie, Token và Mật khẩu Staging đều được mã hóa AES-256-GCM trong Vault (chỉ ghi, không hiển thị lại).",
      "Bạn có thể đổi chế độ Sáng/Tối ở nút trên thanh trên cùng hoặc trong Cài đặt → Chung.",
    ],
  },
  {
    key: "overview",
    label: "Dashboard Cá Nhân",
    title: "Dashboard Cá Nhân (/overview)",
    summary:
      "Không gian theo dõi nhanh tiến độ cá nhân và toàn nhóm, gom dữ liệu từ cả 3 danh sách (Bug, Task Function, Build).",
    steps: [
      "Thanh lọc trên cùng: Lọc theo từ khóa, Thời gian (Hôm nay / Tuần này / Tháng này), Dự án, Loại công việc (Bug / Function / Build) và Vai trò (Tôi thực hiện / Tôi duyệt).",
      "5 thẻ KPI: Hiển thị Tổng task cần làm, Mở quá 7 ngày, Tạo hôm nay, Bug chưa đủ thông tin và Mới trong 24h.",
      "Kanban Board: 4 cột theo trạng thái (Mới, Đang thực hiện, Tạm ngưng/Chờ duyệt, Hoàn thành). Bấm trực tiếp vào thẻ để mở Drawer xem chi tiết từ Haraworks.",
      "Gantt Chart & Biểu Đồ Phân Tích: Xem tiến độ ngang và biểu đồ tròn/cột phân bổ theo Trạng thái, Độ ưu tiên, Loại công việc, Chất lượng bug và Release.",
      "To-do & Note cá nhân: Quản lý danh sách việc cần làm (có ngày hạn) và nhiều Ghi chú riêng của tài khoản; bấm “+ Gán Task” để gắn trực tiếp 1 Bug / Function / Build vào việc cần nhớ.",
    ],
  },
  {
    key: "lookup",
    label: "Tra cứu Rule",
    title: "Tra cứu Rule & Trích xuất nguồn chính xác (/lookup)",
    summary:
      "Khi gặp một bug cần xác định đúng/sai so với thiết kế hoặc tài liệu BA, bạn dán mô tả bug vào đây để hệ thống tự nhận diện Module, phân tích luồng/chức năng liên quan và trích xuất NGUYÊN VĂN 100% đoạn quy định từ các nguồn + Bug cũ đã hoàn thành.",
    steps: [
      "Bước 1 — Nạp từ danh sách Bug (có nhãn Mới hôm nay) hoặc dán mô tả bug: hệ thống tự động tách tiền tố [MODULE] để chọn đúng Module.",
      "Bước 2 — Nhập Tên chức năng / Luồng ứng dụng liên quan (hoặc bấm Phân tích bằng AI để gợi ý tự động; nếu chưa có khóa AI hệ thống sẽ điều hướng sang Cài đặt → Tích hợp).",
      "Bước 3 — Chọn loại nguồn ở ô lọc sổ xuống (mặc định Tất cả loại nguồn, bao gồm cả Bug cũ đã hoàn thành) rồi bấm Tra cứu Rule.",
      "Bước 4 — Hệ thống chỉ trả kết quả thuộc đúng Module đã chọn; bấm Xem trực tiếp nguồn để mở tài liệu gốc, hoặc dùng biểu tượng Ghi chú / Lịch sử ở góc trên.",
    ],
  },
  {
    key: "sources",
    label: "Quản lý nguồn rule",
    title: "Quản lý nguồn rule theo Module (/sources)",
    summary:
      "Nơi nạp, chỉnh sửa, thay thế nội dung, xem trực tiếp và xóa các nguồn rule dùng cho chức năng Tra cứu Rule (Task Function được lấy trực tiếp từ danh sách đồng bộ).",
    steps: [
      "Nạp Tài liệu BA (.docx): Chọn Module từ danh sách sổ xuống, đặt tên nguồn, chọn file .docx rồi bấm Nạp tài liệu (ngày thêm được tự động dùng làm mốc phiên bản).",
      "Thêm nguồn Figma: Chọn Module, dán link Figma và/hoặc dán nội dung (chuột phải frame trên Figma → Copy/Paste as → Copy as CSS hoặc copy text), đồng thời có thể tải lên nhiều hình ảnh thiết kế.",
      "Thêm Wiki Rule: Chọn Module và upload tệp HTML / Markdown / Word / TXT của trang wiki.",
      "Xem & Sửa nguồn: Bấm “Xem nguồn” để xem toàn bộ tài liệu dạng preview sạch sẽ kèm tìm kiếm tự cuộn tới đúng chỗ; bấm “Sửa” để đổi thông tin hoặc thay thế luôn file/nội dung/hình ảnh đúng theo loại nguồn.",
    ],
  },
  {
    key: "lists",
    label: "3 Danh sách (Bug / Function / Build)",
    title: "Tra Cứu Bug · Task Function · Theo Dõi Build",
    summary:
      "3 danh sách chỉ hiển thị (đồng bộ trực tiếp từ Haraworks qua nút Đồng bộ trên cùng), giữ nguyên bố cục 7 cột và bảng màu theo Team/Dự án của bản cũ.",
    steps: [
      "Chỉ hiển thị Task cha ngoài danh sách: Toàn bộ task con được gom vào bên trong Drawer khi bạn bấm vào task cha, giúp danh sách gọn và không bị rối.",
      "Tìm kiếm, Sắp xếp & Bộ lọc: Dùng ô tìm kiếm, chọn sắp xếp (⇅) hoặc bấm nút “Bộ lọc” để mở khung lọc 4 cột (Bug có 9 bộ lọc, Task Function 6 bộ lọc, Theo dõi Build 6 bộ lọc).",
      "Ngăn chi tiết (Drawer trượt bên phải): Bấm vào bất kỳ dòng nào để xem đầy đủ mô tả, ảnh/video/file đính kèm, danh sách Task con, lịch sử cập nhật và toàn bộ Bình luận/Reply từ Haraworks.",
      "Dò đợt Build: Trong Drawer của Bug và Task Function có nút “Kiểm tra đợt build” để dò xem task đã nằm trong đợt Build App Mobile hay Build Task Function nào chưa. Ngược lại, trong Drawer của Build sẽ hiển thị Task Function nguồn.",
    ],
  },
  {
    key: "env",
    label: "Môi trường & Tài khoản",
    title: "Môi trường & Tài khoản test (/environments)",
    summary:
      "Quản lý các môi trường kiểm thử (Staging, Production…) và bộ tài khoản test phục vụ chạy Automation.",
    steps: [
      "Thêm Môi trường: Chọn loại STAGING (để được phép chạy Automation), nhập URL chính, URL đăng nhập và mã Org (nếu trang đăng nhập có bước nhập mã công ty).",
      "Thêm Tài khoản test: Gắn với môi trường tương ứng, nhập tên đăng nhập và vai trò (ví dụ: Quản trị, Nhân viên…).",
      "Nhập mật khẩu: Nhập vào ô “Mật khẩu mới” rồi Lưu. Mật khẩu được mã hóa trong Vault và chỉ cấp 1 lần cho Runner khi thực thi, không bao giờ hiện lại trên web.",
    ],
  },
  {
    key: "automation",
    label: "Tác vụ tự động · Ghi luồng · Runner",
    title: "Kiểm thử tự động Playwright (/automation · /flows · /runners)",
    summary:
      "Tạo, ghi lại thao tác và chạy kịch bản kiểm thử tự động trên Chrome thật qua Host Runner (hoặc Docker Runner).",
    steps: [
      "Runner (/runners): Tạo một Runner loại Host để lấy token (rn_..., chỉ hiện 1 lần), sau đó chạy lệnh node dist/index.js trong thư mục apps/runner-agent trên máy Windows của bạn.",
      "Ghi luồng (/flows): Chạy lệnh node dist/recorder.js với biến QC_RECORD_URL, thao tác trên trình duyệt (mật khẩu không bao giờ bị ghi), đóng trình duyệt rồi tải file recording.json lên trang Ghi luồng để sinh kịch bản tự động.",
      "Tác vụ tự động (/automation): Xem danh sách kịch bản kèm nhãn Module và ngày tạo. Bấm “Chi tiết” để chỉnh tham số, bấm “Kích hoạt vX” cho phiên bản code muốn dùng rồi bấm “Xếp hàng chạy” (hoặc đặt lịch chạy định kỳ).",
    ],
  },
  {
    key: "settings",
    label: "Cài đặt",
    title: "Trang Cài đặt gom nhóm (/settings)",
    summary:
      "Tất cả thiết lập cá nhân và hệ thống đều tập trung tại 1 trang chia 5 mục bên trái:",
    steps: [
      "Tài khoản: Xem thông tin tài khoản QC đang đăng nhập và đổi mật khẩu (yêu cầu ≥ 12 ký tự).",
      "Chung (Giao diện & Màu): Chuyển Sáng/Tối và tùy chỉnh màu sắc cho từng Dự án và từng nhãn Module (đồng bộ trên toàn bộ các trang).",
      "Tích hợp (Token & Cookie): Nhập Cookie Haraworks (có nút Kiểm tra kết nối), Token Figma và Khóa AI (Gemini / Anthropic).",
      "Người dùng QC: Tạo mới hoặc khóa/mở khóa tài khoản thành viên QC trong nhóm.",
      "Nhật ký hoạt động: Xem lịch sử thao tác hệ thống (append-only, đã che bí mật).",
    ],
  },
];

export function HelpModal({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState("start");
  const cur = HELP_TABS.find((t) => t.key === active) || HELP_TABS[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Hướng dẫn sử dụng QC Platform">
      <div className="modal-box" style={{ maxWidth: 920 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong style={{ fontSize: 15 }}>Hướng dẫn sử dụng từng menu — QC Platform</strong>
          <button className="sm" onClick={onClose}>Đóng ✕</button>
        </div>
        <div className="modal-body">
          <div className="subtabs" style={{ marginBottom: 14 }}>
            {HELP_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`subtab${t.key === active ? " active" : ""}`}
                onClick={() => setActive(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <h3 style={{ margin: "0 0 6px", fontSize: 16 }}>{cur.title}</h3>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13.5 }}>{cur.summary}</p>

          <div className="card" style={{ background: "var(--panel-alt)", marginBottom: 10 }}>
            <div className="card-title">Cách hoạt động & Thao tác</div>
            <ul style={{ margin: "4px 0 0 18px", padding: 0, lineHeight: 1.7 }}>
              {cur.steps.map((s, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{s}</li>
              ))}
            </ul>
          </div>

          {cur.tips && cur.tips.length > 0 && (
            <div className="notice">
              <strong>Lưu ý:</strong>
              <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
                {cur.tips.map((tip, i) => <li key={i}>{tip}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
