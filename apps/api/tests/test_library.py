import json

import pytest
from sqlalchemy import select

from app.core.errors import AppError, Conflict
from app.core.principal import AI_PRINCIPAL
from app.domains.knowledge import importer, service
from app.domains.knowledge.models import BusinessRule, BusinessRuleVersion, Module, Reference, Source, SourceVersion
from app.domains.platform import approvals
from app.domains.platform.models import ApprovalRequest, AuditLog
from tests.conftest import login, make_qc, principal


def _rule(rule_id="DV5S-001", version=1, state="active", **kw):
    base = {
        "rule_id": rule_id, "version": version, "state": state, "module": "DV5S", "flow": "DS", "flow_name": "Tra cứu danh sách phiếu",
        "title": "Quyền truy cập Danh sách xử lý phiếu", "description": "Chỉ người thuộc danh sách xử lý phiếu mới vào được trang.",
        "user_roles": ["Nhân viên", "Quản trị"], "setting_type": "org_config", "setting_label": "Cấu hình theo tổ chức",
        "classification": "Explicit", "open_questions": ["Người không có quyền thấy gì?"],
        "business_logic": "NẾU user thuộc danh sách THÌ cho vào", "ai_interpretation": "FS không nói trang lỗi 403",
        "regression_risk": "thấp", "exceptions": [], "related_rules": [], "source_type": "BA Document",
        "approved_by": "u_external", "approved_at": "2026-11-14T18:00:07.845Z", "verification_status": "Confirmed", "batch_id": "B1",
        "evidence": [{"quote": "Người dùng được truy cập khi thuộc danh sách", "reference": "FS mục 3.4 (L1196-L1202)", "stance": "supports"}],
        "source_reference": {"document": "Tasks_YeuCauBaoTri_FS.docx", "doc_version": "v2", "section": "3.4.5", "text_lines": "L1194-L1202", "url": "https://x.example/f"},
    }
    base.update(kw)
    return base


@pytest.fixture()
def snap(tmp_path):
    d = tmp_path / "kb-snapshot"
    (d / "rules").mkdir(parents=True)
    (d / "modules").mkdir()
    (d / "modules" / "DV5S.json").write_text(json.dumps({"code": "DV5S", "name": "Dịch vụ 5 sao", "cluster": "", "flows": [{"code": "DS", "name": "Danh sách"}], "explored_at": "2026-11-12"}), encoding="utf-8")
    for r in (_rule(), _rule("DV5S-002", title="Tạo phiếu bảo trì", description="Form tạo phiếu có độ ưu tiên mặc định", state="pending"),
              _rule("DV5S-003", state="archived", title="Rule cũ đã lưu trữ")):
        (d / "rules" / f"{r['rule_id']}_v{r['version']}.json").write_text(json.dumps(r, ensure_ascii=False), encoding="utf-8")
    return d


def test_dry_run_changes_nothing(session, snap):
    rep = importer.run(session, snap, apply=False)
    assert rep.versions_created == 3 and not rep.errors
    session.expire_all()
    assert session.scalars(select(BusinessRule)).all() == [] and session.scalars(select(Module)).all() == []
    assert session.scalars(select(ApprovalRequest)).all() == []


def test_import_never_marks_validated_and_keeps_every_field(session, snap):
    rep = importer.run(session, snap, apply=True)
    assert (rep.rules_created, rep.versions_created, rep.approvals_requested, rep.references_created, rep.sources_created) == (3, 3, 2, 1, 1)  # 3 rule dùng chung một trích dẫn giống hệt ⇒ một tham chiếu (dedupe theo băm)
    versions = session.scalars(select(BusinessRuleVersion)).all()
    assert {v.validation_status for v in versions} == {"UNREVIEWED"}  # duyệt ở Kho ngoài KHÔNG tự thành VALIDATED
    v1 = session.scalar(select(BusinessRuleVersion).where(BusinessRuleVersion.title.like("Quyền%")))
    assert v1.legacy_approval["approved_by"] == "u_external" and v1.legacy_approval["verification_status"] == "Confirmed"
    assert v1.extra["business_logic"].startswith("NẾU") and v1.extra["ai_interpretation"] and v1.extra["regression_risk"] == "thấp"  # trường bản Node làm rơi
    ref = session.scalar(select(Reference).where(Reference.quote.like("Người dùng%")))
    assert ref.locator["section"] == "3.4.5" and ref.locator["reference"].startswith("FS mục 3.4")
    sv = session.scalar(select(SourceVersion))
    assert sv.label == "v2" and session.scalar(select(Source)).title == "Tasks_YeuCauBaoTri_FS.docx"
    reqs = session.scalars(select(ApprovalRequest)).all()
    assert len(reqs) == 2 and all(r.origin == "ai" and r.status == "PENDING" for r in reqs)  # máy gửi ⇒ coi như AI, chờ QC


