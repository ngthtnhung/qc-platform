from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, JsonType, pk, ts, utcnow


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Chỉ một vai trò con người: qc. Thêm vai trò khác đòi một migration có chủ đích.
        CheckConstraint("role IN ('qc')", name="role_qc_only"),
    )
    id: Mapped[uuid.UUID] = pk()
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # đã chuẩn hóa chữ thường
    display_name: Mapped[str] = mapped_column(String(120))
    employee_code: Mapped[str] = mapped_column(String(40), default="")
    email: Mapped[str] = mapped_column(String(200), default="")
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="qc")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    legacy_id: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    created_at: Mapped[dt.datetime] = ts()
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    refresh_hash: Mapped[str] = mapped_column(String(64), unique=True)
    prev_refresh_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[dt.datetime] = ts()
    last_used_at: Mapped[dt.datetime] = ts()


class AuditLog(Base):
    """Append-only. Trên PostgreSQL có trigger chặn UPDATE/DELETE (xem migration)."""

    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = pk()
    at: Mapped[dt.datetime] = ts(index=True)
    actor_type: Mapped[str] = mapped_column(String(16))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    actor_username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    resource_type: Mapped[str] = mapped_column(String(60), default="")
    resource_id: Mapped[str] = mapped_column(String(80), default="")
    decision: Mapped[str] = mapped_column(String(16), default="ALLOW")
    reason: Mapped[str] = mapped_column(Text, default="")
    before: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    after: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    correlation_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    source: Mapped[str] = mapped_column(String(16), default="app")  # app | legacy


class Environment(Base):
    __tablename__ = "environments"
    __table_args__ = (
        CheckConstraint("type IN ('STAGING','PRODUCTION_TEST','PRODUCTION','TASK_SYSTEM')", name="type_valid"),
        # PRODUCTION_TEST luôn phải xác nhận Org
        CheckConstraint("type <> 'PRODUCTION_TEST' OR requires_org_confirmation", name="prod_test_needs_org_confirm"),
    )
    id: Mapped[uuid.UUID] = pk()
    code: Mapped[str] = mapped_column(String(60), unique=True)
    name: Mapped[str] = mapped_column(String(160))
    type: Mapped[str] = mapped_column(String(20))
    base_url: Mapped[str] = mapped_column(String(500))
    login_url: Mapped[str] = mapped_column(String(500), default="")
    org_identifier: Mapped[str] = mapped_column(String(120), default="")
    allowed_actions: Mapped[list] = mapped_column(JsonType, default=list)
    requires_org_confirmation: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    legacy_id: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    created_at: Mapped[dt.datetime] = ts()
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Secret(Base):
    """Mã hóa phong bì: DEK ngẫu nhiên cho mỗi bí mật, DEK được bọc bằng KEK (ngoài DB)."""

    __tablename__ = "secrets"
    id: Mapped[uuid.UUID] = pk()
    kind: Mapped[str] = mapped_column(String(40))
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    wrapped_dek: Mapped[bytes] = mapped_column(LargeBinary)
    dek_nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_version: Mapped[int] = mapped_column(Integer, default=1)
    aad: Mapped[str] = mapped_column(String(120))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (Index("uq_accounts_env_username", "environment_id", "username_ref", unique=True),)
    id: Mapped[uuid.UUID] = pk()
    environment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("environments.id", ondelete="RESTRICT"), index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(160))
    role_label: Mapped[str] = mapped_column(String(120), default="")
    username_ref: Mapped[str] = mapped_column(String(200))
    expected_org_ref: Mapped[str] = mapped_column(String(120), default="")
    default_route: Mapped[str] = mapped_column(String(500), default="")
    routes: Mapped[list] = mapped_column(JsonType, default=list)
    kb_links: Mapped[list] = mapped_column(JsonType, default=list)
    kb_can_do: Mapped[list] = mapped_column(JsonType, default=list)
    kb_cannot_do: Mapped[list] = mapped_column(JsonType, default=list)
    secret_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("secrets.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    legacy_id: Mapped[str | None] = mapped_column(String(80), unique=True, nullable=True)
    created_at: Mapped[dt.datetime] = ts()
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AiSuggestion(Base):
    """Mọi sản phẩm do AI tạo ra (tài liệu, rule, test, code, đề xuất hành động...) bắt đầu ở đây
    với trạng thái PROPOSED. Chỉ QC mới chuyển được sang ACCEPTED/REJECTED (qua ApprovalRequest)."""

    __tablename__ = "ai_suggestions"
    __table_args__ = (CheckConstraint("status IN ('PROPOSED','ACCEPTED','REJECTED')", name="status_valid"),)
    id: Mapped[uuid.UUID] = pk()
    kind: Mapped[str] = mapped_column(String(40), index=True)  # document | rule | test_case | code | action | ...
    title: Mapped[str] = mapped_column(String(300))
    payload: Mapped[dict] = mapped_column(JsonType)
    source_ref: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    module_code: Mapped[str] = mapped_column(String(40), default="")
    model: Mapped[str] = mapped_column(String(80), default="")
    content_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(12), default="PROPOSED", index=True)
    created_at: Mapped[dt.datetime] = ts()


class ApprovalRequest(Base):
    __tablename__ = "approval_requests"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING','APPROVED','REJECTED','CANCELLED')", name="status_valid"),
        CheckConstraint("origin IN ('ai','human')", name="origin_valid"),
        # Quyết định luôn do một người dùng (users.role luôn là qc nhờ CHECK ở bảng users)
        CheckConstraint(
            "status IN ('PENDING','CANCELLED') OR (decided_by_id IS NOT NULL AND decided_at IS NOT NULL)",
            name="decision_has_human",
        ),
        Index(
            "uq_approval_one_pending_per_subject",
            "subject_type",
            "subject_id",
            unique=True,
            sqlite_where=text("status = 'PENDING'"),
            postgresql_where=text("status = 'PENDING'"),
        ),
    )
    id: Mapped[uuid.UUID] = pk()
    subject_type: Mapped[str] = mapped_column(String(60), index=True)
    subject_id: Mapped[str] = mapped_column(String(80))
    origin: Mapped[str] = mapped_column(String(8))
    requested_by_type: Mapped[str] = mapped_column(String(16))
    requested_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    title: Mapped[str] = mapped_column(String(300))
    payload: Mapped[dict] = mapped_column(JsonType)
    payload_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(10), default="PENDING", index=True)
    decided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), nullable=True)
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.datetime] = ts(index=True)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[uuid.UUID] = pk()
    kind: Mapped[str] = mapped_column(String(60), index=True)
    status: Mapped[str] = mapped_column(String(12), default="QUEUED")
    payload: Mapped[dict] = mapped_column(JsonType, default=dict)
    result: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    celery_task_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[dt.datetime] = ts()
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
