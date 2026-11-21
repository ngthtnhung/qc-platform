import json

from sqlalchemy import select

from app import cli
from app.domains.platform.models import User


def _legacy(tmp_path):
    data = {"team_users": [
        {"id": "tea_1", "display_name": "Nguyễn Thị Nhung", "username": "nhung", "role": "admin", "password_hash": "x", "session_token": "qa_secret_should_not_be_imported_12345", "is_active": 1},
        {"id": "tea_2", "display_name": "Lê Văn Khánh", "role": "member", "is_active": 1},
        {"id": "tea_3", "display_name": "Cũ Nghỉ", "username": "cunghi", "role": "member", "is_active": 0},
        {"id": "tea_4", "display_name": "", "is_active": 1},
    ]}
    p = tmp_path / "legacy.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return p


def test_dry_run_changes_nothing(env, session, capsys):
    src = _legacy(env)
    before = src.read_bytes()
    assert cli.main(["import-legacy-users", "--source", str(src)]) == 0
    assert session.scalars(select(User)).all() == []
    assert src.read_bytes() == before  # nguồn không bị đụng
    assert "CHẠY KHÔ" in capsys.readouterr().out


def test_apply_maps_everyone_to_qc_is_idempotent_and_ignores_old_secrets(env, session, capsys):
    src = _legacy(env)
    assert cli.main(["import-legacy-users", "--source", str(src), "--apply"]) == 0
    out = capsys.readouterr().out
    assert "qa_secret_should_not_be_imported" not in out
    session.expire_all()
    rows = {u.legacy_id: u for u in session.scalars(select(User))}
    assert set(rows) == {"tea_1", "tea_2", "tea_3"}  # tea_4 không có tên ⇒ bỏ qua
    assert all(u.role == "qc" and u.must_change_password for u in rows.values())
    assert rows["tea_3"].is_active is False
    assert rows["tea_2"].username == "levankhanh"
    assert cli.main(["import-legacy-users", "--source", str(src), "--apply"]) == 0  # chạy lại không tạo trùng
    session.expire_all()
    assert len(session.scalars(select(User)).all()) == 3