def test_import_is_idempotent_and_never_overwrites(session, snap):
    importer.run(session, snap, apply=True)
    again = importer.run(session, snap, apply=True)
    assert again.versions_created == 0 and again.versions_skipped == 3 and not again.conflicts
    (snap / "rules" / "DV5S-001_v1.json").write_text(json.dumps(_rule(description="Nội dung KHÁC của cùng version"), ensure_ascii=False), encoding="utf-8")
    conflict = importer.run(session, snap, apply=True)
    assert len(conflict.conflicts) == 1 and "không ghi đè" in conflict.conflicts[0]
    kept = session.scalar(select(BusinessRuleVersion).where(BusinessRuleVersion.title.like("Quyền%")))
    assert kept.description.startswith("Chỉ người thuộc")


def test_bad_files_are_reported_not_fatal(session, snap):
    (snap / "rules" / "bad.json").write_text(json.dumps({"rule_id": "X", "version": 1, "state": "weird", "title": "t", "description": "d"}), encoding="utf-8")
    rep = importer.run(session, snap, apply=True)
    assert len(rep.errors) == 1 and rep.versions_created == 3


def test_qc_approval_validates_rule_and_records_who(session, snap):
    importer.run(session, snap, apply=True)
    qc = make_qc(session)
    req = session.scalar(select(ApprovalRequest).where(ApprovalRequest.title.like("[DV5S-001%")))
    approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)
    session.commit()
    rv = session.scalar(select(BusinessRuleVersion).where(BusinessRuleVersion.title.like("Quyền%")))
    assert rv.validation_status == "VALIDATED" and rv.validated_by == qc.id


def test_rule_changed_after_submission_cannot_be_approved(session, snap):
    importer.run(session, snap, apply=True)
    qc = make_qc(session)
    req = session.scalar(select(ApprovalRequest).where(ApprovalRequest.title.like("[DV5S-001%")))
    session.scalar(select(BusinessRuleVersion).where(BusinessRuleVersion.title.like("Quyền%"))).content_hash = "f" * 64
    session.flush()
    with pytest.raises(Conflict):
        approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)


def test_qc_authored_rule_is_versioned_and_needs_another_approval(client, session):
    make_qc(session, "qcone")
    login(client, "qcone")
    first = client.post("/api/v1/library/rules", json={"module": "MAINT", "title": "Độ ưu tiên mặc định", "description": "Mặc định là Trung bình", "user_roles": ["QC"]})
    assert first.status_code == 201, first.text
    key = first.json()["rule_key"]
    assert key == "MAINT-P001" and first.json()["validation_status"] == "UNREVIEWED"
    second = client.post("/api/v1/library/rules", json={"rule_key": key, "module": "MAINT", "title": "Độ ưu tiên mặc định", "description": "Mặc định là Cao", "user_roles": ["QC"]})
    assert second.json()["version_no"] == 2
    detail = client.get(f"/api/v1/library/rules/{key}").json()
    assert [v["version_no"] for v in detail["versions"]] == [2, 1]  # lịch sử còn nguyên
    pend = client.get("/api/v1/approvals?status=PENDING").json()
    assert len([a for a in pend if a["subject_type"] == "rule_version"]) == 2


