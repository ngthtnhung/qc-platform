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
    beat_schedule={},
)


@celery_app.task(name="system.ping")
def ping() -> str:
    return "pong"
