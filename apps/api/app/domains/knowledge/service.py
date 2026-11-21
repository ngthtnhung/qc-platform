"""Reference Library: rule, tham chiếu, xung đột. Mọi chuyển sang VALIDATED chỉ qua QC (hook của approvals)."""
from __future__ import annotations

import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError, Conflict, NotFound
from app.core.principal import Principal
from app.core.text import fold, like_escape, stable_hash
from app.domains.knowledge.models import (
    BusinessRule,
    BusinessRuleVersion,
    Module,
    Reference,
    ReferenceLink,
    RuleVersionReference,
)
from app.domains.platform import approvals
from app.domains.platform.audit import log_audit
from app.domains.platform.models import AiSuggestion, ApprovalRequest


def rule_fold(key: str, title: str, description: str, extra: str = "") -> str:
    return fold(f"{key} {title} {description} {extra}")


SETTING_TYPES = {"fixed", "org_config", "default_editable", "unknown"}


# ------------------------------------------------------------------ hook duyệt
def _validate(row, req: ApprovalRequest, approved: bool) -> None:
    if approved:
        row.validation_status, row.validated_by, row.validated_at = "VALIDATED", req.decided_by_id, req.decided_at or utcnow()
    else:
        row.validation_status = "REJECTED"


def _on_rule_version(session: Session, req: ApprovalRequest, approved: bool) -> None:
    rv = session.get(BusinessRuleVersion, uuid.UUID(req.subject_id))
    if rv is None:
        raise NotFound("Không thấy phiên bản rule")
    if rv.content_hash != req.payload.get("content_hash"):
        raise Conflict("Rule đã thay đổi sau khi gửi duyệt", code="PAYLOAD_CHANGED")
    if rv.validation_status == "DISPUTED" and approved:
        raise Conflict("Rule đang tranh chấp (DISPUTED); giải quyết xung đột trước khi duyệt", code="DISPUTED")
    _validate(rv, req, approved)


def _on_reference(session: Session, req: ApprovalRequest, approved: bool) -> None:
    ref = session.get(Reference, uuid.UUID(req.subject_id))
    if ref is None:
        raise NotFound("Không thấy tham chiếu")
    if ref.validation_status == "DISPUTED" and approved:
        raise Conflict("Tham chiếu đang tranh chấp (DISPUTED)", code="DISPUTED")
    _validate(ref, req, approved)


def _on_ai_suggestion(session: Session, req: ApprovalRequest, approved: bool) -> None:
    """Đề xuất AI loại `rule`: khi QC chấp nhận, tạo rule (đã VALIDATED bởi chính QC đó). Loại khác: chỉ đổi trạng thái."""
    sug = session.get(AiSuggestion, uuid.UUID(req.subject_id))
    if sug is None:
        return
    if approved and sug.kind == "rule":
        p = sug.payload or {}
        missing = [k for k in ("module", "title", "description") if not str(p.get(k, "")).strip()]
        if missing:
            raise AppError(f"Đề xuất rule thiếu trường: {', '.join(missing)}", code="SUGGESTION_INCOMPLETE", status=422)
        rule = _new_platform_rule(session, module=str(p["module"]).strip(), flow=str(p.get("flow", "")), origin="ai")
        rv = BusinessRuleVersion(
            rule_id=rule.id, version_no=1, state="active", title=str(p["title"]).strip()[:400], description=str(p["description"]).strip(),
            user_roles=list(p.get("user_roles", [])), setting_type=p.get("setting_type") if p.get("setting_type") in SETTING_TYPES else "unknown",
            extra={"from_ai_suggestion": str(sug.id), "model": sug.model, "source_ref": sug.source_ref},
            content_hash=stable_hash({"t": p["title"], "d": p["description"]}), created_by_type="AI",
            search_fold=rule_fold(rule.rule_key, str(p["title"]), str(p["description"])),
            validation_status="VALIDATED", validated_by=req.decided_by_id, validated_at=req.decided_at or utcnow(),
        )
        session.add(rv)
    sug.status = "ACCEPTED" if approved else "REJECTED"


approvals.register_hook("rule_version", _on_rule_version)
approvals.register_hook("reference", _on_reference)
approvals.register_hook("ai_suggestion", _on_ai_suggestion)  # thay hook mặc định: thêm tạo rule khi duyệt


def _new_platform_rule(session: Session, *, module: str, flow: str, origin: str) -> BusinessRule:
    n = 0
    prefix = f"{module}-P"
    for (key,) in session.execute(select(BusinessRule.rule_key).where(BusinessRule.rule_key.like(f"{like_escape(prefix)}%", escape="\\"))):
        tail = key[len(prefix):]
        if tail.isdigit():
            n = max(n, int(tail))
    rule = BusinessRule(rule_key=f"{prefix}{n + 1:03d}", module_code=module, flow_code=flow, origin=origin)
    session.add(rule)
    session.flush()
    return rule