def test_bulk_decision_requires_correct_hashes_and_is_per_item(client, session, snap):
    importer.run(session, snap, apply=True)
    make_qc(session, "qcbulk")
    login(client, "qcbulk")
    items = [a for a in client.get("/api/v1/approvals?status=PENDING").json() if a["subject_type"] == "rule_version"]
    payload = [{"id": i["id"], "payload_hash": i["payload_hash"]} for i in items]
    payload[0]["payload_hash"] = "0" * 64  # một mục sai băm
    res = client.post("/api/v1/approvals/bulk-decision", json={"decision": "approve", "items": payload}).json()
    assert [r["ok"] for r in res] == [False, True]
    assert "đã thay đổi" in res[0]["error"]


def test_ai_rule_suggestion_becomes_rule_only_when_qc_accepts(session):
    sug, req = approvals.create_ai_suggestion(session, producer=AI_PRINCIPAL, kind="rule", title="Rule AI",
                                              payload={"module": "MAINT", "title": "Độ ưu tiên", "description": "Mặc định Trung bình", "user_roles": ["QC"]}, model="m")
    session.commit()
    assert session.scalars(select(BusinessRule)).all() == []  # chưa duyệt ⇒ chưa có rule
    qc = make_qc(session)
    approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)
    session.commit()
    rv = session.scalar(select(BusinessRuleVersion))
    assert rv.validation_status == "VALIDATED" and rv.validated_by == qc.id and rv.created_by_type == "AI"
    assert session.scalar(select(BusinessRule)).origin == "ai"


def test_incomplete_ai_rule_cannot_be_accepted(session):
    sug, req = approvals.create_ai_suggestion(session, producer=AI_PRINCIPAL, kind="rule", title="Thiếu", payload={"module": "MAINT"})
    session.commit()
    qc = make_qc(session)
    with pytest.raises(AppError):
        approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)
    session.rollback()
    assert session.get(ApprovalRequest, req.id).status == "PENDING"


def test_conflict_marks_both_disputed_and_blocks_approval(session, snap):
    importer.run(session, snap, apply=True)
    qc = make_qc(session)
    sv = session.scalar(select(SourceVersion))
    a = Reference(module_code="DV5S", source_version_id=sv.id, quote="A", content_hash="a" * 64, validation_status="UNREVIEWED")
    b = Reference(module_code="DV5S", source_version_id=sv.id, quote="B", content_hash="b" * 64, validation_status="UNREVIEWED")
    session.add_all([a, b])
    session.flush()
    service.link_references(session, actor=principal(qc), from_id=a.id, to_id=b.id, type_="conflicts_with")
    assert a.validation_status == b.validation_status == "DISPUTED" and a.validated_by is None
    req = approvals.submit_for_approval(session, requester=principal(qc), subject_type="reference", subject_id=str(a.id), title="ref A", payload={"q": "A"})
    with pytest.raises(Conflict):
        approvals.decide(session, actor=principal(qc), request_id=req.id, approve=True, payload_hash=req.payload_hash)
    with pytest.raises(AppError):
        service.link_references(session, actor=principal(qc), from_id=a.id, to_id=a.id, type_="refines")


def test_accent_insensitive_search_and_filters(client, session, snap):
    importer.run(session, snap, apply=True)
    make_qc(session, "qcsearch")
    login(client, "qcsearch")
    r = client.get("/api/v1/library/rules", params={"q": "quyen truy cap"}).json()
    assert r["total"] == 1 and r["items"][0]["rule_key"] == "DV5S-001" and r["items"][0]["has_legacy_approval"] is True
    assert client.get("/api/v1/library/rules", params={"validation": "VALIDATED"}).json()["total"] == 0
    assert client.get("/api/v1/library/rules", params={"state": "archived"}).json()["total"] == 1
    detail = client.get("/api/v1/library/rules/DV5S-001").json()
    assert detail["references"][0]["source_title"] == "Tasks_YeuCauBaoTri_FS.docx" and detail["versions"][0]["extra"]["business_logic"]
    assert session.scalars(select(AuditLog)).all() is not None
