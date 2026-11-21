from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.principal import Principal
from app.core.redaction import redact, redact_text
from app.domains.platform.models import AuditLog


def log_audit(
    session: Session,
    actor: Principal | None,
    action: str,
    *,
    resource_type: str = "",
    resource_id: str = "",
    decision: str = "ALLOW",
    reason: str = "",
    before: dict | None = None,
    after: dict | None = None,
    correlation_id: str = "",
    ip: str = "",
) -> AuditLog:
    row = AuditLog(
        actor_type=(actor.type.value if actor else "SYSTEM"),
        actor_id=actor.id if actor else None,
        actor_username=actor.username if actor else None,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id),
        decision=decision,
        reason=redact_text(reason)[:2000],
        before=redact(before) if before is not None else None,
        after=redact(after) if after is not None else None,
        correlation_id=correlation_id,
        ip=ip,
    )
    session.add(row)
    session.flush()
    return row
