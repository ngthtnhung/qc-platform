import datetime as dt
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.db import utcnow
from app.core.principal import AI_PRINCIPAL
from app.domains.automation import importer, rules, service
from app.domains.automation.models import AutomationTask, CodeVersion, Execution
from app.domains.platform import approvals
from app.domains.platform.models import ApprovalRequest, AuditLog
from tests.conftest import login, make_qc, principal

SCRIPT = "await step('Mở trang', async () => { await page.waitForLoadState('networkidle'); });"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _task_body(**kw):
    base = {"name": "Tạo phiếu bảo trì", "module_code": "MAINT", "start_url": "https://staging.example.com/maint", "steps": ["Mở trang"], "script": SCRIPT,
            "params": [{"key": "ghi_chu", "label": "Ghi chú", "value": "AI TEST"}], "required_roles": ["Nhân viên"]}
    base.update(kw)
    return base


@pytest.fixture()
def qc(client, session):
    make_qc(session, "qcauto")
    login(client, "qcauto")
    return client


@pytest.fixture()
def staging(qc):
    env = qc.post("/api/v1/environments", json={"code": "stg", "name": "Staging", "type": "STAGING", "base_url": "https://staging.example.com",
                                                 "login_url": "https://staging.example.com/login", "org_identifier": "org1", "allowed_actions": ["READ", "AUTOMATE"]}).json()
    acc = qc.post("/api/v1/accounts", json={"environment_id": env["id"], "name": "NV Staging", "username_ref": "nv@x.com", "role_label": "Nhân viên"}).json()
    assert qc.put(f"/api/v1/accounts/{acc['id']}/secret", json={"password": "Staging-Pass-123"}).status_code == 204
    return env, acc


def _approve(qc, task_id, version_no=None):
    t = qc.get(f"/api/v1/automation/tasks/{task_id}").json()
    v = next(x for x in t["versions"] if version_no is None or x["version_no"] == version_no)
    pend = [a for a in qc.get("/api/v1/approvals?status=PENDING").json() if a["subject_type"] == "automation_code_version"
            and a["payload"]["sha256"] == v["sha256"]][0]
    r = qc.post(f"/api/v1/approvals/{pend['id']}/decision", json={"decision": "approve", "payload_hash": pend["payload_hash"]})
    assert r.status_code == 200, r.text


def _runner(qc, name="r1"):
    r = qc.post("/api/v1/runners", json={"name": name, "type": "host"}).json()
    c = TestClient(qc.app)
    c.headers["Authorization"] = f"Bearer {r['token']}"
    return r, c


# ------------------------------------------------------------------ quy tắc kiểm tra
def test_rules_validation():
    assert rules.validate_script(SCRIPT) == []
    assert rules.validate_script("require('fs')") and rules.validate_script("await page.evaluate(() => process.exit())")
    assert rules.validate_start_url("http://staging.example.com", []) and rules.validate_start_url("https://evil.com/x", ["https://staging.example.com"])
    assert rules.validate_start_url("https://app.example.com/x", ["https://staging.example.com"]) is None
    params, errs = rules.normalize_params([{"key": "Tab_kiem_tra", "value": "x"}, {"key": "1bad"}, {"key": "a"}, {"key": "a"}])
    assert [p["key"] for p in params] == ["Tab_kiem_tra", "a"] and len(errs) == 2  # khóa hoa cũ được giữ; khóa sai/trùng bị báo
    assert rules.merge_params(params, {"a": "mới", "khong_co": "x"}) == {"Tab_kiem_tra": "x", "a": "mới"}


# ------------------------------------------------------------------ duyệt code
def test_new_task_is_not_runnable_until_a_qc_approves(qc, staging):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    assert t["runnable"] is False and t["versions"][0]["status"] == "PENDING"
    r = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={})
    assert r.status_code == 409 and r.json()["error"]["code"] == "NOT_APPROVED"
    _approve(qc, t["id"])
    t2 = qc.get(f"/api/v1/automation/tasks/{t['id']}").json()
    assert t2["runnable"] and t2["versions"][0]["status"] == "APPROVED" and t2["versions"][0]["approved_by"]
    assert qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).status_code == 201


