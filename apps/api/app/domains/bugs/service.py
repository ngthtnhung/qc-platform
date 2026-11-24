from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.text import fold, like_escape, stable_hash
from app.domains.bugs.models import Bug, BugSnapshot, BugSource, Project
from app.domains.knowledge.models import Module

# Nhãn trạng thái/ưu tiên Haraworks (port từ packages/bug-search/codes.js; đối chiếu lại khi Haraworks đổi client)
STATUS_LABELS = {0: "Mới", 1: "Đang thực hiện", 2: "Tạm ngưng", 3: "Chờ duyệt", 4: "Từ chối", 5: "Hoàn thành",
                 6: "Cần duyệt", 10: "Không xử lý", 11: "Không thực hiện"}
PRIORITY_LABELS = {1: "Ưu tiên cao", 2: "Ưu tiên cao", 3: "Ưu tiên", 4: "Không ưu tiên"}
VN = dt.timezone(dt.timedelta(hours=7))  # GIẢ ĐỊNH: ngày `d` của bug cũ là giờ Việt Nam (nguồn không ghi múi giờ)


def _dt(value: str | None, *, naive_tz: dt.timezone = VN) -> dt.datetime | None:
    if not value:
        return None
    try:
        d = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=naive_tz)).astimezone(dt.timezone.utc)  # luôn lưu UTC (SQLite không giữ múi giờ)


@dataclass
class Report:
    source: str
    created: int = 0
    updated: int = 0
    skipped: int = 0
    snapshots: int = 0
    projects_created: int = 0
    errors: list[str] = field(default_factory=list)

    def summary(self) -> dict:
        d = self.__dict__.copy()
        d["errors"] = len(self.errors)
        return d


TAG_RE = re.compile(r"^\s*\[([^\]]{1,40})\]\s*")


def _norm_tag(t: str) -> str:
    return re.sub(r"['’\s]", "", t.strip().upper())


def module_index(session: Session) -> dict[str, str]:
    """token → mã module, từ bảng modules (mã, prefix, bug_aliases). Rỗng nếu chưa nhập modules."""
    idx: dict[str, str] = {}
    for m in session.scalars(select(Module)):
        for tok in [m.code, m.prefix, *(m.extra or {}).get("bug_aliases", [])]:
            if tok:
                idx.setdefault(_norm_tag(str(tok)), m.code)
    return idx


def derive_module(title: str, index: dict[str, str]) -> str:
    """'[BUG][HRM][SCF] mô tả' → thẻ đầu tiên trùng một module đã biết (giống parseTags của bản Node). Không đoán nếu không khớp."""
    rest = title
    while (m := TAG_RE.match(rest)):
        code = index.get(_norm_tag(m.group(1)))
        if code:
            return code
        rest = rest[m.end():]
    return ""


def _person(v) -> str:
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError:
            return v
    if isinstance(v, list) and v:
        return ", ".join(str(x.get("name") or x.get("user_Name") or "") for x in v if isinstance(x, dict) and (x.get("name") or x.get("user_Name")))
    return str(v.get("name") or v.get("user_Name") or "") if isinstance(v, dict) else ""


_KNOWN = {"id", "name", "status", "priority", "is_Deleted", "created_At", "status_Updated_At", "project_Id", "assignTo", "approverEntity", "project_Name"}


def live_fields(b: dict, proj: Project | None, mod_index: dict[str, str]) -> dict:
    """Ánh xạ một task Haraworks (định dạng của bản Node/API) sang các cột của bảng bugs; trường chưa ánh xạ giữ trong extra."""
    title = str(b.get("name", ""))
    tid = str(b.get("id") or "")
    pid = proj.external_id if proj else str(b.get("project_Id") or "")
    hw_url = f"https://tasks.haraworks.vn/task/project/{pid}/{tid}" if (pid and tid) else (f"https://tasks.haraworks.vn/task/me/{tid}" if tid else "")
    return dict(title=title, title_fold=fold(title), status=b.get("status"), priority=b.get("priority"), module_code=derive_module(title, mod_index),
                project_id=proj.id if proj else None, created_at_ext=_dt(b.get("created_At")), updated_at_ext=_dt(b.get("status_Updated_At")),
                assignee=_person(b.get("assignTo")), approver=_person(b.get("approverEntity")), is_deleted=bool(b.get("is_Deleted")),
                url=hw_url, extra={k: v for k, v in b.items() if k not in _KNOWN})


