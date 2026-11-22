from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, JsonType, pk, ts


class FlowRecording(Base):
    """Bản ghi thao tác thô + bản đã chuẩn hóa. Khi QC bấm tạo tác vụ, code sinh ra đi vào hàng duyệt (PENDING)."""

    __tablename__ = "flow_recordings"
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(300))
    module_code: Mapped[str] = mapped_column(String(40), default="")
    start_url: Mapped[str] = mapped_column(String(1000))
    raw_events: Mapped[list] = mapped_column(JsonType, default=list)
    normalized: Mapped[dict] = mapped_column(JsonType, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="RECORDED")  # RECORDED | TASK_CREATED
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("automation_tasks.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[dt.datetime] = ts()
