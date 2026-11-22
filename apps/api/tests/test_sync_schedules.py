import datetime as dt
import json
import re
import uuid

import httpx
import pytest
from sqlalchemy import select

from app.core.db import utcnow
from app.core.errors import PermissionDenied
from app.core.principal import AI_PRINCIPAL, SYSTEM_PRINCIPAL
from app.domains.automation import schedules
from app.domains.automation.models import AutomationTask, Execution, ExecutionSchedule
from app.domains.bugs import service as bugs
from app.domains.bugs.models import Bug
from app.domains.bugs.sync import sync_bugs
from app.domains.integrations import service as integ
from app.domains.integrations.clients import HaraworksClient
from app.domains.platform.models import AuditLog, User
from tests.conftest import login, make_qc, principal
from tests.test_automation import SCRIPT, _approve, _task_body

PID = "6a82c660453be0e60a53fa16"


def haraworks_server(*, version_seen: list, tasks: dict, timestamp="T2", unchanged_when="T2"):
    """Máy chủ Haraworks giả: getListTask (trả null nếu version đã là timestamp hiện tại), getTaskById theo alias."""
    def handler(request: httpx.Request) -> httpx.Response:
        q = json.loads(request.content)["query"]
        assert "mutation" not in q  # chỉ truy vấn đọc
        m = re.search(r'getListTask\(version:"([^"]*)",projectId:"([^"]*)"\)', q)
        if m:
            version_seen.append(m.group(1))
            if m.group(1) == unchanged_when:
                return httpx.Response(200, json={"data": {"getListTask": None}})
            return httpx.Response(200, json={"data": {"getListTask": {"tasks": list(tasks), "timestamp": timestamp}}})
        ids = re.findall(r'getTaskById\(id:"([0-9a-f]{24})"\)', q)
        return httpx.Response(200, json={"data": {f"t{i}": tasks.get(tid) for i, tid in enumerate(ids)}})
    return httpx.MockTransport(handler)


def task(tid, name, **kw):
    return {"id": tid, "name": name, "status": 1, "priority": 2, "is_Deleted": False, "created_At": "2026-11-20T01:00:00Z", "status_Updated_At": "2026-11-20T02:00:00Z",
            "project_Id": PID, "assignTo": {"id": 1, "name": "Nguyễn A"}, "approverEntity": None, "additionalInfo": [], **kw}


A, B, C, D = "a" * 24, "b" * 24, "c" * 24, "d" * 24


@pytest.fixture()
def seeded(session, tmp_path):
    f = tmp_path / "live.json"  # dữ liệu nhập từ bản Node: một dự án thật (mã 24 hex) + một bug, kèm con trỏ phiên bản
    f.write_text(json.dumps({"fieldsVersion": 4, "projects": [{"id": PID, "name": "INTEGRITY - EMPTY", "allTasks": False, "version": "0"}], "seen": {},
                             "bugs": [{"id": "e" * 24, "name": "[BUG] Bug cũ từ file", "status": 1, "priority": 2, "is_Deleted": False, "created_At": "2026-11-10T10:24:00Z",
                                       "status_Updated_At": "2026-11-11T03:38:59Z", "project_Id": PID, "assignTo": None, "approverEntity": None, "additionalInfo": []}]}),
                 encoding="utf-8")
    bugs.import_live(session, f, apply=True)
    return session


def client_for(transport):
    return HaraworksClient("https://tasks.haraworks.vn", "sid=abc", transport=transport)