def get_source(session: Session, code: str, name: str) -> BugSource:
    src = session.scalar(select(BugSource).where(BugSource.code == code))
    if src is None:
        src = BugSource(code=code, name=name)
        session.add(src)
        session.flush()
    return src


def upsert_bug(session: Session, src: BugSource, ext_id: str, fields: dict, snapshot_payload: dict, rep: Report) -> Bug:
    """Idempotent: không đổi nội dung (theo băm) ⇒ bỏ qua; đổi ⇒ cập nhật + thêm snapshot lịch sử."""
    h = stable_hash({"src": snapshot_payload, "module": fields.get("module_code", "")})  # module suy ra cũng là một phần nội dung
    bug = session.scalar(select(Bug).where(Bug.source_id == src.id, Bug.external_id == ext_id))
    if bug is None:
        bug = Bug(source_id=src.id, external_id=ext_id, **fields)
        session.add(bug)
        session.flush()
        rep.created += 1
    elif session.scalar(select(BugSnapshot.id).where(BugSnapshot.bug_id == bug.id, BugSnapshot.content_hash == h)):
        # Nếu trước đó thiếu approver/assignee do lỗi parse, vẫn cập nhật lại cột trên bảng bugs
        changed = False
        for col in ("approver", "assignee", "module_code", "url"):
            if not getattr(bug, col) and fields.get(col):
                setattr(bug, col, fields[col])
                changed = True
        if changed:
            rep.updated += 1
        else:
            rep.skipped += 1
        return bug
    else:
        for k, v in fields.items():
            setattr(bug, k, v)
        rep.updated += 1
    session.add(BugSnapshot(bug_id=bug.id, content_hash=h, payload=snapshot_payload))
    rep.snapshots += 1
    return bug


def import_legacy_kb(session: Session, bugs_json: Path, *, apply: bool) -> Report:
    """M-07: bugs.json (6059). Chỉ đọc nguồn. `c` → classification (KHÔNG suy ra status); `g`, `how` giữ trong extra."""
    rep = Report("legacy_kb")
    data = json.loads(bugs_json.read_text(encoding="utf-8-sig"))
    src = get_source(session, "legacy_kb", "Kho bug cũ (kb-snapshot)")
    src.config = {"revision": data.get("revision"), "synced_at": data.get("synced_at"), "count": data.get("count")}
    for b in data.get("bugs", []):
        try:
            ext = str(b["id"])
            title = str(b.get("t", ""))
            fields = dict(title=title, title_fold=fold(title), classification=str(b.get("c", "")), module_code=str(b.get("m", "")),
                          created_at_ext=_dt(b.get("d")), url=str(b.get("u", "")), extra={"g": b.get("g"), "how": b.get("how")})
            upsert_bug(session, src, ext, fields, b, rep)
        except Exception as exc:  # noqa: BLE001
            rep.errors.append(f"{b.get('id')}: {exc}")
    return _finish(session, rep, apply)


