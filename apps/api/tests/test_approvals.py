"""Quy tắc cốt lõi: sản phẩm/hành động của AI chỉ QC mới duyệt; 4 QC ngang quyền."""
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError, Conflict, PermissionDenied
from app.core.principal import AI_PRINCIPAL, SYSTEM_PRINCIPAL, Principal, PrincipalType
from app.domains.platform import approvals
from app.domains.platform.models import AiSuggestion, ApprovalRequest, AuditLog, User
from tests.conftest import make_qc, principal


def _ai_request(session, title="Rule gợi ý"):
    sug, req = approvals.create_ai_suggestion(session, producer=AI_PRINCIPAL, kind="rule", title=title,
                                              payload={"text": "Độ ưu tiên mặc định là Trung bình"}, model="test-model")
    session.commit()
    return sug, req


def test_ai_output_starts_proposed_and_pending(session):
    sug, req = _ai_request(session)
    assert sug.status == "PROPOSED" and req.status == "PENDING" and req.origin == "ai"


@pytest.mark.parametrize("who", [AI_PRINCIPAL, SYSTEM_PRINCIPAL, Principal(type=PrincipalType.RUNNER, id=None)])
def test_non_user_principals_can_never_decide(session, who):
    _, req = _ai_request(session)
    with pytest.raises(PermissionDenied):
        approvals.decide(session, actor=who, request_id=req.id, approve=True, payload_hash=req.payload_hash)
    session.refresh(req)
    assert req.status == "PENDING"
    deny = session.scalars(select(AuditLog).where(AuditLog.action == "APPROVAL_APPROVED", AuditLog.decision == "DENY")).all()
    assert deny, "phải ghi audit DENY"


def test_user_without_qc_role_is_denied(session):
    _, req = _ai_request(session)
    fake = Principal(type=PrincipalType.USER, id=make_qc(session).id, role="viewer")
    with pytest.raises(PermissionDenied):
        approvals.decide(session, actor=fake, request_id=req.id, approve=True, payload_hash=req.payload_hash)


def test_qc_approves_and_suggestion_becomes_accepted(session):
    sug, req = _ai_request(session)
    qc = make_qc(session)
    out = approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)
    session.commit()
    assert out.status == "APPROVED" and out.decided_by_id == qc.id
    assert session.get(AiSuggestion, sug.id).status == "ACCEPTED"


def test_all_four_qc_have_equal_rights(session):
    qcs = [make_qc(session, f"qc{i}") for i in range(4)]
    for qc in qcs:
        _, req = _ai_request(session, title=f"gợi ý cho {qc.username}")
        out = approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)
        assert out.status == "APPROVED" and out.decided_by_id == qc.id
    # không có QC "cấp cao": tập quyền giống hệt nhau
    perms = {frozenset(p for p in __import__("app.core.principal", fromlist=["Perm"]).Perm if principal(q).has(p)) for q in qcs}
    assert len(perms) == 1


def test_reject_requires_note_and_sets_rejected(session):
    sug, req = _ai_request(session)
    qc = make_qc(session)
    with pytest.raises(AppError):
        approvals.decide(session, actor=principal(qc), request_id=req.id, approve=False, payload_hash=req.payload_hash, note=" ")
    out = approvals.decide(session, actor=principal(qc), request_id=req.id, approve=False, payload_hash=req.payload_hash, note="Sai nghiệp vụ")
    assert out.status == "REJECTED" and session.get(AiSuggestion, sug.id).status == "REJECTED"


def test_decision_is_immutable(session):
    _, req = _ai_request(session)
    qc = make_qc(session)
    approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)
    with pytest.raises(Conflict):
        approvals.decide(session, actor=principal(qc), request_id=req.id, approve=False, payload_hash=req.payload_hash, note="đổi ý")


def test_approving_a_changed_payload_is_refused(session):
    _, req = _ai_request(session)
    qc = make_qc(session)
    with pytest.raises(Conflict) as e:
        approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash="0" * 64)
    assert e.value.code == "PAYLOAD_CHANGED"


def test_only_one_pending_request_per_subject(session):
    qc = make_qc(session)
    approvals.submit_for_approval(session, requester=principal(qc), subject_type="doc", subject_id="1", title="a", payload={"a": 1})
    session.commit()
    with pytest.raises(Conflict):
        approvals.submit_for_approval(session, requester=principal(qc), subject_type="doc", subject_id="1", title="b", payload={"a": 2})


def test_human_submission_is_marked_human_and_qc_decides(session):
    qc1, qc2 = make_qc(session, "qcone"), make_qc(session, "qctwo")
    req = approvals.submit_for_approval(session, requester=principal(qc1), subject_type="doc", subject_id="9", title="t", payload={"x": 1})
    assert req.origin == "human"
    out = approvals.decide(session, actor=principal(qc2), request_id=req.id, approve=True, payload_hash=req.payload_hash)
    assert out.status == "APPROVED"


def test_user_cannot_create_ai_suggestion(session):
    qc = make_qc(session)
    with pytest.raises(AppError):
        approvals.create_ai_suggestion(session, producer=principal(qc), kind="rule", title="x", payload={})


def test_database_rejects_non_qc_role(session):
    session.add(User(username="boss", display_name="B", password_hash="x", role="admin"))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_database_rejects_decision_without_human(session):
    _, req = _ai_request(session)
    req_row = session.get(ApprovalRequest, req.id)
    req_row.status = "APPROVED"  # không có decided_by_id/decided_at
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_decision_http_flow_and_ai_cannot_use_http(client, session):
    from tests.conftest import STRONG, login

    _, req = _ai_request(session)
    qc = make_qc(session, "qcweb")
    # chưa đăng nhập
    assert client.post(f"/api/v1/approvals/{req.id}/decision", json={"decision": "approve", "payload_hash": req.payload_hash}).status_code == 401
    login(client, "qcweb", STRONG)
    r = client.post(f"/api/v1/approvals/{req.id}/decision", json={"decision": "approve", "payload_hash": req.payload_hash})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "APPROVED" and r.json()["decided_by_id"] == str(qc.id)
    # quyết định lần hai
    r2 = client.post(f"/api/v1/approvals/{req.id}/decision", json={"decision": "reject", "payload_hash": req.payload_hash, "note": "x"})
    assert r2.status_code == 409
