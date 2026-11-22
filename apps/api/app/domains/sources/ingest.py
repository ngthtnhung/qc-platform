"""Nạp nguồn vào DB: upload tài liệu, link Figma, Task Function. Mỗi nguồn có phiên bản; nguồn cũ không bị xóa."""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, Conflict
from app.core.principal import Principal
from app.core.text import fold, normalize_text, stable_hash
from app.domains.files import service as file_service
from app.domains.files.storage import StorageBackend
from app.domains.knowledge.models import Source, SourceVersion
from app.domains.platform.audit import log_audit
from app.domains.sources import parsers
from app.domains.sources.models import SourcePassage

KINDS = ("ba_doc", "figma", "task_function", "code_wiki")
KIND_LABEL = {"ba_doc": "Tài liệu BA", "figma": "Figma", "task_function": "Task Function", "code_wiki": "Wiki rule trên code"}
DOC_EXT = {"ba_doc": {"docx"}, "code_wiki": {"docx", "html", "htm", "md", "txt"}}
PASSAGE_KIND = {"heading", "paragraph", "table_row", "code", "node_text", "task", "wiki_block"}


@dataclass
class IngestResult:
    source_id: uuid.UUID
    version_id: uuid.UUID
    version_label: str
    passages: int
    duplicate: bool = False
    note: str = ""


def _next_label(session: Session, source_id: uuid.UUID, wanted: str | None) -> str:
    n = session.scalar(select(func.count()).select_from(SourceVersion).where(SourceVersion.source_id == source_id)) or 0
    label = (wanted or "").strip()[:120] or f"v{n + 1}"
    if session.scalar(select(SourceVersion.id).where(SourceVersion.source_id == source_id, SourceVersion.label == label)):
        raise Conflict(f'Phiên bản "{label}" của nguồn này đã tồn tại. Đặt nhãn phiên bản khác.', code="VERSION_EXISTS")
    return label


def _get_source(session: Session, kind: str, title: str, actor: Principal, url: str = "", meta: dict | None = None) -> Source:
    src = session.scalar(select(Source).where(Source.kind == kind, Source.title == title))
    if src is None:
        src = Source(kind=kind, title=title[:400], external_url=url[:1000], created_by=actor.id, meta=meta or {})
        session.add(src)
        session.flush()
    elif src.status != "active":
        src.status = "active"
    return src


def _add_passages(session: Session, version: SourceVersion, items: list[parsers.Parsed], *, external_keys: list[str | None] | None = None) -> int:
    rows = []
    for i, it in enumerate(items):
        rows.append(SourcePassage(
            source_version_id=version.id, seq=i, kind=it.kind if it.kind in PASSAGE_KIND else "paragraph", heading_path=it.heading_path,
            locator=it.locator, text=it.text, text_fold=fold(it.text), content_hash=hashlib.sha256(it.text.encode()).hexdigest(),
            external_key=external_keys[i] if external_keys else None, is_current=True))
    session.add_all(rows)
    session.flush()
    return len(rows)


def _supersede_previous(session: Session, source_id: uuid.UUID, keep_version: uuid.UUID) -> None:
    ids = [v for (v,) in session.execute(select(SourceVersion.id).where(SourceVersion.source_id == source_id, SourceVersion.id != keep_version))]
    if ids:
        session.execute(update(SourcePassage).where(SourcePassage.source_version_id.in_(ids)).values(is_current=False))