def test_invalid_task_is_rejected(qc, staging):
    assert qc.post("/api/v1/automation/tasks", json=_task_body(script="eval('x')")).json()["error"]["code"] == "SCRIPT_INVALID"
    assert qc.post("/api/v1/automation/tasks", json=_task_body(start_url="https://evil.com")).status_code == 422
    assert qc.post("/api/v1/automation/tasks", json=_task_body(steps=[])).status_code == 422


def test_ai_code_cannot_approve_itself_and_edits_create_new_pending_versions(qc, staging, session):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    v2 = qc.post(f"/api/v1/automation/tasks/{t['id']}/versions", json={"script": SCRIPT + "\n// sửa", "origin": "ai"}).json()
    assert v2["status"] == "PENDING" and v2["version_no"] == 2
    assert qc.post(f"/api/v1/automation/tasks/{t['id']}/versions", json={"script": SCRIPT}).status_code == 409  # trùng code
    e = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["executions"][0]
    cv = session.scalar(select(Execution)).code_version_id
    assert session.get(CodeVersion, cv).version_no == 1  # v2 chưa duyệt ⇒ vẫn chạy v1 đã duyệt
    _approve(qc, t["id"], 2)
    e2 = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["executions"][0]
    session.expire_all()
    assert session.get(CodeVersion, session.get(Execution, uuid.UUID(e2["id"])).code_version_id).version_no == 2 and e["id"] != e2["id"]
    # đường AI: yêu cầu duyệt của code do AI sinh không thể tự duyệt bởi AI
    task = session.scalar(select(AutomationTask))
    cv3 = service.add_code_version(session, task=task, script=SCRIPT + "\n// ai", requester=AI_PRINCIPAL, origin="ai")
    session.commit()
    req = session.scalar(select(ApprovalRequest).where(ApprovalRequest.subject_id == str(cv3.id)))
    from app.core.errors import PermissionDenied

    with pytest.raises(PermissionDenied):
        approvals.decide(session, actor=AI_PRINCIPAL, request_id=req.id, approve=True, payload_hash=req.payload_hash)
    session.refresh(cv3)
    assert cv3.status == "PENDING" and cv3.approved_by is None


def test_db_forbids_approved_code_without_human(session, qc):
    from sqlalchemy.exc import IntegrityError

    t, cv = service.create_task(session, actor=principal(make_qc(session, "qcdb")), name="x", module_code="M", start_url="https://a.example.com", steps=["s"], script=SCRIPT, params=[])
    session.commit()
    cv.status = "APPROVED"
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


# ------------------------------------------------------------------ hàng đợi
def test_queue_requires_staging_account_and_supports_batches(qc, session):
    t = qc.post("/api/v1/automation/tasks", json=_task_body(start_url="https://staging.example.com/x")).json()
    _approve(qc, t["id"])
    assert qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["error"]["code"] == "NO_ACCOUNT"
    prod = qc.post("/api/v1/environments", json={"code": "prod", "name": "P", "type": "PRODUCTION", "base_url": "https://staging.example.com", "allowed_actions": ["*"]}).json()
    qc.post("/api/v1/accounts", json={"environment_id": prod["id"], "name": "P", "username_ref": "p@x.com"})
    assert qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["error"]["code"] == "NO_ACCOUNT"  # Production không bao giờ được chọn
    env = qc.post("/api/v1/environments", json={"code": "stg", "name": "S", "type": "STAGING", "base_url": "https://staging.example.com", "allowed_actions": ["AUTOMATE"]}).json()
    qc.post("/api/v1/accounts", json={"environment_id": env["id"], "name": "S", "username_ref": "s@x.com", "role_label": "Nhân viên"})
    r = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={"count": 3, "params": {"ghi_chu": "đã đổi"}}).json()["executions"]
    assert len(r) == 3 and len({e.id for e in session.scalars(select(Execution))}) == 3
    assert {e.params["ghi_chu"] for e in session.scalars(select(Execution))} == {"đã đổi"}
    assert len({e.batch_id for e in session.scalars(select(Execution))}) == 1
    assert qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={"count": 51}).status_code == 422


