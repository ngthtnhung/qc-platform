"""Tra cứu trích dẫn theo MÔ TẢ BUG: tách từ khóa/cụm từ → tìm trong các đoạn trích đã nạp → trả đoạn NGUYÊN VĂN + vị trí.

Không dùng AI để viết lại. Mọi `quote`/`excerpt` trả về là chuỗi con chính xác của văn bản đã nạp
(excerpt luôn kèm start/end trong đoạn để kiểm chứng được).
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from urllib.parse import urlparse

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.text import fold, fold_with_map, like_escape
from app.domains.bugs.models import Bug, Project as BugProject
from app.domains.knowledge.models import Source, SourceVersion
from app.domains.sources.ingest import KIND_LABEL
from app.domains.sources.models import SourcePassage

LOOKUP_KIND_LABEL = {**KIND_LABEL, "completed_bug": "Bug cũ đã hoàn thành"}

# Từ dừng tiếng Việt (đã bỏ dấu) + từ chung của mô tả bug; cụm từ KHÔNG được bắt đầu/kết thúc bằng từ dừng
# KHÔNG đưa vào các từ mà khi bỏ dấu trùng từ có nghĩa: do (độ), ma (mã), thay, qua (quá), chi (chỉ), tu (từ), con (còn), lai (lại), hay
STOPWORDS = set("""
va la cua cho cac nhung mot khi thi de duoc bi o trong tren duoi voi ra vao len xuong da dang se cung van chua
khong co the nay kia nao gi sao nhu nen neu hoac den tai theo ve boi vi vay tuy nhien roi luon rat nua moi tung may bao nhieu day dau
bug loi sai hien thi ra nhan nhap bam click ko k dc dk http https www com vn net org io
the a an is are was were be been of to in on at for with and or not no this that it as by from
""".split())
TOKEN_RE = re.compile(r"[a-z0-9]+")
IDENT_RE = re.compile(r"\b[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)+\b|\b[A-Z]{3,}\b")
QUOTED_RE = re.compile(r"[\"“”‘’']([^\"“”‘’']{3,80})[\"“”‘’']")
BRACKET_RE = re.compile(r"\[([^\]]{2,40})\]")
CLAUSE_RE = re.compile(r"[,.;:!?()\[\]{}\"“”\n]|\s[-–—]\s")  # ranh giới mệnh đề: cụm từ không đi xuyên dấu câu
URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]]+", re.I)
NOISE_ID_RE = re.compile(r"^(?:[0-9a-f]{12,}|[0-9a-f]{8}-[0-9a-f-]{20,}|[0-9]{7,})$", re.I)

MAX_TERMS = 40
MAX_DF_RATIO = 0.35  # từ xuất hiện ở > 35% đoạn là quá chung: bỏ (trừ khi là cụm/định danh)
CANDIDATE_CAP = 4000
K1, B = 1.2, 0.75


@dataclass
class Keyword:
    term: str  # dạng không dấu dùng để tìm
    display: str  # dạng người dùng đã gõ
    type: str  # flow | quoted | identifier | url_root | phrase | word
    weight: float

    def as_dict(self) -> dict:
        return {"term": self.term, "display": self.display, "type": self.type, "weight": round(self.weight, 2)}


def _sanitize_urls(text: str) -> tuple[str, list[str]]:
    """Loại bỏ path/query/hash/ObjectId dài trong URL, chỉ giữ lại phần URL root (domain)."""
    roots: list[str] = []

    def _repl(m: re.Match) -> str:
        raw = m.group(0).rstrip(".,;:!?)")
        try:
            u = urlparse(raw)
            host = (u.hostname or "").lower()
            if host and host not in roots:
                roots.append(host)
        except Exception:  # noqa: BLE001
            pass
        return " "

    cleaned = URL_RE.sub(_repl, text or "")
    return cleaned, roots


def extract_keywords(description: str, flow_hint: str = "") -> list[Keyword]:
    raw_desc, url_roots = _sanitize_urls(description or "")
    found: dict[str, Keyword] = {}

    def add(display: str, typ: str, weight: float) -> None:
        term = fold(display)
        if len(term) < 2 or term in STOPWORDS or NOISE_ID_RE.match(term):
            return
        cur = found.get(term)
        if cur is None or weight > cur.weight:
            found[term] = Keyword(term, display.strip(), typ, weight)

    # Ưu tiên cao nhất cho tên chức năng / luồng ứng dụng liên quan
    if flow_hint and flow_hint.strip():
        clean_flow, flow_roots = _sanitize_urls(flow_hint.strip())
        for r in flow_roots:
            if r not in url_roots:
                url_roots.append(r)
        for clause in [c for c in CLAUSE_RE.split(clean_flow) if c and c.strip()]:
            toks = [t for t in TOKEN_RE.findall(fold(clause)) if not NOISE_ID_RE.match(t)]
            if len(toks) >= 2:
                add(clause.strip(), "flow", 5.0)
            for n in (3, 2):
                for i in range(len(toks) - n + 1):
                    gram = toks[i:i + n]
                    if gram[0] in STOPWORDS or gram[-1] in STOPWORDS or any(len(t) < 2 for t in gram):
                        continue
                    add(" ".join(gram), "flow", 3.5 + 0.5 * n)
            for t in toks:
                if t not in STOPWORDS and len(t) >= 2:
                    add(t, "word", 2.2)

    for host in url_roots:
        add(host, "url_root", 1.8)

    for m in QUOTED_RE.finditer(raw_desc):
        add(m.group(1), "quoted", 4.0)
    for m in BRACKET_RE.finditer(raw_desc):
        tag = m.group(1).strip()
        if tag.upper() not in {"BUG", "QC", "WEB", "APP", "MOBILE", "INTERNAL", "PRODUCTION", "STAGING"}:
            add(tag, "identifier", 2.5)
    for m in IDENT_RE.finditer(raw_desc):
        tok = m.group(0)
        if not NOISE_ID_RE.match(tok):
            add(tok, "identifier", 3.0)
    clauses = [c for c in CLAUSE_RE.split(raw_desc) if c and c.strip()]
    words: list[str] = []
    for clause in clauses:
        toks = [t for t in TOKEN_RE.findall(fold(clause)) if not NOISE_ID_RE.match(t)]
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
        if t in STOPWORDS or (len(t) < 3 and not t.isdigit()):
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


def _search_completed_bugs(session: Session, keywords: list[Keyword], *, module: str = "", limit: int = 5) -> list[dict]:
    """Tìm các Bug cũ đã hoàn thành (status=4) trong cùng module để làm nguồn tham khảo."""
    if not keywords:
        return []
    mod_up = (module or "").strip().upper()
    stmt = select(Bug).where(Bug.status == 4)
    if mod_up:
        stmt = stmt.where(func.upper(Bug.module_code) == mod_up)
    cond = or_(*[Bug.title_fold.like(f"%{like_escape(k.term)}%", escape="\\") for k in keywords[:25]])
    bugs = session.scalars(stmt.where(cond).order_by(Bug.created_at_ext.desc().nullslast()).limit(300)).all()
    if not bugs:
        return []
    proj_map = {p.id: (p.name, p.external_id) for p in session.scalars(select(BugProject))}
    regs = {k.term: _term_regex(k.term) for k in keywords}
    scored: list[tuple[float, Bug, str, list[Keyword]]] = []
    for b in bugs:
        extra = b.extra or {}
        desc_txt = str(extra.get("description") or "").strip()
        full_txt = b.title + (f"\n{desc_txt}" if desc_txt else "")
        folded_txt = fold(full_txt)
        hit = [k for k in keywords if regs[k.term].search(folded_txt)]
        if not hit:
            continue
        uniq_terms = {k.term for k in hit}
        if len(uniq_terms) < 2 and not any(k.type in ("flow", "quoted", "identifier") for k in hit) and len(keywords) > 1:
            continue
        score = sum(k.weight for k in hit)
        scored.append((score, b, full_txt, hit))
    scored.sort(key=lambda r: -r[0])
    out: list[dict] = []
    for score, b, full_txt, hit in scored[:limit]:
        hl = _highlights(full_txt, hit)
        a, b_end = _excerpt(full_txt, [(h["start"], h["end"]) for h in hl])
        p_name, p_ext = proj_map.get(b.project_id, ("Bug đã hoàn thành", "")) if b.project_id else ("Bug đã hoàn thành", "")
        bug_url = b.url or (
            f"https://tasks.haraworks.vn/task/project/{p_ext}/{b.external_id}" if (p_ext and b.external_id)
            else (f"https://tasks.haraworks.vn/task/me/{b.external_id}" if b.external_id else "")
        )
        out.append({
            "passage_id": f"bug_{b.id}",
            "source_id": str(b.id),
            "source_kind": "completed_bug",
            "source_title": b.title,
            "source_version": "Hoàn thành",
            "source_module": (b.module_code or "").upper(),
            "source_updated_at": b.created_at_ext.isoformat() if b.created_at_ext else "",
            "is_current": True,
            "heading_path": p_name,
            "locator": {"external_id": b.external_id, "assignee": b.assignee, "approver": b.approver},
            "location": f"Bug #{b.external_id}" if b.external_id else "Bug đã hoàn thành",
            "url": bug_url,
            "quote": full_txt,
            "excerpt": {"text": full_txt[a:b_end], "start": a, "end": b_end},
            "highlights": hl,
            "matched_terms": sorted({k.display for k in hit}),
            "score": round(score, 3),
            "citation": f'Bug cũ đã hoàn thành "{b.title}" ({p_name})',
        })
    return out


def lookup(session: Session, description: str, *, kinds: list[str] | None = None, module: str = "", flow_hint: str = "", per_kind: int = 5, include_old: bool = False) -> dict:
    keywords = extract_keywords(description, flow_hint=flow_hint)
    want_completed_bugs = (not kinds) or ("completed_bug" in kinds)
    doc_kinds = [k for k in (kinds or []) if k in KIND_LABEL] if kinds else list(KIND_LABEL.keys())

    base = (select(SourcePassage, Source, SourceVersion).join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
            .join(Source, Source.id == SourceVersion.source_id).where(Source.status == "active"))
    if not include_old:
        base = base.where(SourcePassage.is_current.is_(True))
    if doc_kinds:
        base = base.where(Source.kind.in_(doc_kinds))
    cov = coverage(session)
    total = session.scalar(select(func.count()).select_from(base.subquery())) or 0 if doc_kinds else 0

    mod_fold = fold(module) if module else ""
    mod_up = (module or "").strip().upper()

    # Nếu đã chọn module, kiểm tra xem module này có nguồn nào hay không
    module_has_sources = True
    if mod_fold:
        has_doc = False
        if doc_kinds:
            for src in session.scalars(select(Source).where(Source.status == "active", Source.kind.in_(doc_kinds))):
                sm = fold(str((src.meta or {}).get("module") or ""))
                if sm == mod_fold:
                    has_doc = True
                    break
            if not has_doc and "task_function" in doc_kinds:
                tf_cnt = session.scalar(
                    select(func.count(SourcePassage.id))
                    .join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
                    .join(Source, Source.id == SourceVersion.source_id)
                    .where(Source.kind == "task_function", Source.status == "active", SourcePassage.is_current.is_(True), func.upper(SourcePassage.heading_path) == mod_up)
                ) or 0
                has_doc = tf_cnt > 0
        has_bug = False
        if want_completed_bugs:
            has_bug = bool(session.scalar(select(Bug.id).where(Bug.status == 4, func.upper(Bug.module_code) == mod_up).limit(1)))
        module_has_sources = has_doc or has_bug
        if not module_has_sources:
            return {
                "keywords": [k.as_dict() for k in keywords],
                "groups": {},
                "coverage": cov,
                "total_passages": 0,
                "module_empty": True,
                "hint": f"Chưa có nguồn tài liệu hoặc bug hoàn thành nào thuộc module {mod_up}. Hãy nạp tài liệu gắn mã module {mod_up} ở mục Nguồn tài liệu.",
            }

    groups: dict[str, list[dict]] = {}
    usable: list[Keyword] = []

    if keywords and doc_kinds and total:
        # IDF theo số đoạn chứa từ (df); bỏ từ quá chung
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

        if usable:
            cond = or_(*[SourcePassage.text_fold.like(f"%{like_escape(k.term)}%", escape="\\") for k in usable])
            rows = session.execute(base.where(cond).limit(CANDIDATE_CAP * 2)).all()
            avg = sum(len(p.text_fold) for p, _, _ in rows) / max(len(rows), 1)
            regs = {k.term: _term_regex(k.term) for k in usable}
            tok_terms = [k for k in usable if k.type == "word"]
            phr_terms = [k for k in usable if k.type == "phrase"]
            strong_terms = [k for k in usable if k.type in ("flow", "quoted", "identifier", "url_root")]
            tok_idf = {k.term: idf[k.term] for k in tok_terms}
            default_idf = (sum(tok_idf.values()) / len(tok_idf)) if tok_idf else 1.0
            mass = (sum(tok_idf.values()) + sum(k.weight * idf[k.term] for k in strong_terms)) or 1.0

            scored: list[tuple[float, SourcePassage, Source, SourceVersion, list[Keyword]]] = []
            for p, src, ver in rows:
                if mod_fold:
                    src_mod = fold(str((src.meta or {}).get("module") or ""))
                    if src_mod:
                        if src_mod != mod_fold:
                            continue
                    else:
                        loc_mod = fold(str((p.locator or {}).get("module") or p.heading_path or ""))
                        if loc_mod:
                            if loc_mod != mod_fold:
                                continue
                        else:
                            continue
                m_tok = [k for k in tok_terms if regs[k.term].search(p.text_fold)]
                m_phr = [k for k in phr_terms if regs[k.term].search(p.text_fold)]
                m_str = [k for k in strong_terms if regs[k.term].search(p.text_fold)]
                maximal = [k for k in m_phr if not any(o.term != k.term and f" {k.term} " in f" {o.term} " for o in m_phr)]
                covered = {k.term for k in m_tok} | {t for k in maximal for t in k.term.split() if t in tok_idf}
                if not (m_tok or maximal or m_str):
                    continue
                if len(covered) < 2 and not m_str and len(keywords) > 1:
                    continue
                base_score = 0.0
                for k in m_tok:
                    tf = len(regs[k.term].findall(p.text_fold))
                    base_score += tok_idf[k.term] * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * len(p.text_fold) / avg))
                bonus = sum(0.75 * sum(tok_idf.get(t, default_idf) for t in k.term.split()) for k in maximal)
                bonus += sum(k.weight * idf[k.term] for k in m_str)
                score = (base_score + bonus) * math.sqrt(min(1.0, (sum(tok_idf[t] for t in covered) + sum(k.weight * idf[k.term] for k in m_str)) / mass))
                if p.kind == "heading":
                    score *= 0.7
                scored.append((score, p, src, ver, m_tok + maximal + m_str))

            for kind in KIND_LABEL:
                picked = sorted((r for r in scored if r[2].kind == kind), key=lambda r: -r[0])[:per_kind]
                if picked:
                    groups[kind] = [_citation(*r) for r in picked]

    if want_completed_bugs and keywords:
        bug_hits = _search_completed_bugs(session, keywords, module=mod_up, limit=per_kind)
        if bug_hits:
            groups["completed_bug"] = bug_hits

    hint_msg = _hint(keywords, cov, kinds, no_hit=not groups)
    if mod_up and not groups:
        hint_msg = f"Không tìm thấy đoạn khớp nào trong các nguồn thuộc module {mod_up}. Thử nhập thêm tên chức năng / luồng ứng dụng hoặc từ khóa khác."

    return {
        "keywords": [k.as_dict() for k in keywords],
        "used_terms": [k.term for k in usable],
        "groups": groups,
        "coverage": cov,
        "total_passages": total,
        "module_empty": False,
        "hint": hint_msg,
    }


def _citation(score: float, p: SourcePassage, src: Source, ver: SourceVersion, hit: list[Keyword]) -> dict:
    hl = _highlights(p.text, hit)
    a, b = _excerpt(p.text, [(h["start"], h["end"]) for h in hl])
    where = describe_locator(p.locator or {})
    ref = f'{KIND_LABEL.get(src.kind, src.kind)} "{src.title}" ({ver.label})' + (f" › {p.heading_path}" if p.heading_path else "") + (f" — {where}" if where else "")
    return {
        "passage_id": str(p.id), "source_id": str(src.id), "source_kind": src.kind, "source_title": src.title, "source_version": ver.label,
        "source_module": str((src.meta or {}).get("module") or (p.locator or {}).get("module") or ""),
        "source_updated_at": str((src.meta or {}).get("updated_at") or src.created_at.isoformat()),
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
