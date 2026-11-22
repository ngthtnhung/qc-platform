"""Tách nguồn thành đoạn trích NGUYÊN VĂN kèm vị trí. Không diễn giải, không tóm tắt, không dịch.

Quy ước vị trí (locator):
  - line:        số thứ tự dòng trong văn bản đã trích xuất (mỗi đoạn văn / hàng bảng / dòng là một dòng; bắt đầu từ 1)
  - paragraph:   số thứ tự đoạn văn trong tài liệu (docx)
  - table, row:  số bảng và số hàng (docx/html)
  - char_start, char_end: vị trí ký tự của đoạn trích bên trong đoạn văn gốc (khi một đoạn dài bị cắt)
  - anchor:      id của tiêu đề gần nhất (html), node_id/frame_path (Figma), task_id (Task Function)
Văn bản chỉ được chuẩn hóa NFC + khoảng trắng (xem core.text.normalize_text).
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from io import BytesIO

from app.core.errors import AppError
from app.core.text import normalize_text

MAX_PASSAGE = 1200  # ký tự; đoạn dài hơn bị cắt theo câu (có char_start/char_end)
MIN_ALNUM = 3
HEADING_SEP = " › "


@dataclass
class Parsed:
    kind: str  # heading | paragraph | table_row | code | node_text | task | wiki_block
    text: str
    heading_path: str = ""
    locator: dict = field(default_factory=dict)


def _alnum(s: str) -> int:
    return sum(ch.isalnum() for ch in s)


def split_long(text: str, limit: int = MAX_PASSAGE) -> list[tuple[int, int]]:
    """Cắt đoạn dài thành các khoảng (start, end) theo ranh giới câu/dòng; text[start:end] là văn bản gốc, không sửa."""
    if len(text) <= limit:
        return [(0, len(text))]
    spans: list[tuple[int, int]] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + limit, n)
        if end < n:
            window = text[start:end]
            cut = max(window.rfind(". "), window.rfind("; "), window.rfind("\n"), window.rfind("? "), window.rfind("! "))
            if cut > limit * 0.4:
                end = start + cut + 1
        spans.append((start, end))
        start = end
        while start < n and text[start].isspace():
            start += 1
    return spans


class _Builder:
    """Gom đoạn trích, giữ đường dẫn tiêu đề và đánh số dòng."""

    def __init__(self) -> None:
        self.out: list[Parsed] = []
        self.stack: list[tuple[int, str]] = []
        self.line = 0

    def path(self) -> str:
        return HEADING_SEP.join(t for _, t in self.stack)

    def heading(self, level: int, text: str, locator: dict) -> None:
        text = normalize_text(text)
        if not text:
            return
        self.line += 1
        while self.stack and self.stack[-1][0] >= level:
            self.stack.pop()
        self.stack.append((level, text))
        self.out.append(Parsed("heading", text, self.path(), {**locator, "line": self.line, "level": level}))

    def block(self, kind: str, raw: str, locator: dict) -> None:
        text = normalize_text(raw)
        if _alnum(text) < MIN_ALNUM:
            return
        self.line += 1
        spans = split_long(text)
        for part, (a, b) in enumerate(spans):
            piece = text[a:b].strip()
            if _alnum(piece) < MIN_ALNUM:
                continue
            loc = {**locator, "line": self.line}
            if len(spans) > 1:
                loc.update({"part": part + 1, "parts": len(spans), "char_start": a, "char_end": b})
            self.out.append(Parsed(kind, piece, self.path(), loc))


# ----------------------------------------------------------------------------- DOCX
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _p_text(p: ET.Element) -> str:
    parts: list[str] = []

    def walk(el: ET.Element) -> None:
        for ch in el:
            tag = ch.tag
            if tag == W + "r":
                for c in ch:
                    if c.tag == W + "t" and c.text:
                        parts.append(c.text)
                    elif c.tag == W + "tab":
                        parts.append("\t")
                    elif c.tag in (W + "br", W + "cr"):
                        parts.append("\n")
                    elif c.tag == W + "noBreakHyphen":
                        parts.append("-")
            elif tag in (W + "hyperlink", W + "ins", W + "smartTag", W + "sdt", W + "sdtContent", W + "fldSimple"):
                walk(ch)  # w:del (nội dung bị xóa theo dõi thay đổi) cố ý bỏ qua

    walk(p)
    return "".join(parts)


def _style_names(z: zipfile.ZipFile) -> dict[str, str]:
    try:
        root = ET.fromstring(z.read("word/styles.xml"))
    except KeyError:
        return {}
    out = {}
    for st in root.iter(W + "style"):
        sid = st.get(W + "styleId")
        name = st.find(W + "name")
        if sid and name is not None:
            out[sid] = (name.get(W + "val") or "").lower()
    return out


def _heading_level(p: ET.Element, styles: dict[str, str]) -> int | None:
    ppr = p.find(W + "pPr")
    if ppr is None:
        return None
    ol = ppr.find(W + "outlineLvl")
    if ol is not None and ol.get(W + "val", "").isdigit():
        return int(ol.get(W + "val")) + 1
    ps = ppr.find(W + "pStyle")
    if ps is None:
        return None
    sid = ps.get(W + "val") or ""
    name = styles.get(sid, sid.lower())
    m = re.match(r"^(?:heading|tiêu đề|tieu de)\s*(\d)$", name) or re.match(r"^heading(\d)$", sid.lower())
    if m:
        return int(m.group(1))
    if name == "title":
        return 1
    return None


def parse_docx(data: bytes) -> list[Parsed]:
    try:
        z = zipfile.ZipFile(BytesIO(data))
        root = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise AppError("Không đọc được file .docx (hỏng hoặc không phải Word).", code="DOCX_INVALID", status=422) from exc
    styles = _style_names(z)
    body = root.find(W + "body")
    if body is None:
        return []
    b = _Builder()
    state = {"paragraph": 0, "table": 0}

    def handle(el: ET.Element) -> None:
        if el.tag == W + "p":
            state["paragraph"] += 1
            raw = _p_text(el)
            lvl = _heading_level(el, styles)
            loc = {"paragraph": state["paragraph"]}
            if lvl:
                b.heading(lvl, raw, loc)
            else:
                b.block("paragraph", raw, loc)
        elif el.tag == W + "tbl":
            state["table"] += 1
            t = state["table"]
            for r, tr in enumerate(el.findall(W + "tr"), start=1):
                cells = []
                for tc in tr.findall(W + "tc"):
                    txt = " ".join(normalize_text(_p_text(p)) for p in tc.iter(W + "p") if normalize_text(_p_text(p)))
                    cells.append(txt)
                if any(cells):
                    b.block("table_row", " | ".join(cells), {"table": t, "row": r})
        elif el.tag in (W + "sdt", W + "sdtContent"):
            for ch in el:
                handle(ch)

    for child in body:
        handle(child)
    return b.out


# ----------------------------------------------------------------------------- HTML (wiki)
BLOCK_TAGS = {"p", "div", "li", "section", "article", "ul", "ol", "table", "blockquote", "dd", "dt", "br", "hr", "tbody", "thead", "main", "aside", "header", "footer"}
SKIP_TAGS = {"script", "style", "noscript", "svg", "head", "template", "iframe"}
HEADING_TAGS = {f"h{i}": i for i in range(1, 7)}


class _Html(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.b = _Builder()
        self.buf: list[str] = []
        self.skip = 0
        self.pre = 0
        self.in_heading: int | None = None
        self.heading_id = ""
        self.anchor = ""
        self.row: list[str] | None = None
        self.cell: list[str] | None = None
        self.table = 0
        self.rown = 0
        self.block_no = 0
        self.pre_buf: list[str] = []

    def _flush(self) -> None:
        text = "".join(self.buf)
        self.buf = []
        if self.cell is not None:
            self.cell.append(text)
            return
        if self.in_heading is not None:
            return
        if _alnum(text) >= MIN_ALNUM:
            self.block_no += 1
            self.b.block("wiki_block", text, {"block": self.block_no, **({"anchor": self.anchor} if self.anchor else {})})

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in SKIP_TAGS:
            self.skip += 1
            return
        if self.skip:
            return
        if tag in HEADING_TAGS:
            self._flush()
            self.in_heading = HEADING_TAGS[tag]
            self.heading_id = a.get("id") or ""
        elif tag == "pre":
            self._flush()
            self.pre += 1
        elif tag == "table":
            self._flush()
            self.table += 1
            self.rown = 0
        elif tag == "tr":
            self._flush()
            self.row = []
        elif tag in ("td", "th"):
            self._flush()
            self.cell = []
        elif tag in BLOCK_TAGS:
            self._flush()

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag in HEADING_TAGS and self.in_heading is not None:
            text = "".join(self.buf)
            self.buf = []
            self.anchor = self.heading_id
            self.b.heading(self.in_heading, text, {**({"anchor": self.heading_id} if self.heading_id else {})})
            self.in_heading = None
        elif tag == "pre" and self.pre:
            self.pre -= 1
            raw = "".join(self.pre_buf)
            self.pre_buf = []
            if _alnum(raw) >= MIN_ALNUM:
                self.block_no += 1
                self.b.block("code", raw, {"block": self.block_no, **({"anchor": self.anchor} if self.anchor else {})})
        elif tag in ("td", "th") and self.cell is not None:
            text = normalize_text("".join(self.buf))
            self.buf = []
            self.cell.append(text)
            if self.row is not None:
                self.row.append(normalize_text(" ".join(c for c in self.cell if c)))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.rown += 1
            if any(self.row):
                self.b.block("table_row", " | ".join(self.row), {"table": self.table, "row": self.rown, **({"anchor": self.anchor} if self.anchor else {})})
            self.row = None
        elif tag in BLOCK_TAGS or tag == "table":
            self._flush()

    def handle_data(self, data):
        if self.skip:
            return
        if self.pre:
            self.pre_buf.append(data)
        else:
            self.buf.append(data)

    def close(self):
        super().close()
        self._flush()


def parse_html(data: bytes) -> list[Parsed]:
    text = data.decode("utf-8", errors="replace")
    p = _Html()
    p.feed(text)
    p.close()
    return p.b.out


# ----------------------------------------------------------------------------- Markdown / văn bản thuần
def parse_text(data: bytes, markdown: bool = True) -> list[Parsed]:
    text = data.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").replace("\r", "\n")
    b = _Builder()
    lines = text.split("\n")
    i, n = 0, len(lines)
    para: list[str] = []
    para_start = 0

    def flush(end_line: int) -> None:
        nonlocal para
        if para:
            raw = "\n".join(para)
            b.block("paragraph", raw, {"line_start": para_start, "line_end": end_line})
            b.line = end_line  # số dòng trong FILE gốc, không phải bộ đếm đoạn
            para = []

    while i < n:
        line = lines[i]
        if markdown and line.lstrip().startswith("```"):
            flush(i)
            j = i + 1
            while j < n and not lines[j].lstrip().startswith("```"):
                j += 1
            raw = "\n".join(lines[i + 1:j])
            if _alnum(raw) >= MIN_ALNUM:
                b.block("code", raw, {"line_start": i + 2, "line_end": j})
            i = j + 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", line) if markdown else None
        if m:
            flush(i)
            b.heading(len(m.group(1)), m.group(2), {"line_start": i + 1, "line_end": i + 1})
        elif not line.strip():
            flush(i)
        else:
            if not para:
                para_start = i + 1
            para.append(line)
        i += 1
    flush(n)
    # với văn bản thuần/markdown, `line` = số dòng thật trong file: thay bộ đếm đoạn bằng line_start
    for p in b.out:
        p.locator["line"] = p.locator.get("line_start", p.locator.get("line"))
    return b.out


# ----------------------------------------------------------------------------- Figma
def parse_figma_nodes(doc: dict, file_key: str, base_url: str) -> list[Parsed]:
    """Từ JSON `nodes` của Figma REST: mỗi nút TEXT thành một đoạn trích; đường dẫn = chuỗi tên Frame/Group cha."""
    out: list[Parsed] = []
    seq = 0

    def walk(node: dict, path: list[str]) -> None:
        nonlocal seq
        ntype = node.get("type")
        name = str(node.get("name") or "")
        if ntype == "TEXT":
            text = normalize_text(str(node.get("characters") or ""))
            if _alnum(text) >= MIN_ALNUM:
                seq += 1
                nid = str(node.get("id") or "")
                url = f"{base_url}?node-id={nid.replace(':', '-')}" if nid else base_url
                out.append(Parsed("node_text", text, HEADING_SEP.join(path), {"line": seq, "node_id": nid, "node_name": name, "file_key": file_key, "url": url}))
            return
        child_path = path + [name] if name and ntype in ("FRAME", "COMPONENT", "COMPONENT_SET", "SECTION", "GROUP", "CANVAS", "INSTANCE") else path
        for ch in node.get("children") or []:
            walk(ch, child_path)

    for entry in (doc.get("nodes") or {}).values():
        if entry and entry.get("document"):
            walk(entry["document"], [])
    if not out and doc.get("document"):
        walk(doc["document"], [])
    return out


def parse_pasted(text: str, label: str = "Chú thích dán tay") -> list[Parsed]:
    """Nội dung Figma do QC dán tay (khi không có token Figma): mỗi đoạn cách nhau dòng trống là một đoạn trích."""
    b = _Builder()
    for chunk in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        b.block("paragraph", chunk, {"source": "pasted"})
    return b.out