def test_environment_without_automate_permission_blocks_run(qc, session):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    env = qc.post("/api/v1/environments", json={"code": "stg", "name": "S", "type": "STAGING", "base_url": "https://staging.example.com", "allowed_actions": ["READ"]}).json()
    qc.post("/api/v1/accounts", json={"environment_id": env["id"], "name": "S", "username_ref": "s@x.com", "role_label": "Nhân viên"})
    assert qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["error"]["code"] == "POLICY_BLOCKED"


# ------------------------------------------------------------------ Runner
def test_runner_full_lifecycle(qc, staging, session):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    ex_id = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["executions"][0]["id"]
    runner, rc = _runner(qc)
    assert "token" in runner and qc.get("/api/v1/runners").json()[0].get("token") is None  # token chỉ hiện một lần

    job = rc.post("/api/v1/runner/claim").json()["job"]
    assert job["execution_id"] == ex_id and job["script"] == SCRIPT and job["sha256"] == rules.script_sha(SCRIPT)
    assert job["account"]["username"] == "nv@x.com" and job["environment"]["type"] == "STAGING" and "password" not in json.dumps(job)
    assert rc.post("/api/v1/runner/claim").json()["job"] is None  # không còn việc

    cred = rc.post(f"/api/v1/runner/executions/{ex_id}/credentials").json()
    assert cred["password"] == "Staging-Pass-123"
    assert rc.post(f"/api/v1/runner/executions/{ex_id}/credentials").status_code == 409  # chỉ một lần
    assert session.scalars(select(AuditLog).where(AuditLog.action == "SECRET_READ", AuditLog.actor_type == "RUNNER")).all()

    assert rc.post(f"/api/v1/runner/executions/{ex_id}/start").status_code == 204
    wrong = rc.post(f"/api/v1/runner/executions/{ex_id}/report", json={"status": "PASSED", "sha256": "0" * 64})
    assert wrong.status_code == 409 and wrong.json()["error"]["code"] == "SHA_MISMATCH"
    ok = rc.post(f"/api/v1/runner/executions/{ex_id}/report", json={"status": "PASSED", "sha256": job["sha256"], "duration_ms": 1234,
                                                                   "steps": [{"name": "Mở trang", "status": "PASS", "ms": 10}], "log": ["xong"]})
    assert ok.status_code == 200 and ok.json()["status"] == "PASSED"
    art = rc.post(f"/api/v1/runner/executions/{ex_id}/artifacts", params={"kind": "screenshot"}, files={"file": ("s.png", PNG, "image/png")})
    assert art.status_code == 201, art.text
    detail = qc.get(f"/api/v1/automation/executions/{ex_id}").json()
    assert detail["steps"][0]["name"] == "Mở trang" and detail["log"] == ["xong"] and detail["artifacts"][0]["kind"] == "screenshot"
    assert rc.post(f"/api/v1/runner/executions/{ex_id}/report", json={"status": "FAILED", "sha256": job["sha256"]}).status_code == 409  # không báo lại


def test_runner_tokens_and_principal_separation(qc, staging):
    runner, rc = _runner(qc, "r2")
    assert TestClient(qc.app).post("/api/v1/runner/claim").status_code == 401
    jwt_client = TestClient(qc.app)
    login(jwt_client, "qcauto")
    jwt_client.headers["Authorization"] = jwt_client.cookies.get("access_token") and f"Bearer {jwt_client.cookies.get('access_token')}"
    assert jwt_client.post("/api/v1/runner/claim").status_code == 401  # token người dùng không dùng được cho runner
    assert rc.get("/api/v1/users").status_code == 401  # token runner không gọi được API của QC
    assert qc.post(f"/api/v1/runners/{runner['id']}/revoke").status_code == 200
    assert rc.post("/api/v1/runner/claim").status_code == 401  # đã thu hồi


def test_expired_lease_is_requeued_then_failed(qc, staging, session):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    ex_id = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["executions"][0]["id"]
    _, rc = _runner(qc, "r3")
    for attempt in (1, 2):
        job = rc.post("/api/v1/runner/claim").json()["job"]
        assert job and job["attempt"] == attempt
        ex = session.get(Execution, uuid.UUID(job["execution_id"]))
        session.refresh(ex)
        ex.lease_expires_at = utcnow() - dt.timedelta(seconds=1)  # runner "mất kết nối"
        session.commit()
    assert rc.post("/api/v1/runner/claim").json()["job"] is None
    session.expire_all()
    ex = session.get(Execution, uuid.UUID(ex_id))
    assert ex.status == "FAILED" and "hết số lần thử" in ex.error


