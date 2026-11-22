"""Lịch chạy định kỳ. Đến hạn ⇒ xếp hàng thay mặt QC đã tạo lịch, qua ĐÚNG các kiểm tra như QC bấm chạy (code đã duyệt, Staging, Policy, giới hạn tốc độ)."""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError, NotFound
from app.core.principal import Principal, PrincipalType
from app.domains.automation import service
from app.domains.automation.models import AutomationTask, Execution, ExecutionSchedule
from app.domains.platform.audit import log_audit
from app.domains.platform.models import User

MIN_INTERVAL = 5


def create_schedule(session: Session, *, actor: Principal, task_id: uuid.UUID, interval_minutes: int, account_id: uuid.UUID | None = None,
                    params: dict | None = None, run_count: int = 1, first_run_in_minutes: int | None = None) -> ExecutionSchedule:
    if interval_minutes < MIN_INTERVAL:
        raise AppError(f"Chu kỳ tối thiểu {MIN_INTERVAL} phút", code="VALIDATION_ERROR", status=422)
    task = session.get(AutomationTask, task_id)
    if task is None or task.status != "active":
        raise NotFound("Không thấy tác vụ")
    if service.latest_approved(session, task.id) is None:
        raise AppError("Tác vụ chưa có phiên bản code nào được QC duyệt; duyệt trước khi đặt lịch.", code="NOT_APPROVED", status=409)
    sch = ExecutionSchedule(task_id=task_id, account_id=account_id, params=params or {}, run_count=run_count, interval_minutes=interval_minutes,
                            next_run_at=utcnow() + dt.timedelta(minutes=first_run_in_minutes if first_run_in_minutes is not None else interval_minutes), created_by=actor.id)
    session.add(sch)
    session.flush()
    log_audit(session, actor, "SCHEDULE_CREATE", resource_type="automation_task", resource_id=str(task_id), after={"schedule": str(sch.id), "every_minutes": interval_minutes})
    return sch


def run_due(session: Session, now: dt.datetime | None = None) -> dict:
    now = now or utcnow()
    done = skipped = failed = 0
    for sch in session.scalars(select(ExecutionSchedule).where(ExecutionSchedule.enabled.is_(True), ExecutionSchedule.next_run_at <= now)):
        user = session.get(User, sch.created_by)
        if user is None or not user.is_active:
            sch.enabled, sch.last_status = False, "Đã tắt: người tạo lịch không còn hoạt động"
            skipped += 1
            continue
        sch.next_run_at = now + dt.timedelta(minutes=sch.interval_minutes)  # không dồn lịch bỏ lỡ
        busy = session.scalar(select(Execution.id).where(Execution.schedule_id == sch.id, Execution.status.in_(["QUEUED", "CLAIMED", "RUNNING"])).limit(1))
        if busy:
            sch.last_status, skipped = "Bỏ qua: lần chạy trước vẫn đang chờ/chạy", skipped + 1
            continue
        actor = Principal(type=PrincipalType.USER, id=user.id, role=user.role, username=user.username)
        task = session.get(AutomationTask, sch.task_id)
        try:
            with session.begin_nested():
                exs = service.queue_runs(session, actor=actor, task=task, account_id=sch.account_id, override=sch.params or None, count=sch.run_count)
                for e in exs:
                    e.schedule_id = sch.id
            sch.last_status, sch.last_run_at = f"Đã xếp hàng {len(exs)} lần chạy", now
            log_audit(session, actor, "SCHEDULE_TRIGGERED", resource_type="automation_task", resource_id=str(sch.task_id), after={"schedule": str(sch.id), "executions": len(exs)})
            done += 1
        except AppError as exc:
            sch.last_status, sch.last_run_at = f"Không xếp hàng được: {exc.message}"[:300], now
            failed += 1
    return {"queued": done, "skipped": skipped, "failed": failed}
