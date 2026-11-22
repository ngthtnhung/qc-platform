"""Celery worker/beat — cùng image với API (một mã nghiệp vụ, nhiều điểm vào).

Phase 1–2 chỉ có tác vụ hệ thống. Đồng bộ Haraworks, phân tích AI, lập chỉ mục... được thêm ở Phase 3+.
Quy tắc: việc dài KHÔNG chạy trong handler HTTP; API tạo `jobs` rồi `delay()`.
Mọi sản phẩm AI sinh ra trong worker PHẢI đi qua `approvals.create_ai_suggestion` (chờ QC duyệt).
"""
from __future__ import annotations

from celery import Celery

from app.core.config import get_settings

_s = get_settings()
celery_app = Celery("qc", broker=_s.redis_url, backend=_s.redis_url)
celery_app.conf.update(
    task_default_queue="default",
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    beat_schedule={
        "run-due-schedules": {"task": "automation.run_due_schedules", "schedule": 60.0},
        "sync-haraworks-bugs": {"task": "sync.scheduled", "schedule": float(_s.haraworks_sync_seconds), "args": ("sync_bugs",)},
        "sync-function-descriptions": {"task": "sync.scheduled", "schedule": 3600.0 * 6, "args": ("sync_function_descriptions",)},
    },
)

if _s.app_env == "test":  # test chạy tác vụ ngay trong tiến trình, không cần Redis
    celery_app.conf.task_always_eager = True


@celery_app.task(name="system.ping")
def ping() -> str:
    return "pong"


@celery_app.task(name="jobs.run")
def run_job_task(job_id: str) -> dict:
    import uuid

    from app.domains.platform.jobs import run_job

    return run_job(uuid.UUID(job_id))


@celery_app.task(name="automation.run_due_schedules")
def run_due_schedules_task() -> dict:
    """Beat gọi mỗi phút: xếp hàng các lịch đến hạn (qua đúng kiểm tra như QC bấm chạy)."""
    from app.core.db import session_scope
    from app.domains.automation.schedules import run_due

    s = session_scope()
    try:
        out = run_due(s)
        s.commit()
        return out
    finally:
        s.close()


@celery_app.task(name="sync.scheduled")
def scheduled_sync_task(kind: str) -> dict:
    """Beat gọi định kỳ: đồng bộ bug / mô tả Task Function nếu ĐÃ cấu hình cookie Haraworks; chưa thì bỏ qua (không báo lỗi)."""
    from app.core.db import session_scope
    from app.core.principal import SYSTEM_PRINCIPAL
    from app.domains.integrations import service as integ
    from app.domains.platform import handlers  # noqa: F401
    from app.domains.platform.jobs import HANDLERS

    s = session_scope()
    try:
        if not any(i["key"] == "haraworks" and i["configured"] for i in integ.status(s)):
            return {"skipped": "chưa cấu hình cookie Haraworks"}
        out = HANDLERS[kind](s, SYSTEM_PRINCIPAL, {})
        s.commit()
        return out
    finally:
        s.close()
