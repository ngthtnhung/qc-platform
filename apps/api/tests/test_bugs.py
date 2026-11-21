import json

from sqlalchemy import select

from app.domains.bugs import service
from app.domains.bugs.models import Bug, BugSnapshot, BugSource, Project
from tests.conftest import login, make_qc


def _legacy(tmp_path, bugs=None):
    bugs = bugs or [
        {"id": "6af2f0135316d2ca5c282235", "t": "[BUG][HRM][EH] Lỗi nhân viên có quyền quản trị", "c": "NotBug", "d": "2026-11-10 17:24", "m": "HRM", "g": "HRM", "how": "tag", "u": "https://t.example/1"},
        {"id": "6af2f0135316d2ca5c282236", "t": "[BUG][MAINT] Không lưu được độ ưu tiên", "c": "Bug", "d": "2026-11-11 09:00", "m": "MAINT", "g": "MAINT", "how": "tag", "u": ""},
    ]
    p = tmp_path / "bugs.json"
    p.write_text(json.dumps({"source": "kb", "count": len(bugs), "revision": 3, "synced_at": "x", "bugs": bugs}, ensure_ascii=False), encoding="utf-8")
    return p


def _live(tmp_path, status=5):
    p = tmp_path / "live.json"
    p.write_text(json.dumps({"fieldsVersion": 2, "projects": [{"id": "p1", "name": "INTEGRITY - EMPTY"}], "bugs": [{
        "id": "6af2f0135316d2ca5c282235", "name": "[BUG][HRM][EH] Lỗi nhân viên có quyền quản trị", "status": status, "priority": 2, "is_Deleted": False,
        "created_At": "2026-11-10T10:24:00.000Z", "status_Updated_At": "2026-11-11T03:38:59Z", "project_Id": "p1",
        "assignTo": json.dumps({"id": 1, "name": "Nguyễn Duy Luật"}), "approverEntity": None, "additionalInfo": [1, 2], "project_Name": "INTEGRITY - EMPTY"}]},
        ensure_ascii=False), encoding="utf-8")
    return p


def test_dry_run_writes_nothing(session, tmp_path):
    rep = service.import_legacy_kb(session, _legacy(tmp_path), apply=False)
    assert rep.created == 2
    session.expire_all()
    assert session.scalars(select(Bug)).all() == [] and session.scalars(select(BugSource)).all() == []


def test_legacy_import_maps_fields_without_inventing_status(session, tmp_path):
    rep = service.import_legacy_kb(session, _legacy(tmp_path), apply=True)
    assert (rep.created, rep.snapshots, len(rep.errors)) == (2, 2, 0)
    b = session.scalar(select(Bug).where(Bug.module_code == "HRM"))
    assert b.status is None and b.classification == "NotBug"  # `c` KHÔNG bị suy ra thành status
    assert b.created_at_ext.isoformat().startswith("2026-11-10T10:24:00")  # 17:24 giờ VN (giả định ghi trong mã) = 10:24 UTC
    assert b.extra == {"g": "HRM", "how": "tag"} and b.title_fold.startswith("[bug][hrm][eh] loi nhan vien")


def test_idempotent_and_change_creates_history_snapshot(session, tmp_path):
    service.import_live(session, _live(tmp_path), apply=True)
    again = service.import_live(session, _live(tmp_path), apply=True)
    assert (again.created, again.updated, again.skipped) == (0, 0, 1)
    changed = service.import_live(session, _live(tmp_path, status=3), apply=True)
    assert changed.updated == 1
    bug = session.scalar(select(Bug))
    assert bug.status == 3
    assert len(session.scalars(select(BugSnapshot).where(BugSnapshot.bug_id == bug.id)).all()) == 2  # lịch sử được giữ


def test_live_and_legacy_are_kept_separate_by_source(session, tmp_path):
    service.import_legacy_kb(session, _legacy(tmp_path), apply=True)
    service.import_live(session, _live(tmp_path), apply=True)
    assert len(session.scalars(select(Bug).where(Bug.external_id == "6af2f0135316d2ca5c282235")).all()) == 2  # không gộp tự động
    live = session.scalar(select(Bug).join(BugSource).where(BugSource.code == "haraworks"))
    assert live.assignee == "Nguyễn Duy Luật" and live.project_id is not None and live.extra["additionalInfo"] == [1, 2]
    assert session.scalar(select(Project)).name == "INTEGRITY - EMPTY"


def test_bad_rows_are_reported_not_fatal(session, tmp_path):
    p = _legacy(tmp_path, [{"id": "a" * 24, "t": "ok", "d": "2026-11-10 17:24"}, {"t": "thiếu id"}])
    rep = service.import_legacy_kb(session, p, apply=True)
    assert rep.created == 1 and len(rep.errors) == 1


def test_api_search_is_accent_insensitive_and_filterable(client, session, tmp_path):
    service.import_legacy_kb(session, _legacy(tmp_path), apply=True)
    service.import_live(session, _live(tmp_path), apply=True)
    make_qc(session, "qcbugs")
    assert client.get("/api/v1/bugs").status_code == 401
    login(client, "qcbugs")
    r = client.get("/api/v1/bugs", params={"q": "loi nhan vien quan tri"}).json()
    assert r["total"] == 2
    assert client.get("/api/v1/bugs", params={"q": "do uu tien"}).json()["items"][0]["module_code"] == "MAINT"
    live = client.get("/api/v1/bugs", params={"source": "haraworks"}).json()["items"][0]
    assert live["status_label"] == "Hoàn thành" and live["priority_label"] == "Ưu tiên cao"
    assert client.get("/api/v1/bugs", params={"module": "NOPE"}).json()["total"] == 0
    detail = client.get(f"/api/v1/bugs/{live['id']}").json()
    assert detail["project"] == "INTEGRITY - EMPTY" and len(detail["history"]) == 1
    meta = client.get("/api/v1/bugs/meta").json()
    assert meta["sources"] == {"haraworks": 1, "legacy_kb": 2} and "HRM" in meta["modules"]
    assert client.get("/api/v1/bugs", params={"q": "50%_"}).json()["total"] == 0  # ký tự LIKE được escape


def test_live_module_is_derived_from_title_tags_only_when_known(session, tmp_path):
    from app.domains.knowledge.models import Module

    session.add(Module(code="HRM", name="Nhân sự", prefix="HRM", extra={"bug_aliases": ["HR-M"]}))
    session.add(Module(code="MAINT", name="Bảo trì", extra={}))
    session.commit()
    p = _live(tmp_path)
    data = json.loads(p.read_text(encoding="utf-8"))
    base = data["bugs"][0]
    data["bugs"] = [
        {**base, "id": "a" * 24, "name": "[BUG][HRM][SCF] có thẻ module"},
        {**base, "id": "b" * 24, "name": "[BUG][HR-M] qua alias"},
        {**base, "id": "c" * 24, "name": "[BUG][ZZZ] thẻ lạ"},
        {**base, "id": "d" * 24, "name": "Không có thẻ"},
    ]
    p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    service.import_live(session, p, apply=True)
    got = {b.external_id[0]: b.module_code for b in session.scalars(select(Bug))}
    assert got == {"a": "HRM", "b": "HRM", "c": "", "d": ""}  # không đoán khi không khớp