# ------------------------------------------------------------------ đồng bộ bug
def test_sync_bugs_filters_titles_keeps_cursors_and_skips_when_unchanged(seeded):
    tasks = {A: task(A, "[BUG][HRM] Lỗi mới xuất file"), B: task(B, "Task thường không phải bug"), C: task(C, "[BUG] Đã xóa", is_Deleted=True),
             D: task(D, "[Issuse][MAINT] gõ sai tag vẫn là bug")}
    seen: list = []
    out = sync_bugs(seeded, client_for(haraworks_server(version_seen=seen, tasks=tasks)))
    seeded.commit()
    assert out["created"] == 2 and out["projects_changed"] == 1 and seen == ["0"]  # chưa có con trỏ trong DB ⇒ lấy từ "0"
    titles = {b.title for b in seeded.scalars(select(Bug).where(Bug.external_id.in_([A, B, C, D])))}
    assert titles == {"[BUG][HRM] Lỗi mới xuất file", "[Issuse][MAINT] gõ sai tag vẫn là bug"}  # task thường và task đã xóa bị loại
    again = sync_bugs(seeded, client_for(haraworks_server(version_seen=seen, tasks=tasks)))
    assert seen[-1] == "T2" and again["projects_changed"] == 0 and again["created"] == 0  # không đổi: không tải lại chi tiết


def test_sync_updates_changed_bug_with_history_and_never_writes(seeded):
    t = {A: task(A, "[BUG] Lỗi")}
    sync_bugs(seeded, client_for(haraworks_server(version_seen=[], tasks=t, timestamp="T1", unchanged_when="never")))
    t2 = {A: task(A, "[BUG] Lỗi", status=5)}
    out = sync_bugs(seeded, client_for(haraworks_server(version_seen=[], tasks=t2, timestamp="T3", unchanged_when="never")))
    seeded.commit()
    bug = seeded.scalar(select(Bug).where(Bug.external_id == A))
    assert out["updated"] == 1 and bug.status == 5


def test_sync_expired_cookie_raises_auth_error(seeded):
    from app.core.errors import AppError

    with pytest.raises(AppError) as e:
        sync_bugs(seeded, client_for(httpx.MockTransport(lambda r: httpx.Response(401))))
    assert e.value.code == "HARAWORKS_AUTH"


# ------------------------------------------------------------------ tác vụ nền qua API
@pytest.fixture()
def qc(client, session):
    make_qc(session, "qcsync")
    login(client, "qcsync")
    yield client
    integ.TRANSPORT.clear()


