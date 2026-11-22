import pytest
from sqlalchemy import select

from app.domains.automation.models import CodeVersion
from app.domains.flows import recorder
from tests.conftest import login, make_qc

BTN = {"tag": "button", "role": "button", "name": "Lưu", "text": "Lưu", "css": "form > button.save"}
EMAIL = {"tag": "input", "type": "text", "label": "Tên phiếu", "placeholder": "Nhập tên", "id": "field-12345"}
PWD = {"tag": "input", "type": "password", "label": "Mật khẩu"}
SEL = {"tag": "select", "label": "Loại", "css": "select.kind"}

EVENTS = [
    {"t": "navigate", "url": "https://staging.example.com/maint"},
    {"t": "click", "el": EMAIL},
    {"t": "fill", "el": EMAIL, "value": "a"},
    {"t": "fill", "el": EMAIL, "value": "Phiếu thử"},
    {"t": "fill", "el": PWD, "value": "Sup3r-Secret!"},
    {"t": "select", "el": SEL, "value": "Khẩn cấp"},
    {"t": "click", "el": BTN},
    {"t": "navigate", "url": "https://staging.example.com/maint/done"},
    {"t": "bogus"},
]


def test_locator_ranking_and_escape():
    c = recorder.locator_candidates({**BTN, "testid": "save-btn"})
    assert [x["kind"] for x in c] == ["testid", "role", "text", "css"]
    assert recorder.js_str("it's\n x") == "'it\\'s\\n\\u2028x'"
    # id tự sinh (nhiều chữ số) bị loại khỏi ứng viên
    assert all(x["kind"] != "id" for x in recorder.locator_candidates(EMAIL))


def test_normalize_merges_masks_and_parametrizes():
    n = recorder.normalize(EVENTS)
    kinds = [s["t"] for s in n["steps"]]
    assert kinds == ["fill", "select", "click"]  # click focus thừa, gõ lại, điều hướng do click, sự kiện lạ đều được gộp/bỏ
    assert n["params"][0] == {"key": "nhap_1", "label": "Nhập “Tên phiếu”", "value": "Phiếu thử", "type": "text"}
    blob = str(n)
    assert "Sup3r-Secret" not in blob  # mật khẩu không bao giờ vào bản chuẩn hóa
    assert any("nhạy cảm" in w for w in n["warnings"]) and any("lạ" in w for w in n["warnings"])


def test_generate_script_is_deterministic_and_valid():
    from app.domains.automation import rules

    n = recorder.normalize(EVENTS)
    s1, s2 = recorder.generate_script(n["steps"]), recorder.generate_script(recorder.normalize(EVENTS)["steps"])
    assert s1 == s2 and rules.validate_script(s1) == []
    assert "ctx.val('nhap_1')" in s1 and "getByLabel('Tên phiếu')" in s1 and "selectOption" in s1
    assert "Phiếu thử" not in s1 and "Sup3r" not in s1  # giá trị nhập nằm ở tham số, không nằm trong code


def test_too_many_events():
    with pytest.raises(ValueError):
        recorder.normalize([{"t": "navigate", "url": "x"}] * (recorder.MAX_EVENTS + 1))


@pytest.fixture()
def qc(client, session):
    make_qc(session, "qcflow")
    login(client, "qcflow")
    return client


def test_flow_to_pending_task_requires_qc_approval(qc, session):
    body = {"name": "Tạo phiếu (ghi)", "module_code": "MAINT", "start_url": "https://staging.example.com/maint", "events": EVENTS}
    r = qc.post("/api/v1/flows/recordings", json=body)
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["step_count"] == 3 and "Sup3r" not in r.text and "ctx.val" in rec["script_preview"]
    import uuid

    from app.domains.flows.models import FlowRecording
    row = session.get(FlowRecording, uuid.UUID(rec["id"]))
    assert "Sup3r-Secret" not in str(row.raw_events)  # bản thô cũng không giữ mật khẩu

    mk = qc.post(f"/api/v1/flows/recordings/{rec['id']}/create-task", json={"module_code": "MAINT"})
    assert mk.status_code == 201, mk.text
    tid = mk.json()["task_id"]
    cv = session.scalars(select(CodeVersion).where(CodeVersion.task_id == uuid.UUID(tid))).one()
    assert cv.status == "PENDING"  # code do recorder sinh ra vẫn phải chờ QC duyệt
    task = qc.get(f"/api/v1/automation/tasks/{tid}").json()
    assert task["runnable"] is False and sorted(p["key"] for p in task["params"]) == ["chon_2", "nhap_1"]
    assert qc.post(f"/api/v1/flows/recordings/{rec['id']}/create-task", json={"module_code": "MAINT"}).status_code == 409


def test_recording_validation(qc):
    bad = qc.post("/api/v1/flows/recordings", json={"name": "x", "start_url": "https://s.example.com", "events": [{"t": "navigate", "url": "u"}]})
    assert bad.status_code == 422  # không có thao tác dùng được
