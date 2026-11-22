"""Tra cứu trích dẫn theo MÔ TẢ BUG: tách từ khóa/cụm từ → tìm trong các đoạn trích đã nạp → trả đoạn NGUYÊN VĂN + vị trí.

Không dùng AI để viết lại. Mọi `quote`/`excerpt` trả về là chuỗi con chính xác của văn bản đã nạp
(excerpt luôn kèm start/end trong đoạn để kiểm chứng được).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.text import fold, fold_with_map, like_escape
from app.domains.knowledge.models import Source, SourceVersion
from app.domains.sources.ingest import KIND_LABEL
from app.domains.sources.models import SourcePassage

# Từ dừng tiếng Việt (đã bỏ dấu) + từ chung của mô tả bug; cụm từ KHÔNG được bắt đầu/kết thúc bằng từ dừng
# KHÔNG đưa vào các từ mà khi bỏ dấu trùng từ có nghĩa: do (độ), ma (mã), thay, qua (quá), chi (chỉ), tu (từ), con (còn), lai (lại), hay
STOPWORDS = set("""
va la cua cho cac nhung mot khi thi de duoc bi o trong tren duoi voi ra vao len xuong da dang se cung van chua
khong co the nay kia nao gi sao nhu nen neu hoac den tai theo ve boi vi vay tuy nhien roi luon rat nua moi tung may bao nhieu day dau
bug loi sai hien thi ra nhan nhap bam click ko k dc dk
the a an is are was were be been of to in on at for with and or not no this that it as by from
""".split())
TOKEN_RE = re.compile(r"[a-z0-9]+")
IDENT_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b|\b[A-Z]{3,}\b")
QUOTED_RE = re.compile(r"[\"“”‘’']([^\"“”‘’']{3,80})[\"“”‘’']")
BRACKET_RE = re.compile(r"\[([^\]]{2,40})\]")
CLAUSE_RE = re.compile(r"[,.;:!?()\[\]{}\"“”\n]|\s[-–—]\s")  # ranh giới mệnh đề: cụm từ không đi xuyên dấu câu

MAX_TERMS = 40
MAX_DF_RATIO = 0.35  # từ xuất hiện ở > 35% đoạn là quá chung: bỏ (trừ khi là cụm/định danh)
CANDIDATE_CAP = 4000
K1, B = 1.2, 0.75


@dataclass
class Keyword:
    term: str  # dạng không dấu dùng để tìm
    display: str  # dạng người dùng đã gõ
    type: str  # quoted | identifier | phrase | word
    weight: float

    def as_dict(self) -> dict:
        return {"term": self.term, "display": self.display, "type": self.type, "weight": round(self.weight, 2)}


def extract_keywords(description: str) -> list[Keyword]:
    desc = description or ""
    found: dict[str, Keyword] = {}

    def add(display: str, typ: str, weight: float) -> None:
        term = fold(display)
        if len(term) < 2 or term in STOPWORDS:
            return
        cur = found.get(term)
        if cur is None or weight > cur.weight:
            found[term] = Keyword(term, display.strip(), typ, weight)

    for m in QUOTED_RE.finditer(desc):
        add(m.group(1), "quoted", 4.0)
    for m in BRACKET_RE.finditer(desc):
        add(m.group(1), "identifier", 2.5)
    for m in IDENT_RE.finditer(desc):
        add(m.group(0), "identifier", 3.0)
    clauses = [c for c in CLAUSE_RE.split(desc) if c and c.strip()]
    words: list[str] = []
    for clause in clauses:
        toks = TOKEN_RE.findall(fold(clause))
        words.extend(toks)
        for n in (3, 2):  # cụm 3 trước, 2 sau; cụm dài hơn có trọng số cao hơn
            for i in range(len(toks) - n + 1):
                gram = toks[i:i + n]
                if gram[0] in STOPWORDS or gram[-1] in STOPWORDS or any(len(t) < 2 for t in gram):
                    continue
                if sum(t in STOPWORDS for t in gram) > 1:
                    continue
                add(" ".join(gram), "phrase", 1.5 * n)
    for t in words:
        if t in STOPWORDS or len(t) < 3 and not t.isdigit():
            continue
        add(t, "word", 1.0)
    ordered = sorted(found.values(), key=lambda k: (-k.weight, -len(k.term)))
    return ordered[:MAX_TERMS]


def _term_regex(term: str) -> re.Pattern:
    parts = [re.escape(p) for p in term.split()]
    return re.compile(r"(?<![a-z0-9])" + r"\s+".join(parts) + r"(?![a-z0-9])")


def describe_locator(loc: dict) -> str:
    bits = []
    if loc.get("table"):
        bits.append(f"bảng {loc['table']}, hàng {loc.get('row', '?')}")
    if loc.get("line_start"):
        bits.append(f"dòng {loc['line_start']}" + (f"–{loc['line_end']}" if loc.get("line_end") and loc["line_end"] != loc["line_start"] else ""))
    elif loc.get("line"):
        bits.append(f"dòng {loc['line']}")
    if loc.get("paragraph"):
        bits.append(f"đoạn {loc['paragraph']}")
    if loc.get("part"):
        bits.append(f"phần {loc['part']}/{loc['parts']} (ký tự {loc['char_start']}–{loc['char_end']})")
    if loc.get("node_id"):
        bits.append(f"node Figma {loc['node_id']}")
    if loc.get("task_id"):
        bits.append(f"task {loc['task_id']}")
    if loc.get("anchor"):
        bits.append(f"#{loc['anchor']}")
    return ", ".join(bits)


def _excerpt(text: str, spans: list[tuple[int, int]], span_chars: int = 360) -> tuple[int, int]:
    """Cửa sổ quanh vùng khớp đầu tiên, nới tới ranh giới dòng/câu gần nhất; text[a:b] là chuỗi con chính xác."""
    if len(text) <= span_chars * 1.5 or not spans:
        return 0, len(text)
    s0, e0 = spans[0]
    a = max(0, s0 - span_chars // 3)
    b = min(len(text), max(e0, a + span_chars))
    cut = max(text.rfind("\n", 0, a + 1), text.rfind(". ", 0, a + 1) + 1)
    a = cut + 1 if cut >= 0 and a - cut < 120 else a
    nxt = [i for i in (text.find("\n", b), text.find(". ", b)) if i != -1]
    if nxt and min(nxt) - b < 120:
        b = min(nxt) + 1
    return max(0, a), min(len(text), b)


def _highlights(text: str, terms: list[Keyword]) -> list[dict]:
    folded, idx = fold_with_map(text)
    spans: list[tuple[int, int, str]] = []
    for k in terms:
        for m in _term_regex(k.term).finditer(folded):
            spans.append((idx[m.start()], idx[m.end() - 1] + 1, k.display))
    spans.sort()
    merged: list[list] = []
    for s, e, d in spans:
        if merged and s <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([s, e, d])
    return [{"start": s, "end": e, "term": d} for s, e, d in merged]


def coverage(session: Session) -> dict[str, dict]:
    out = {k: {"label": v, "sources": 0, "passages": 0} for k, v in KIND_LABEL.items()}
    for kind, n in session.execute(select(Source.kind, func.count()).where(Source.status == "active").group_by(Source.kind)):
        if kind in out:
            out[kind]["sources"] = n
    q = (select(Source.kind, func.count(SourcePassage.id)).join(SourceVersion, SourceVersion.source_id == Source.id)
         .join(SourcePassage, SourcePassage.source_version_id == SourceVersion.id)
         .where(Source.status == "active", SourcePassage.is_current.is_(True)).group_by(Source.kind))
    for kind, n in session.execute(q):
        if kind in out:
            out[kind]["passages"] = n
    return out


def lookup(session: Session, description: str, *, kinds: list[str] | None = None, module: str = "", per_kind: int = 5, include_old: bool = False) -> dict:
    keywords = extract_keywords(description)
    base = (select(SourcePassage, Source, SourceVersion).join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
            .join(Source, Source.id == SourceVersion.source_id).where(Source.status == "active"))
    if not include_old:
        base = base.where(SourcePassage.is_current.is_(True))
    if kinds:
        base = base.where(Source.kind.in_(kinds))
    cov = coverage(session)
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    if not keywords or not total:
        return {"keywords": [k.as_dict() for k in keywords], "groups": {}, "coverage": cov, "total_passages": total, "hint": _hint(keywords, cov, kinds)}

    # IDF theo số đoạn chứa từ (df); bỏ từ quá chung
    usable: list[Keyword] = []
    idf: dict[str, float] = {}
    for k in keywords:
        like = f"%{like_escape(k.term)}%"
        df = session.scalar(select(func.count()).select_from(base.where(SourcePassage.text_fold.like(like, escape="\\")).subquery())) or 0
        if df == 0:
            continue
        if k.type == "word" and df / total > MAX_DF_RATIO and total > 50:
            continue
        idf[k.term] = math.log(1 + (total - df + 0.5) / (df + 0.5))
        usable.append(k)
    if not usable:
        return {"keywords": [k.as_dict() for k in keywords], "groups": {}, "coverage": cov, "total_passages": total, "hint": _hint(keywords, cov, kinds, no_hit=True)}

    cond = or_(*[SourcePassage.text_fold.like(f"%{like_escape(k.term)}%", escape="\\") for k in usable])
    rows = session.execute(base.where(cond).limit(CANDIDATE_CAP * 2)).all()
    avg = sum(len(p.text_fold) for p, _, _ in rows) / max(len(rows), 1)
    regs = {k.term: _term_regex(k.term) for k in usable}
    tok_terms = [k for k in usable if k.type == "word"]
    phr_terms = [k for k in usable if k.type == "phrase"]
    strong_terms = [k for k in usable if k.type in ("quoted", "identifier")]
    tok_idf = {k.term: idf[k.term] for k in tok_terms}
    default_idf = (sum(tok_idf.values()) / len(tok_idf)) if tok_idf else 1.0
    # khối lượng thông tin của toàn mô tả: mỗi từ đơn một lần + định danh/chuỗi trong ngoặc (KHÔNG cộng chồng các cụm)
    mass = (sum(tok_idf.values()) + sum(k.weight * idf[k.term] for k in strong_terms)) or 1.0

    scored: list[tuple[float, SourcePassage, Source, SourceVersion, list[Keyword]]] = []
    for p, src, ver in rows:
        if module and module.lower() not in fold(f"{p.heading_path} {(p.locator or {}).get('module', '')} {src.title}"):
            continue
        m_tok = [k for k in tok_terms if regs[k.term].search(p.text_fold)]
        m_phr = [k for k in phr_terms if regs[k.term].search(p.text_fold)]
        m_str = [k for k in strong_terms if regs[k.term].search(p.text_fold)]
        # chỉ giữ cụm DÀI NHẤT: bỏ cụm là chuỗi con của một cụm khác cũng khớp (tránh tính chồng "danh sach" và "man hinh danh sach")
        maximal = [k for k in m_phr if not any(o.term != k.term and f" {k.term} " in f" {o.term} " for o in m_phr)]
        covered = {k.term for k in m_tok} | {t for k in maximal for t in k.term.split() if t in tok_idf}
        if not (m_tok or maximal or m_str):
            continue
        # Chỉ nhận đoạn phủ ≥ 2 từ khóa đơn khác nhau, hoặc có định danh/chuỗi trong ngoặc; một từ lẻ là quá yếu để gọi là trích dẫn
        if len(covered) < 2 and not m_str and len(keywords) > 1:
            continue
        base = 0.0
        for k in m_tok:
            tf = len(regs[k.term].findall(p.text_fold))
            base += tok_idf[k.term] * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * len(p.text_fold) / avg))
        bonus = sum(0.75 * sum(tok_idf.get(t, default_idf) for t in k.term.split()) for k in maximal)
        bonus += sum(k.weight * idf[k.term] for k in m_str)
        score = (base + bonus) * math.sqrt(min(1.0, (sum(tok_idf[t] for t in covered) + sum(k.weight * idf[k.term] for k in m_str)) / mass))
        if p.kind == "heading":
            score *= 0.7
        scored.append((score, p, src, ver, m_tok + maximal + m_str))

    groups: dict[str, list[dict]] = {}
    for kind in KIND_LABEL:
        picked = sorted((r for r in scored if r[2].kind == kind), key=lambda r: -r[0])[:per_kind]
        if picked:
            groups[kind] = [_citation(*r) for r in picked]
    return {"keywords": [k.as_dict() for k in keywords], "used_terms": [k.term for k in usable], "groups": groups, "coverage": cov,
            "total_passages": total, "hint": _hint(keywords, cov, kinds, no_hit=not groups)}


def _citation(score: float, p: SourcePassage, src: Source, ver: SourceVersion, hit: list[Keyword]) -> dict:
    hl = _highlights(p.text, hit)
    a, b = _excerpt(p.text, [(h["start"], h["end"]) for h in hl])
    where = describe_locator(p.locator or {})
    ref = f'{KIND_LABEL.get(src.kind, src.kind)} "{src.title}" ({ver.label})' + (f" › {p.heading_path}" if p.heading_path else "") + (f" — {where}" if where else "")
    return {
        "passage_id": str(p.id), "source_id": str(src.id), "source_kind": src.kind, "source_title": src.title, "source_version": ver.label,
        "is_current": p.is_current, "heading_path": p.heading_path, "locator": p.locator, "location": where, "url": (p.locator or {}).get("url") or src.external_url,
        "quote": p.text, "excerpt": {"text": p.text[a:b], "start": a, "end": b}, "highlights": hl, "matched_terms": sorted({k.display for k in hit}),
        "score": round(score, 3), "citation": ref,
    }


def _hint(keywords: list[Keyword], cov: dict, kinds: list[str] | None, no_hit: bool = False) -> str:
    empty = [v["label"] for k, v in cov.items() if v["passages"] == 0 and (not kinds or k in kinds)]
    parts = []
    if empty:
        parts.append("Chưa nạp nguồn loại: " + ", ".join(empty) + ".")
    if not keywords:
        parts.append("Mô tả chưa có từ khóa đủ rõ; thêm tên màn hình, tên chức năng hoặc nội dung thông báo lỗi.")
    elif no_hit:
        parts.append("Không có đoạn nào khớp từ khóa. Thử thêm từ khóa theo cách nguồn viết (tên màn hình, tên trường, tên chức năng).")
    return " ".join(parts)


def passage_context(session: Session, passage_id, radius: int = 2) -> dict | None:
    p = session.get(SourcePassage, passage_id)
    if p is None:
        return None
    rows = session.scalars(select(SourcePassage).where(SourcePassage.source_version_id == p.source_version_id, SourcePassage.seq.between(p.seq - radius, p.seq + radius))
                           .order_by(SourcePassage.seq)).all()
    return {"passage_id": str(p.id), "items": [{"passage_id": str(r.id), "seq": r.seq, "is_target": r.id == p.id, "kind": r.kind, "heading_path": r.heading_path,
                                                "location": describe_locator(r.locator or {}), "text": r.text} for r in rows]}
