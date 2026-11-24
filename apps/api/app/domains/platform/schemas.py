from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class UserOut(ORM):
    id: uuid.UUID
    username: str
    display_name: str
    employee_code: str
    email: str
    role: str
    is_active: bool
    must_change_password: bool
    last_login_at: dt.datetime | None


class LoginOut(BaseModel):
    user: UserOut
    csrf_token: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=1, max_length=256)


class UserCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(min_length=1, max_length=120)
    employee_code: str = ""
    email: str = ""


class UserCreatedOut(BaseModel):
    user: UserOut
    temporary_password: str  # hiển thị MỘT lần; người dùng bị buộc đổi ở lần đăng nhập đầu


class ApprovalOut(ORM):
    id: uuid.UUID
    subject_type: str
    subject_id: str
    origin: str
    requested_by_type: str
    title: str
    payload: dict[str, Any]
    payload_hash: str
    status: str
    decided_by_id: uuid.UUID | None
    decided_at: dt.datetime | None
    decision_note: str
    created_at: dt.datetime


class DecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    payload_hash: str = Field(min_length=64, max_length=64)  # đúng bản đã đọc
    note: str = ""


class AiSuggestionOut(ORM):
    id: uuid.UUID
    kind: str
    title: str
    payload: dict[str, Any]
    source_ref: dict[str, Any] | None
    module_code: str
    model: str
    status: str
    created_at: dt.datetime


ENV_TYPES = Literal["STAGING", "PRODUCTION_TEST", "PRODUCTION", "TASK_SYSTEM"]


class EnvironmentIn(BaseModel):
    code: str = Field(default="", max_length=60, pattern=r"^$|^[a-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=160)
    type: ENV_TYPES
    base_url: str
    login_url: str = ""
    org_identifier: str = ""
    allowed_actions: list[str] = []
    requires_org_confirmation: bool = False


class EnvironmentUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    type: ENV_TYPES | None = None
    base_url: str | None = None
    org_identifier: str | None = None


class EnvironmentOut(ORM):
    id: uuid.UUID
    code: str
    name: str
    type: str
    base_url: str
    login_url: str
    org_identifier: str
    allowed_actions: list[str]
    requires_org_confirmation: bool
    is_active: bool


class AccountIn(BaseModel):
    environment_id: uuid.UUID
    name: str = Field(min_length=1, max_length=160)
    role_label: str = ""
    username_ref: str = Field(min_length=1, max_length=200)
    expected_org_ref: str = ""
    default_route: str = ""
    routes: list[dict[str, Any]] = []
    kb_links: list[Any] = []
    kb_can_do: list[str] = []
    kb_cannot_do: list[str] = []


class AccountUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    role_label: str | None = None
    username_ref: str | None = Field(default=None, min_length=1, max_length=200)
    default_route: str | None = None
    routes: list[dict[str, Any]] | None = None


class AccountOut(ORM):
    id: uuid.UUID
    environment_id: uuid.UUID
    name: str
    role_label: str
    username_ref: str
    expected_org_ref: str
    default_route: str
    routes: list[dict[str, Any]]
    kb_links: list[Any]
    kb_can_do: list[str]
    kb_cannot_do: list[str]
    has_secret: bool = False  # KHÔNG bao giờ trả mật khẩu
    is_active: bool


class SecretIn(BaseModel):
    password: str = Field(min_length=1, max_length=500)


class AuditOut(ORM):
    id: uuid.UUID
    at: dt.datetime
    actor_type: str
    actor_username: str | None
    action: str
    resource_type: str
    resource_id: str
    decision: str
    reason: str
    correlation_id: str


class FileOut(ORM):
    id: uuid.UUID
    sha256: str
    size: int
    mime: str
    original_name: str
    created_at: dt.datetime


class BulkItem(BaseModel):
    id: uuid.UUID
    payload_hash: str = Field(min_length=64, max_length=64)


class BulkDecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    items: list[BulkItem] = Field(min_length=1, max_length=200)
    note: str = ""


class BulkResult(BaseModel):
    id: uuid.UUID
    ok: bool
    status: str | None = None
    error: str | None = None
