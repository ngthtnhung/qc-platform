"""Quy trình duyệt — điểm kiểm soát duy nhất.

Quy tắc:
  1. Sản phẩm/hành động do AI tạo ra phải đi qua ``submit_for_approval`` và chờ QC.
  2. Chỉ ``Principal`` là USER vai trò ``qc`` được ``decide``. AI/SYSTEM/RUNNER bị từ chối và ghi audit.
  3. 4 QC có quyền ngang nhau: QC nào cũng duyệt được (kể cả bản do chính QC đó yêu cầu); mọi quyết định đều có audit.
  4. Người duyệt phải gửi ``payload_hash`` của đúng bản đã đọc; bản đã đổi ⇒ từ chối (giống ghim SHA của code tác vụ).
  5. Quyết định cuối cùng (APPROVED/REJECTED) là bất biến.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import utcnow
from app.core.errors import AppError, Conflict, NotFound, PermissionDenied
from app.core.principal import Perm, Principal, PrincipalType
from app.domains.platform.audit import log_audit
from app.domains.platform.models import AiSuggestion, ApprovalRequest

Hook = Callable[[Session, ApprovalRequest, bool], None]
_HOOKS: dict[str, Hook] = {}


def register_hook(subject_type: str, hook: Hook) -> None:
    """Miền nghiệp vụ (rule, test case, code automation...) đăng ký phản ứng khi QC quyết định.
    Hook chạy trong cùng giao dịch với quyết định."""
    _HOOKS[subject_type] = hook


def canonical_hash(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def submit_for_approval(
    session: Session, *, requester: Principal, subject_type: str, subject_id: str, title: str, payload: dict,
    correlation_id: str = "",
) -> ApprovalRequest:
    origin = "ai" if requester.type in (PrincipalType.AI, PrincipalType.SYSTEM, PrincipalType.RUNNER) else "human"
    req = ApprovalRequest(
        subject_type=subject_type, subject_id=str(subject_id), origin=origin,
        requested_by_type=requester.type.value, requested_by_id=requester.id,
        title=title[:300], payload=payload, payload_hash=canonical_hash(payload),
    )
    session.add(req)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise Conflict("Đối tượng này đã có yêu cầu duyệt đang chờ") from exc
    log_audit(session, requester, "APPROVAL_REQUESTED", resource_type=subject_type, resource_id=str(subject_id),
              reason=f"origin={origin}", after={"approval_id": str(req.id), "payload_hash": req.payload_hash},
              correlation_id=correlation_id)
    return req


def create_ai_suggestion(
    session: Session, *, producer: Principal, kind: str, title: str, payload: dict,
    source_ref: dict | None = None, module_code: str = "", model: str = "",
) -> tuple[AiSuggestion, ApprovalRequest]:
    """Điểm vào DUY NHẤT để AI đưa sản phẩm vào hệ thống: luôn PROPOSED + một yêu cầu duyệt chờ QC."""
    if producer.type is PrincipalType.USER:
        raise AppError("create_ai_suggestion chỉ dành cho chủ thể AI/hệ thống", code="NOT_AI_PRODUCER")
    sug = AiSuggestion(kind=kind, title=title[:300], payload=payload, source_ref=source_ref,
                       module_code=module_code, model=model, content_hash=canonical_hash(payload))
    session.add(sug)
    session.flush()
    req = submit_for_approval(session, requester=producer, subject_type="ai_suggestion", subject_id=str(sug.id),
                              title=title, payload={"kind": kind, "title": title, "payload": payload, "source_ref": source_ref})
    return sug, req


def _on_ai_suggestion(session: Session, req: ApprovalRequest, approved: bool) -> None:
    sug = session.get(AiSuggestion, uuid.UUID(req.subject_id))
    if sug is not None:
        sug.status = "ACCEPTED" if approved else "REJECTED"


register_hook("ai_suggestion", _on_ai_suggestion)


def decide(
    session: Session, *, actor: Principal, request_id: uuid.UUID, approve: bool, payload_hash: str,
    note: str = "", correlation_id: str = "", ip: str = "",
) -> ApprovalRequest:
    action = "APPROVAL_APPROVED" if approve else "APPROVAL_REJECTED"
    req = session.get(ApprovalRequest, request_id)
    if req is None:
        raise NotFound("Không thấy yêu cầu duyệt")

    # (2) chỉ QC (người dùng) — kiểm tra trước mọi thứ khác
    if not (actor.is_qc_user and actor.has(Perm.APPROVE)):
        log_audit(session, actor, action, resource_type=req.subject_type, resource_id=req.subject_id, decision="DENY",
                  reason=f"{actor.type.value}/{actor.role} không có quyền duyệt", correlation_id=correlation_id, ip=ip)
        session.commit()  # giữ audit DENY dù request trả lỗi
        raise PermissionDenied("Chỉ người dùng vai trò QC mới được duyệt")

    # (5) bất biến
    if req.status != "PENDING":
        raise Conflict(f"Yêu cầu đã ở trạng thái {req.status}, không thể quyết định lại")
    # (4) ghim bản đã đọc
    if payload_hash != req.payload_hash:
        raise Conflict("Nội dung đã thay đổi so với bản bạn xem. Tải lại và đọc lại trước khi duyệt.",
                       code="PAYLOAD_CHANGED")
    if not approve and not note.strip():
        raise AppError("Từ chối cần ghi lý do", code="NOTE_REQUIRED")

    req.status = "APPROVED" if approve else "REJECTED"
    req.decided_by_id = actor.id
    req.decided_at = utcnow()
    req.decision_note = note.strip()
    hook = _HOOKS.get(req.subject_type)
    if hook:
        hook(session, req, approve)
    session.flush()
    log_audit(session, actor, action, resource_type=req.subject_type, resource_id=req.subject_id,
              reason=note, after={"approval_id": str(req.id), "status": req.status, "payload_hash": req.payload_hash,
                                  "origin": req.origin, "requested_by_type": req.requested_by_type},
              correlation_id=correlation_id, ip=ip)
    return req


def list_requests(session: Session, *, status: str | None = None, origin: str | None = None, limit: int = 100) -> list[ApprovalRequest]:
    q = select(ApprovalRequest).order_by(ApprovalRequest.created_at.desc()).limit(min(limit, 500))
    if status:
        q = q.where(ApprovalRequest.status == status)
    if origin:
        q = q.where(ApprovalRequest.origin == origin)
    return list(session.scalars(q))
