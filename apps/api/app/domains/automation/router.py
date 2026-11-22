from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.deps import client_ip, correlation_id, current_principal, require
from app.core.errors import AuthRequired, NotFound
from app.core.principal import Perm, Principal
from app.domains.automation import schedules as sched
from app.domains.automation import service
from app.domains.automation.models import (
    AutomationTask,
    CodeVersion,
    Execution,
    ExecutionArtifact,
    ExecutionLog,
    ExecutionSchedule,
    ExecutionStep,
    Runner,
)
from app.domains.files import service as file_service
from app.domains.files.storage import StorageBackend, get_storage
from app.domains.platform.audit import log_audit

router = APIRouter(tags=["automation"])
runner_router = APIRouter(prefix="/runner", tags=["runner"])


# ------------------------------------------------------------------ schemas
class ParamIn(BaseModel):
    key: str
    label: str = ""
    type: Literal["text", "multiline", "list", "file"] = "text"
    value: str = ""
    auto: bool = True
    fallback: Literal["first", "random"] = "first"


class TaskIn(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    module_code: str = Field(min_length=1, max_length=40)
    start_url: str
    steps: list[str] = Field(min_length=1)
    script: str
    params: list[ParamIn] = []
    flow: str = ""
    description: str = ""
    required_roles: list[str] = []
    writes: bool = False
    rule_keys: list[str] = []


class CodeIn(BaseModel):
    script: str
    note: str = ""
    origin: Literal["human", "ai"] = "human"


class RunIn(BaseModel):
    account_id: uuid.UUID | None = None
    params: dict[str, str] | None = None
    count: int = Field(1, ge=1, le=service.MAX_BATCH)


class ParamsIn(BaseModel):
    values: dict[str, str]


class RunnerIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    type: Literal["host", "docker"]
    capabilities: list[Literal["web", "api", "hybrid"]] = ["web"]
    labels: list[str] = []


class StepIn(BaseModel):
    name: str
    status: str
    ms: int = 0
    error: str = ""


class ReportIn(BaseModel):
    status: Literal["PASSED", "FAILED"]
    sha256: str = Field(min_length=64, max_length=64)
    steps: list[StepIn] = []
    log: list[str] = []
    error: str = ""
    duration_ms: int = 0


class HeartbeatIn(BaseModel):
    status: Literal["ONLINE", "BUSY"] = "ONLINE"


# ------------------------------------------------------------------ QC: tác vụ
def _task_out(session: Session, t: AutomationTask) -> dict[str, Any]:
    vs = list(session.scalars(select(CodeVersion).where(CodeVersion.task_id == t.id).order_by(CodeVersion.version_no.desc())))
    approved = next((v for v in vs if v.status == "APPROVED"), None)
    return {"id": str(t.id), "legacy_id": t.legacy_id, "name": t.name, "module_code": t.module_code, "flow": t.flow, "description": t.description,
            "start_url": t.start_url, "required_roles": t.required_roles, "writes": t.writes, "rule_keys": t.rule_keys, "steps": t.steps,
            "status": t.status, "params": service.task_params(session, t.id), "runnable": approved is not None,
            "approved_version": approved.version_no if approved else None,
            "versions": [{"id": str(v.id), "version_no": v.version_no, "status": v.status, "origin": v.origin, "sha256": v.sha256,
                          "approved_by": str(v.approved_by) if v.approved_by else None} for v in vs]}


def _get_task(session: Session, task_id: uuid.UUID) -> AutomationTask:
    t = session.get(AutomationTask, task_id)
    if t is None:
        raise NotFound("Không thấy tác vụ")
    return t


@router.get("/automation/tasks")
def list_tasks(module: str = "", _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    q = select(AutomationTask).where(AutomationTask.status == "active").order_by(AutomationTask.module_code, AutomationTask.name)
    if module:
        q = q.where(AutomationTask.module_code == module)
    return [_task_out(session, t) for t in session.scalars(q)]


@router.get("/automation/tasks/{task_id}")
def get_task(task_id: uuid.UUID, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    out = _task_out(session, _get_task(session, task_id))
    out["scripts"] = {v.sha256: v.script for v in session.scalars(select(CodeVersion).where(CodeVersion.task_id == task_id))}
    out["script_by_version"] = {str(v.version_no): v.script for v in session.scalars(select(CodeVersion).where(CodeVersion.task_id == task_id))}
    return out


@router.post("/automation/tasks", status_code=201)
def create_task(body: TaskIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    """Tạo tác vụ ⇒ code ở PENDING cho tới khi một QC duyệt (kể cả khi chính QC viết)."""
    t, _cv = service.create_task(session, actor=p, name=body.name, module_code=body.module_code, start_url=body.start_url, steps=body.steps,
                                 script=body.script, params=[x.model_dump() for x in body.params], flow=body.flow, description=body.description,
                                 required_roles=body.required_roles, writes=body.writes, rule_keys=body.rule_keys)
    return _task_out(session, t)


@router.post("/automation/tasks/{task_id}/versions", status_code=201)
def add_version(task_id: uuid.UUID, body: CodeIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    t = _get_task(session, task_id)
    cv = service.add_code_version(session, task=t, script=body.script, requester=p, origin=body.origin, note=body.note)
    return {"id": str(cv.id), "version_no": cv.version_no, "status": cv.status, "sha256": cv.sha256}


@router.put("/automation/tasks/{task_id}/params")
def set_params(task_id: uuid.UUID, body: ParamsIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    return service.update_param_values(session, actor=p, task=_get_task(session, task_id), values=body.values)


@router.delete("/automation/tasks/{task_id}", status_code=204)
def retire_task(task_id: uuid.UUID, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    t = _get_task(session, task_id)
    t.status = "retired"
    log_audit(session, p, "AUTOMATION_TASK_RETIRE", resource_type="automation_task", resource_id=str(t.id))


@router.post("/automation/tasks/{task_id}/run", status_code=201)
def run_task(task_id: uuid.UUID, body: RunIn, request: Request, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    exs = service.queue_runs(session, actor=p, task=_get_task(session, task_id), account_id=body.account_id, override=body.params,
                             count=body.count, correlation_id=correlation_id(request))
    return {"executions": [{"id": str(e.id), "status": e.status} for e in exs]}


# ------------------------------------------------------------------ QC: lần chạy
def _ex_out(e: Execution) -> dict[str, Any]:
    return {"id": str(e.id), "task_id": str(e.task_id), "status": e.status, "attempt": e.attempt, "runner_id": str(e.runner_id) if e.runner_id else None,
            "error": e.error, "duration_ms": e.duration_ms, "batch_id": e.batch_id, "queued_at": e.queued_at.isoformat(),
            "finished_at": e.finished_at.isoformat() if e.finished_at else None}


@router.get("/automation/executions")
def list_executions(task_id: uuid.UUID | None = None, status: str = "", limit: int = 50, _: Principal = Depends(current_principal),
                    session: Session = Depends(get_session)):
    q = select(Execution).order_by(Execution.queued_at.desc()).limit(min(limit, 200))
    if task_id:
        q = q.where(Execution.task_id == task_id)
    if status:
        q = q.where(Execution.status == status)
    return [_ex_out(e) for e in session.scalars(q)]


@router.get("/automation/executions/{execution_id}")
def get_execution(execution_id: uuid.UUID, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    e = session.get(Execution, execution_id)
    if e is None:
        raise NotFound("Không thấy lần chạy")
    steps = session.scalars(select(ExecutionStep).where(ExecutionStep.execution_id == e.id).order_by(ExecutionStep.seq))
    logs = session.scalars(select(ExecutionLog).where(ExecutionLog.execution_id == e.id).order_by(ExecutionLog.seq))
    arts = session.scalars(select(ExecutionArtifact).where(ExecutionArtifact.execution_id == e.id))
    return {**_ex_out(e), "steps": [{"name": s.name, "status": s.status, "ms": s.ms, "error": s.error} for s in steps],
            "log": [x.message for x in logs], "artifacts": [{"id": str(a.id), "kind": a.kind, "file_id": str(a.file_id)} for a in arts]}


@router.post("/automation/executions/{execution_id}/cancel")
def cancel(execution_id: uuid.UUID, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    return _ex_out(service.cancel_execution(session, actor=p, execution_id=execution_id))


# ------------------------------------------------------------------ QC: lịch chạy định kỳ
class ScheduleIn(BaseModel):
    task_id: uuid.UUID
    interval_minutes: int = Field(ge=5, le=60 * 24 * 30)
    account_id: uuid.UUID | None = None
    params: dict[str, str] = {}
    run_count: int = Field(1, ge=1, le=service.MAX_BATCH)
    first_run_in_minutes: int | None = Field(None, ge=0, le=60 * 24)


def _sched_out(s: ExecutionSchedule) -> dict[str, Any]:
    return {"id": str(s.id), "task_id": str(s.task_id), "interval_minutes": s.interval_minutes, "run_count": s.run_count, "enabled": s.enabled,
            "next_run_at": s.next_run_at.isoformat(), "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None, "last_status": s.last_status,
            "account_id": str(s.account_id) if s.account_id else None}


@router.get("/automation/schedules")
def list_schedules(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return [_sched_out(s) for s in session.scalars(select(ExecutionSchedule).order_by(ExecutionSchedule.next_run_at))]


@router.post("/automation/schedules", status_code=201)
def create_schedule(body: ScheduleIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    return _sched_out(sched.create_schedule(session, actor=p, task_id=body.task_id, interval_minutes=body.interval_minutes, account_id=body.account_id,
                                            params=body.params, run_count=body.run_count, first_run_in_minutes=body.first_run_in_minutes))


class ScheduleToggle(BaseModel):
    enabled: bool


@router.put("/automation/schedules/{schedule_id}")
def toggle_schedule(schedule_id: uuid.UUID, body: ScheduleToggle, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    s = session.get(ExecutionSchedule, schedule_id)
    if s is None:
        raise NotFound("Không thấy lịch")
    s.enabled = body.enabled
    log_audit(session, p, "SCHEDULE_TOGGLE", resource_type="automation_task", resource_id=str(s.task_id), after={"schedule": str(s.id), "enabled": body.enabled})
    return _sched_out(s)


@router.delete("/automation/schedules/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: uuid.UUID, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    s = session.get(ExecutionSchedule, schedule_id)
    if s is None:
        raise NotFound("Không thấy lịch")
    log_audit(session, p, "SCHEDULE_DELETE", resource_type="automation_task", resource_id=str(s.task_id), after={"schedule": str(s.id)})
    session.delete(s)


# ------------------------------------------------------------------ QC: runner
def _runner_out(r: Runner) -> dict[str, Any]:
    return {"id": str(r.id), "name": r.name, "type": r.type, "capabilities": r.capabilities, "labels": r.labels, "status": r.status,
            "last_heartbeat_at": r.last_heartbeat_at.isoformat() if r.last_heartbeat_at else None, "revoked": r.revoked_at is not None}


@router.get("/runners")
def list_runners(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return [_runner_out(r) for r in session.scalars(select(Runner).order_by(Runner.name))]


@router.post("/runners", status_code=201)
def create_runner(body: RunnerIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    r, token = service.create_runner(session, actor=p, name=body.name, type_=body.type, capabilities=list(body.capabilities), labels=body.labels)
    return {**_runner_out(r), "token": token}  # token chỉ hiển thị MỘT lần


@router.post("/runners/{runner_id}/revoke")
def revoke(runner_id: uuid.UUID, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    return _runner_out(service.revoke_runner(session, actor=p, runner_id=runner_id))


# ------------------------------------------------------------------ Runner API (xác thực bằng token runner)
def current_runner(request: Request, session: Session = Depends(get_session)) -> Runner:
    h = request.headers.get("authorization", "")
    if not h.lower().startswith("bearer "):
        raise AuthRequired("Thiếu token runner")
    runner, _principal = service.authenticate_runner(session, h[7:].strip())
    return runner


@runner_router.post("/heartbeat", status_code=204)
def runner_heartbeat(body: HeartbeatIn, runner: Runner = Depends(current_runner), session: Session = Depends(get_session)):
    service.heartbeat(session, runner, body.status)


@runner_router.post("/claim")
def runner_claim(runner: Runner = Depends(current_runner), session: Session = Depends(get_session)):
    job = service.claim(session, runner)
    session.commit()
    return {"job": job}


@runner_router.post("/executions/{execution_id}/credentials")
def runner_credentials(execution_id: uuid.UUID, runner: Runner = Depends(current_runner), session: Session = Depends(get_session)):
    return service.serve_credentials(session, runner, execution_id)


@runner_router.get("/executions/{execution_id}/files")
def runner_files(execution_id: uuid.UUID, runner: Runner = Depends(current_runner), session: Session = Depends(get_session)):
    return service.execution_files(session, runner, execution_id)


@runner_router.get("/executions/{execution_id}/files/{file_id}")
def runner_file(execution_id: uuid.UUID, file_id: uuid.UUID, runner: Runner = Depends(current_runner), session: Session = Depends(get_session),
                storage: StorageBackend = Depends(lambda: get_storage())):
    from fastapi.responses import Response

    allowed = {f["file_id"]: f for f in service.execution_files(session, runner, execution_id)}
    meta = allowed.get(str(file_id))
    if meta is None:
        raise NotFound("File không thuộc tham số của lần chạy này")
    rec = file_service.get_file(session, file_id)
    log_audit(session, Principal(type=__import__("app.core.principal", fromlist=["PrincipalType"]).PrincipalType.RUNNER, id=runner.id, username=runner.name),
              "RUNNER_FILE_DOWNLOAD", resource_type="execution", resource_id=str(execution_id), after={"file": str(file_id)})
    return Response(storage.get(rec.storage_key), media_type=rec.mime, headers={"X-Content-Type-Options": "nosniff"})


@runner_router.post("/executions/{execution_id}/start", status_code=204)
def runner_start(execution_id: uuid.UUID, runner: Runner = Depends(current_runner), session: Session = Depends(get_session)):
    service.mark_running(session, runner, execution_id)


@runner_router.post("/executions/{execution_id}/report")
def runner_report(execution_id: uuid.UUID, body: ReportIn, runner: Runner = Depends(current_runner), session: Session = Depends(get_session)):
    ex = service.report(session, runner, execution_id, status=body.status, steps=[s.model_dump() for s in body.steps], log=body.log,
                        error=body.error, duration_ms=body.duration_ms, sha256=body.sha256)
    return _ex_out(ex)


@runner_router.post("/executions/{execution_id}/artifacts", status_code=201)
async def runner_artifact(execution_id: uuid.UUID, request: Request, kind: str, file: UploadFile = File(...), runner: Runner = Depends(current_runner),
                          session: Session = Depends(get_session), storage: StorageBackend = Depends(lambda: get_storage())):
    from app.core.config import get_settings
    from app.core.errors import AppError
    from app.core.principal import PrincipalType

    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise AppError("File vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
    owner = Principal(type=PrincipalType.RUNNER, id=runner.id, username=runner.name)
    rec = file_service.save_file(session, storage, data=data, name=file.filename or "artifact", owner=owner)
    art = service.add_artifact(session, runner, execution_id, kind, rec.id)
    log_audit(session, owner, "ARTIFACT_UPLOAD", resource_type="execution", resource_id=str(execution_id), after={"kind": kind, "file": str(rec.id)}, ip=client_ip(request))
    return {"id": str(art.id), "file_id": str(rec.id)}