def import_live(session: Session, live_json: Path, *, apply: bool) -> Report:
    """M-08: bugs-live.json (Haraworks). Trường chưa ánh xạ (additionalInfo, plan_*…) giữ trong extra."""
    rep = Report("haraworks")
    data = json.loads(live_json.read_text(encoding="utf-8-sig"))
    src = get_source(session, "haraworks", "Haraworks (realtime)")
    src.config = {"fieldsVersion": data.get("fieldsVersion"), "projects": [p.get("id") for p in data.get("projects", [])]}
    projects: dict[str, Project] = {}
    mod_index = module_index(session)
    for p in data.get("projects", []):
        pid = str(p["id"])
        proj = session.scalar(select(Project).where(Project.source_id == src.id, Project.external_id == pid))
        if proj is None:
            proj = Project(source_id=src.id, external_id=pid, name=str(p.get("name", "")))
            session.add(proj)
            session.flush()
            rep.projects_created += 1
        projects[pid] = proj

    src.config = {**(src.config or {}), "all_tasks": {str(p["id"]): bool(p.get("allTasks")) for p in data.get("projects", [])},
                  "versions": {str(p["id"]): str(p.get("version", "0")) for p in data.get("projects", [])}, "seen": data.get("seen") or {}}
    for b in data.get("bugs", []):
        try:
            ext = str(b["id"])
            proj = projects.get(str(b.get("project_Id")))
            upsert_bug(session, src, ext, live_fields(b, proj, mod_index), b, rep)
        except Exception as exc:  # noqa: BLE001
            rep.errors.append(f"{b.get('id')}: {exc}")
    return _finish(session, rep, apply)


def _finish(session: Session, rep: Report, apply: bool) -> Report:
    if apply:
        session.commit()
    else:
        session.rollback()
    return rep


CLOSED_STATUSES = {4, 5, 10, 11}


def search_bugs(session: Session, *, q: str = "", source: str = "", module: str = "", status: int | None = None,
                project_id=None, project_name: str = "", closed: str = "", assignee: str = "", approver: str = "",
                classification: str = "", year: str = "", date_range: str = "", sort: str = "created",
                limit: int = 50, offset: int = 0) -> tuple[int, list[tuple[Bug, str]]]:
    stmt = select(Bug, BugSource.code).join(BugSource, BugSource.id == Bug.source_id).where(Bug.is_deleted.is_(False))
    if source:
        stmt = stmt.where(BugSource.code == source)
    if module:
        stmt = stmt.where(Bug.module_code == module)
    if status is not None:
        stmt = stmt.where(Bug.status == status)
    if closed == "open":
        stmt = stmt.where((Bug.status.is_(None)) | (~Bug.status.in_(CLOSED_STATUSES)))
    elif closed == "closed":
        stmt = stmt.where(Bug.status.in_(CLOSED_STATUSES))
    if assignee:
        stmt = stmt.where(Bug.assignee == assignee)
    if approver:
        stmt = stmt.where(Bug.approver == approver)
    if classification:
        stmt = stmt.where(Bug.classification == classification)
    if project_id:
        stmt = stmt.where(Bug.project_id == project_id)
    if project_name:
        stmt = stmt.join(Project, Project.id == Bug.project_id).where(Project.name == project_name)
    if year and year.isdigit() and len(year) == 4:
        y = int(year)
        stmt = stmt.where(Bug.created_at_ext >= dt.datetime(y, 1, 1, tzinfo=dt.timezone.utc),
                          Bug.created_at_ext < dt.datetime(y + 1, 1, 1, tzinfo=dt.timezone.utc))
    if date_range:
        now = dt.datetime.now(dt.timezone.utc)
        if date_range == "old":
            stmt = stmt.where(Bug.created_at_ext < now - dt.timedelta(days=30))
        else:
            days_map = {"today": 1, "week": 7, "month": 30, "30d": 30, "quarter": 90}
            if date_range in days_map:
                stmt = stmt.where(Bug.created_at_ext >= now - dt.timedelta(days=days_map[date_range]))
    for term in fold(q).split():
        stmt = stmt.where(Bug.title_fold.like(f"%{like_escape(term)}%", escape="\\"))
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    if sort == "priority":
        order = (Bug.priority.asc().nulls_last(), Bug.created_at_ext.desc().nulls_last())
    else:
        order = (Bug.created_at_ext.desc().nulls_last(), Bug.external_id)
    rows = session.execute(stmt.order_by(*order).limit(min(limit, 200)).offset(offset)).all()
    return total, [(b, c) for b, c in rows]
