import pytest
from sqlalchemy import select

from app.core.errors import AppError
from app.domains.platform import users
from app.domains.platform.models import AuditLog, AuthSession
from tests.conftest import STRONG, login, make_qc


def test_password_policy_rejects_legacy_default_and_short(session):
    for bad in ["123456", "short", "passwordpassword", "aaaaaaaaaaaaaaaa"]:
        with pytest.raises(AppError):
            users.create_user(session, actor=None, username="x1", display_name="X", password=bad)
    with pytest.raises(AppError):  # chứa tên đăng nhập
        users.create_user(session, actor=None, username="alice", display_name="A", password="alice-Is-Great-1")


def test_hash_is_argon2id_not_sha256(session):
    u = make_qc(session, "hashuser")
    assert u.password_hash.startswith("$argon2id$")


def test_login_sets_httponly_cookies_and_csrf_required(client, session):
    make_qc(session, "qcauth")
    r = client.post("/api/v1/auth/login", json={"username": "qcauth", "password": STRONG})
    assert r.status_code == 200
    set_cookie = " ".join(r.headers.get_list("set-cookie")).lower()
    assert "access_token=" in set_cookie and "httponly" in set_cookie and "samesite=strict" in set_cookie
    assert "access_token" not in r.json() and "refresh" not in str(r.json())
    client.headers.pop("X-CSRF-Token", None)  # có cookie nhưng thiếu header CSRF ⇒ ghi bị chặn
    assert client.post("/api/v1/users", json={"username": "n", "display_name": "N"}).status_code == 403
    client.headers["X-CSRF-Token"] = r.json()["csrf_token"]
    assert client.post("/api/v1/users", json={"username": "n", "display_name": "N"}).status_code == 201


def test_wrong_credentials_are_generic(client, session):
    make_qc(session, "qcgeneric")
    a = client.post("/api/v1/auth/login", json={"username": "qcgeneric", "password": "wrong-password-xx"})
    b = client.post("/api/v1/auth/login", json={"username": "nobody", "password": "wrong-password-xx"})
    assert a.status_code == b.status_code == 401
    assert a.json()["error"]["message"] == b.json()["error"]["message"]


def test_lockout_after_failures_even_with_correct_password(client, session):
    make_qc(session, "qclock")
    for _ in range(3):
        client.post("/api/v1/auth/login", json={"username": "qclock", "password": "bad-bad-bad-bad"})
    assert client.post("/api/v1/auth/login", json={"username": "qclock", "password": STRONG}).status_code == 401
    assert session.scalars(select(AuditLog).where(AuditLog.action == "LOGIN", AuditLog.decision == "DENY")).all()


def test_refresh_rotates_and_reuse_revokes_session(client, session):
    make_qc(session, "qcrefresh")
    login(client, "qcrefresh")
    old_refresh = client.cookies.get("refresh_token", path="/api/v1/auth")
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    client.headers["X-CSRF-Token"] = r.json()["csrf_token"]  # CSRF cũng xoay khi refresh
    new_refresh = client.cookies.get("refresh_token", path="/api/v1/auth")
    assert new_refresh and new_refresh != old_refresh
    client.cookies.set("refresh_token", old_refresh, path="/api/v1/auth")  # dùng lại token cũ ⇒ coi là bị đánh cắp
    assert client.post("/api/v1/auth/refresh").status_code == 401
    session.expire_all()
    assert all(s.revoked_at is not None for s in session.scalars(select(AuthSession)))
    assert client.get("/api/v1/auth/me").status_code == 401


def test_logout_revokes_session(client, session):
    make_qc(session, "qcout")
    login(client, "qcout")
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_change_password_revokes_other_sessions(client, session):
    from fastapi.testclient import TestClient

    from app.main import create_app

    make_qc(session, "qcchg")
    login(client, "qcchg")
    other = TestClient(create_app())
    login(other, "qcchg")
    r = client.post("/api/v1/auth/change-password", json={"current_password": STRONG, "new_password": "Another-Strong-Pass-7"})
    assert r.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 200
    assert other.get("/api/v1/auth/me").status_code == 401
    weak = client.post("/api/v1/auth/change-password", json={"current_password": "Another-Strong-Pass-7", "new_password": "123456"})
    assert weak.status_code == 422


def test_cannot_deactivate_last_active_qc(client, session):
    a, b = make_qc(session, "qca"), make_qc(session, "qcb")
    login(client, "qca")
    assert client.post(f"/api/v1/users/{b.id}/deactivate").status_code == 200
    assert client.post(f"/api/v1/users/{a.id}/deactivate").status_code == 409


def test_new_qc_has_same_rights_and_temp_password_forces_change(client, session):
    from fastapi.testclient import TestClient

    from app.main import create_app

    make_qc(session, "qcroot")
    login(client, "qcroot")
    created = client.post("/api/v1/users", json={"username": "QC Mới", "display_name": "QC Mới"}).json()
    assert created["user"]["role"] == "qc" and created["user"]["must_change_password"] is True
    c2 = TestClient(create_app())
    login(c2, created["user"]["username"], created["temporary_password"])
    assert c2.get("/api/v1/users").status_code == 200  # ngang quyền


def test_security_headers_and_error_shape(client):
    r = client.get("/api/v1/auth/me")
    body = r.json()["error"]
    assert r.status_code == 401 and body["code"] == "AUTH_REQUIRED" and body["correlation_id"]
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["cache-control"] == "no-store"


def test_forged_token_rejected(client, session):
    import jwt

    u = make_qc(session, "qcjwt")
    bad = jwt.encode({"sub": str(u.id), "sid": "00000000-0000-0000-0000-000000000000", "exp": 9999999999, "typ": "access"},
                     "x" * 48, algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {bad}"}).status_code == 401
