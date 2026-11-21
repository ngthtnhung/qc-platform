from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Iterator

from sqlalchemy import JSON, DateTime, MetaData, Uuid, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Session, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# JSON portable: JSONB trên PostgreSQL, JSON nơi khác (test SQLite)
JsonType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def new_id() -> uuid.UUID:
    return uuid.uuid4()


def pk():
    return mapped_column(Uuid, primary_key=True, default=new_id)


def ts(**kw):
    return mapped_column(DateTime(timezone=True), default=utcnow, **kw)


_engine = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        url = get_settings().database_url
        kwargs: dict = {"pool_pre_ping": True}
        if url.startswith("sqlite"):
            kwargs = {"connect_args": {"check_same_thread": False}, "poolclass": StaticPool}
        _engine = create_engine(url, **kwargs)
        _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False, autoflush=False)
    return _engine


def reset_engine() -> None:
    """Dùng trong test."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None


def get_session() -> Iterator[Session]:
    get_engine()
    assert _SessionLocal is not None
    with _SessionLocal() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


def session_scope() -> Session:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal()
