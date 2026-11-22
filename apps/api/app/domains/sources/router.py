from __future__ import annotations

import json
import uuid
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, File, Form, UploadFile
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
def list_sources(kind: str = "", include_retired: bool = False, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    q = select(Source).order_by(Source.kind, Source.title)
    if kind:
        q = q.where(Source.kind == kind)
    if not include_retired:
        q = q.where(Source.status == "active")
    out = []
    for s in session.scalars(q):
        if s.kind not in ingest.KIND_LABEL:  # nguồn cũ của Kho rule: không phải nguồn tra cứu trích dẫn
            continue
        vers = session.scalars(select(SourceVersion).where(SourceVersion.source_id == s.id).order_by(SourceVersion.created_at.desc())).all()
        counts = dict(session.execute(select(SourcePassage.source_version_id, func.count()).where(SourcePassage.source_version_id.in_([v.id for v in vers] or [uuid.uuid4()]),
                                                                                                   SourcePassage.is_current.is_(True)).group_by(SourcePassage.source_version_id)).all())
        out.append({"id": str(s.id), "kind": s.kind, "kind_label": ingest.KIND_LABEL[s.kind], "title": s.title, "url": s.external_url, "status": s.status,
                    "meta": s.meta or {}, "created_at": s.created_at.isoformat(),
                    "versions": [{"id": str(v.id), "label": v.label, "created_at": v.created_at.isoformat(), "current_passages": counts.get(v.id, 0),
                                  "has_file": v.file_id is not None, "meta": {k: x for k, x in (v.meta or {}).items() if k != "sha256"}} for v in vers]})
    return {"items": out, "coverage": search.coverage(session)}


@router.post("/sources/upload", status_code=201)
async def upload_source(kind: str = Form(...), title: str = Form(...), version_label: str = Form(""), external_url: str = Form(""), file: UploadFile = File(...),
                        p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session), storage: StorageBackend = Depends(storage_dep)):
    """Upload tài liệu BA (.docx) hoặc wiki (.docx/.html/.md/.txt). Cùng tên nguồn ⇒ thêm PHIÊN BẢN mới; bản cũ không bị xóa."""
    limit = get_settings().max_source_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("Tệp vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
    return _result(ingest.ingest_document(session, storage, actor=p, kind=kind, title=title, filename=file.filename or "", data=data,
                                          version_label=version_label or None, external_url=external_url))


class FigmaIn(BaseModel):
    url: str
    title: str = ""
    pasted_text: str = ""
    version_label: str = ""


@router.post("/sources/figma", status_code=201)
def add_figma(body: FigmaIn, p: Principal = Depends(require(Perm.FILES_WRITE)), session: Session = Depends(get_session)):
    """Thêm link Figma. Nội dung lấy bằng token Figma (nếu đã cấu hình) hoặc từ văn bản bạn dán; chỉ link thì chưa có gì để trích."""
    info = ingest.parse_figma_url(body.url)
    nodes = None
    if not body.pasted_text.strip():
        nodes = integ.fetch_figma(session, p, info["file_key"], info["node_id"])
    return _result(ingest.ingest_figma(session, actor=p, url=body.url, title=body.title or None, nodes_json=nodes, pasted_text=body.pasted_text,
                                       version_label=body.version_label or None))


class WikiUrlIn(BaseModel):
    url: str
    title: str = Field(min_length=1, max_length=400)
    version_label: str = ""


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
                                          version_label=body.version_label or None, external_url=body.url))


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
def browse_passages(source_id: uuid.UUID, version: uuid.UUID | None = None, q: str = "", offset: int = 0, limit: int = 50, _: Principal = Depends(current_principal),
                    session: Session = Depends(get_session)):
    from app.core.text import fold, like_escape

    s = session.get(Source, source_id)
    if s is None:
        raise NotFound("Không thấy nguồn")
    ver = session.get(SourceVersion, version) if version else session.scalar(select(SourceVersion).where(SourceVersion.source_id == s.id).order_by(SourceVersion.created_at.desc()))
    if ver is None:
        return {"total": 0, "items": []}
    stmt = select(SourcePassage).where(SourcePassage.source_version_id == ver.id)
    for term in fold(q).split():
        stmt = stmt.where(SourcePassage.text_fold.like(f"%{like_escape(term)}%", escape="\\"))
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.scalars(stmt.order_by(SourcePassage.seq).offset(offset).limit(min(limit, 200))).all()
    return {"total": total, "version": ver.label, "items": [{"passage_id": str(r.id), "seq": r.seq, "kind": r.kind, "heading_path": r.heading_path,
                                                            "location": search.describe_locator(r.locator or {}), "text": r.text, "is_current": r.is_current} for r in rows]}


@router.get("/sources/passages/{passage_id}/context")
def passage_context(passage_id: uuid.UUID, radius: int = 2, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    ctx = search.passage_context(session, passage_id, min(max(radius, 0), 5))
    if ctx is None:
        raise NotFound("Không thấy đoạn trích")
    return ctx


# ----------------------------------------------------------------------------- tra cứu theo mô tả bug
class LookupIn(BaseModel):
    description: str = Field(min_length=8, max_length=6000)
    kinds: list[str] = []
    module: str = ""
    per_kind: int = Field(5, ge=1, le=20)
    include_old_versions: bool = False
    save: bool = True


@router.post("/lookups")
def run_lookup(body: LookupIn, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    bad = [k for k in body.kinds if k not in ingest.KIND_LABEL]
    if bad:
        raise AppError(f"Loại nguồn không hợp lệ: {', '.join(bad)}", code="VALIDATION_ERROR", status=422)
    res = search.lookup(session, body.description, kinds=body.kinds or None, module=body.module, per_kind=body.per_kind, include_old=body.include_old_versions)
    res["lookup_id"] = None
    if body.save:
        snap = [{k: c[k] for k in ("passage_id", "source_kind", "source_title", "source_version", "heading_path", "location", "quote", "citation", "score", "url")}
                for g in res["groups"].values() for c in g]
        row = Lookup(description=body.description, keywords=res["keywords"], filters={"kinds": body.kinds, "module": body.module}, results=snap, created_by=p.id)
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