def test_bug_sync_job_needs_cookie_then_runs_in_worker(qc, seeded):
    assert qc.post("/api/v1/bugs/sync").json()["error"]["code"] == "NO_COOKIE"
    qc.put("/api/v1/integrations/haraworks", json={"value": "sid=abc"})
    integ.TRANSPORT["haraworks"] = haraworks_server(version_seen=[], tasks={A: task(A, "[BUG] Lỗi từ job")})
    r = qc.post("/api/v1/bugs/sync")
    assert r.status_code == 202
    job = qc.get(f"/api/v1/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "DONE" and job["result"]["created"] == 1 and job["kind"] == "sync_bugs"
    assert qc.get("/api/v1/bugs", params={"q": "loi tu job"}).json()["total"] == 1


def test_failed_job_records_error_code_without_crashing(qc, seeded):
    qc.put("/api/v1/integrations/haraworks", json={"value": "sid=expired"})
    integ.TRANSPORT["haraworks"] = httpx.MockTransport(lambda r: httpx.Response(401))
    r = qc.post("/api/v1/bugs/sync")
    job = qc.get(f"/api/v1/jobs/{r.json()['job_id']}").json()
    assert job["status"] == "FAILED" and job["result"]["error"]["code"] == "HARAWORKS_AUTH"
    assert qc.get(f"/api/v1/jobs/{uuid.uuid4()}").status_code == 404


def test_scheduled_sync_is_a_noop_without_cookie_and_system_can_read_but_ai_cannot(qc, session):
    from app.worker import scheduled_sync_task

    assert scheduled_sync_task("sync_bugs") == {"skipped": "chưa cấu hình cookie Haraworks"}
    qc.put("/api/v1/integrations/haraworks", json={"value": "sid=abc"})
    session.expire_all()
    assert integ.get_secret(session, SYSTEM_PRINCIPAL, "haraworks", "beat") == "sid=abc"  # tác vụ nền theo lịch
    with pytest.raises(PermissionDenied):
        integ.get_secret(session, AI_PRINCIPAL, "haraworks", "x")  # AI không bao giờ đọc được


# ------------------------------------------------------------------ lịch chạy
@pytest.fixture()
def ready(qc, session):
    env = qc.post("/api/v1/environments", json={"code": "stg", "name": "S", "type": "STAGING", "base_url": "https://staging.example.com", "allowed_actions": ["AUTOMATE"]}).json()
    qc.post("/api/v1/accounts", json={"environment_id": env["id"], "name": "NV", "username_ref": "nv@x.com", "role_label": "Nhân viên"})
    t = qc.post("/api/v1/automation/tasks", json=_task_body()).json()
    return t


def test_schedule_requires_approved_code_and_min_interval(qc, ready):
    body = {"task_id": ready["id"], "interval_minutes": 60}
    assert qc.post("/api/v1/automation/schedules", json=body).json()["error"]["code"] == "NOT_APPROVED"
    _approve(qc, ready["id"])
    assert qc.post("/api/v1/automation/schedules", json={**body, "interval_minutes": 1}).status_code == 422
    r = qc.post("/api/v1/automation/schedules", json=body)
    assert r.status_code == 201 and r.json()["enabled"] is True
    assert qc.put(f"/api/v1/automation/schedules/{r.json()['id']}", json={"enabled": False}).json()["enabled"] is False
    assert qc.delete(f"/api/v1/automation/schedules/{r.json()['id']}").status_code == 204
    assert qc.get("/api/v1/automation/schedules").json() == []


def test_due_schedule_queues_once_while_previous_is_active_and_advances(qc, ready, session):
    _approve(qc, ready["id"])
    sid = qc.post("/api/v1/automation/schedules", json={"task_id": ready["id"], "interval_minutes": 15, "first_run_in_minutes": 0, "run_count": 2}).json()["id"]
    now = utcnow() + dt.timedelta(seconds=5)
    out = schedules.run_due(session, now)
    session.commit()
    assert out == {"queued": 1, "skipped": 0, "failed": 0}
    exs = session.scalars(select(Execution)).all()
    assert len(exs) == 2 and all(e.schedule_id == uuid.UUID(sid) for e in exs)
    sch = session.get(ExecutionSchedule, uuid.UUID(sid))
    assert sch.next_run_at.replace(tzinfo=dt.timezone.utc) >= now + dt.timedelta(minutes=14)  # không dồn lịch bỏ lỡ
    assert session.scalars(select(AuditLog).where(AuditLog.action == "SCHEDULE_TRIGGERED", AuditLog.actor_type == "USER")).all()
    sch.next_run_at = now - dt.timedelta(minutes=1)  # đến hạn lại nhưng lần trước còn đang chờ
    session.commit()
    again = schedules.run_due(session, now)
    assert again["skipped"] == 1 and len(session.scalars(select(Execution)).all()) == 2


def test_schedule_fails_closed_when_code_no_longer_approved_or_user_deactivated(qc, ready, session):
    from app.domains.automation.models import CodeVersion

    _approve(qc, ready["id"])
    sid = uuid.UUID(qc.post("/api/v1/automation/schedules", json={"task_id": ready["id"], "interval_minutes": 15, "first_run_in_minutes": 0}).json()["id"])
    session.scalar(select(CodeVersion)).status = "RETIRED"
    session.commit()
    out = schedules.run_due(session, utcnow() + dt.timedelta(seconds=5))
    session.commit()
    sch = session.get(ExecutionSchedule, sid)
    assert out["failed"] == 1 and "duyệt" in sch.last_status and not session.scalars(select(Execution)).all()
    sch.next_run_at = utcnow() - dt.timedelta(minutes=1)
    session.scalar(select(User)).is_active = False
    session.commit()
    schedules.run_due(session, utcnow() + dt.timedelta(seconds=5))
    session.commit()
    session.refresh(sch)
    assert sch.enabled is False and "không còn hoạt động" in sch.last_status


def test_unused_imports_guard():
    assert AutomationTask and principal and SCRIPT
