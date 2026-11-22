from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, JsonType, pk, ts, utcnow


class AutomationTask(Base):
    __tablename__ = "automation_tasks"
    __table_args__ = (CheckConstraint("status IN ('active','retired')", name="status_valid"),)
    id: Mapped[uuid.UUID] = pk()
    legacy_id: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)  # at_<sha1(module|name)[:16]> của bản Node
    name: Mapped[str] = mapped_column(String(300))
    module_code: Mapped[str] = mapped_column(String(40), index=True)
    flow: Mapped[str] = mapped_column(String(80), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    start_url: Mapped[str] = mapped_column(String(1000))
    required_roles: Mapped[list] = mapped_column(JsonType, default=list)
    writes: Mapped[bool] = mapped_column(Boolean, default=False)  # true: tạo/sửa dữ liệu (tiền tố [AI TEST])
    rule_keys: Mapped[list] = mapped_column(JsonType, default=list)
    source: Mapped[dict] = mapped_column(JsonType, default=dict)
    steps: Mapped[list] = mapped_column(JsonType, default=list)  # các bước bằng lời để người duyệt đọc
    status: Mapped[str] = mapped_column(String(10), default="active")
    created_at: Mapped[dt.datetime] = ts()
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class TaskParam(Base):
    __tablename__ = "automation_task_params"
    __table_args__ = (
        Index("uq_task_params_key", "task_id", "key", unique=True),
        CheckConstraint("type IN ('text','multiline','list','file')", name="type_valid"),
    )
    id: Mapped[uuid.UUID] = pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automation_tasks.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(31))
    label: Mapped[str] = mapped_column(String(80), default="")
    type: Mapped[str] = mapped_column(String(10), default="text")
    value: Mapped[str] = mapped_column(Text, default="")
    auto: Mapped[bool] = mapped_column(Boolean, default=True)
    fallback: Mapped[str] = mapped_column(String(10), default="first")


class CodeVersion(Base):
    """Code Playwright bất biến. Chỉ phiên bản APPROVED (do QC) mới được xếp hàng chạy; sha256 được ghim."""

    __tablename__ = "automation_code_versions"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','APPROVED','REJECTED','RETIRED')", name="status_valid"),
        CheckConstraint("origin IN ('import','human','ai')", name="origin_valid"),
        CheckConstraint("status <> 'APPROVED' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)", name="approved_has_human"),
        Index("uq_code_versions_no", "task_id", "version_no", unique=True),
        Index("uq_code_versions_sha", "task_id", "sha256", unique=True),
    )
    id: Mapped[uuid.UUID] = pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automation_tasks.id", ondelete="RESTRICT"), index=True)
    version_no: Mapped[int] = mapped_column(Integer)
    script: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(10), default="PENDING", index=True)
    origin: Mapped[str] = mapped_column(String(10), default="human")
    created_by_type: Mapped[str] = mapped_column(String(16), default="USER")
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    approved_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = ts()


class Runner(Base):
    __tablename__ = "runners"
    __table_args__ = (CheckConstraint("type IN ('host','docker')", name="type_valid"),)
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(80), unique=True)
    type: Mapped[str] = mapped_column(String(10))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # token chỉ hiển thị một lần khi tạo
    capabilities: Mapped[list] = mapped_column(JsonType, default=list)  # web | api | hybrid
    labels: Mapped[list] = mapped_column(JsonType, default=list)
    status: Mapped[str] = mapped_column(String(12), default="OFFLINE")
    last_heartbeat_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[dt.datetime] = ts()


class Execution(Base):
    __tablename__ = "executions"
    __table_args__ = (
        CheckConstraint("status IN ('QUEUED','CLAIMED','RUNNING','PASSED','FAILED','CANCELLED')", name="status_valid"),
    )
    id: Mapped[uuid.UUID] = pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automation_tasks.id", ondelete="RESTRICT"), index=True)
    code_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automation_code_versions.id", ondelete="RESTRICT"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    runner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("runners.id", ondelete="SET NULL"), nullable=True)
    params: Mapped[dict] = mapped_column(JsonType, default=dict)
    status: Mapped[str] = mapped_column(String(10), default="QUEUED", index=True)
    attempt: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=2)
    lease_expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credentials_served: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_id: Mapped[str] = mapped_column(String(24), default="")
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("execution_schedules.id", ondelete="SET NULL"), nullable=True, index=True)
    error: Mapped[str] = mapped_column(Text, default="")
    requested_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    queued_at: Mapped[dt.datetime] = ts(index=True)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ExecutionSchedule(Base):
    """Lịch chạy định kỳ do một QC tạo; đến hạn thì xếp hàng thay mặt QC đó qua đúng các kiểm tra như QC bấm chạy."""

    __tablename__ = "execution_schedules"
    __table_args__ = (CheckConstraint("interval_minutes >= 5", name="interval_min"), CheckConstraint("run_count BETWEEN 1 AND 50", name="count_range"))
    id: Mapped[uuid.UUID] = pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automation_tasks.id", ondelete="CASCADE"), index=True)
    account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True)
    params: Mapped[dict] = mapped_column(JsonType, default=dict)
    run_count: Mapped[int] = mapped_column(Integer, default=1)
    interval_minutes: Mapped[int] = mapped_column(Integer)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    last_run_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str] = mapped_column(String(300), default="")
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[dt.datetime] = ts()


class ExecutionStep(Base):
    __tablename__ = "execution_steps"
    id: Mapped[uuid.UUID] = pk()
    execution_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("executions.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10))
    ms: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")


class ExecutionLog(Base):
    __tablename__ = "execution_logs"
    id: Mapped[uuid.UUID] = pk()
    execution_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("executions.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    message: Mapped[str] = mapped_column(Text)


class ExecutionArtifact(Base):
    __tablename__ = "execution_artifacts"
    id: Mapped[uuid.UUID] = pk()
    execution_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("executions.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # screenshot | video | trace | log
    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id", ondelete="RESTRICT"))
    created_at: Mapped[dt.datetime] = ts()
