"""Chủ thể thực hiện hành động và quyền.

Quy tắc sản phẩm (đã chốt):
- Chỉ có MỘT vai trò con người: ``qc``. Cả 4 QC có quyền tương đương nhau trên toàn hệ thống.
- Mọi sản phẩm/hành động do AI tạo ra (tài liệu, rule, test, code, đề xuất hành động...)
  chỉ được duyệt bởi một người dùng vai trò ``qc``. AI, SYSTEM, RUNNER không bao giờ duyệt.
"""
from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass


class PrincipalType(str, enum.Enum):
    USER = "USER"
    AI = "AI"
    SYSTEM = "SYSTEM"
    RUNNER = "RUNNER"


ROLE_QC = "qc"
ROLES = (ROLE_QC,)


class Perm(str, enum.Enum):
    USERS_MANAGE = "users.manage"
    ENV_MANAGE = "environments.manage"
    SECRET_WRITE = "secrets.write"
    APPROVE = "approvals.decide"
    AUDIT_READ = "audit.read"
    FILES_WRITE = "files.write"
    FILES_READ = "files.read"
    AI_SUGGESTION_READ = "ai_suggestions.read"


# 4 QC dùng chung một tập quyền đầy đủ: không có QC "cấp cao" hơn.
ROLE_PERMS: dict[str, frozenset[Perm]] = {ROLE_QC: frozenset(Perm)}


@dataclass(frozen=True)
class Principal:
    type: PrincipalType
    id: uuid.UUID | None = None
    role: str | None = None
    username: str | None = None
    session_id: uuid.UUID | None = None

    @property
    def is_qc_user(self) -> bool:
        return self.type is PrincipalType.USER and self.role == ROLE_QC

    def has(self, perm: Perm) -> bool:
        if self.type is not PrincipalType.USER or self.role is None:
            return False
        return perm in ROLE_PERMS.get(self.role, frozenset())


AI_PRINCIPAL = Principal(type=PrincipalType.AI, username="ai")
SYSTEM_PRINCIPAL = Principal(type=PrincipalType.SYSTEM, username="system")
