from __future__ import annotations

import base64
import os
import secrets

import pytest

# Cấu hình test: đặt TRƯỚC khi import app
os.environ.setdefault("APP_ENV", "test")
os.environ["JWT_SIGNING_KEY"] = "t" * 48
os.environ["SECRET_KEK"] = base64.b64encode(b"K" * 32).decode()
os.environ["PASSWORD_MIN_LENGTH"] = "12"
os.environ["LOGIN_MAX_FAILURES"] = "3"
os.environ["REDIS_URL"] = "redis://127.0.0.1:1/0"  # không có Redis trong test đơn vị

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from alembic import command  # noqa: E402
from app.core import config, db  # noqa: E402

STRONG = "Correct-Horse-Battery-9"


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 't.sqlite'}")
    monkeypatch.setenv("STORAGE_LOCAL_PATH", str(tmp_path / "storage"))
    config.get_settings.cache_clear()
    db.reset_engine()
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")  # kiểm thử luôn qua migration thật
    yield tmp_path
    db.reset_engine()
    config.get_settings.cache_clear()


@pytest.fixture()
def session(env):
    s = db.session_scope()
    yield s
    s.close()


@pytest.fixture()
def client(env):
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


def make_qc(session, username=None, password=STRONG):
    from app.domains.platform import users

    username = username or f"qc{secrets.token_hex(3)}"
    user, _ = users.create_user(session, actor=None, username=username, display_name=username.upper(),
                                password=password, must_change_password=False)
    session.commit()
    return user


def principal(user):
    from app.domains.platform.auth import principal_for

    return principal_for(user)


def login(client, username, password=STRONG):
    r = client.post("/api/v1/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    csrf = r.json()["csrf_token"]
    client.headers["X-CSRF-Token"] = csrf
    return r
