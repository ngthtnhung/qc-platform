"""Port của PolicyEngine (Node) — luật fail-closed giữ nguyên, bổ sung quy tắc duyệt chỉ-QC."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.errors import AuthRequired, PermissionDenied, PolicyBlocked
from app.core.principal import Principal, PrincipalType
from app.domains.platform.audit import log_audit
from app.domains.platform.models import Environment

# AI/SYSTEM/RUNNER không bao giờ được thực hiện các hành động này
HUMAN_ONLY_ACTIONS = {"APPROVE", "REJECT", "CONFIRM_ORG", "TASK_WRITE"}
PRODUCTION_BLOCKED = {"WRITE", "MIGRATE", "RELEASE", "DELETE_DATA"}


@dataclass
class SessionState:
    is_active: bool = True
    org_confirmed: bool = False


def evaluate_action(
    session: Session, *, actor: Principal | None, action: str, env: Environment | None,
    state: SessionState | None = None, correlation_id: str = "",
) -> None:
    state = state or SessionState()

    def deny(exc, reason: str):
        log_audit(session, actor, f"POLICY:{action}", resource_type="environment",
                  resource_id=str(env.id) if env else "", decision="DENY", reason=reason, correlation_id=correlation_id)
        raise exc

    if actor is None or (actor.type is PrincipalType.USER and actor.id is None):
        deny(AuthRequired("Cần xác thực trước khi thực thi"), "missing actor")
    assert actor is not None
    if action in HUMAN_ONLY_ACTIONS and not actor.is_qc_user:
        deny(PermissionDenied("Chỉ QC (người dùng) mới được thực hiện hành động này; AI/hệ thống/runner không được"),
             f"{actor.type.value} cannot {action}")
    if env is None:
        deny(PolicyBlocked("Không xác minh được cấu hình môi trường"), "unknown environment")
    assert env is not None
    if not env.is_active:
        deny(PolicyBlocked("Môi trường đang bị vô hiệu"), "inactive environment")
    if not state.is_active:
        deny(PolicyBlocked("Phiên đã hết hạn"), "session expired")
    if env.type == "PRODUCTION_TEST" and env.requires_org_confirmation and action != "CONFIRM_ORG" and not state.org_confirmed:
        deny(PolicyBlocked("Production (Org Test) bắt buộc QC xác nhận đúng Org trước khi thực hiện"), "org not confirmed")
    if env.type == "PRODUCTION" and action in PRODUCTION_BLOCKED:
        deny(PolicyBlocked("Production không cho phép thao tác ghi/migrate tự động"), "production write blocked")
    allowed = set(env.allowed_actions or [])
    if action != "CONFIRM_ORG" and action not in allowed and "*" not in allowed:
        deny(PolicyBlocked(f"Hành động {action} không nằm trong phạm vi cho phép của môi trường {env.type}"), "action not allowed")
    log_audit(session, actor, f"POLICY:{action}", resource_type="environment", resource_id=str(env.id),
              decision="ALLOW", reason="passed all policy gates", correlation_id=correlation_id)
