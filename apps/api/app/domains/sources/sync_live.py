"""Đồng bộ trực tiếp danh sách Task Function (4 team), Release Build (2 dự án),
lấy chi tiết đầy đủ từ Haraworks (mô tả, media, đính kèm, task con, lịch sử, bình luận)
và dò 1 task Bug/Function thuộc đợt Build nào (port từ packages/haraworks-live/* ở nhánh main)."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import time
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.principal import Principal
from app.core.text import fold
from app.domains.bugs.service import PRIORITY_LABELS, STATUS_LABELS
from app.domains.integrations.clients import HaraworksAuthError, HaraworksClient, html_to_text
from app.domains.knowledge.models import Source, SourceVersion
from app.domains.sources.ingest import ingest_task_functions
from app.domains.sources.models import SourcePassage

FUNCTION_PROJECTS = [
    {"id": "69c9d807450dd4c76ed0a3d2", "name": "Super Team", "team": "Super Team"},
    {"id": "69c6328e5064a7c3126c07aa", "name": "Winx Team", "team": "Winx Team"},
    {"id": "64633a85ed6a4000010ce2a0", "name": "Integrity Team", "team": "Integrity Team"},
    {"id": "69c4cfd54a0b31677fd70f2f", "name": "Team 1", "team": "Team 1"},
]

BUILD_PROJECTS = [
    {"id": "674ff8e9d64a3fd0fbaa2217", "kind": "app", "kind_label": "Build App Mobile", "name": "HRWs APP - RELEASE", "team": "HRWs APP - RELEASE"},
    {"id": "5d0758a105922900014b9d07", "kind": "function", "kind_label": "Build Task Function", "name": "HRWs - RELEASE CHECKLIST", "team": "HRWs - RELEASE CHECKLIST"},
]

CLOSED_STATUSES = {4, 5, 10, 11}

TASK_FIELDS = """id name status priority is_Deleted is_Group_Task parent_Id created_At status_Updated_At plan_Start_At plan_End_At project_Id content
  assignTo { id name } approverEntity { user_Name department_Name } additionalInfo { key value }"""

BUILD_FIELDS = """id name status priority is_Deleted is_Group_Task parent_Id created_At status_Updated_At plan_Start_At plan_End_At project_Id content
  assignTo { id name } approverEntity { user_Name } additionalInfo { key value }"""

DETAIL_FULL = """id name code content status ticket_Status priority need_Approval plan_End_At comment_Token created_At updated_At
  approverEntity { user_Name department_Name job_Title_Name }
  created_By { id name } updated_By { id name } owner { id name }
  assignTo { id name departmentName jobtitleName }
  followers { id name departmentName jobtitleName }
  supporters { id name departmentName jobtitleName }
  attachments { id name url }
  additionalInfo { key value }
  project_Id project_Name"""

DETAIL_MINIMAL = """id name content status ticket_Status priority plan_End_At comment_Token created_At
  assignTo { id name } owner { id name } followers { id name } attachments { id name url } additionalInfo { key value }"""

MAX_INITIAL_FETCH = 2500
MIN_OID_2024 = "659200800000000000000000"  # 2024-01-01T00:00:00Z theo MongoDB ObjectId timestamp
QC_CHILD_RE = re.compile(r"^\s*(?:\[\s*qc\s*\]|qc[\s:\-\]])", re.I)
TAG_RE = re.compile(r"\[([^\]]{1,30})\]")
SKIP_TAGS = {"WEB", "MOBILE", "APP", "TẤT CẢ", "TATCA", "MINIAPP", "EH", "ODOO", "IOS", "ANDROID", "BUILD", "PRODUCTION", "RELEASE"}
HTML_TASK_ID_RE = re.compile(r"(?:/task/(?:project/[0-9a-f]{24}/|me/|filter/approval/)|/task-timeline/)([0-9a-f]{24})", re.I)
ID_RE = re.compile(r"^[0-9a-f]{24}$", re.I)

IMG_RE = re.compile(r"\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)", re.I)
VID_RE = re.compile(r"\.(mp4|webm|mov|m4v|ogv)(\?|#|$)", re.I)
AUD_RE = re.compile(r"\.(mp3|wav|m4a|ogg|aac)(\?|#|$)", re.I)
PDF_RE = re.compile(r"\.pdf(\?|#|$)", re.I)

_DETAIL_CACHE: dict[str, tuple[float, dict]] = {}
_DETAIL_TTL = 60.0


def _media_kind(url: str, name: str = "") -> str:
    if IMG_RE.search(name) or IMG_RE.search(url):
        return "image"
    if VID_RE.search(name) or VID_RE.search(url):
        return "video"
    if AUD_RE.search(name) or AUD_RE.search(url):
        return "audio"
    if PDF_RE.search(name) or PDF_RE.search(url):
        return "pdf"
    return "file"


def _extract_media(html: str | None) -> list[dict]:
    s = str(html or "")
    out: dict[str, str] = {}

    def add(u: str, kind: str) -> None:
        url = u.replace("&amp;", "&").strip()
        if re.match(r"^https?://", url, re.I) and url not in out:
            out[url] = kind

    for m in re.finditer(r'<img\b[^>]*?\bsrc=["\']([^"\']+)["\']', s, re.I):
        add(m.group(1), "image")
    for m in re.finditer(r'<(?:video|audio|source)\b[^>]*?\bsrc=["\']([^"\']+)["\']', s, re.I):
        u = m.group(1)
        add(u, "audio" if _media_kind(u) == "audio" else "video")
    for m in re.finditer(r'<a\b[^>]*?\bhref=["\']([^"\']+)["\']', s, re.I):
        u = m.group(1)
        k = _media_kind(u)
        if k in ("image", "video", "audio"):
            add(u, k)
    return [{"url": u, "kind": k} for u, k in out.items()]


def _extract_module(name: str) -> str:
    for m in TAG_RE.findall(name or ""):
        t = re.sub(r"\s+", "", m.strip().upper())
        if not t or t in SKIP_TAGS or re.match(r"^B\d{4,}$", t):
            continue
        return t
    return ""


def _extract_ids_from_html(html: str | None) -> list[str]:
    return sorted({m.group(1).lower() for m in HTML_TASK_ID_RE.finditer(str(html or ""))})


_BUILD_SRC_RE = re.compile(r"BUILD(?:\s+(?:PRODUCTION|STAGING|DEV|BETA|RELEASE))?\s*[-–:]\s*(.+)$", re.I)


def _extract_source_title(name: str) -> str:
    s = str(name or "").strip()
    m = _BUILD_SRC_RE.search(s)
    return m.group(1).strip() if m else ""


def _info_dict(task: dict) -> dict:
    ai = task.get("additionalInfo") or []
    if isinstance(ai, list):
        return {str(i.get("key")): i.get("value") for i in ai if isinstance(i, dict)}
    return ai if isinstance(ai, dict) else {}


def _assignee_name(task: dict) -> str:
    a = task.get("assignTo")
    if isinstance(a, dict):
        return str(a.get("name") or "")
    if isinstance(a, list) and a:
        return ", ".join(str(x.get("name") or "") for x in a if isinstance(x, dict) and x.get("name"))
    return ""


def _approver_name(task: dict) -> str:
    ap = task.get("approverEntity")
    if isinstance(ap, dict):
        return str(ap.get("user_Name") or "")
    return ""


def _qc_child_version(session: Session, actor: Principal | None) -> SourceVersion:
    src = session.scalar(select(Source).where(Source.kind == "qc_function_child", Source.title == "QC Function Children"))
    if src is None:
        src = Source(kind="qc_function_child", title="QC Function Children", external_url="", created_by=actor.id if actor else None, meta={"system": True})
        session.add(src)
        session.flush()
    ver = session.scalar(select(SourceVersion).where(SourceVersion.source_id == src.id, SourceVersion.label == "live"))
    if ver is None:
        ver = SourceVersion(source_id=src.id, label="live", meta={"live": True})
        session.add(ver)
        session.flush()
    return ver


def sync_task_functions(session: Session, client: HaraworksClient, actor: Principal | None = None) -> dict:
    """Kéo danh sách Task Function (task cha) + lưu riêng task con tiền tố QC cho Dashboard Cá Nhân."""
    results = []
    total_created = total_updated = 0
    qc_ver = _qc_child_version(session, actor)
    qc_existing = {
        r.external_key: r
        for r in session.scalars(select(SourcePassage).where(SourcePassage.source_version_id == qc_ver.id, SourcePassage.is_current.is_(True)))
        if r.external_key
    }
    qc_seq = (session.scalar(select(func.max(SourcePassage.seq)).where(SourcePassage.source_version_id == qc_ver.id)) or -1) + 1
    qc_seen_keys: set[str] = set()

    for proj in FUNCTION_PROJECTS:
        pid = proj["id"]
        try:
            lst = client.get_list_task("0", pid)
        except HaraworksAuthError:
            raise
        except Exception:  # noqa: BLE001
            continue
        if not lst or not lst.get("ids"):
            continue
        ids = sorted((str(x) for x in lst["ids"] if str(x) >= MIN_OID_2024), reverse=True)
        if len(ids) > MAX_INITIAL_FETCH:
            ids = ids[:MAX_INITIAL_FETCH]
        raw_tasks = client.get_tasks(ids, TASK_FIELDS)
        valid = []
        descriptions: dict[str, str] = {}
        extra_meta: dict[str, dict] = {}
        for t in raw_tasks:
            if t.get("is_Deleted") or t.get("is_Group_Task") or not (t.get("name") or "").strip():
                continue
            created_str = str(t.get("created_At") or "")
            if created_str and created_str[:10] < "2024-01-01":
                continue
            tid = str(t.get("id") or "")
            st = t.get("status")
            pr = t.get("priority")
            info = _info_dict(t)
            name = str(t.get("name") or "").strip()
            mod_code = str(info.get("module") or _extract_module(name)).strip().upper()
            meta_obj = {
                "task_id": tid,
                "team": proj["team"],
                "project": proj["name"],
                "project_id": pid,
                "status": st,
                "status_label": STATUS_LABELS.get(st, str(st) if st is not None else "Mới"),
                "closed": st in CLOSED_STATUSES,
                "priority": pr,
                "priority_label": PRIORITY_LABELS.get(pr, "") if pr is not None else "",
                "assignee": _assignee_name(t),
                "approver": _approver_name(t),
                "plan_start_at": str(t.get("plan_Start_At") or ""),
                "plan_end_at": str(t.get("plan_End_At") or ""),
                "created_at": created_str,
                "updated_at": str(t.get("status_Updated_At") or created_str),
                "module": mod_code,
                "url": f"https://tasks.haraworks.vn/task/project/{pid}/{tid}",
            }
            if t.get("parent_Id"):
                # Chỉ lưu task con có tiền tố QC vào nguồn riêng cho Dashboard (KHÔNG đưa ra danh sách Task Function)
                if tid and QC_CHILD_RE.match(name):
                    qc_seen_keys.add(tid)
                    meta_obj["parent_id"] = str(t.get("parent_Id"))
                    h = hashlib.sha256(name.encode()).hexdigest()
                    if tid in qc_existing:
                        row = qc_existing[tid]
                        row.text = name
                        row.text_fold = fold(name)
                        row.heading_path = mod_code
                        row.locator = meta_obj
                        row.content_hash = h
                    else:
                        row = SourcePassage(
                            source_version_id=qc_ver.id, seq=qc_seq, kind="task", heading_path=mod_code,
                            locator=meta_obj, text=name, text_fold=fold(name), content_hash=h,
                            external_key=tid, is_current=True,
                        )
                        session.add(row)
                        qc_existing[tid] = row
                        qc_seq += 1
                continue
            t["project_Name"] = proj["name"]
            t["team_Name"] = proj["team"]
            if tid and t.get("content"):
                descriptions[tid] = html_to_text(t.get("content"))
            extra_meta[tid] = meta_obj
            valid.append(t)
        r = ingest_task_functions(session, actor=actor, team=proj["team"], tasks=valid, descriptions=descriptions)
        # Bổ sung metadata hiển thị (status, priority, assignee, approver, created_at) và dọn mọi task con / task cũ trước 2024
        if valid:
            src_id = uuid.UUID(r["source_id"])
            ver = session.scalar(select(SourceVersion).where(SourceVersion.source_id == src_id, SourceVersion.label == "live"))
            if ver is not None:
                valid_keys = set(extra_meta.keys())
                for p in session.scalars(select(SourcePassage).where(SourcePassage.source_version_id == ver.id, SourcePassage.is_current.is_(True))):
                    loc = dict(p.locator or {})
                    if loc.get("parent_id") or (p.external_key not in valid_keys):
                        p.is_current = False
                        continue
                    loc.update(extra_meta[p.external_key])
                    p.locator = loc
                    if not p.heading_path and extra_meta[p.external_key]["module"]:
                        p.heading_path = extra_meta[p.external_key]["module"]
                session.flush()
        total_created += r["created"]
        total_updated += r["updated"]
        results.append(r)
    return {"teams": results, "created": total_created, "updated": total_updated}


def _fetch_linked_task_builds(client: HaraworksClient, build_id: str) -> list[dict]:
    try:
        res = client._http.get(
            f"{client.base}/call/ta_api/tasks/get_task-build_by_taskids",
            params={"taskIds": build_id},
            headers={"cookie": client.cookie, "origin": client.base, "referer": f"{client.base}/task/me", "accept": "application/json"},
        )
        if not res.is_success:
            return []
        data = res.json().get("data")
        if not isinstance(data, list):
            return []
        return [{"id": str(r.get("id") or "").lower(), "name": str(r.get("name") or ""), "project_id": str(r.get("project_Id") or "")} for r in data if isinstance(r, dict) and r.get("id")]
    except Exception:  # noqa: BLE001
        return []


def sync_release_builds(session: Session, client: HaraworksClient, actor: Principal | None = None) -> dict:
    """Kéo danh sách đợt Build / Release trực tiếp từ 2 dự án Release trên Haraworks kèm liên kết task gốc."""
    src = session.scalar(select(Source).where(Source.kind == "release_build", Source.title == "Release Builds"))
    if src is None:
        src = Source(kind="release_build", title="Release Builds", external_url="", created_by=actor.id if actor else None, meta={"system": True})
        session.add(src)
        session.flush()
    ver = session.scalar(select(SourceVersion).where(SourceVersion.source_id == src.id, SourceVersion.label == "live"))
    if ver is None:
        ver = SourceVersion(source_id=src.id, label="live", meta={"live": True})
        session.add(ver)
        session.flush()

    existing = {
        r.external_key: r
        for r in session.scalars(select(SourcePassage).where(SourcePassage.source_version_id == ver.id, SourcePassage.is_current.is_(True)))
        if r.external_key
    }
    seq = (session.scalar(select(func.max(SourcePassage.seq)).where(SourcePassage.source_version_id == ver.id)) or -1) + 1
    created = updated = 0
    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()

    # Map project_Id -> team name của 4 team Function để tô màu theo team nguồn
    team_by_pid = {p["id"]: p["team"] for p in FUNCTION_PROJECTS}

    for proj in BUILD_PROJECTS:
        pid = proj["id"]
        try:
            lst = client.get_list_task("0", pid)
        except HaraworksAuthError:
            raise
        except Exception:  # noqa: BLE001
            continue
        if not lst or not lst.get("ids"):
            continue
        ids = sorted((str(x) for x in lst["ids"] if str(x) >= MIN_OID_2024), reverse=True)
        if len(ids) > MAX_INITIAL_FETCH:
            ids = ids[:MAX_INITIAL_FETCH]
        raw_tasks = client.get_tasks(ids, BUILD_FIELDS)
        for t in raw_tasks:
            if t.get("is_Deleted") or t.get("is_Group_Task") or t.get("parent_Id") or not (t.get("name") or "").strip():
                continue
            created_str = str(t.get("created_At") or "")
            if created_str and created_str[:10] < "2024-01-01":
                continue
            bid = str(t.get("id") or "")
            if not bid:
                continue
            title = str(t.get("name") or "").strip()
            info = _info_dict(t)
            st_code = t.get("status")
            st_label = STATUS_LABELS.get(st_code, str(st_code) if st_code is not None else "Mới")
            pr = t.get("priority")
            html_content = str(t.get("content") or "")
            note = html_to_text(html_content) if html_content else ""
            linked_ids = {x for x in _extract_ids_from_html(html_content) if x != bid.lower()}
            linked_rows = _fetch_linked_task_builds(client, bid)
            source_team = ""
            source_fn = None
            for lr in linked_rows:
                if lr["id"] == bid.lower():
                    continue
                linked_ids.add(lr["id"])
                if not source_team and lr.get("project_id") in team_by_pid:
                    source_team = team_by_pid[lr["project_id"]]
                if source_fn is None and lr.get("name"):
                    source_fn = {
                        "id": lr["id"],
                        "title": lr["name"],
                        "url": f"https://tasks.haraworks.vn/task/project/{lr.get('project_id') or ''}/{lr['id']}",
                    }
            mod = str(info.get("module") or _extract_module(title) or (_extract_module(source_fn["title"]) if source_fn else "")).strip().upper()
            loc = {
                "build_id": bid,
                "kind": proj["kind"],
                "kind_label": proj["kind_label"],
                "team": proj["team"],
                "project": proj["name"],
                "source_team": source_team,
                "source_function": source_fn,
                "source_title": _extract_source_title(title),
                "linked_ids": sorted(linked_ids),
                "module": mod,
                "status_code": st_code,
                "status": st_label,
                "closed": st_code in CLOSED_STATUSES,
                "priority": pr,
                "priority_label": PRIORITY_LABELS.get(pr, "") if pr is not None else "",
                "assignee": _assignee_name(t),
                "approver": _approver_name(t),
                "version": str(info.get("buildNumber") or ""),
                "platform": str(info.get("platform") or ""),
                "parent_task": str(t.get("parent_Id") or ""),
                "plan_start_at": str(t.get("plan_Start_At") or ""),
                "plan_end_at": str(t.get("plan_End_At") or ""),
                "url": f"https://tasks.haraworks.vn/task/project/{pid}/{bid}",
                "created_at": str(t.get("created_At") or now_iso),
                "updated_at": str(t.get("status_Updated_At") or t.get("created_At") or now_iso),
            }
            text = title + (("\n" + note) if note else "")
            h = hashlib.sha256(text.encode()).hexdigest()
            if bid in existing:
                row = existing[bid]
                row.text = text
                row.text_fold = fold(text)
                row.heading_path = mod
                row.locator = loc
                row.content_hash = h
                updated += 1
            else:
                row = SourcePassage(
                    source_version_id=ver.id,
                    seq=seq,
                    kind="task",
                    heading_path=mod,
                    locator=loc,
                    text=text,
                    text_fold=fold(text),
                    content_hash=h,
                    external_key=bid,
                    is_current=True,
                )
                session.add(row)
                existing[bid] = row
                seq += 1
                created += 1
    session.flush()
    return {"created": created, "updated": updated}


def check_task_in_builds(session: Session, *, task_id: str = "", title: str = "") -> dict:
    """Kiểm tra 1 task (Bug hoặc Task Function) đã nằm trong đợt Build App Mobile / Build Task Function nào chưa."""
    target_id = str(task_id or "").strip().lower()
    clean_title = fold(re.sub(r"^\s*(?:\[[^\]]{1,40}\]\s*)+", "", str(title or "")).strip())
    full_title = fold(title or "")
    app_builds: list[dict] = []
    fn_builds: list[dict] = []

    rows = session.scalars(
        select(SourcePassage)
        .join(SourceVersion, SourceVersion.id == SourcePassage.source_version_id)
        .join(Source, Source.id == SourceVersion.source_id)
        .where(Source.kind == "release_build", Source.status == "active", SourcePassage.is_current.is_(True))
    ).all()

    for p in rows:
        loc = p.locator or {}
        linked = [str(x).lower() for x in (loc.get("linked_ids") or [])]
        matched = False
        if target_id and target_id in linked:
            matched = True
        elif len(full_title) >= 10:
            src_t = fold(str(loc.get("source_title") or ""))
            content_f = p.text_fold or ""
            if src_t and (src_t == full_title or full_title in src_t or (len(clean_title) >= 10 and clean_title in src_t)):
                matched = True
            elif content_f and (full_title in content_f or (len(clean_title) >= 12 and clean_title in content_f)):
                matched = True
        if matched:
            lines = (p.text or "").split("\n", 1)
            item = {
                "id": str(loc.get("build_id") or p.external_key or p.id),
                "title": lines[0],
                "kind": str(loc.get("kind") or "function"),
                "kind_label": str(loc.get("kind_label") or "Build Task Function"),
                "status_label": str(loc.get("status") or ""),
                "assignee": str(loc.get("assignee") or ""),
                "date": str(loc.get("created_at") or p.created_at.isoformat()),
                "url": str(loc.get("url") or ""),
            }
            if item["kind"] == "app":
                app_builds.append(item)
            else:
                fn_builds.append(item)

    app_builds.sort(key=lambda x: x["date"], reverse=True)
    fn_builds.sort(key=lambda x: x["date"], reverse=True)
    return {"appBuilds": app_builds, "functionBuilds": fn_builds, "total": len(app_builds) + len(fn_builds)}


def get_haraworks_task_detail(client: HaraworksClient, task_id: str) -> dict:
    """Lấy chi tiết đầy đủ của 1 task từ Haraworks (mô tả, ảnh/video/file, task con, lịch sử, bình luận)."""
    tid = str(task_id or "").strip()
    if not ID_RE.match(tid):
        raise AppError("Mã task Haraworks không hợp lệ", code="BAD_ID", status=422)
    hit = _DETAIL_CACHE.get(tid)
    if hit and (time.time() - hit[0]) < _DETAIL_TTL:
        return hit[1]
    q = json.dumps(tid)
    try:
        task = client.gql(f"query{{getTaskById(id:{q}){{{DETAIL_FULL}}}}}").get("getTaskById")
    except AppError as exc:
        if exc.code == "HARAWORKS_AUTH":
            raise
        task = client.gql(f"query{{getTaskById(id:{q}){{{DETAIL_MINIMAL}}}}}").get("getTaskById")
    if not task:
        raise AppError("Không tìm thấy task này trên Haraworks (có thể đã bị xóa).", code="NOT_FOUND", status=404)

    logs = []
    try:
        logs = (client.gql(f"query{{getTaskById(id:{q}){{logs{{log_Type value reason additional_Info{{key value}} created_At created_By{{id name}}}}}}}}").get("getTaskById") or {}).get("logs") or []
    except Exception:  # noqa: BLE001
        pass

    childs = []
    try:
        childs = ((client.gql(f"query{{getTaskById(id:{q}){{childs{{totalCount data{{id name status priority assignTo{{id name}}}}}}}}}}").get("getTaskById") or {}).get("childs") or {}).get("data") or []
    except Exception:  # noqa: BLE001
        pass

    comments = None
    if task.get("comment_Token"):
        try:
            ct = json.dumps(task["comment_Token"])
            comments = client.gql(
                f"query{{comments(token:{ct},preview:false,page_index:1,page_size:100)"
                "{totalCount data{id content created_At created_By{id name} attachments{id name url} like_count "
                "replies(preview:false,page_index:1,page_size:100){totalCount data{id content created_At created_By{id name}}}}}}"
            ).get("comments")
        except Exception:  # noqa: BLE001
            pass

    def _files(arr):
        return [{"name": f.get("name") or "", "url": f.get("url") or "", "kind": _media_kind(f.get("url") or "", f.get("name") or "")} for f in (arr or []) if isinstance(f, dict)]

    def _people(arr):
        return [{"name": p.get("name") or "", "dept": p.get("departmentName") or "", "title": p.get("jobtitleName") or ""} for p in (arr or []) if isinstance(p, dict)]

    def _one(p):
        return {"name": p.get("name") or ""} if isinstance(p, dict) else None

    st = task.get("status") if task.get("status") is not None else task.get("ticket_Status")
    data = {
        "id": task.get("id"),
        "code": task.get("code") or "",
        "name": task.get("name") or "",
        "description": html_to_text(task.get("content")),
        "description_media": _extract_media(task.get("content")),
        "status": st,
        "status_label": STATUS_LABELS.get(st, str(st) if st is not None else ""),
        "priority": task.get("priority"),
        "priority_label": PRIORITY_LABELS.get(task.get("priority"), "") if task.get("priority") is not None else "",
        "plan_end_at": task.get("plan_End_At") or "",
        "created_at": task.get("created_At") or "",
        "updated_at": task.get("updated_At") or "",
        "approver": {"name": task["approverEntity"].get("user_Name") or "", "dept": task["approverEntity"].get("department_Name") or ""} if isinstance(task.get("approverEntity"), dict) else None,
        "created_by": _one(task.get("created_By")),
        "updated_by": _one(task.get("updated_By")),
        "owner": _one(task.get("owner")),
        "assignee": {"name": task["assignTo"].get("name") or "", "dept": task["assignTo"].get("departmentName") or ""} if isinstance(task.get("assignTo"), dict) else None,
        "followers": _people(task.get("followers")),
        "supporters": _people(task.get("supporters")),
        "attachments": _files(task.get("attachments")),
        "project_id": task.get("project_Id") or "",
        "project": task.get("project_Name") or "",
        "childs": [
            {
                "id": ch.get("id") or "",
                "name": ch.get("name") or "",
                "status": ch.get("status"),
                "status_label": STATUS_LABELS.get(ch.get("status"), "") if ch.get("status") is not None else "",
                "assignee": (ch.get("assignTo") or {}).get("name") or "" if isinstance(ch.get("assignTo"), dict) else "",
                "url": f"https://tasks.haraworks.vn/task/project/{task.get('project_Id') or ''}/{ch.get('id')}" if ch.get("id") else "",
            }
            for ch in (childs or []) if isinstance(ch, dict)
        ],
        "logs": [
            {
                "type": lg.get("log_Type"),
                "value": lg.get("value") or "",
                "reason": lg.get("reason") or "",
                "at": lg.get("created_At") or "",
                "by": (lg.get("created_By") or {}).get("name") or "" if isinstance(lg.get("created_By"), dict) else "",
                "info": {str(i.get("key")): i.get("value") for i in (lg.get("additional_Info") or []) if isinstance(i, dict)},
            }
            for lg in (logs or []) if isinstance(lg, dict)
        ],
        "comments": {
            "total": (comments or {}).get("totalCount") or 0,
            "items": [
                {
                    "id": c.get("id"),
                    "text": html_to_text(c.get("content")),
                    "at": c.get("created_At") or "",
                    "by": (c.get("created_By") or {}).get("name") or "" if isinstance(c.get("created_By"), dict) else "",
                    "attachments": _files(c.get("attachments")),
                    "media": _extract_media(c.get("content")),
                    "replies": [
                        {
                            "id": r.get("id"),
                            "text": html_to_text(r.get("content")),
                            "at": r.get("created_At") or "",
                            "by": (r.get("created_By") or {}).get("name") or "" if isinstance(r.get("created_By"), dict) else "",
                        }
                        for r in ((c.get("replies") or {}).get("data") or []) if isinstance(r, dict)
                    ],
                }
                for c in ((comments or {}).get("data") or []) if isinstance(c, dict)
            ],
        },
    }
    _DETAIL_CACHE[tid] = (time.time(), data)
    return data