def ingest_document(session: Session, storage: StorageBackend, *, actor: Principal, kind: str, title: str, filename: str, data: bytes,
                    version_label: str | None = None, external_url: str = "") -> IngestResult:
    """Upload .docx (BA) hoặc wiki (.docx/.html/.md/.txt): lưu file vào storage, tách đoạn, thêm vào DB như phiên bản mới."""
    if kind not in DOC_EXT:
        raise AppError("Loại nguồn không hỗ trợ upload tệp", code="VALIDATION_ERROR", status=422)
    title = normalize_text(title)[:400]
    if not title:
        raise AppError("Thiếu tên nguồn", code="VALIDATION_ERROR", status=422)
    ext = (re.search(r"\.([A-Za-z0-9]{1,5})$", filename or "") or [None, ""])[1].lower()
    if ext not in DOC_EXT[kind]:
        raise AppError(f"Loại tệp .{ext or '?'} không hợp lệ cho {KIND_LABEL[kind]} (chấp nhận: {', '.join(sorted(DOC_EXT[kind]))})", code="FILE_TYPE_NOT_ALLOWED", status=415)
    sha = hashlib.sha256(data).hexdigest()
    existing = session.scalar(select(Source).where(Source.kind == kind, Source.title == title))
    if existing:
        dup = session.execute(select(SourceVersion).join(SourcePassage, SourcePassage.source_version_id == SourceVersion.id, isouter=True)
                              .where(SourceVersion.source_id == existing.id).distinct()).scalars().all()
        for v in dup:
            if (v.meta or {}).get("sha256") == sha:
                n = session.scalar(select(func.count()).select_from(SourcePassage).where(SourcePassage.source_version_id == v.id)) or 0
                return IngestResult(existing.id, v.id, v.label, n, duplicate=True, note="Tệp giống hệt phiên bản đã nạp; không tạo phiên bản mới.")
    if ext == "docx":
        items = parsers.parse_docx(data)
    elif ext in ("html", "htm"):
        items = parsers.parse_html(data)
    else:
        items = parsers.parse_text(data, markdown=ext == "md")
    if not items:
        raise AppError("Không trích xuất được đoạn văn bản nào từ tệp này (tệp rỗng hoặc chỉ có ảnh).", code="NO_TEXT", status=422)
    rec = file_service.save_file(session, storage, data=data, name=filename, owner=actor, max_bytes=get_settings().max_source_upload_bytes)
    src = _get_source(session, kind, title, actor, external_url)
    label = _next_label(session, src.id, version_label)
    ver = SourceVersion(source_id=src.id, label=label, file_id=rec.id, meta={"sha256": sha, "filename": filename, "parser": ext})
    session.add(ver)
    session.flush()
    n = _add_passages(session, ver, items)
    _supersede_previous(session, src.id, ver.id)
    log_audit(session, actor, "SOURCE_INGEST", resource_type="source", resource_id=str(src.id), after={"kind": kind, "title": title, "version": label, "passages": n, "sha256": sha})
    return IngestResult(src.id, ver.id, label, n)


# ----------------------------------------------------------------------------- Figma
def parse_figma_url(url: str) -> dict:
    u = urlparse((url or "").strip())
    if u.scheme != "https" or not (u.hostname or "").endswith("figma.com"):
        raise AppError("Link Figma phải là https://…figma.com/…", code="VALIDATION_ERROR", status=422)
    parts = [p for p in u.path.split("/") if p]
    if len(parts) < 2 or parts[0] not in ("design", "file", "proto", "board"):
        raise AppError("Không nhận ra file Figma trong link (dạng /design/<key>/<tên>).", code="VALIDATION_ERROR", status=422)
    node = (parse_qs(u.query).get("node-id") or [""])[0]
    return {"file_key": parts[1], "title": parts[2] if len(parts) > 2 else parts[1], "node_id": node.replace("-", ":") if node else "", "url": f"https://www.figma.com{u.path}" + (f"?node-id={node}" if node else "")}


def ingest_figma(session: Session, *, actor: Principal, url: str, title: str | None, nodes_json: dict | None, pasted_text: str | None,
                 version_label: str | None = None) -> IngestResult:
    """Nội dung Figma đến từ (a) JSON của Figma REST (đã lấy bằng token) hoặc (b) văn bản QC dán tay. Chỉ link thì không có đoạn nào để trích."""
    info = parse_figma_url(url)
    if nodes_json:
        items = parsers.parse_figma_nodes(nodes_json, info["file_key"], info["url"].split("?")[0])
        origin = "figma_api"
    elif pasted_text and pasted_text.strip():
        items = parsers.parse_pasted(pasted_text)
        for it in items:
            it.locator.update({"url": info["url"], "file_key": info["file_key"], **({"node_id": info["node_id"]} if info["node_id"] else {})})
        origin = "pasted"
    else:
        raise AppError("Chưa có nội dung Figma để trích: cần token Figma (để hệ thống đọc) hoặc dán chú thích/văn bản trong thiết kế.", code="NO_FIGMA_CONTENT", status=422)
    if not items:
        raise AppError("Không tìm thấy văn bản (nút TEXT) trong vùng Figma này.", code="NO_TEXT", status=422)
    name = normalize_text(title or "") or info["title"]
    src = _get_source(session, "figma", name, actor, info["url"], {"file_key": info["file_key"]})
    label = _next_label(session, src.id, version_label)
    ver = SourceVersion(source_id=src.id, label=label, meta={"origin": origin, "file_key": info["file_key"], "node_id": info["node_id"], "url": info["url"]})
    session.add(ver)
    session.flush()
    n = _add_passages(session, ver, items)
    _supersede_previous(session, src.id, ver.id)
    log_audit(session, actor, "SOURCE_INGEST", resource_type="source", resource_id=str(src.id), after={"kind": "figma", "title": name, "version": label, "passages": n, "origin": origin})
    return IngestResult(src.id, ver.id, label, n)