def test_revoked_code_is_not_run(qc, staging, session):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    ex_id = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["executions"][0]["id"]
    cv = session.scalar(select(CodeVersion))
    cv.status = "RETIRED"
    session.commit()
    _, rc = _runner(qc, "r4")
    assert rc.post("/api/v1/runner/claim").json()["job"] is None
    session.expire_all()
    assert session.get(Execution, uuid.UUID(ex_id)).status == "FAILED"


def test_cancel_execution(qc, staging):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    ex_id = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["executions"][0]["id"]
    assert qc.post(f"/api/v1/automation/executions/{ex_id}/cancel").json()["status"] == "CANCELLED"
    _, rc = _runner(qc, "r5")
    assert rc.post("/api/v1/runner/claim").json()["job"] is None
    assert qc.post(f"/api/v1/automation/executions/{ex_id}/cancel").status_code == 409


# ------------------------------------------------------------------ importer
def _drafts(tmp_path):
    d = tmp_path / "drafts"
    d.mkdir()
    item = {"name": "Tạo phiếu", "module": "MAINT", "start_url": "https://staging.example.com/m", "steps": ["a"], "script": SCRIPT, "writes": True,
            "params": [{"key": "ghi_chu", "label": "Ghi chú", "value": "x", "type": "text"}], "rule_ids": ["MAINT-001"], "required_roles": ["Nhân viên"]}
    (d / "A.json").write_text(json.dumps(item, ensure_ascii=False), encoding="utf-8")
    (d / "B.json").write_text(json.dumps([{**item, "name": "Tạo phiếu 2", "script": SCRIPT + "\n//2"}, {**item, "name": "Sai", "script": "eval(1)"}], ensure_ascii=False), encoding="utf-8")
    (d / "_skip.json").write_text("{}", encoding="utf-8")
    legacy = {"automation_tasks": [
        {"id": legacy_id(item), "script": SCRIPT, "script_sha": rules.script_sha(SCRIPT), "approved_by": "auto", "status": "approved",
         "params": [{"key": "ghi_chu", "value": "người dùng đã đổi trên UI", "auto": False}]},
        {"id": "at_onlyindb", "name": "Chỉ có trong DB", "module": "IOT", "start_url": "https://staging.example.com/i", "steps": ["b"], "script": SCRIPT + "\n//db",
         "params": [], "status": "approved", "approved_by": "auto"},
    ]}
    lp = tmp_path / "legacy.json"
    lp.write_text(json.dumps(legacy, ensure_ascii=False), encoding="utf-8")
    return d, lp


def legacy_id(item):
    return importer.legacy_id_for(item)


def test_import_dry_run_changes_nothing(session, tmp_path):
    d, lp = _drafts(tmp_path)
    rep = importer.run(session, d, legacy_db=lp, apply=False)
    assert rep.tasks_created == 3 and len(rep.errors) == 1
    session.expire_all()
    assert session.scalars(select(AutomationTask)).all() == []


def test_import_never_carries_auto_approval_and_is_idempotent(session, tmp_path):
    d, lp = _drafts(tmp_path)
    rep = importer.run(session, d, legacy_db=lp, apply=True)
    assert (rep.tasks_created, rep.params_updated) == (3, 1) and len(rep.errors) == 1 and "eval" in rep.errors[0] or "cấm" in rep.errors[0]
    versions = session.scalars(select(CodeVersion)).all()
    assert {v.status for v in versions} == {"PENDING"} and {v.origin for v in versions} == {"import"}  # "auto" của bản Node KHÔNG phải duyệt
    reqs = session.scalars(select(ApprovalRequest).where(ApprovalRequest.subject_type == "automation_code_version")).all()
    assert len(reqs) == 3 and all(r.status == "PENDING" and r.origin == "ai" for r in reqs)
    only_db = session.scalar(select(AutomationTask).where(AutomationTask.legacy_id == "at_onlyindb"))
    assert only_db and only_db.module_code == "IOT"
    first = session.scalar(select(AutomationTask).where(AutomationTask.name == "Tạo phiếu"))
    assert first.writes and first.rule_keys == ["MAINT-001"] and service.task_params(session, first.id)[0]["value"] == "người dùng đã đổi trên UI"
    again = importer.run(session, d, legacy_db=lp, apply=True)
    assert again.tasks_created == 0 and again.versions_added == 0 and again.unchanged == 2