# ------------------------------------------------------------------ rule do QC tạo/sửa trực tiếp
def create_rule_version(session: Session, *, actor: Principal, rule_key: str | None, module: str, title: str, description: str,
                        user_roles: list[str], setting_type: str = "unknown", flow: str = "") -> BusinessRuleVersion:
    """QC viết/sửa rule. Luôn tạo VERSION MỚI (không ghi đè) ở trạng thái UNREVIEWED + yêu cầu duyệt: ngay cả QC tạo
    cũng phải qua một lần duyệt (QC nào cũng duyệt được) để giữ dấu vết và ghim nội dung."""
    if not actor.is_qc_user:
        raise AppError("Chỉ QC được tạo rule", code="PERMISSION_DENIED", status=403)
    if not title.strip() or not description.strip():
        raise AppError("Thiếu tên hoặc mô tả rule", code="VALIDATION_ERROR", status=422)
    if rule_key:
        rule = session.scalar(select(BusinessRule).where(BusinessRule.rule_key == rule_key))
        if rule is None:
            raise NotFound("Không thấy rule")
        version_no = (session.scalar(select(func.max(BusinessRuleVersion.version_no)).where(BusinessRuleVersion.rule_id == rule.id)) or 0) + 1
    else:
        rule, version_no = _new_platform_rule(session, module=module, flow=flow, origin="platform"), 1
    rv = BusinessRuleVersion(
        rule_id=rule.id, version_no=version_no, state="pending", title=title.strip()[:400], description=description.strip(),
        user_roles=user_roles, setting_type=setting_type if setting_type in SETTING_TYPES else "unknown",
        content_hash=stable_hash({"t": title, "d": description, "r": user_roles}), created_by_type="USER",
        search_fold=rule_fold(rule.rule_key, title, description),
    )
    session.add(rv)
    session.flush()
    submit_rule_version(session, rv, rule, requester=actor)
    log_audit(session, actor, "RULE_VERSION_CREATE", resource_type="rule_version", resource_id=str(rv.id), after={"rule_key": rule.rule_key, "version": version_no})
    return rv


def submit_rule_version(session: Session, rv: BusinessRuleVersion, rule: BusinessRule, *, requester: Principal) -> ApprovalRequest:
    return approvals.submit_for_approval(
        session, requester=requester, subject_type="rule_version", subject_id=str(rv.id),
        title=f"[{rule.rule_key} v{rv.version_no}] {rv.title}",
        payload={"rule_key": rule.rule_key, "version": rv.version_no, "module": rule.module_code, "title": rv.title,
                 "description": rv.description, "user_roles": rv.user_roles, "content_hash": rv.content_hash,
                 "legacy_approval": rv.legacy_approval},
    )


# ------------------------------------------------------------------ xung đột
def link_references(session: Session, *, actor: Principal, from_id: uuid.UUID, to_id: uuid.UUID, type_: str, note: str = "") -> ReferenceLink:
    if type_ not in ("refines", "conflicts_with", "supersedes", "depends_on"):
        raise AppError("Loại quan hệ không hợp lệ", code="VALIDATION_ERROR", status=422)
    a, b = session.get(Reference, from_id), session.get(Reference, to_id)
    if a is None or b is None:
        raise NotFound("Không thấy tham chiếu")
    if a.id == b.id:
        raise AppError("Không thể liên kết một tham chiếu với chính nó", code="VALIDATION_ERROR", status=422)
    link = ReferenceLink(from_ref_id=a.id, to_ref_id=b.id, type=type_, note=note, created_by=actor.id)
    session.add(link)
    try:
        session.flush()
    except Exception as exc:  # noqa: BLE001
        raise Conflict("Quan hệ này đã tồn tại") from exc
    if type_ == "conflicts_with":
        # Không bao giờ gộp âm thầm: hai nguồn mâu thuẫn đều chuyển DISPUTED cho tới khi QC quyết định
        for r in (a, b):
            if r.validation_status != "REJECTED":
                r.validation_status, r.validated_by, r.validated_at = "DISPUTED", None, None
    log_audit(session, actor, "REFERENCE_LINK", resource_type="reference", resource_id=str(a.id), after={"to": str(b.id), "type": type_})
    return link


# ------------------------------------------------------------------ tìm kiếm
def search_rules(session: Session, *, q: str = "", module: str = "", validation: str = "", state: str = "",
                 latest_only: bool = True, limit: int = 100, offset: int = 0) -> tuple[int, list[tuple[BusinessRule, BusinessRuleVersion]]]:
    stmt = select(BusinessRule, BusinessRuleVersion).join(BusinessRuleVersion, BusinessRuleVersion.rule_id == BusinessRule.id)
    if latest_only:
        latest = select(BusinessRuleVersion.rule_id, func.max(BusinessRuleVersion.version_no).label("v")).group_by(BusinessRuleVersion.rule_id).subquery()
        stmt = stmt.join(latest, (latest.c.rule_id == BusinessRuleVersion.rule_id) & (latest.c.v == BusinessRuleVersion.version_no))
    if module:
        stmt = stmt.where(or_(BusinessRule.module_code == module))
    if validation:
        stmt = stmt.where(BusinessRuleVersion.validation_status == validation)
    if state:
        stmt = stmt.where(BusinessRuleVersion.state == state)
    for term in fold(q).split():
        like = f"%{like_escape(term)}%"
        stmt = stmt.where(BusinessRuleVersion.search_fold.like(like, escape="\\"))
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = session.execute(stmt.order_by(BusinessRule.rule_key, BusinessRuleVersion.version_no).limit(min(limit, 500)).offset(offset)).all()
    return total, [(r, v) for r, v in rows]


def module_codes(session: Session) -> list[str]:
    return [c for (c,) in session.execute(select(Module.code).order_by(Module.code))]


def link_rule_references(session: Session, rv: BusinessRuleVersion, refs: list[Reference]) -> None:
    have = {r for (r,) in session.execute(select(RuleVersionReference.reference_id).where(RuleVersionReference.rule_version_id == rv.id))}
    for ref in refs:
        if ref.id not in have:
            session.add(RuleVersionReference(rule_version_id=rv.id, reference_id=ref.id))