# ----------------------------------------------------------------------------- Task Function
def _info(task: dict) -> dict:
    ai = task.get("additionalInfo") or []
    if isinstance(ai, list):
        return {str(i.get("key")): i.get("value") for i in ai if isinstance(i, dict)}
    return ai if isinstance(ai, dict) else {}


def ingest_task_functions(session: Session, *, actor: Principal | None, team: str, tasks: list[dict], descriptions: dict[str, str] | None = None,
                          base_task_url: str = "https://tasks.haraworks.vn/task/project") -> dict:
    """Mỗi task = một đoạn trích: tên + (mô tả nếu có). Idempotent theo id task: đổi nội dung ⇒ đoạn cũ is_current=false, thêm đoạn mới.
    `descriptions` (id→văn bản mô tả) đến từ Haraworks khi có cookie; không có thì đoạn chỉ gồm tên + thuộc tính (ghi rõ chưa có mô tả)."""
    descriptions = descriptions or {}
    title = f"Task Function — {team}"
    src = _get_source(session, "task_function", title, actor or Principal(type=__import__("app.core.principal", fromlist=["PrincipalType"]).PrincipalType.SYSTEM),
                      meta={"team": team})
    ver = session.scalar(select(SourceVersion).where(SourceVersion.source_id == src.id, SourceVersion.label == "live"))
    if ver is None:
        ver = SourceVersion(source_id=src.id, label="live", meta={"live": True})
        session.add(ver)
        session.flush()
    current = {p.external_key: p for p in session.scalars(select(SourcePassage).where(SourcePassage.source_version_id == ver.id, SourcePassage.is_current.is_(True)))}
    seq = (session.scalar(select(func.max(SourcePassage.seq)).where(SourcePassage.source_version_id == ver.id)) or -1) + 1
    created = updated = unchanged = 0
    for t in tasks:
        tid = str(t.get("id") or "")
        if not tid or t.get("is_Deleted"):
            continue
        info = _info(t)
        name = normalize_text(str(t.get("name") or ""))
        desc = normalize_text(descriptions.get(tid, "")) if tid in descriptions else ""
        old = current.get(tid)
        if not desc and old is not None and (old.locator or {}).get("has_description"):
            desc = old.text.split("\n", 1)[1] if "\n" in old.text else ""  # giữ mô tả đã có khi lần nạp này chỉ có metadata
        text = name + (("\n" + desc) if desc else "")
        if not text:
            continue
        h = stable_hash({"t": text})
        if old is not None and old.content_hash == h:
            unchanged += 1
            continue
        loc = {"task_id": tid, "line": seq + 1, "url": f"{base_task_url}/{t.get('project_Id') or ''}/{tid}", "project": t.get("project_Name") or "", "team": team,
               "has_description": bool(desc), "project_id": t.get("project_Id") or "", **{k: info[k] for k in ("module", "customer", "platform", "type", "buildNumber") if info.get(k)}}
        if t.get("parent_Id"):
            loc["parent_id"] = t["parent_Id"]
        p = SourcePassage(source_version_id=ver.id, seq=seq, kind="task", heading_path=str(info.get("module") or ""), locator=loc, text=text, text_fold=fold(text),
                          content_hash=h, external_key=tid, is_current=True, supersedes_id=old.id if old else None)
        seq += 1
        if old is not None:
            old.is_current = False
            updated += 1
        else:
            created += 1
        session.add(p)
    session.flush()
    if actor:
        log_audit(session, actor, "SOURCE_INGEST", resource_type="source", resource_id=str(src.id),
                  after={"kind": "task_function", "team": team, "created": created, "updated": updated, "unchanged": unchanged})
    return {"source_id": str(src.id), "team": team, "created": created, "updated": updated, "unchanged": unchanged}


def import_functions_json(session: Session, path: Path, actor: Principal | None) -> list[dict]:
    """Nhập danh sách task đã có sẵn (functions-live.json của bản Node): chỉ có TÊN + thuộc tính, KHÔNG có mô tả
    (mô tả cần cookie Haraworks: xem integrations.haraworks.sync_descriptions). Chỉ đọc nguồn."""
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    by_team: dict[str, list[dict]] = {}
    for key in ("tasks", "qcTasks"):
        for t in data.get(key, []):
            by_team.setdefault(str(t.get("team_Name") or t.get("project_Name") or "Không rõ"), []).append(t)
    return [ingest_task_functions(session, actor=actor, team=team, tasks=items) for team, items in sorted(by_team.items())]
