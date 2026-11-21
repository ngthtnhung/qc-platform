from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, JsonType, pk, ts


class BugSource(Base):
    __tablename__ = "bug_sources"
    id: Mapped[uuid.UUID] = pk()
    code: Mapped[str] = mapped_column(String(30), unique=True)  # legacy_kb | haraworks
    name: Mapped[str] = mapped_column(String(120))
    config: Mapped[dict] = mapped_column(JsonType, default=dict)  # con trỏ đồng bộ; KHÔNG chứa bí mật
    last_sync_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_sync_status: Mapped[str] = mapped_column(String(40), default="")


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (Index("uq_projects_source_ext", "source_id", "external_id", unique=True),)
    id: Mapped[uuid.UUID] = pk()
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bug_sources.id", ondelete="RESTRICT"))
    external_id: Mapped[str] = mapped_column(String(60))
    name: Mapped[str] = mapped_column(String(200))


class Bug(Base):
    __tablename__ = "bugs"
    __table_args__ = (
        Index("uq_bugs_source_ext", "source_id", "external_id", unique=True),
        Index("ix_bugs_updated", "updated_at_ext"),
    )
    id: Mapped[uuid.UUID] = pk()
    source_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bug_sources.id", ondelete="RESTRICT"), index=True)
    external_id: Mapped[str] = mapped_column(String(60))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    title_fold: Mapped[str] = mapped_column(Text, default="")  # không dấu, chữ thường: tìm kiếm tiếng Việt
    status: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    priority: Mapped[int | None] = mapped_column(Integer, nullable=True)
    classification: Mapped[str] = mapped_column(String(60), default="")
    module_code: Mapped[str] = mapped_column(String(40), default="", index=True)
    created_at_ext: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at_ext: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    assignee: Mapped[str] = mapped_column(String(200), default="")
    approver: Mapped[str] = mapped_column(String(200), default="")
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    url: Mapped[str] = mapped_column(String(1000), default="")
    extra: Mapped[dict] = mapped_column(JsonType, default=dict)  # trường nguồn chưa ánh xạ — không bỏ
    created_at: Mapped[dt.datetime] = ts()


class BugSnapshot(Base):
    """Lịch sử: mỗi lần nội dung đổi (theo băm) thêm một bản. Bản Node không có lịch sử bug."""

    __tablename__ = "bug_snapshots"
    __table_args__ = (Index("uq_bug_snapshots_hash", "bug_id", "content_hash", unique=True),)
    id: Mapped[uuid.UUID] = pk()
    bug_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("bugs.id", ondelete="CASCADE"), index=True)
    taken_at: Mapped[dt.datetime] = ts()
    content_hash: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JsonType)
    note: Mapped[str] = mapped_column(Text, default="")
