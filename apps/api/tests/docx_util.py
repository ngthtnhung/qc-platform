"""Tạo file .docx thật (zip + XML Word) để test bộ phân tích mà không cần thư viện ngoài."""
from __future__ import annotations

import zipfile
from io import BytesIO
from xml.sax.saxutils import escape

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>"""


def p(text: str, style: str | None = None, runs: list[str] | None = None) -> str:
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    parts = runs if runs is not None else [text]
    body = "".join(f'<w:r><w:t xml:space="preserve">{escape(t)}</w:t></w:r>' for t in parts)
    return f"<w:p>{ppr}{body}</w:p>"


def table(rows: list[list[str]]) -> str:
    trs = "".join("<w:tr>" + "".join(f"<w:tc>{p(c)}</w:tc>" for c in r) + "</w:tr>" for r in rows)
    return f"<w:tbl>{trs}</w:tbl>"


def make_docx(*blocks: str) -> bytes:
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}"><w:body>{"".join(blocks)}</w:body></w:document>'
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", doc)
        z.writestr("word/styles.xml", STYLES)
    return buf.getvalue()


BA_DOC = make_docx(
    p("Yêu cầu bảo trì", "Heading1"),
    p("3. Danh sách xử lý phiếu", "Heading2"),
    p("Người dùng được truy cập trang Danh sách xử lý phiếu khi thuộc danh sách xử lý phiếu hoặc có quyền Quản trị toàn hệ thống."),
    p("Độ ưu tiên mặc định của phiếu mới tạo là Trung bình; không còn mức Không ưu tiên."),
    p("3.4 Bộ lọc", "Heading2"),
    table([["Tiêu chí", "Quy tắc"], ["Độ ưu tiên", "Lọc theo bốn mức: Thấp, Trung bình, Cao, Khẩn cấp"], ["Trạng thái", "Lọc theo trạng thái xử lý phiếu"]]),
    p("", runs=["Phiếu quá hạn ", "được tô đỏ ", "trên danh sách."]),
)