def test_changed_script_adds_a_new_pending_version_not_overwrite(session, tmp_path):
    d, lp = _drafts(tmp_path)
    importer.run(session, d, legacy_db=None, apply=True)
    item = json.loads((d / "A.json").read_text(encoding="utf-8"))
    item["script"] = SCRIPT + "\n// đã sửa"
    (d / "A.json").write_text(json.dumps(item, ensure_ascii=False), encoding="utf-8")
    rep = importer.run(session, d, legacy_db=None, apply=True)
    assert rep.versions_added == 1
    task = session.scalar(select(AutomationTask).where(AutomationTask.name == "Tạo phiếu"))
    vs = session.scalars(select(CodeVersion).where(CodeVersion.task_id == task.id).order_by(CodeVersion.version_no)).all()
    assert [v.version_no for v in vs] == [1, 2] and vs[0].script == SCRIPT  # bản cũ nguyên vẹn


def test_rate_limit_counts_recent_runs(qc, staging, session, monkeypatch):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    monkeypatch.setattr(service, "RATE_LIMIT_RUNS", 4)
    assert qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={"count": 3}).status_code == 201
    r = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={"count": 2})
    assert r.status_code == 429 and r.json()["error"]["code"] == "RATE_LIMITED"



def test_no_account_message_explains_cause_and_manual_pick_works(qc):
    t = qc.post("/api/v1/automation/tasks", json=_task_body(required_roles=["Quản trị"])).json()
    _approve(qc, t["id"])
    msg = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["error"]["message"]
    assert "STAGING" in msg  # chưa có môi trường/tài khoản Staging
    env = qc.post("/api/v1/environments", json={"code": "stg", "name": "S", "type": "STAGING", "base_url": "https://staging.example.com",
                                                 "allowed_actions": ["AUTOMATE"]}).json()
    acc = qc.post("/api/v1/accounts", json={"environment_id": env["id"], "name": "NV", "username_ref": "nv@x.com", "role_label": "Nhân viên"}).json()
    msg2 = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={}).json()["error"]["message"]
    assert "Quản trị" in msg2 and "Nhân viên" in msg2  # nêu vai trò cần và vai trò đang có
    ok = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={"account_id": acc["id"]})
    assert ok.status_code == 201  # chọn thủ công thì không bắt khớp vai trò
    prod = qc.post("/api/v1/environments", json={"code": "prod", "name": "P", "type": "PRODUCTION", "base_url": "https://staging.example.com", "allowed_actions": ["*"]}).json()
    pacc = qc.post("/api/v1/accounts", json={"environment_id": prod["id"], "name": "P", "username_ref": "p@x.com"}).json()
    r = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={"account_id": pacc["id"]})
    assert r.status_code == 422 and "không thuộc môi trường loại STAGING" in r.json()["error"]["message"]  # không thể chọn Production


def test_approval_payload_carries_previous_approved_script_for_diff(qc, staging):
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    _approve(qc, t["id"])
    new_script = SCRIPT + "\n// sửa"
    qc.post(f"/api/v1/automation/tasks/{t['id']}/versions", json={"script": new_script, "note": "đổi selector"})
    pend = [a for a in qc.get("/api/v1/approvals?status=PENDING").json() if a["subject_type"] == "automation_code_version"][0]
    assert pend["payload"]["script"] == new_script and pend["payload"]["prev_script"] == SCRIPT and pend["payload"]["prev_version"] == 1
    assert pend["payload"]["note"] == "đổi selector"
    detail = qc.get(f"/api/v1/automation/tasks/{t['id']}").json()
    assert detail["script_by_version"]["1"] == SCRIPT and detail["script_by_version"]["2"] == new_script
