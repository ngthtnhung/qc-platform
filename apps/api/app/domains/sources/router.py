from __future__ import annotations

import datetime as dt
import json
import uuid
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_session
from app.core.deps import current_principal, require
from app.core.errors import AppError, NotFound
from app.core.principal import Perm, Principal
from app.domains.files.storage import StorageBackend, get_storage
from app.domains.integrations import service as integ
from app.domains.knowledge.models import Source, SourceVersion
from app.domains.platform.audit import log_audit
from app.domains.sources import ingest, search
from app.domains.sources.models import Lookup, SourcePassage

router = APIRouter(tags=["sources"])
WIKI_TRANSPORT: httpx.BaseTransport | None = None  # chỉ dùng trong test


def storage_dep() -> StorageBackend:
    return get_storage()


def _result(r: ingest.IngestResult) -> dict:
    return {"source_id": str(r.source_id), "version_id": str(r.version_id), "version": r.version_label, "passages": r.passages, "duplicate": r.duplicate, "note": r.note}


# ----------------------------------------------------------------------------- nguồn
@router.get("/sources")
def list_sources(kind: str = "", module: str = "", include_retired: bool = False, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    q = select(Source).order_by(Source.kind, Source.title)
    if kind:
        q = q.where(Source.kind == kind)
    if not include_retired:
        q = q.where(Source.status == "active")
    mod_filter = module.strip().upper()
    out = []
    for s in session.scalars(q):
        if s.kind not in ingest.KIND_LABEL:  # nguồn cũ của Kho rule / release_build: không phải nguồn tra cứu trích dẫn
            continue
        s_meta = s.meta or {}
        s_mod = str(s_meta.get("module") or "").strip().upper()
        if mod_filter and s_mod != mod_filter:
            continue
        vers = session.scalars(select(SourceVersion).where(SourceVersion.source_id == s.id).order_by(SourceVersion.created_at.desc())).all()
        counts = dict(session.execute(select(SourcePassage.source_version_id, func.count()).where(SourcePassage.source_version_id.in_([v.id for v in vers] or [uuid.uuid4()]),
                                                                                                   SourcePassage.is_current.is_(True)).group_by(SourcePassage.source_version_id)).all())
        out.append({"id": str(s.id), "kind": s.kind, "kind_label": ingest.KIND_LABEL[s.kind], "title": s.title, "url": s.external_url, "status": s.status,
                    "module": s_mod, "updated_at": str(s_meta.get("updated_at") or s.created_at.isoformat()),
                    "meta": s_meta, "created_at": s.created_at.isoformat(),
                    "versions": [{"id": str(v.id), "label": v.label, "created_at": v.created_at.isoformat(), "current_passages": counts.get(v.id, 0),
                                  "has_file": v.file_id is not None, "file_id": str(v.file_id) if v.file_id else None,
                                  "meta": {k: x for k, x in (v.meta or {}).items() if k != "sha256"}} for v in vers]})
    return {"items": out, "coverage": search.coverage(session)}


# 37 Module chuẩn Haraworks với 37 màu riêng biệt (không trùng nhau) + alias tiền tố
LEGACY_MODULES: list[tuple[str, str, str, list[str]]] = [
    ("4RUM", "Diễn đàn", "#e11d48", []),
    ("ACC", "Account", "#2563eb", ["ACCOUNT"]),
    ("ANNOUN", "Thông báo", "#dc2626", ["THÔNG BÁO", "NOTI"]),
    ("BONUS", "Thưởng", "#d97706", []),
    ("BOOKING", "Đặt tài nguyên", "#0d9488", []),
    ("BOSS", "BOSS", "#1e293b", []),
    ("BUDGET", "Ngân sách", "#15803d", []),
    ("CHAT", "ZuiZui", "#7c3aed", ["ZUIZUI"]),
    ("CHECK", "Chấm điểm", "#0284c7", []),
    ("CHECKLIST", "Việc cần làm", "#0891b2", []),
    ("COMMON", "Common", "#475569", []),
    ("CUS", "Chăm sóc khách hàng", "#db2777", []),
    ("DELP", "Triển khai", "#ea580c", ["DEPL"]),
    ("DRIVE", "Tài liệu", "#4f46e5", []),
    ("DV5S", "Dịch vụ 5 sao", "#ca8a04", []),
    ("EFORM", "Quy trình phê duyệt", "#9333ea", []),
    ("ESIGN", "Chữ ký Haraworks", "#be123c", []),
    ("FILE", "Thư viện", "#0f766e", []),
    ("HOME", "Trang chủ", "#0369a1", []),
    ("HRM", "Nhân sự", "#059669", ["HR"]),
    ("HRWS DIS", "Haraworks Discover", "#6d28d9", ["HRWSDIS"]),
    ("IOT", "Hỗ trợ kĩ thuật", "#b45309", []),
    ("LISTEN", "Lắng nghe", "#c026d3", []),
    ("LND", "Học tập", "#16a34a", []),
    ("MAIL", "Hộp thư", "#0e7490", []),
    ("MAINT", "Bảo trì", "#b91c1c", []),
    ("NEWS", "Tạp chí", "#a21caf", []),
    ("NPS", "Khảo sát", "#65a30d", []),
    ("QC", "Chất lượng", "#1d4ed8", []),
    ("REC", "Tuyển dụng", "#ec4899", []),
    ("RISK", "Quản lý rủi ro", "#991b1b", []),
    ("SAL", "Lương", "#047857", []),
    ("SCM", "Dịch vụ hàng hóa", "#c2410c", []),
    ("SHIFT", "Xếp ca", "#4338ca", []),
    ("SMART", "Vận hành thông minh", "#06b6d4", []),
    ("TASK", "Công việc", "#3b82f6", []),
    ("VHST", "Vận hành siêu thị", "#854d0e", []),
]
LEGACY_MODULE_COLORS: dict[str, tuple[str, str]] = {code: (name, color) for code, name, color, _ in LEGACY_MODULES}
DEFAULT_DV5S_FLOWS = [
    {"code": "DS", "name": "Danh sách & Tìm kiếm phiếu"},
    {"code": "TAO", "name": "Tạo & Cập nhật phiếu"},
    {"code": "BC", "name": "Báo cáo & Thống kê"},
    {"code": "TL", "name": "Thiết lập nhân viên & Cấu hình phụ trách"},
    {"code": "SLA", "name": "Thiết lập SLA"},
]
DEFAULT_DV5S_ROLES = ["Quản trị module", "Quản lý", "Nhân viên phụ trách", "Người tạo phiếu"]
DEFAULT_MODULE_CLUSTER_META: dict[str, dict] = {
    "DV5S": {"cluster_code": "DV5S", "subsystem_slug": "maintenance", "flows": DEFAULT_DV5S_FLOWS, "standard_roles": DEFAULT_DV5S_ROLES},
    "MAINT": {"cluster_code": "DV5S", "subsystem_slug": "maintenance", "flows": DEFAULT_DV5S_FLOWS, "standard_roles": DEFAULT_DV5S_ROLES},
    "SCM": {"cluster_code": "DV5S", "subsystem_slug": "scm", "flows": DEFAULT_DV5S_FLOWS, "standard_roles": DEFAULT_DV5S_ROLES},
    "IOT": {"cluster_code": "DV5S", "subsystem_slug": "iot", "flows": DEFAULT_DV5S_FLOWS, "standard_roles": DEFAULT_DV5S_ROLES},
}
_MOD_PALETTE = [
    "#2563eb", "#059669", "#d97706", "#7c3aed",
    "#db2777", "#0891b2", "#ea580c", "#4f46e5",
    "#16a34a", "#dc2626", "#0284c7", "#9333ea",
]


def _default_mod_color(code: str) -> str:
    up = (code or "").strip().upper()
    if up in LEGACY_MODULE_COLORS:
        return LEGACY_MODULE_COLORS[up][1]
    h = sum((i + 1) * ord(ch) for i, ch in enumerate(up))
    return _MOD_PALETTE[h % len(_MOD_PALETTE)]


def _ensure_default_modules(session: Session) -> None:
    """Tự động nạp 37 module chuẩn, đồng thời merge bổ sung metadata cụm DV5S (MAINT/SCM/IOT) nếu còn trống."""
    from app.domains.bugs.models import Bug
    from app.domains.bugs.service import derive_module, module_index
    from app.domains.knowledge.models import Module

    existing_count = session.scalar(select(func.count()).select_from(Module)) or 0
    if existing_count == 0:
        for code, name, color, aliases in LEGACY_MODULES:
            cmeta = DEFAULT_MODULE_CLUSTER_META.get(code, {})
            session.add(Module(
                code=code,
                name=name,
                prefix=code,
                cluster_code=cmeta.get("cluster_code", ""),
                subsystem_slug=cmeta.get("subsystem_slug", ""),
                flows=list(cmeta.get("flows") or []),
                standard_roles=list(cmeta.get("standard_roles") or []),
                extra={"color": color, "bug_aliases": aliases},
            ))
        session.flush()
        idx = module_index(session)
        for b in session.scalars(select(Bug).where(Bug.module_code == "")):
            matched = derive_module(b.title or "", idx)
            if matched:
                b.module_code = matched
        session.flush()
        return

    # Merge phần còn thiếu cho các module thuộc cụm DV5S mà không ghi đè dữ liệu đã cấu hình
    changed = False
    for code, cmeta in DEFAULT_MODULE_CLUSTER_META.items():
        m = session.scalar(select(Module).where(Module.code == code))
        if m is None:
            continue
        if not (m.cluster_code or "").strip() and cmeta.get("cluster_code"):
            m.cluster_code = cmeta["cluster_code"]
            changed = True
        if not (m.subsystem_slug or "").strip() and cmeta.get("subsystem_slug"):
            m.subsystem_slug = cmeta["subsystem_slug"]
            changed = True
        if not (m.flows or []) and cmeta.get("flows"):
            m.flows = list(cmeta["flows"])
            changed = True
        if not (m.standard_roles or []) and cmeta.get("standard_roles"):
            m.standard_roles = list(cmeta["standard_roles"])
            changed = True
    if changed:
        session.flush()


class ModuleIn(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(default="", max_length=200)
    prefix: str = Field(default="", max_length=40)
    color: str = Field(default="", max_length=20)
    aliases: list[str] = []
    cluster_code: str = Field(default="", max_length=40)
    subsystem_slug: str = Field(default="", max_length=60)
    flows: list[dict] = []
    standard_roles: list[str] = []


class ModuleUpdateIn(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    prefix: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, max_length=20)
    aliases: list[str] | None = None
    cluster_code: str | None = Field(default=None, max_length=40)
    subsystem_slug: str | None = Field(default=None, max_length=60)
    flows: list[dict] | None = None
    standard_roles: list[str] | None = None


def _mod_out(m) -> dict:
    code = m.code.strip().upper()
    ex = m.extra or {}
    legacy_name = LEGACY_MODULE_COLORS.get(code, ("", ""))[0]
    return {
        "id": str(m.id),
        "code": code,
        "name": m.name or legacy_name or code,
        "prefix": (m.prefix or code).strip().upper(),
        "color": str(ex.get("color") or _default_mod_color(code)),
        "aliases": list(ex.get("bug_aliases") or []),
        "cluster_code": (m.cluster_code or "").strip().upper(),
        "subsystem_slug": (m.subsystem_slug or "").strip().lower(),
        "flows": list(m.flows or []),
        "standard_roles": list(m.standard_roles or []),
        "custom": True,
    }


@router.get("/sources/modules")
def list_source_modules(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.domains.bugs.models import Bug
    from app.domains.knowledge.models import Module

    _ensure_default_modules(session)

    mods: dict[str, dict] = {}
    for m in session.scalars(select(Module).order_by(Module.code)):
        item = _mod_out(m)
        mods[item["code"]] = item
    for (mc,) in session.execute(select(Bug.module_code).where(Bug.module_code != "").distinct()):
        c = str(mc).strip().upper()
        if c and c not in mods:
            cmeta = DEFAULT_MODULE_CLUSTER_META.get(c, {})
            mods[c] = {
                "id": "",
                "code": c,
                "name": LEGACY_MODULE_COLORS.get(c, (c, ""))[0],
                "prefix": c,
                "color": _default_mod_color(c),
                "aliases": [],
                "cluster_code": cmeta.get("cluster_code", ""),
                "subsystem_slug": cmeta.get("subsystem_slug", ""),
                "flows": list(cmeta.get("flows") or []),
                "standard_roles": list(cmeta.get("standard_roles") or []),
                "custom": False,
            }
    for s in session.scalars(select(Source).where(Source.status == "active")):
        c = str((s.meta or {}).get("module") or "").strip().upper()
        if c and c not in mods:
            cmeta = DEFAULT_MODULE_CLUSTER_META.get(c, {})
            mods[c] = {
                "id": "",
                "code": c,
                "name": LEGACY_MODULE_COLORS.get(c, (c, ""))[0],
                "prefix": c,
                "color": _default_mod_color(c),
                "aliases": [],
                "cluster_code": cmeta.get("cluster_code", ""),
                "subsystem_slug": cmeta.get("subsystem_slug", ""),
                "flows": list(cmeta.get("flows") or []),
                "standard_roles": list(cmeta.get("standard_roles") or []),
                "custom": False,
            }
    return {"items": sorted(mods.values(), key=lambda x: x["code"])}


@router.post("/sources/modules", status_code=201)
def create_source_module(body: ModuleIn, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.domains.bugs.models import Bug
    from app.domains.bugs.service import derive_module, module_index
    from app.domains.knowledge.models import Module

    code = body.code.strip().upper()
    if not code:
        raise AppError("Mã module không được để trống", code="VALIDATION_ERROR", status=422)
    existing = session.scalar(select(Module).where(Module.code == code))
    prefix = (body.prefix or code).strip().upper()
    color = body.color.strip() or _default_mod_color(code)
    aliases = [a.strip().upper() for a in body.aliases if a and a.strip()]
    if existing is not None:
        existing.name = body.name.strip() or existing.name or code
        existing.prefix = prefix
        if body.cluster_code.strip():
            existing.cluster_code = body.cluster_code.strip().upper()
        if body.subsystem_slug.strip():
            existing.subsystem_slug = body.subsystem_slug.strip().lower()
        if body.flows:
            existing.flows = body.flows
        if body.standard_roles:
            existing.standard_roles = [r.strip() for r in body.standard_roles if str(r).strip()]
        ex = dict(existing.extra or {})
        ex["color"] = color
        ex["bug_aliases"] = aliases
        existing.extra = ex
        m = existing
    else:
        m = Module(
            code=code,
            name=body.name.strip() or LEGACY_MODULE_COLORS.get(code, (code, ""))[0],
            prefix=prefix,
            cluster_code=body.cluster_code.strip().upper(),
            subsystem_slug=body.subsystem_slug.strip().lower(),
            flows=body.flows,
            standard_roles=[r.strip() for r in body.standard_roles if str(r).strip()],
            extra={"color": color, "bug_aliases": aliases},
        )
        session.add(m)
    session.flush()
    # Tự động nhận diện lại các bug chưa có module khớp với tiền tố mới thêm
    idx = module_index(session)
    for b in session.scalars(select(Bug).where(Bug.module_code == "")):
        matched = derive_module(b.title or "", idx)
        if matched:
            b.module_code = matched
    session.flush()
    log_audit(session, p, "MODULE_SAVE", resource_type="module", resource_id=str(m.id), after={"code": code, "prefix": prefix, "color": color})
    return _mod_out(m)


@router.patch("/sources/modules/{code}")
def update_source_module(code: str, body: ModuleUpdateIn, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from sqlalchemy.orm.attributes import flag_modified

    from app.domains.knowledge.models import Module

    up = code.strip().upper()
    m = session.scalar(select(Module).where(Module.code == up))
    if m is None:
        m = Module(
            code=up,
            name=LEGACY_MODULE_COLORS.get(up, (up, ""))[0],
            prefix=up,
            extra={"color": _default_mod_color(up), "bug_aliases": []},
        )
        session.add(m)
    if body.name is not None:
        m.name = body.name.strip() or up
    if body.prefix is not None:
        m.prefix = body.prefix.strip().upper() or up
    if body.cluster_code is not None:
        m.cluster_code = body.cluster_code.strip().upper()
    if body.subsystem_slug is not None:
        m.subsystem_slug = body.subsystem_slug.strip().lower()
    if body.flows is not None:
        m.flows = body.flows
        flag_modified(m, "flows")
    if body.standard_roles is not None:
        m.standard_roles = [str(r).strip() for r in body.standard_roles if str(r).strip()]
        flag_modified(m, "standard_roles")
    ex = dict(m.extra or {})
    if body.color is not None and body.color.strip():
        ex["color"] = body.color.strip()
    if body.aliases is not None:
        ex["bug_aliases"] = [a.strip().upper() for a in body.aliases if a and a.strip()]
    m.extra = ex
    flag_modified(m, "extra")
    session.flush()
    log_audit(session, p, "MODULE_UPDATE", resource_type="module", resource_id=str(m.id), after={"code": up, "name": m.name, "prefix": m.prefix, "color": ex.get("color")})
    return _mod_out(m)


@router.delete("/sources/modules/{code}", status_code=204)
def delete_source_module(code: str, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.domains.knowledge.models import Module

    up = code.strip().upper()
    m = session.scalar(select(Module).where(Module.code == up))
    if m is None:
        raise NotFound("Không thấy module để xóa")
    session.delete(m)
    session.flush()
    log_audit(session, p, "MODULE_DELETE", resource_type="module", resource_id=up)


@router.get("/sources/task-functions")
def list_task_functions(q: str = "", team: str = "", module: str = "", status: str = "", closed: str = "",
                        assignee: str = "", date_range: str = "", sort: str = "created", limit: int = 50, offset: int = 0,
                        _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.core.text import fold, like_escape

    stmt = (select(SourcePassage, Source).join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
            .join(Source, Source.id == SourceVersion.source_id)
            .where(Source.kind == "task_function", Source.status == "active", SourcePassage.is_current.is_(True)))
    for term in fold(q).split():
        stmt = stmt.where(SourcePassage.text_fold.like(f"%{like_escape(term)}%", escape="\\"))
    all_rows = session.execute(stmt.order_by(SourcePassage.created_at.desc(), SourcePassage.seq)).all()
    teams: set[str] = set()
    modules: set[str] = set()
    assignees: set[str] = set()
    statuses: dict[str, str] = {}
    filtered = []
    team_f = team.strip().lower()
    mod_f = module.strip().upper()
    st_f = status.strip()
    as_f = assignee.strip()
    cutoff_iso = ""
    year_filter = ""
    if date_range in ("today", "week", "month", "30d", "quarter"):
        days_map = {"today": 1, "week": 7, "month": 30, "30d": 30, "quarter": 90}
        cutoff_iso = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days_map[date_range])).isoformat()
    elif date_range.isdigit() and len(date_range) == 4:
        year_filter = date_range
    for p, src in all_rows:
        loc = p.locator or {}
        if loc.get("parent_id") or loc.get("is_group_task"):
            continue
        t_name = str(loc.get("team") or (src.meta or {}).get("team") or loc.get("project") or "Không rõ")
        m_code = str(loc.get("module") or p.heading_path or "").strip().upper()
        is_closed = bool(loc.get("closed"))
        st_code = loc.get("status")
        st_label = str(loc.get("status_label") or "")
        as_name = str(loc.get("assignee") or "")
        if t_name:
            teams.add(t_name)
        if m_code:
            modules.add(m_code)
        if as_name:
            assignees.add(as_name)
        if st_code is not None and st_label:
            statuses[str(st_code)] = st_label
        if team_f and team_f not in t_name.lower():
            continue
        if mod_f and m_code != mod_f:
            continue
        if st_f != "" and str(st_code) != st_f:
            continue
        if as_f and as_name != as_f:
            continue
        if closed == "open" and is_closed:
            continue
        if closed == "closed" and not is_closed:
            continue
        lines = (p.text or "").split("\n", 1)
        created_iso = str(loc.get("created_at") or "")
        if not created_iso or created_iso[:10] < "2024-01-01":
            continue
        if cutoff_iso and created_iso < cutoff_iso:
            continue
        if year_filter and not created_iso.startswith(year_filter):
            continue
        filtered.append({
            "id": str(p.id),
            "task_id": str(loc.get("task_id") or p.external_key or ""),
            "title": lines[0],
            "description": lines[1] if len(lines) > 1 else "",
            "has_description": bool(loc.get("has_description") or (len(lines) > 1 and lines[1].strip())),
            "team": t_name,
            "project": str(loc.get("project") or t_name),
            "module": m_code,
            "status": st_code,
            "status_label": st_label,
            "closed": is_closed,
            "priority": loc.get("priority"),
            "priority_label": str(loc.get("priority_label") or ""),
            "assignee": as_name,
            "approver": str(loc.get("approver") or ""),
            "platform": str(loc.get("platform") or ""),
            "customer": str(loc.get("customer") or ""),
            "build_number": str(loc.get("buildNumber") or ""),
            "url": str(loc.get("url") or ""),
            "created_at": created_iso,
            "updated_at": str(loc.get("updated_at") or created_iso),
        })
    if sort == "priority":
        filtered.sort(key=lambda x: x["created_at"], reverse=True)
        filtered.sort(key=lambda x: x["priority"] if x["priority"] is not None else 99)
    elif sort == "updated":
        filtered.sort(key=lambda x: x["updated_at"], reverse=True)
    else:
        filtered.sort(key=lambda x: x["created_at"], reverse=True)
    total = len(filtered)
    page = filtered[offset:offset + min(limit, 200)]
    return {"total": total, "items": page, "teams": sorted(teams), "modules": sorted(modules), "assignees": sorted(assignees), "statuses": statuses}


class BuildIn(BaseModel):
    title: str = Field(min_length=1, max_length=400)
    team: str = ""
    project: str = ""
    module: str = ""
    status: str = "Đang theo dõi"
    version: str = ""
    platform: str = ""
    parent_task: str = ""
    url: str = ""
    note: str = ""


def _build_version(session: Session, actor: Principal) -> SourceVersion:
    src = session.scalar(select(Source).where(Source.kind == "release_build", Source.title == "Release Builds"))
    if src is None:
        src = Source(kind="release_build", title="Release Builds", external_url="", created_by=actor.id, meta={"system": True})
        session.add(src)
        session.flush()
    ver = session.scalar(select(SourceVersion).where(SourceVersion.source_id == src.id, SourceVersion.label == "live"))
    if ver is None:
        ver = SourceVersion(source_id=src.id, label="live", meta={"live": True})
        session.add(ver)
        session.flush()
    return ver


@router.get("/sources/dashboard")
def personal_dashboard_tasks(p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    """Trả toàn bộ task cá nhân cho Dashboard: Bug (Tôi duyệt + Tôi thực hiện), Task Function con tiền tố QC, và Release Function."""
    from app.core.text import fold
    from app.domains.bugs.models import Bug, BugSource, Project
    from app.domains.bugs.service import CLOSED_STATUSES, PRIORITY_LABELS, STATUS_LABELS
    from app.domains.platform.models import User

    user = session.get(User, p.id)
    tokens = [fold(x) for x in (user.display_name if user else "", user.employee_code if user else "") if x and x.strip()]

    def is_me(name_str: str) -> bool:
        if not tokens or not name_str:
            return False
        f = fold(name_str)
        return any(t in f for t in tokens)

    items: list[dict] = []

    # 1. Bug của tôi (Tôi thực hiện hoặc Tôi duyệt)
    proj_map = {pr.id: (pr.name, pr.external_id) for pr in session.scalars(select(Project))}
    bug_rows = session.execute(
        select(Bug, BugSource.code).join(BugSource, BugSource.id == Bug.source_id).where(Bug.is_deleted.is_(False))
    ).all()
    for b, src_code in bug_rows:
        am_asg = is_me(b.assignee or "")
        am_app = is_me(b.approver or "")
        if not am_asg and not am_app:
            continue
        extra = b.extra if isinstance(b.extra, dict) else {}
        ai = extra.get("additionalInfo") or []
        info = {str(i.get("key")): i.get("value") for i in ai if isinstance(i, dict)} if isinstance(ai, list) else (ai if isinstance(ai, dict) else {})
        missing: list[str] = []
        if not str(info.get("customer") or extra.get("customerName") or "").strip():
            missing.append("Khách hàng")
        if not str(b.module_code or info.get("module") or extra.get("moduleName") or "").strip():
            missing.append("Ứng dụng")
        if not str(info.get("platform") or extra.get("platform") or "").strip():
            missing.append("Nền tảng")
        if not str(b.classification or info.get("type") or "").strip():
            missing.append("Phân loại")
        if not str(info.get("priority") or info.get("severity") or extra.get("severity") or "").strip():
            missing.append("Độ nghiêm trọng")
        st = b.status
        p_name, p_ext = proj_map.get(b.project_id, (src_code, "")) if b.project_id else (src_code, "")
        bug_url = b.url or (f"https://tasks.haraworks.vn/task/project/{p_ext}/{b.external_id}" if (p_ext and b.external_id) else (f"https://tasks.haraworks.vn/task/me/{b.external_id}" if b.external_id else ""))
        items.append({
            "uid": f"bug_{b.id}",
            "kind": "bug",
            "external_id": b.external_id,
            "title": b.title,
            "module": b.module_code or str(info.get("module") or "").upper(),
            "project": p_name,
            "status": st,
            "status_label": STATUS_LABELS.get(st, "Mới") if st is not None else "Mới",
            "closed": st in CLOSED_STATUSES if st is not None else False,
            "priority": b.priority,
            "priority_label": PRIORITY_LABELS.get(b.priority, "") if b.priority is not None else "",
            "assignee": b.assignee or "",
            "approver": b.approver or "",
            "role": "assignee" if am_asg else "approver",
            "is_assignee": am_asg,
            "is_approver": am_app,
            "plan_start_at": str(extra.get("plan_Start_At") or extra.get("planStartAt") or ""),
            "plan_end_at": str(extra.get("plan_End_At") or extra.get("planEndAt") or ""),
            "created_at": b.created_at_ext.isoformat() if b.created_at_ext else "",
            "updated_at": str(extra.get("status_Updated_At") or (b.created_at_ext.isoformat() if b.created_at_ext else "")),
            "url": bug_url,
            "missing_fields": missing,
        })

    # 2. Task Function (chỉ task con tiền tố QC của 4 dự án Function gán cho tôi)
    qc_rows = session.scalars(
        select(SourcePassage)
        .join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
        .join(Source, Source.id == SourceVersion.source_id)
        .where(Source.kind == "qc_function_child", Source.status == "active", SourcePassage.is_current.is_(True))
    ).all()
    for r in qc_rows:
        loc = r.locator or {}
        am_asg = is_me(str(loc.get("assignee") or ""))
        am_app = is_me(str(loc.get("approver") or ""))
        if not am_asg and not am_app:
            continue
        st = loc.get("status")
        items.append({
            "uid": f"qcfn_{r.id}",
            "kind": "function",
            "external_id": str(loc.get("task_id") or r.external_key or ""),
            "title": (r.text or "").split("\n", 1)[0],
            "module": str(loc.get("module") or r.heading_path or "").upper(),
            "project": str(loc.get("team") or loc.get("project") or ""),
            "status": st,
            "status_label": str(loc.get("status_label") or "Mới"),
            "closed": bool(loc.get("closed")),
            "priority": loc.get("priority"),
            "priority_label": str(loc.get("priority_label") or ""),
            "assignee": str(loc.get("assignee") or ""),
            "approver": str(loc.get("approver") or ""),
            "role": "assignee" if am_asg else "approver",
            "is_assignee": am_asg,
            "is_approver": am_app,
            "plan_start_at": str(loc.get("plan_start_at") or ""),
            "plan_end_at": str(loc.get("plan_end_at") or ""),
            "created_at": str(loc.get("created_at") or ""),
            "updated_at": str(loc.get("updated_at") or loc.get("created_at") or ""),
            "url": str(loc.get("url") or ""),
            "missing_fields": [],
        })

    # 3. Release Function (HRWs - RELEASE CHECKLIST gán cho tôi)
    rel_rows = session.scalars(
        select(SourcePassage)
        .join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
        .join(Source, Source.id == SourceVersion.source_id)
        .where(Source.kind == "release_build", Source.status == "active", SourcePassage.is_current.is_(True))
    ).all()
    fn_by_id, fn_by_title = _build_fn_index(session)
    for r in rel_rows:
        loc = r.locator or {}
        if str(loc.get("kind") or "") != "function":
            continue
        am_asg = is_me(str(loc.get("assignee") or ""))
        am_app = is_me(str(loc.get("approver") or ""))
        if not am_asg and not am_app:
            continue
        bid = str(loc.get("build_id") or r.external_key or "")
        b_title = (r.text or "").split("\n", 1)[0]
        src_fn, src_team = _resolve_build_source(bid, b_title, loc, fn_by_id, fn_by_title)
        items.append({
            "uid": f"rel_{r.id}",
            "kind": "release",
            "external_id": bid,
            "title": b_title,
            "module": str(loc.get("module") or r.heading_path or "").upper(),
            "project": str(loc.get("project") or src_team or "HRWs - RELEASE CHECKLIST"),
            "source_team": src_team,
            "source_function": src_fn,
            "status": loc.get("status_code"),
            "status_label": str(loc.get("status") or "Mới"),
            "closed": bool(loc.get("closed")),
            "priority": loc.get("priority"),
            "priority_label": str(loc.get("priority_label") or ""),
            "assignee": str(loc.get("assignee") or ""),
            "approver": str(loc.get("approver") or ""),
            "role": "assignee" if am_asg else "approver",
            "is_assignee": am_asg,
            "is_approver": am_app,
            "plan_start_at": str(loc.get("plan_start_at") or ""),
            "plan_end_at": str(loc.get("plan_end_at") or ""),
            "created_at": str(loc.get("created_at") or ""),
            "updated_at": str(loc.get("updated_at") or loc.get("created_at") or ""),
            "url": str(loc.get("url") or ""),
            "missing_fields": [],
        })

    items.sort(key=lambda x: x["created_at"], reverse=True)
    return {
        "user": {"display_name": user.display_name if user else "", "employee_code": user.employee_code if user else ""},
        "items": items,
    }


_NOTI_CACHE: dict[str, tuple[float, dict]] = {}
_COLLEAGUE_CACHE: dict[str, str] = {}


def _fetch_hw_notifications(session: Session, p: Principal, force: bool = False) -> dict:
    """Lấy danh sách thông báo trực tiếp realtime từ Haraworks (chỉ đọc, cache 15 giây)."""
    import re
    import time

    now = time.monotonic()
    cached = _NOTI_CACHE.get("global")
    if not force and cached and now - cached[0] < 15.0:
        return cached[1]

    try:
        client = integ.haraworks_client(session, p)
    except Exception as exc:  # noqa: BLE001
        return {"connected": False, "error": str(exc), "items": [], "unread_count": 0, "synced_at": dt.datetime.now(dt.timezone.utc).isoformat()}

    headers = {
        "accept": "application/json",
        "cookie": client.cookie,
        "origin": client.base,
        "referer": f"{client.base}/task/me",
    }
    try:
        r_list = client._http.get(
            f"{client.base}/call/im_api/notify_center/notifications",
            params={"page": 1, "page_size": 25, "module": "all"},
            headers=headers,
            timeout=12.0,
        )
        if r_list.status_code in (401, 403) or 300 <= r_list.status_code < 400:
            from app.core.db import utcnow
            from app.domains.sources.models import Integration

            hw_int = session.get(Integration, "haraworks")
            if hw_int is not None:
                hw_int.last_check_status = f"hết hạn: Cookie Haraworks hết hạn (HTTP {r_list.status_code})"
                hw_int.last_check_at = utcnow()
                session.flush()
            res_obj = {"connected": False, "error": "Cookie Haraworks hết hạn hoặc chưa hợp lệ", "items": [], "unread_count": 0, "synced_at": dt.datetime.now(dt.timezone.utc).isoformat()}
            _NOTI_CACHE["global"] = (now, res_obj)
            return res_obj
        r_list.raise_for_status()
        raw_items = (r_list.json().get("data") or {}).get("data") or []
        # Giải mã tên người gửi (tối đa 10 người mới mỗi lượt)
        actor_ids = list({str((x.get("from") or {}).get("numberId") or "") for x in raw_items if isinstance(x, dict) and (x.get("from") or {}).get("numberId")})
        for aid in actor_ids[:10]:
            if aid and aid not in _COLLEAGUE_CACHE:
                try:
                    rc = client._http.get(f"{client.base}/call/hr_api/colleague", params={"HaraId": aid}, headers=headers, timeout=6.0)
                    if rc.is_success:
                        fn = ((rc.json().get("data") or {}).get("fullName") or "").strip()
                        if fn:
                            _COLLEAGUE_CACHE[aid] = fn
                except Exception:  # noqa: BLE001
                    pass

        task_id_re = re.compile(r"([0-9a-f]{24})", re.I)
        mention_re = re.compile(r"nhắc|mention|@|bình luận|trả lời|comment|tag", re.I)
        follower_re = re.compile(r"thêm vào danh sách theo dõi|theo dõi công việc", re.I)
        items = []
        for n in raw_items:
            if not isinstance(n, dict):
                continue
            aid = str((n.get("from") or {}).get("numberId") or "")
            title = str(n.get("title") or "").strip()
            content = str(n.get("content") or "").strip()
            link = str(n.get("link") or "").strip()
            if link and link.startswith("/"):
                link = f"{client.base}{link}"
            m_tid = task_id_re.search(link)
            full_txt = f"{title} {content}"
            is_mention = bool(mention_re.search(full_txt)) and not bool(follower_re.search(full_txt))
            items.append({
                "id": str(n.get("id") or ""),
                "title": title,
                "content": content,
                "module_name": str(n.get("moduleName") or "Haraworks"),
                "actor": _COLLEAGUE_CACHE.get(aid, ""),
                "link": link,
                "task_id": m_tid.group(1) if m_tid else "",
                "created_at": str(n.get("createdAt") or ""),
                "is_read": bool(n.get("isRead")),
                "is_mention": is_mention,
            })
        unread = sum(1 for x in items if not x["is_read"])
        res_obj = {
            "connected": True,
            "error": "",
            "items": items,
            "unread_count": unread,
            "synced_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        _NOTI_CACHE["global"] = (now, res_obj)
        return res_obj
    except Exception as exc:  # noqa: BLE001
        return {"connected": False, "error": f"Không tải được thông báo Haraworks ({exc.__class__.__name__})", "items": [], "unread_count": 0, "synced_at": dt.datetime.now(dt.timezone.utc).isoformat()}
    finally:
        client.close()


@router.get("/sources/haraworks-notifications")
def get_haraworks_notifications(force: bool = False, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return _fetch_hw_notifications(session, p, force=force)


@router.get("/sources/pet-pulse")
def get_pet_pulse(since: str = "", force: bool = False, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    """Trả dữ liệu realtime cho Bé Pet & dấu chấm đỏ Left Menu: thông báo Haraworks, bug mới gán chưa check > 1 phút, số bug mới & báo cáo ngày."""
    from app.core.text import fold
    from app.domains.bugs.models import Bug, Project
    from app.domains.platform.models import User

    now_utc = dt.datetime.now(dt.timezone.utc)
    vn_today = (now_utc + dt.timedelta(hours=7)).strftime("%Y-%m-%d")

    user = session.get(User, p.id) if p.id else None
    me_tokens = [fold(t) for t in (user.display_name if user else "", user.employee_code if user else "", p.username or "") if t and len(t.strip()) >= 2]

    def is_me(person: str) -> bool:
        fp = fold(person)
        return bool(fp and any(tok in fp for tok in me_tokens))

    # 1. Đếm bug mới (cho dấu chấm đỏ trên Left Menu) + bug mới gán cho mình chưa check (> 1 phút, trạng thái Mới = 0)
    since_dt: dt.datetime | None = None
    if since.strip():
        try:
            since_dt = dt.datetime.fromisoformat(since.strip().replace("Z", "+00:00"))
            if since_dt.tzinfo is None:
                since_dt = since_dt.replace(tzinfo=dt.timezone.utc)
        except ValueError:
            since_dt = None

    proj_map = {pr.id: (pr.name, pr.external_id) for pr in session.scalars(select(Project))}
    all_bugs = session.scalars(select(Bug).order_by(Bug.created_at_ext.desc().nullslast()).limit(500)).all()
    new_bugs_count = 0
    latest_bug_at = ""
    unchecked_bugs = []
    todo_today = 0
    overdue = 0
    due_today = 0
    need_approval = 0
    incomplete_bugs = 0

    for b in all_bugs:
        if not latest_bug_at and b.created_at_ext:
            latest_bug_at = b.created_at_ext.isoformat()
        if since_dt and b.created_at_ext and b.created_at_ext > since_dt:
            new_bugs_count += 1
        am_asg = is_me(b.assignee or "")
        am_app = is_me(b.approver or "")
        if not am_asg and not am_app:
            continue
        p_name, p_ext = proj_map.get(b.project_id, ("", "")) if b.project_id else ("", "")
        bug_url = b.url or (
            f"https://tasks.haraworks.vn/task/project/{p_ext}/{b.external_id}" if (p_ext and b.external_id)
            else (f"https://tasks.haraworks.vn/task/me/{b.external_id}" if b.external_id else "")
        )
        is_closed = b.status in (5, 10, 11)
        extra = b.extra or {}
        raw_info = extra.get("additionalInfo") or []
        info = {str(x.get("key")): x.get("value") for x in raw_info if isinstance(x, dict)} if isinstance(raw_info, list) else (raw_info if isinstance(raw_info, dict) else {})
        plan_end = str(extra.get("plan_End_At") or extra.get("planEndAt") or "")[:10]
        if not is_closed:
            if plan_end and plan_end < vn_today:
                overdue += 1
            if plan_end and plan_end == vn_today:
                due_today += 1
            if am_app:
                need_approval += 1
            if am_asg or (plan_end and plan_end <= vn_today):
                todo_today += 1
        # Thiếu 1 trong 5 trường
        missing_any = (
            not str(info.get("customer") or "").strip()
            or not str(b.module_code or info.get("module") or "").strip()
            or not str(info.get("platform") or extra.get("platform") or "").strip()
            or not str(b.classification or info.get("type") or "").strip()
            or not str(info.get("priority") or info.get("severity") or extra.get("severity") or "").strip()
        )
        if missing_any:
            incomplete_bugs += 1
        # Bug mới gán cho mình ở trạng thái Mới (0) chưa check quá 1 phút
        if am_asg and (b.status == 0 or b.status is None):
            age_sec = (now_utc - b.created_at_ext).total_seconds() if b.created_at_ext else 999
            if age_sec >= 60:
                unchecked_bugs.append({
                    "id": str(b.id),
                    "external_id": b.external_id,
                    "title": b.title,
                    "module": (b.module_code or "").upper(),
                    "project": p_name,
                    "url": bug_url,
                    "created_at": b.created_at_ext.isoformat() if b.created_at_ext else "",
                    "age_minutes": max(1, int(age_sec // 60)),
                })

    # Tính daily_summary DÙNG CHUNG 100% quy tắc lọc & đếm với Dashboard Cá Nhân (mặc định Tuần này)
    dash = personal_dashboard_tasks(p=p, session=session)
    dash_items = dash.get("items") or []

    def _vn_d(iso_s: str) -> str:
        s = str(iso_s or "").strip()
        if not s:
            return ""
        try:
            d = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return (d + dt.timedelta(hours=7)).strftime("%Y-%m-%d")
        except ValueError:
            return s[:10]

    vn_now = now_utc + dt.timedelta(hours=7)
    week_start_str = (vn_now - dt.timedelta(days=vn_now.weekday())).strftime("%Y-%m-%d")

    todo_today = 0
    overdue = 0
    due_today = 0
    need_approval = 0
    incomplete_bugs = 0

    for t in dash_items:
        closed = bool(t.get("closed"))
        ps = _vn_d(t.get("plan_start_at", ""))
        pe = _vn_d(t.get("plan_end_at", ""))
        cr = _vn_d(t.get("created_at", ""))

        # Lọc đồng bộ theo bộ lọc mặc định "Tuần này" trên Dashboard
        in_base = False
        if (not closed) and pe and pe < vn_today:
            in_base = True
        elif (pe and pe >= vn_today) or (ps and ps >= vn_today) or (cr and cr >= vn_today):
            in_base = True
        else:
            ref_d = pe or ps or cr
            in_base = (not ref_d) or (ref_d >= week_start_str)
        if not in_base:
            continue

        is_ov = (not closed) and bool(pe) and pe < vn_today
        is_dt = (not closed) and bool(pe) and pe == vn_today
        if ps and pe:
            in_today = ps <= vn_today <= pe
        elif pe:
            in_today = pe == vn_today
        elif ps:
            in_today = ps == vn_today
        else:
            in_today = cr == vn_today

        if is_ov:
            overdue += 1
        if is_dt:
            due_today += 1
        if (not closed) and t.get("is_approver"):
            need_approval += 1
        if t.get("kind") == "bug" and (t.get("missing_fields") or []):
            incomplete_bugs += 1
        if not closed:
            k = t.get("kind")
            if k == "bug":
                if t.get("is_assignee") or (t.get("is_approver") and in_today) or is_ov:
                    todo_today += 1
            elif k == "function":
                if in_today or is_ov:
                    todo_today += 1
            elif k == "release":
                if (ps or pe) and (in_today or is_ov):
                    todo_today += 1

    # Chủ động kiểm tra nhẹ các khóa AI đã lưu (theo TTL 10 phút hoặc khi force=True) & tải thông báo Haraworks
    if get_settings().app_env != "test" or integ.TRANSPORT.get("gemini") is not None:
        integ.probe_ai_if_stale(session, p, "gemini", force=force)
    if get_settings().app_env != "test" or integ.TRANSPORT.get("anthropic") is not None:
        integ.probe_ai_if_stale(session, p, "anthropic", force=force)

    noti = _fetch_hw_notifications(session, p, force=force)
    mentions = [x for x in noti.get("items", []) if x.get("is_mention") or not x.get("is_read")]

    # Đọc lại trạng thái tích hợp SAU khi probe & gọi Haraworks (cập nhật tức thời expired/error)
    integ_list = integ.status(session)
    integ_map = {row["key"]: row for row in integ_list}
    missing_integrations: list[str] = []
    hw_row = integ_map.get("haraworks", {})
    gem_row = integ_map.get("gemini", {})
    ant_row = integ_map.get("anthropic", {})
    fig_row = integ_map.get("figma", {})

    hw_state = hw_row.get("state", "missing")
    gem_state = gem_row.get("state", "missing")
    ant_state = ant_row.get("state", "missing")
    fig_state = fig_row.get("state", "missing")

    if hw_state != "active":
        missing_integrations.append("haraworks")
    if gem_state != "active" and ant_state != "active":
        missing_integrations.append("ai")
    elif gem_state in ("expired", "error") or ant_state in ("expired", "error"):
        # Nếu 1 key đang lỗi/hết hạn thì vẫn báo rõ để user sửa
        if gem_state in ("expired", "error"):
            missing_integrations.append("gemini")
        if ant_state in ("expired", "error"):
            missing_integrations.append("anthropic")
    if fig_state != "active":
        missing_integrations.append("figma")

    # Kiểm tra trạng thái job đồng bộ gần nhất (nếu có lỗi đồng bộ Haraworks)
    from app.domains.platform.models import Job
    last_job = session.scalar(
        select(Job)
        .where(Job.kind.in_(["sync_all", "bugs_sync", "functions_sync", "builds_sync"]))
        .order_by(Job.created_at.desc())
        .limit(1)
    )
    last_sync = {"ok": True, "code": None, "message": None, "at": None}
    if last_job is not None:
        err_obj = (last_job.result or {}).get("error") if isinstance(last_job.result, dict) else None
        if last_job.status == "FAILED" and isinstance(err_obj, dict):
            last_sync = {
                "ok": False,
                "code": err_obj.get("code"),
                "message": err_obj.get("message"),
                "at": last_job.finished_at.isoformat() if last_job.finished_at else last_job.created_at.isoformat(),
            }
        elif last_job.finished_at:
            last_sync["at"] = last_job.finished_at.isoformat()

    # Tính trạng thái AI tổng hợp nhưng ưu tiên báo lỗi nếu bất kỳ khóa nào đã cấu hình bị expired/error
    if gem_state in ("expired", "error"):
        ai_summary = gem_state
    elif ant_state in ("expired", "error"):
        ai_summary = ant_state
    elif gem_state == "active" or ant_state == "active":
        ai_summary = "active"
    elif gem_state == "unchecked" or ant_state == "unchecked":
        ai_summary = "unchecked"
    else:
        ai_summary = "missing"

    return {
        "new_bugs_count": new_bugs_count,
        "latest_bug_at": latest_bug_at,
        "unchecked_bugs": unchecked_bugs[:20],
        "notifications": noti,
        "mentions": mentions[:20],
        "missing_integrations": missing_integrations,
        "integration_states": {
            "haraworks": hw_state,
            "gemini": gem_state,
            "anthropic": ant_state,
            "ai": ai_summary,
            "figma": fig_state,
        },
        "integration_details": {
            k: {
                "label": row.get("label", k),
                "state": row.get("state", "missing"),
                "state_label": row.get("state_label", ""),
                "detail": row.get("detail", ""),
                "checked_at": row.get("last_check_at"),
            }
            for k, row in (("haraworks", hw_row), ("gemini", gem_row), ("anthropic", ant_row))
        },
        "data_health": {
            "haraworks_notifications": {
                "ok": bool(noti.get("connected")),
                "error": noti.get("error") or None,
            },
            "last_sync": last_sync,
        },
        "daily_summary": {
            "todo_today": todo_today,
            "overdue": overdue,
            "due_today": due_today,
            "need_approval": need_approval,
            "incomplete_bugs": incomplete_bugs,
        },
        "checked_at": now_utc.isoformat(),
    }


@router.get("/sources/builds/check")
def check_build_membership(id: str = "", title: str = "", _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.domains.sources.sync_live import check_task_in_builds

    return check_task_in_builds(session, task_id=id, title=title)


@router.get("/sources/haraworks-media")
def haraworks_media_proxy(
    url: str,
    request: Request,
    p: Principal = Depends(current_principal),
    session: Session = Depends(get_session),
):
    """Proxy chỉ-đọc để preview ảnh/video/PDF đính kèm từ Haraworks ngay trong hệ thống (hỗ trợ Range 206 cho video)."""
    import mimetypes
    from fastapi.responses import Response

    u = urlparse((url or "").strip())
    host = (u.hostname or "").lower()
    allowed_suffixes = (
        "haraworks.vn",
        "haravan.com",
        "haravan.vn",
        "hstatic.net",
        "hrws.cloud",
        "zuizui.io",
        "googleapis.com",
        "cloudfront.net",
        "amazonaws.com",
    )
    if u.scheme != "https" or not any(host == s or host.endswith("." + s) for s in allowed_suffixes):
        raise AppError("URL đính kèm không nằm trong danh sách host cho phép preview", code="MEDIA_HOST_BLOCKED", status=403)
    headers = {"accept": "*/*"}
    range_hdr = request.headers.get("range")
    if range_hdr:
        headers["range"] = range_hdr
    if host.endswith("haraworks.vn") or host.endswith("zuizui.io"):
        try:
            c = integ.haraworks_client(session, p)
            headers["cookie"] = c.cookie
            headers["referer"] = f"{c.base}/task/me"
            c.close()
        except Exception:  # noqa: BLE001
            pass
    try:
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            r = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise AppError(f"Không tải được tệp xem trước: {exc.__class__.__name__}", code="MEDIA_FETCH_FAILED", status=502) from exc
    if r.status_code >= 400:
        raise AppError(f"Không xem trước được tệp (HTTP {r.status_code})", code="MEDIA_FETCH_FAILED", status=502)
    if len(r.content) > 100 * 1024 * 1024:
        raise AppError("Tệp quá lớn để xem trước trực tiếp", code="FILE_TOO_LARGE", status=413)

    ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
    if not ctype or ctype in ("application/octet-stream", "binary/octet-stream"):
        ext_map = {
            ".mp4": "video/mp4",
            ".m4v": "video/mp4",
            ".mov": "video/quicktime",
            ".webm": "video/webm",
            ".ogv": "video/ogg",
            ".mp3": "audio/mpeg",
            ".wav": "audio/wav",
            ".m4a": "audio/mp4",
            ".ogg": "audio/ogg",
            ".pdf": "application/pdf",
        }
        path_l = (u.path or "").lower()
        guessed = next((mt for ext, mt in ext_map.items() if path_l.endswith(ext)), None)
        if not guessed:
            guessed = mimetypes.guess_type(u.path)[0]
        ctype = guessed or "application/octet-stream"

    resp_headers = {
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=300",
        "Accept-Ranges": "bytes",
    }

    if r.status_code == 206:
        if "content-range" in r.headers:
            resp_headers["Content-Range"] = r.headers["content-range"]
        return Response(content=r.content, status_code=206, media_type=ctype, headers=resp_headers)

    if range_hdr and range_hdr.lower().startswith("bytes="):
        total = len(r.content)
        spec = range_hdr[6:].split(",")[0].strip()
        start_s, _, end_s = spec.partition("-")
        try:
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else total - 1
            if not start_s and end_s:
                start = max(0, total - int(end_s))
                end = total - 1
            start = max(0, start)
            end = min(total - 1, end)
            if total > 0 and start <= end:
                resp_headers["Content-Range"] = f"bytes {start}-{end}/{total}"
                return Response(content=r.content[start : end + 1], status_code=206, media_type=ctype, headers=resp_headers)
        except ValueError:
            pass

    return Response(content=r.content, media_type=ctype, headers=resp_headers)


@router.get("/sources/haraworks-detail/{task_id}")
def haraworks_task_detail(task_id: str, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.domains.sources.sync_live import get_haraworks_task_detail

    client = integ.haraworks_client(session, p)
    try:
        return get_haraworks_task_detail(client, task_id)
    finally:
        client.close()


def _build_fn_index(session: Session) -> tuple[dict[str, dict], dict[str, dict]]:
    from app.core.text import fold

    fn_rows = session.scalars(
        select(SourcePassage)
        .join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
        .join(Source, Source.id == SourceVersion.source_id)
        .where(Source.kind == "task_function", Source.status == "active", SourcePassage.is_current.is_(True))
    ).all()
    fn_by_id: dict[str, dict] = {}
    fn_by_title: dict[str, dict] = {}
    for fp in fn_rows:
        floc = fp.locator or {}
        fid = str(floc.get("task_id") or fp.external_key or "").lower()
        ftitle = (fp.text or "").split("\n", 1)[0].strip()
        fteam = str(floc.get("team") or floc.get("project") or "")
        furl = str(floc.get("url") or (f"https://tasks.haraworks.vn/task/me/{fid}" if fid else ""))
        rec = {"id": fid, "title": ftitle, "team": fteam, "url": furl}
        if fid:
            fn_by_id[fid] = rec
        ft_fold = fold(ftitle)
        if ft_fold and ft_fold not in fn_by_title:
            fn_by_title[ft_fold] = rec
    return fn_by_id, fn_by_title


def _resolve_build_source(bid: str, b_title: str, loc: dict, fn_by_id: dict[str, dict], fn_by_title: dict[str, dict]) -> tuple[dict | None, str]:
    from app.core.text import fold
    from app.domains.sources.sync_live import _extract_source_title

    bid_l = str(bid or "").strip().lower()
    src_fn = loc.get("source_function")
    if isinstance(src_fn, dict) and str(src_fn.get("id") or "").strip().lower() == bid_l:
        src_fn = None
    src_team = str(loc.get("source_team") or "")
    if not src_fn or not src_team:
        matched_fn = None
        for lid in (loc.get("linked_ids") or []):
            lid_l = str(lid).strip().lower()
            if not lid_l or lid_l == bid_l:
                continue
            cand = fn_by_id.get(lid_l)
            if cand:
                matched_fn = cand
                break
        if matched_fn is None:
            st_title = str(loc.get("source_title") or _extract_source_title(b_title) or "").strip()
            st_fold = fold(st_title)
            if st_fold:
                matched_fn = fn_by_title.get(st_fold)
                if matched_fn is None and len(st_fold) >= 10:
                    for fk, fv in fn_by_title.items():
                        if st_fold in fk or fk in st_fold:
                            matched_fn = fv
                            break
        if matched_fn:
            if not src_fn:
                src_fn = {"id": matched_fn["id"], "title": matched_fn["title"], "url": matched_fn["url"]}
            if not src_team and matched_fn["team"]:
                src_team = matched_fn["team"]
    return src_fn, src_team


@router.get("/sources/builds")
def list_builds(q: str = "", team: str = "", module: str = "", kind: str = "", status: str = "", closed: str = "",
                assignee: str = "", year: str = "", sort: str = "created", limit: int = 50, offset: int = 0,
                _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.core.text import fold, like_escape
    from app.domains.sources.sync_live import FUNCTION_PROJECTS

    fn_by_id, fn_by_title = _build_fn_index(session)

    stmt = (select(SourcePassage).join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
            .join(Source, Source.id == SourceVersion.source_id)
            .where(Source.kind == "release_build", Source.status == "active", SourcePassage.is_current.is_(True)))
    for term in fold(q).split():
        stmt = stmt.where(SourcePassage.text_fold.like(f"%{like_escape(term)}%", escape="\\"))
    all_rows = session.scalars(stmt.order_by(SourcePassage.created_at.desc(), SourcePassage.seq.desc())).all()

    four_teams = [p["team"] for p in FUNCTION_PROJECTS]
    modules: set[str] = set()
    assignees: set[str] = set()
    statuses: dict[str, str] = {}
    years: set[str] = set()
    filtered = []
    team_f = team.strip().lower()
    mod_f = module.strip().upper()
    kind_f = kind.strip().lower()
    st_f = status.strip()
    as_f = assignee.strip()
    yr_f = year.strip()
    for p in all_rows:
        loc = p.locator or {}
        if loc.get("parent_task") or loc.get("parent_id") or loc.get("is_group_task"):
            continue
        lines = (p.text or "").split("\n", 1)
        b_title = lines[0]
        bid = str(loc.get("build_id") or p.external_key or "")
        src_fn, src_team = _resolve_build_source(bid, b_title, loc, fn_by_id, fn_by_title)

        m_code = str(loc.get("module") or p.heading_path or "").strip().upper()
        b_kind = str(loc.get("kind") or "function")
        is_closed = bool(loc.get("closed"))
        st_code = loc.get("status_code")
        st_label = str(loc.get("status") or "")
        as_name = str(loc.get("assignee") or "")
        created_iso = str(loc.get("created_at") or p.created_at.isoformat())
        if m_code:
            modules.add(m_code)
        if as_name:
            assignees.add(as_name)
        if st_code is not None and st_label:
            statuses[str(st_code)] = st_label
        if len(created_iso) >= 4 and created_iso[:4].isdigit():
            years.add(created_iso[:4])
        if team_f and team_f != src_team.lower():
            continue
        if mod_f and m_code != mod_f:
            continue
        if kind_f and b_kind != kind_f:
            continue
        if st_f != "" and str(st_code) != st_f:
            continue
        if as_f and as_name != as_f:
            continue
        if yr_f and not created_iso.startswith(yr_f):
            continue
        if closed == "open" and is_closed:
            continue
        if closed == "closed" and not is_closed:
            continue
        filtered.append({
            "id": str(p.id),
            "build_id": str(loc.get("build_id") or p.external_key or ""),
            "title": b_title,
            "note": lines[1] if len(lines) > 1 else "",
            "kind": b_kind,
            "kind_label": str(loc.get("kind_label") or ("Build App Mobile" if b_kind == "app" else "Build Task Function")),
            "team": str(loc.get("team") or loc.get("project") or "Không rõ"),
            "project": str(loc.get("project") or loc.get("team") or "Không rõ"),
            "source_team": src_team,
            "source_function": src_fn,
            "module": m_code,
            "status_code": st_code,
            "status": st_label,
            "closed": is_closed,
            "priority": loc.get("priority"),
            "priority_label": str(loc.get("priority_label") or ""),
            "assignee": as_name,
            "approver": str(loc.get("approver") or ""),
            "version": str(loc.get("version") or ""),
            "platform": str(loc.get("platform") or ""),
            "parent_task": str(loc.get("parent_task") or ""),
            "linked_count": len(loc.get("linked_ids") or []),
            "url": str(loc.get("url") or ""),
            "created_at": created_iso,
            "updated_at": str(loc.get("updated_at") or created_iso),
        })
    if sort == "priority":
        filtered.sort(key=lambda x: x["created_at"], reverse=True)
        filtered.sort(key=lambda x: x["priority"] if x["priority"] is not None else 99)
    elif sort == "updated":
        filtered.sort(key=lambda x: x["updated_at"], reverse=True)
    else:
        filtered.sort(key=lambda x: x["created_at"], reverse=True)
    return {
        "total": len(filtered), "items": filtered[offset:offset + min(limit, 200)],
        "teams": four_teams, "modules": sorted(modules),
        "assignees": sorted(assignees), "statuses": statuses, "years": sorted(years, reverse=True),
    }


@router.post("/sources/builds", status_code=201)
def create_build(body: BuildIn, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    import hashlib

    from app.core.text import fold

    ver = _build_version(session, p)
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    seq = (session.scalar(select(func.max(SourcePassage.seq)).where(SourcePassage.source_version_id == ver.id)) or -1) + 1
    text = body.title.strip() + (("\n" + body.note.strip()) if body.note.strip() else "")
    mod = body.module.strip().upper()
    loc = {"team": body.team.strip(), "project": (body.project or body.team).strip(), "module": mod, "status": body.status.strip(),
           "version": body.version.strip(), "platform": body.platform.strip(), "parent_task": body.parent_task.strip(),
           "url": body.url.strip(), "created_at": now_iso, "updated_at": now_iso}
    row = SourcePassage(source_version_id=ver.id, seq=seq, kind="task", heading_path=mod, locator=loc, text=text, text_fold=fold(text),
                        content_hash=hashlib.sha256(text.encode()).hexdigest(), external_key=f"manual_{uuid.uuid4().hex[:10]}", is_current=True)
    session.add(row)
    session.flush()
    return {"id": str(row.id), "title": body.title.strip(), **loc}


@router.patch("/sources/builds/{passage_id}")
def update_build(passage_id: uuid.UUID, body: BuildIn, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    import hashlib

    from app.core.text import fold

    row = session.get(SourcePassage, passage_id)
    if row is None or not row.is_current:
        raise NotFound("Không thấy đợt build")
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    text = body.title.strip() + (("\n" + body.note.strip()) if body.note.strip() else "")
    mod = body.module.strip().upper()
    loc = {**(row.locator or {}), "team": body.team.strip(), "project": (body.project or body.team).strip(), "module": mod,
           "status": body.status.strip(), "version": body.version.strip(), "platform": body.platform.strip(),
           "parent_task": body.parent_task.strip(), "url": body.url.strip(), "updated_at": now_iso}
    row.text = text
    row.text_fold = fold(text)
    row.heading_path = mod
    row.locator = loc
    row.content_hash = hashlib.sha256(text.encode()).hexdigest()
    return {"id": str(row.id), "title": body.title.strip(), **loc}


@router.delete("/sources/builds/{passage_id}", status_code=204)
def delete_build(passage_id: uuid.UUID, _: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    row = session.get(SourcePassage, passage_id)
    if row is None:
        raise NotFound("Không thấy đợt build")
    row.is_current = False


@router.post("/sources/builds/upload", status_code=201)
async def upload_builds_json(file: UploadFile = File(...), p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    import hashlib

    from app.core.text import fold

    limit = get_settings().max_source_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("Tệp vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except ValueError as exc:
        raise AppError("Tệp không phải JSON hợp lệ", code="VALIDATION_ERROR", status=422) from exc
    items = doc.get("builds") or doc.get("tasks") or (doc if isinstance(doc, list) else [])
    if not isinstance(items, list) or not items:
        raise AppError("Không thấy danh sách build trong tệp JSON.", code="VALIDATION_ERROR", status=422)
    ver = _build_version(session, p)
    existing = {r.external_key: r for r in session.scalars(select(SourcePassage).where(SourcePassage.source_version_id == ver.id, SourcePassage.is_current.is_(True)))}
    seq = (session.scalar(select(func.max(SourcePassage.seq)).where(SourcePassage.source_version_id == ver.id)) or -1) + 1
    created = updated = 0
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    for b in items:
        if not isinstance(b, dict):
            continue
        bid = str(b.get("id") or b.get("build_id") or "")
        title = str(b.get("name") or b.get("title") or "").strip()
        if not title:
            continue
        team = str(b.get("team_Name") or b.get("team") or b.get("project_Name") or b.get("project") or "Không rõ")
        mod = str(b.get("module") or "").strip().upper()
        loc = {
            "build_id": bid,
            "team": team,
            "project": str(b.get("project_Name") or b.get("project") or team),
            "module": mod,
            "status": str(b.get("status_Name") or b.get("status") or ""),
            "version": str(b.get("buildNumber") or b.get("version") or ""),
            "platform": str(b.get("platform") or ""),
            "parent_task": str(b.get("parent_Name") or b.get("parent_task") or b.get("parent_Id") or ""),
            "url": str(b.get("url") or (f"https://tasks.haraworks.vn/task/project/{b.get('project_Id') or ''}/{bid}" if bid else "")),
            "created_at": str(b.get("created_Date") or b.get("created_at") or now_iso),
            "updated_at": now_iso,
        }
        note = str(b.get("description") or b.get("note") or "").strip()
        text = title + (("\n" + note) if note else "")
        h = hashlib.sha256(text.encode()).hexdigest()
        if bid and bid in existing:
            r = existing[bid]
            r.text = text
            r.text_fold = fold(text)
            r.heading_path = mod
            r.locator = loc
            r.content_hash = h
            updated += 1
        else:
            session.add(SourcePassage(source_version_id=ver.id, seq=seq, kind="task", heading_path=mod, locator=loc, text=text, text_fold=fold(text),
                                      content_hash=h, external_key=bid or f"imp_{uuid.uuid4().hex[:10]}", is_current=True))
            seq += 1
            created += 1
    session.flush()
    return {"created": created, "updated": updated}


@router.post("/sources/upload", status_code=201)
async def upload_source(kind: str = Form(...), title: str = Form(...), version_label: str = Form(""), external_url: str = Form(""), module: str = Form(""), file: UploadFile = File(...),
                        p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session), storage: StorageBackend = Depends(storage_dep)):
    """Upload tài liệu BA (.docx) hoặc wiki (.docx/.html/.md/.txt). Cùng tên nguồn ⇒ thêm PHIÊN BẢN mới; bản cũ không bị xóa."""
    limit = get_settings().max_source_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("Tệp vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
    return _result(ingest.ingest_document(session, storage, actor=p, kind=kind, title=title, filename=file.filename or "", data=data,
                                          version_label=version_label or None, external_url=external_url, module=module))


class FigmaIn(BaseModel):
    url: str
    title: str = ""
    pasted_text: str = ""
    version_label: str = ""
    module: str = ""


@router.post("/sources/figma", status_code=201)
def add_figma(body: FigmaIn, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    """Thêm link Figma. Nội dung lấy bằng token Figma (nếu đã cấu hình) hoặc từ văn bản bạn dán; chỉ link thì chưa có gì để trích."""
    info = ingest.parse_figma_url(body.url)
    nodes = None
    if not body.pasted_text.strip():
        nodes = integ.fetch_figma(session, p, info["file_key"], info["node_id"])
    return _result(ingest.ingest_figma(session, actor=p, url=body.url, title=body.title or None, nodes_json=nodes, pasted_text=body.pasted_text,
                                       version_label=body.version_label or None, module=body.module))


class WikiUrlIn(BaseModel):
    url: str
    title: str = Field(min_length=1, max_length=400)
    version_label: str = ""
    module: str = ""


def _fetch_wiki(url: str) -> bytes:
    s = get_settings()
    allowed = {h.strip().lower() for h in s.wiki_fetch_allowed_hosts.split(",") if h.strip()}
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise AppError("URL wiki không hợp lệ", code="VALIDATION_ERROR", status=422)
    if not allowed:
        raise AppError("Tải trang wiki từ URL đang tắt. Admin đặt WIKI_FETCH_ALLOWED_HOSTS (danh sách host được phép) hoặc hãy upload tệp wiki đã lưu.", code="WIKI_FETCH_DISABLED", status=409)
    if u.hostname.lower() not in allowed:
        raise AppError(f"Host {u.hostname} không nằm trong danh sách được phép (WIKI_FETCH_ALLOWED_HOSTS).", code="WIKI_HOST_NOT_ALLOWED", status=403)
    try:
        with httpx.Client(timeout=30, follow_redirects=False, transport=WIKI_TRANSPORT) as c:
            r = c.get(url, headers={"accept": "text/html,text/plain,text/markdown"})
    except httpx.HTTPError as exc:
        raise AppError(f"Không tải được trang wiki: {exc.__class__.__name__}", code="WIKI_FETCH_FAILED", status=502) from exc
    if r.status_code != 200:
        raise AppError(f"Wiki trả HTTP {r.status_code} (chuyển hướng không được theo dõi; nếu trang cần đăng nhập hãy upload tệp đã lưu).", code="WIKI_FETCH_FAILED", status=502)
    if len(r.content) > s.max_source_upload_bytes:
        raise AppError("Trang wiki quá lớn", code="FILE_TOO_LARGE", status=413)
    return r.content


@router.post("/sources/code-wiki/url", status_code=201)
def add_wiki_url(body: WikiUrlIn, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session), storage: StorageBackend = Depends(storage_dep)):
    data = _fetch_wiki(body.url)
    return _result(ingest.ingest_document(session, storage, actor=p, kind="code_wiki", title=body.title, filename="wiki.html", data=data,
                                          version_label=body.version_label or None, external_url=body.url, module=body.module))


class SourceUpdateIn(BaseModel):
    title: str | None = None
    module: str | None = None
    external_url: str | None = None


@router.post("/sources/figma/upload", status_code=201)
async def add_figma_multipart(
    title: str = Form(""),
    module: str = Form(""),
    url: str = Form(""),
    pasted_text: str = Form(""),
    images: list[UploadFile] = File(default=[]),
    p: Principal = Depends(require(Perm.FILES_WRITE)),
    session: Session = Depends(get_session),
    storage: StorageBackend = Depends(storage_dep),
):
    """Thêm nguồn Figma kèm nhiều hình ảnh + nội dung dán (Copy as CSS / text) hoặc lấy tự động qua Token."""
    from app.domains.files import service as file_service

    limit = get_settings().max_upload_bytes
    saved_imgs: list[dict] = []
    for img in images or []:
        if not img or not img.filename:
            continue
        data = await img.read(limit + 1)
        if not data:
            continue
        if len(data) > limit:
            raise AppError(f"Ảnh {img.filename} vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
        rec = file_service.save_file(session, storage, data=data, name=img.filename, owner=p, max_bytes=limit)
        saved_imgs.append({"file_id": str(rec.id), "filename": rec.original_name})

    nodes = None
    if url.strip() and not pasted_text.strip() and not saved_imgs:
        info = ingest.parse_figma_url(url)
        nodes = integ.fetch_figma(session, p, info["file_key"], info["node_id"])

    return _result(
        ingest.ingest_figma(
            session,
            actor=p,
            url=url,
            title=title or None,
            nodes_json=nodes,
            pasted_text=pasted_text,
            version_label=None,
            module=module,
            images=saved_imgs,
        )
    )


@router.post("/sources/{source_id}/replace")
async def replace_source(
    source_id: uuid.UUID,
    title: str = Form(""),
    module: str = Form(""),
    external_url: str = Form(""),
    pasted_text: str = Form(""),
    remove_image_ids: str = Form(""),
    file: UploadFile | None = File(default=None),
    images: list[UploadFile] = File(default=[]),
    p: Principal = Depends(require(Perm.FILES_WRITE)),
    session: Session = Depends(get_session),
    storage: StorageBackend = Depends(storage_dep),
):
    """Sửa thông tin nguồn và (tùy chọn) thay thế nội dung theo đúng loại nguồn (ba_doc, figma, code_wiki)."""
    from app.domains.files import service as file_service

    s = session.get(Source, source_id)
    if s is None:
        raise NotFound("Không thấy nguồn")

    if title.strip():
        s.title = title.strip()[:400]
    if external_url is not None:
        s.external_url = external_url.strip()[:1000]
    m = dict(s.meta or {})
    if module is not None:
        m["module"] = module.strip().upper()[:40]

    # Xóa bớt hình ảnh Figma nếu người dùng bỏ chọn
    if remove_image_ids.strip():
        rm_set = {x.strip() for x in remove_image_ids.split(",") if x.strip()}
        m["images"] = [im for im in (m.get("images") or []) if isinstance(im, dict) and str(im.get("file_id")) not in rm_set]

    # Tải thêm hình ảnh mới (cho Figma)
    limit = get_settings().max_upload_bytes
    new_imgs: list[dict] = []
    for img in images or []:
        if not img or not img.filename:
            continue
        data = await img.read(limit + 1)
        if not data:
            continue
        if len(data) > limit:
            raise AppError(f"Ảnh {img.filename} vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
        rec = file_service.save_file(session, storage, data=data, name=img.filename, owner=p, max_bytes=limit)
        new_imgs.append({"file_id": str(rec.id), "filename": rec.original_name})
    if new_imgs:
        m["images"] = [*(m.get("images") or []), *new_imgs]

    m["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    s.meta = m
    session.flush()

    replaced_passages = None
    # Thay thế nội dung file cho ba_doc / code_wiki
    if file is not None and file.filename:
        src_limit = get_settings().max_source_upload_bytes
        data = await file.read(src_limit + 1)
        if len(data) > src_limit:
            raise AppError("Tệp vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
        if data:
            r = ingest.ingest_document(
                session,
                storage,
                actor=p,
                kind=s.kind,
                title=s.title,
                filename=file.filename,
                data=data,
                version_label=None,
                external_url=s.external_url,
                module=m.get("module", ""),
            )
            replaced_passages = r.passages
    elif s.kind == "figma" and pasted_text.strip():
        r = ingest.ingest_figma(
            session,
            actor=p,
            url=s.external_url,
            title=s.title,
            nodes_json=None,
            pasted_text=pasted_text,
            version_label=None,
            module=m.get("module", ""),
            images=m.get("images") or [],
        )
        replaced_passages = r.passages

    log_audit(session, p, "SOURCE_UPDATE", resource_type="source", resource_id=str(s.id),
              after={"title": s.title, "module": m.get("module", ""), "replaced_passages": replaced_passages})
    return {
        "id": str(s.id),
        "title": s.title,
        "module": m.get("module", ""),
        "url": s.external_url,
        "images": m.get("images") or [],
        "replaced_passages": replaced_passages,
        "updated_at": m["updated_at"],
    }


@router.patch("/sources/{source_id}")
def update_source(source_id: uuid.UUID, body: SourceUpdateIn, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    s = session.get(Source, source_id)
    if s is None:
        raise NotFound("Không thấy nguồn")
    if body.title is not None and body.title.strip():
        s.title = body.title.strip()[:400]
    if body.external_url is not None:
        s.external_url = body.external_url.strip()[:1000]
    m = dict(s.meta or {})
    if body.module is not None:
        m["module"] = body.module.strip().upper()[:40]
    m["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat()
    s.meta = m
    log_audit(session, p, "SOURCE_UPDATE", resource_type="source", resource_id=str(s.id), after={"title": s.title, "module": m.get("module", "")})
    return {"id": str(s.id), "title": s.title, "module": m.get("module", ""), "url": s.external_url, "updated_at": m["updated_at"]}


@router.post("/sources/task-functions/upload", status_code=201)
async def upload_task_functions(file: UploadFile = File(...), p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    """Nạp danh sách Task Function từ tệp JSON (functions-live.json của bản Node): có TÊN + thuộc tính, KHÔNG có mô tả.
    Mô tả đầy đủ lấy bằng 'Đồng bộ mô tả' (cần cookie Haraworks)."""
    limit = get_settings().max_source_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("Tệp vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except ValueError as exc:
        raise AppError("Tệp không phải JSON hợp lệ", code="VALIDATION_ERROR", status=422) from exc
    by_team: dict[str, list[dict]] = {}
    for key in ("tasks", "qcTasks"):
        for t in doc.get(key, []) if isinstance(doc, dict) else []:
            by_team.setdefault(str(t.get("team_Name") or t.get("project_Name") or "Không rõ"), []).append(t)
    if not by_team:
        raise AppError("Không thấy danh sách task (khóa 'tasks'/'qcTasks') trong tệp.", code="VALIDATION_ERROR", status=422)
    return {"teams": [ingest.ingest_task_functions(session, actor=p, team=team, tasks=items) for team, items in sorted(by_team.items())]}


@router.post("/sources/task-functions/sync", status_code=202)
def sync_task_functions_now(p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.domains.platform import jobs

    integ.haraworks_client(session, p).close()
    job = jobs.enqueue(session, kind="sync_task_functions", actor=p)
    return {"job_id": str(job.id), "status": job.status}


@router.post("/sources/builds/sync", status_code=202)
def sync_builds_now(p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    from app.domains.platform import jobs

    integ.haraworks_client(session, p).close()
    job = jobs.enqueue(session, kind="sync_builds", actor=p)
    return {"job_id": str(job.id), "status": job.status}


@router.post("/sources/sync-all", status_code=202)
def sync_all_haraworks(p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    """Đồng bộ cả 3 danh sách (Bug + Task Function + Theo dõi Build) từ Haraworks."""
    from app.domains.platform import jobs

    integ.haraworks_client(session, p).close()
    job = jobs.enqueue(session, kind="sync_all", actor=p)
    return {"job_id": str(job.id), "status": job.status}


@router.post("/sources/task-functions/sync-descriptions", status_code=202)
def sync_descriptions(limit: int | None = None, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    """Việc dài (hàng nghìn task): chạy ở worker. Trả job_id; xem tiến độ ở GET /jobs/{id}."""
    from app.domains.platform import jobs

    integ.haraworks_client(session, p).close()  # báo lỗi sớm (chưa cấu hình cookie) thay vì để job thất bại
    job = jobs.enqueue(session, kind="sync_function_descriptions", actor=p, payload={"limit": limit})
    return {"job_id": str(job.id), "status": job.status}


@router.delete("/sources/{source_id}", status_code=204)
def retire_source(source_id: uuid.UUID, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    """Ngừng dùng nguồn: không còn xuất hiện trong tra cứu. Dữ liệu và các tra cứu cũ vẫn được giữ."""
    s = session.get(Source, source_id)
    if s is None:
        raise NotFound("Không thấy nguồn")
    s.status = "retired"
    log_audit(session, p, "SOURCE_RETIRE", resource_type="source", resource_id=str(s.id))


@router.get("/sources/{source_id}/passages")
def browse_passages(source_id: uuid.UUID, version: uuid.UUID | None = None, q: str = "", offset: int = 0, limit: int = 500, _: Principal = Depends(current_principal),
                    session: Session = Depends(get_session)):
    from app.core.text import fold, like_escape

    s = session.get(Source, source_id)
    if s is None:
        raise NotFound("Không thấy nguồn")
    ver = session.get(SourceVersion, version) if version else session.scalar(select(SourceVersion).where(SourceVersion.source_id == s.id).order_by(SourceVersion.created_at.desc()))
    s_meta = s.meta or {}
    images = list(s_meta.get("images") or [])
    if ver is None:
        return {"total": 0, "version": "", "kind": s.kind, "url": s.external_url, "images": images, "items": []}
    stmt = select(SourcePassage).where(SourcePassage.source_version_id == ver.id)
    for term in fold(q).split():
        stmt = stmt.where(SourcePassage.text_fold.like(f"%{like_escape(term)}%", escape="\\"))
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(stmt.order_by(SourcePassage.seq).offset(offset).limit(min(limit, 1000))).all()
    return {
        "total": total,
        "version": ver.label,
        "kind": s.kind,
        "url": s.external_url,
        "images": images,
        "items": [
            {
                "passage_id": str(r.id),
                "seq": r.seq,
                "kind": r.kind,
                "heading_path": r.heading_path,
                "location": search.describe_locator(r.locator or {}),
                "text": r.text,
                "is_current": r.is_current,
            }
            for r in rows
        ],
    }


@router.get("/sources/passages/{passage_id}/context")
def passage_context(passage_id: uuid.UUID, radius: int = 2, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    ctx = search.passage_context(session, passage_id, min(max(radius, 0), 5))
    if ctx is None:
        raise NotFound("Không thấy đoạn trích")
    return ctx


# ----------------------------------------------------------------------------- tra cứu theo mô tả bug
class LookupIn(BaseModel):
    description: str = Field(min_length=4, max_length=6000)
    kinds: list[str] = []
    module: str = ""
    flow_hint: str = ""
    per_kind: int = Field(5, ge=1, le=20)
    include_old_versions: bool = False
    save: bool = True


@router.post("/lookups")
def run_lookup(body: LookupIn, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    allowed_kinds = set(ingest.KIND_LABEL) | {"completed_bug"}
    bad = [k for k in body.kinds if k not in allowed_kinds]
    if bad:
        raise AppError(f"Loại nguồn không hợp lệ: {', '.join(bad)}", code="VALIDATION_ERROR", status=422)
    res = search.lookup(
        session,
        body.description,
        kinds=body.kinds or None,
        module=body.module,
        flow_hint=body.flow_hint,
        per_kind=body.per_kind,
        include_old=body.include_old_versions,
    )
    res["lookup_id"] = None
    if body.save:
        snap = [{k: c[k] for k in ("passage_id", "source_kind", "source_title", "source_version", "heading_path", "location", "quote", "citation", "score", "url")}
                for g in res["groups"].values() for c in g]
        row = Lookup(
            description=body.description,
            keywords=res["keywords"],
            filters={"kinds": body.kinds, "module": body.module, "flow_hint": body.flow_hint},
            results=snap,
            created_by=p.id,
        )
        session.add(row)
        session.flush()
        res["lookup_id"] = str(row.id)
    return res


@router.get("/lookups")
def list_lookups(limit: int = 30, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    rows = session.scalars(select(Lookup).order_by(Lookup.created_at.desc()).limit(min(limit, 100))).all()
    return [{"id": str(r.id), "description": r.description[:200], "results": len(r.results), "note": r.note, "created_at": r.created_at.isoformat()} for r in rows]


@router.get("/lookups/{lookup_id}")
def get_lookup(lookup_id: uuid.UUID, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    r = session.get(Lookup, lookup_id)
    if r is None:
        raise NotFound("Không thấy lần tra cứu")
    return {"id": str(r.id), "description": r.description, "keywords": r.keywords, "filters": r.filters, "results": r.results, "note": r.note, "created_at": r.created_at.isoformat()}


class NoteIn(BaseModel):
    note: str = Field(max_length=4000)


@router.put("/lookups/{lookup_id}/note", status_code=204)
def set_note(lookup_id: uuid.UUID, body: NoteIn, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    r = session.get(Lookup, lookup_id)
    if r is None:
        raise NotFound("Không thấy lần tra cứu")
    r.note = body.note


# ----------------------------------------------------------------------------- tích hợp (chỉ ghi)
class SecretIn(BaseModel):
    value: str = Field(min_length=1, max_length=8000)


@router.get("/integrations")
def integrations(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return integ.status(session)


@router.put("/integrations/{key}", status_code=204)
def put_integration(key: str, body: SecretIn, p: Principal = Depends(require(Perm.SECRET_WRITE)), session: Session = Depends(get_session)):
    """Chỉ ghi: cookie Haraworks / token Figma được mã hóa trong vault, không bao giờ trả về giao diện."""
    integ.set_secret(session, p, key, body.value)


@router.post("/integrations/haraworks/check")
def check_haraworks(p: Principal = Depends(require(Perm.SECRET_WRITE)), session: Session = Depends(get_session)):
    return integ.check_haraworks(session, p)


@router.post("/integrations/{key}/check")
def check_single_integration(key: str, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    try:
        return integ.check_integration(session, p, key)
    except AppError as exc:
        return {
            "ok": False,
            "state": "missing" if exc.code == "NO_COOKIE" else ("expired" if exc.status in (401, 403) else "error"),
            "state_label": "Thiếu token" if exc.code == "NO_COOKIE" else ("Hết hạn" if exc.status in (401, 403) else "Lỗi"),
            "status": exc.message,
        }


@router.post("/integrations/check-all")
def check_all_integrations(p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    results = {}
    for row in integ.status(session):
        k = row["key"]
        if row["configured"]:
            try:
                results[k] = integ.check_integration(session, p, k)
            except AppError as exc:
                results[k] = {"ok": False, "state": "expired" if exc.status in (401, 403) else "error", "status": exc.message}
    return {"items": integ.status(session), "results": results}
