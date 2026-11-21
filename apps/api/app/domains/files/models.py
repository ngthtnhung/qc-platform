from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import BigInteger, DateTime, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, pk, ts


class StoredFile(Base):
    """Metadata của file; nhị phân nằm ở storage (local/S3), không nằm trong PostgreSQL."""

    __tablename__ = "files"
    id: Mapped[uuid.UUID] = pk()
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size: Mapped[int] = mapped_column(BigInteger)
    mime: Mapped[str] = mapped_column(String(120))
    original_name: Mapped[str] = mapped_column(String(200), default="")
    storage_backend: Mapped[str] = mapped_column(String(10))
    storage_key: Mapped[str] = mapped_column(String(300))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    legacy_id: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    created_at: Mapped[dt.datetime] = ts()
    retention_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
