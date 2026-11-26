"""Đoạn trích (passage) của các nguồn đã nạp: văn bản NGUYÊN VĂN + vị trí chính xác. Cơ sở của tra cứu trích dẫn."""
from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, JsonType, pk, ts


class SourcePassage(Base):
    __tablename__ = "source_passages"
    __table_args__ = (
        CheckConstraint("kind IN ('heading','paragraph','table_row','code','node_text','task','wiki_block')", name="kind_valid"),
        Index("ix_passages_version_seq", "source_version_id", "seq"),
        Index("ix_passages_current", "is_current"),
        Index("ix_passages_external", "source_version_id", "external_key"),
    )
    id: Mapped[uuid.UUID] = pk()
    source_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("source_versions.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(12))
    heading_path: Mapped[str] = mapped_column(Text, default="")
    locator: Mapped[dict] = mapped_column(JsonType, default=dict)  # line, paragraph, table, row, char_start/char_end, node_id, task_id, anchor, url…
    text: Mapped[str] = mapped_column(Text)  # NGUYÊN VĂN (chỉ chuẩn hóa NFC + khoảng trắng)
    text_fold: Mapped[str] = mapped_column(Text)  # không dấu, chữ thường: dùng để tìm
    content_hash: Mapped[str] = mapped_column(String(64))
    external_key: Mapped[str | None] = mapped_column(String(80), nullable=True)  # ví dụ id task Haraworks
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    supersedes_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[dt.datetime] = ts()


class Lookup(Base):
    """Lịch sử mỗi lần QC tra cứu bằng mô tả bug: giữ ảnh chụp trích dẫn đã trả (nguồn có thể đổi phiên bản sau này)."""

    __tablename__ = "lookups"
    id: Mapped[uuid.UUID] = pk()
    description: Mapped[str] = mapped_column(Text)
    keywords: Mapped[list] = mapped_column(JsonType, default=list)
    filters: Mapped[dict] = mapped_column(JsonType, default=dict)
    results: Mapped[list] = mapped_column(JsonType, default=list)
    note: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[dt.datetime] = ts(index=True)


class Integration(Base):
    """Bí mật tích hợp ngoài (cookie Haraworks, token Figma): chỉ ghi, nằm trong vault."""

    __tablename__ = "integrations"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)  # haraworks | figma
    secret_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("secrets.id", ondelete="SET NULL"), nullable=True)
    last_check_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_check_status: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[dt.datetime] = ts()
