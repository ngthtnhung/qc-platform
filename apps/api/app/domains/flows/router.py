from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.deps import current_principal, require
from app.core.errors import AppError, Conflict, NotFound
from app.core.principal import Perm, Principal
from app.domains.automation import service as automation
from app.domains.flows import recorder
from app.domains.flows.models import FlowRecording
from app.domains.platform.audit import log_audit

router = APIRouter(tags=["flows"])


class RecordingIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    module_code: str = Field(default="", max_length=40)
    start_url: str = Field(min_length=1, max_length=1000)
    events: list[dict[str, Any]] = Field(min_length=1, max_length=recorder.MAX_EVENTS)


class MakeTaskIn(BaseModel):
    module_code: str = Field(min_length=1, max_length=40)
    name: str = ""
    required_roles: list[str] = []
    writes: bool = False


def _out(r: FlowRecording, full: bool = False) -> dict[str, Any]:
    d = {"id": str(r.id), "name": r.name, "module_code": r.module_code, "start_url": r.start_url, "status": r.status,
         "task_id": str(r.task_id) if r.task_id else None, "created_at": r.created_at.isoformat(),
         "step_count": len(r.normalized.get("steps", [])), "warnings": r.normalized.get("warnings", [])}
    if full:
        d["normalized"] = r.normalized
        d["script_preview"] = recorder.generate_script(r.normalized.get("steps", []))
    return d


def _get(session: Session, rid: uuid.UUID) -> FlowRecording:
    r = session.get(FlowRecording, rid)
    if r is None:
        raise NotFound("Không thấy bản ghi")
    return r


@router.post("/flows/recordings", status_code=201)
def create_recording(body: RecordingIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    try:
        norm = recorder.normalize(body.events)
    except ValueError as e:
        raise AppError(str(e), code="VALIDATION_ERROR", status=422) from e
    if not norm["steps"]:
        raise AppError("Không có thao tác nào dùng được trong bản ghi", code="VALIDATION_ERROR", status=422)
    # Chỉ lưu thô các trường cần cho locator; giá trị ô nhạy cảm đã bị loại ở normalize nhưng KHÔNG lưu bản thô của chúng
    raw = [e for e in body.events if not (e.get("t") == "fill" and recorder.is_sensitive(e.get("el") or {}))]
    r = FlowRecording(name=body.name.strip(), module_code=body.module_code.strip(), start_url=body.start_url, raw_events=raw,
                      normalized=norm, created_by=p.id)
    session.add(r)
    session.flush()
    log_audit(session, p, "FLOW_RECORDING_CREATE", resource_type="flow_recording", resource_id=str(r.id), after={"steps": len(norm["steps"])})
    return _out(r, full=True)


@router.get("/flows/recordings")
def list_recordings(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return [_out(r) for r in session.scalars(select(FlowRecording).order_by(FlowRecording.created_at.desc()).limit(100))]


@router.get("/flows/recordings/{rid}")
def get_recording(rid: uuid.UUID, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return _out(_get(session, rid), full=True)


@router.post("/flows/recordings/{rid}/create-task", status_code=201)
def make_task(rid: uuid.UUID, body: MakeTaskIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    """Sinh code tất định rồi tạo tác vụ; code ở PENDING cho tới khi một QC duyệt (kể cả người vừa ghi)."""
    r = _get(session, rid)
    if r.task_id:
        raise Conflict("Bản ghi này đã tạo tác vụ", code="ALREADY_CREATED")
    norm = r.normalized
    script = recorder.generate_script(norm["steps"])
    t, _cv = automation.create_task(
        session, actor=p, name=(body.name or r.name), module_code=body.module_code, start_url=r.start_url,
        steps=[s["label"] for s in norm["steps"]], script=script, params=norm["params"], required_roles=body.required_roles,
        writes=body.writes, source={"flow_recording": str(r.id)}, origin="human",
    )
    r.status, r.task_id = "TASK_CREATED", t.id
    log_audit(session, p, "FLOW_TASK_CREATE", resource_type="flow_recording", resource_id=str(r.id), after={"task_id": str(t.id)})
    return {"task_id": str(t.id), "recording": _out(r)}
