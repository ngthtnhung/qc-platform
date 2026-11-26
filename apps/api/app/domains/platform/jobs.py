"""Hàng đợi tác vụ nền: việc dài (đồng bộ Haraworks, nạp mô tả...) KHÔNG chạy trong request HTTP.
API tạo `jobs` rồi đẩy sang Celery; worker chạy handler và ghi kết quả. Trạng thái xem được qua GET /jobs/{id}."""
from __future__ import annotations

import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.db import session_scope, utcnow
from app.core.errors import AppError, NotFound
from app.core.principal import Principal, PrincipalType
from app.domains.platform.audit import log_audit
from app.domains.platform.models import Job, User

Handler = Callable[[Session, Principal, dict], dict]
HANDLERS: dict[str, Handler] = {}


def register(kind: str, fn: Handler) -> None:
    HANDLERS[kind] = fn


def enqueue(session: Session, *, kind: str, actor: Principal, payload: dict | None = None) -> Job:
    from app.domains.platform import handlers  # noqa: F401  (đăng ký handler)

    if kind not in HANDLERS:
        raise AppError(f"Loại tác vụ nền không tồn tại: {kind}", code="VALIDATION_ERROR", status=422)
    job = Job(kind=kind, payload=payload or {}, created_by=actor.id)
    session.add(job)
    session.flush()
    log_audit(session, actor, "JOB_ENQUEUED", resource_type="job", resource_id=str(job.id), after={"kind": kind})
    session.commit()  # worker phải thấy job: commit TRƯỚC khi đẩy sang Celery
    from app.worker import run_job_task

    job_id = job.id
    res = run_job_task.apply_async(args=[str(job_id)])  # eager khi APP_ENV=test
    session.expire_all()
    job = session.get(Job, job_id)
    job.celery_task_id = str(res.id)[:64]
    return job


def run_job(job_id: uuid.UUID) -> dict:
    """Chạy trong worker (phiên riêng). Lỗi được ghi vào job, không làm sập worker."""
    from app.domains.platform import handlers  # noqa: F401

    s = session_scope()
    try:
        job = s.get(Job, job_id)
        if job is None:
            raise NotFound("Không thấy job")
        job.status = "RUNNING"
        s.commit()
        user = s.get(User, job.created_by) if job.created_by else None
        if user and user.is_active:
            actor = Principal(type=PrincipalType.USER, id=user.id, role=user.role, username=user.username)
        else:
            actor = Principal(type=PrincipalType.SYSTEM, username="system")
        try:
            job.result, job.status = HANDLERS[job.kind](s, actor, job.payload or {}), "DONE"
            s.commit()
        except AppError as exc:
            s.rollback()
            if exc.code == "HARAWORKS_AUTH":
                from app.domains.integrations import service as integ
                integ.record_integration_failure("haraworks", f"hết hạn ({exc.code}): {exc.message}")
            job = s.get(Job, job_id)
            job.status, job.result = "FAILED", {"error": {"code": exc.code, "message": exc.message}}
        except Exception as exc:  # noqa: BLE001
            s.rollback()
            job = s.get(Job, job_id)
            job.status, job.result = "FAILED", {"error": {"code": "INTERNAL_ERROR", "message": exc.__class__.__name__}}
        job.finished_at = utcnow()
        s.commit()
        return {"status": job.status}
    finally:
        s.close()
