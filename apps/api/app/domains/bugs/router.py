from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.deps import current_principal
from app.core.errors import NotFound
from app.core.principal import Principal
from app.domains.bugs import service
from app.domains.bugs.models import Bug, BugSnapshot, BugSource, Project

router = APIRouter(prefix="/bugs", tags=["bugs"])


class BugItem(BaseModel):
    id: uuid.UUID
    external_id: str
    source: str
    title: str
    status: int | None
    status_label: str
    priority: int | None
    priority_label: str
    classification: str
    module_code: str
    project: str = ""
    created_at_ext: dt.datetime | None
    assignee: str
    approver: str
    url: str


class BugList(BaseModel):
    total: int
    items: list[BugItem]


def _item(b: Bug, source: str, project_name: str = "", project_ext_id: str = "") -> BugItem:
    url = b.url or ""
    if not url and b.external_id and len(b.external_id) == 24:
        url = f"https://tasks.haraworks.vn/task/project/{project_ext_id}/{b.external_id}" if project_ext_id else f"https://tasks.haraworks.vn/task/me/{b.external_id}"
    return BugItem(id=b.id, external_id=b.external_id, source=source, title=b.title, status=b.status,
                   status_label=service.STATUS_LABELS.get(b.status, "") if b.status is not None else "", priority=b.priority,
                   priority_label=service.PRIORITY_LABELS.get(b.priority, "") if b.priority is not None else "",
                   classification=b.classification, module_code=b.module_code, project=project_name, created_at_ext=b.created_at_ext,
                   assignee=b.assignee, approver=b.approver, url=url)


@router.get("", response_model=BugList)
def list_bugs(q: str = "", source: str = "", module: str = "", project: str = "", status: int | None = None,
              closed: str = "", assignee: str = "", approver: str = "", classification: str = "",
              year: str = "", date_range: str = "", sort: str = "created", limit: int = 50, offset: int = 0,
              _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    total, rows = service.search_bugs(
        session, q=q, source=source, module=module, project_name=project, status=status,
        closed=closed, assignee=assignee, approver=approver, classification=classification,
        year=year, date_range=date_range, sort=sort, limit=limit, offset=offset,
    )
    pids = {b.project_id for b, _ in rows if b.project_id}
    pmap = {p.id: (p.name, p.external_id) for p in session.scalars(select(Project).where(Project.id.in_(pids)))} if pids else {}
    return BugList(total=total, items=[_item(b, c, *(pmap.get(b.project_id, ("", "")) if b.project_id else ("", ""))) for b, c in rows])


@router.post("/sync", status_code=202)
def sync_now(p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    """Đồng bộ bug từ Haraworks (chỉ đọc) ở worker. Cần cookie Haraworks (Nguồn tài liệu → Tích hợp)."""
    from app.domains.integrations import service as integ
    from app.domains.platform import jobs

    integ.haraworks_client(session, p).close()
    job = jobs.enqueue(session, kind="sync_bugs", actor=p)
    return {"job_id": str(job.id), "status": job.status}


@router.get("/meta")
def meta(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    by_source = {c: n for c, n in session.execute(select(BugSource.code, func.count(Bug.id)).join(Bug, Bug.source_id == BugSource.id, isouter=True).group_by(BugSource.code))}
    modules = [m for (m,) in session.execute(select(Bug.module_code).where(Bug.module_code != "").distinct().order_by(Bug.module_code))]
    projects = [p for (p,) in session.execute(select(Project.name).distinct().order_by(Project.name))]
    assignees = [a for (a,) in session.execute(select(Bug.assignee).where(Bug.assignee != "").distinct().order_by(Bug.assignee))]
    approvers = [a for (a,) in session.execute(select(Bug.approver).where(Bug.approver != "").distinct().order_by(Bug.approver))]
    classifications = [c for (c,) in session.execute(select(Bug.classification).where(Bug.classification != "").distinct().order_by(Bug.classification))]
    years = sorted({d.year for (d,) in session.execute(select(Bug.created_at_ext).where(Bug.created_at_ext.is_not(None))) if d}, reverse=True)
    return {
        "sources": by_source, "modules": modules, "projects": projects,
        "assignees": assignees, "approvers": approvers, "classifications": classifications,
        "years": [str(y) for y in years], "status_labels": service.STATUS_LABELS,
    }


@router.get("/{bug_id}")
def bug_detail(bug_id: uuid.UUID, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    row = session.execute(select(Bug, BugSource.code).join(BugSource, BugSource.id == Bug.source_id).where(Bug.id == bug_id)).first()
    if row is None:
        raise NotFound("Không thấy bug")
    b, code = row
    project = session.get(Project, b.project_id) if b.project_id else None
    snaps = session.scalars(select(BugSnapshot).where(BugSnapshot.bug_id == b.id).order_by(BugSnapshot.taken_at.desc()))
    return {**_item(b, code).model_dump(mode="json"), "project": project.name if project else "", "extra": b.extra,
            "history": [{"taken_at": s.taken_at.isoformat(), "content_hash": s.content_hash} for s in snaps]}
