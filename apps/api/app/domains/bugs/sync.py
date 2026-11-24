"""Đồng bộ bug trực tiếp từ Haraworks (CHỈ ĐỌC), theo từng dự án, giữ con trỏ phiên bản như bản Node (bug-live.js)."""
from __future__ import annotations

import datetime as dt
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.domains.bugs.models import Bug, Project
from app.domains.bugs.service import Report, get_source, live_fields, module_index, upsert_bug
from app.domains.integrations.clients import HaraworksClient

BIG_PROJECT = 1000  # dự án lớn hơn mức này: chỉ lấy chi tiết task MỚI hoặc tạo gần đây
RECENT_DAYS = 14
BUG_FIELDS = """id name status priority is_Deleted created_At status_Updated_At plan_Start_At plan_End_At project_Id
  assignTo { id name } approverEntity { user_Name department_Name } additionalInfo { key value }"""
IS_BUG_TITLE = re.compile(r"\[\s*(bug|iss\w*)\s*\]", re.I)  # tag [Bug]/[Issue] (kể cả gõ sai như [Issuse]), như bản Node
BUG_PROJECT_RE = re.compile(r"-\s*empty$|^ODOO BUG PRODUCTION$", re.I)
ALL_TASKS_RE = re.compile(r"^ODOO BUG PRODUCTION$", re.I)


def _discover_bug_projects(session: Session, client: HaraworksClient, src, all_tasks: dict, rep: Report) -> list[Project]:
    existing = {p.external_id: p for p in session.scalars(select(Project).where(Project.source_id == src.id))}
    try:
        remote = client.projects() or []
    except Exception:  # noqa: BLE001
        remote = []
    for rp in remote:
        pid = str(rp.get("id") or "").strip()
        name = str(rp.get("name") or "").strip()
        if not pid or not name or not BUG_PROJECT_RE.search(name):
            continue
        if pid not in existing:
            proj = Project(source_id=src.id, external_id=pid, name=name)
            session.add(proj)
            session.flush()
            existing[pid] = proj
            rep.projects_created += 1
        elif existing[pid].name != name:
            existing[pid].name = name
        if ALL_TASKS_RE.search(name):
            all_tasks[pid] = True
    return list(existing.values())


def sync_bugs(session: Session, client: HaraworksClient, *, now: dt.datetime | None = None) -> dict:
    now = now or utcnow()
    src = get_source(session, "haraworks", "Haraworks (realtime)")
    cfg = dict(src.config or {})
    versions, seen, all_tasks = dict(cfg.get("versions") or {}), dict(cfg.get("seen") or {}), dict(cfg.get("all_tasks") or {})
    rep = Report("haraworks")
    idx = module_index(session)
    recent = (now - dt.timedelta(days=RECENT_DAYS)).isoformat()
    changed_projects = 0
    projects = _discover_bug_projects(session, client, src, all_tasks, rep)
    for proj in projects:
        pid = proj.external_id
        lst = client.get_list_task(versions.get(pid, "0"), pid)
        if lst is None:  # không đổi từ lần trước
            continue
        changed_projects += 1
        ids = lst["ids"]
        before = set(seen.get(pid) or [])
        if len(ids) <= BIG_PROJECT:
            to_fetch = ids
        else:
            known = {e: c for e, c in session.execute(select(Bug.external_id, Bug.created_at_ext).where(Bug.source_id == src.id, Bug.project_id == proj.id))}
            to_fetch = [i for i in ids if i not in before or (known.get(i) and known[i].isoformat() >= recent)]
        for t in client.get_tasks(to_fetch, BUG_FIELDS):
            if t.get("is_Deleted") or not (t.get("name") or "").strip():
                continue
            if not all_tasks.get(pid) and not IS_BUG_TITLE.search(t["name"]):
                continue
            try:
                upsert_bug(session, src, str(t["id"]), live_fields(t, proj, idx), t, rep)
            except Exception as exc:  # noqa: BLE001
                rep.errors.append(f"{t.get('id')}: {exc}")
        versions[pid], seen[pid] = lst["timestamp"], ids
    src.config = {**cfg, "versions": versions, "seen": seen, "all_tasks": all_tasks}
    src.last_sync_at, src.last_sync_status = now, f"ok: {rep.created} mới, {rep.updated} đổi, {len(rep.errors)} lỗi"
    out = rep.summary()
    out["projects_changed"] = changed_projects
    return out
