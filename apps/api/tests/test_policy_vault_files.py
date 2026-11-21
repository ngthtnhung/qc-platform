import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError, PermissionDenied, PolicyBlocked
from app.core.principal import AI_PRINCIPAL
from app.domains.files import service as files
from app.domains.files.storage import LocalStorage
from app.domains.platform import policy
from app.domains.platform.models import AuditLog, Environment
from app.domains.platform.vault import reveal_secret, store_secret
from tests.conftest import login, make_qc, principal

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


def _env(session, type_, actions, org=False):
    e = Environment(code=f"e-{type_.lower()}", name=type_, type=type_, base_url="https://x.example.com",
                    allowed_actions=actions, requires_org_confirmation=org)
    session.add(e)
    session.commit()
    return e


def test_policy_human_only_actions(session):
    env = _env(session, "STAGING", ["READ", "AUTOMATE"])
    for action in ("APPROVE", "CONFIRM_ORG", "TASK_WRITE"):
        with pytest.raises(PermissionDenied):
            policy.evaluate_action(session, actor=AI_PRINCIPAL, action=action, env=env)
    policy.evaluate_action(session, actor=principal(make_qc(session)), action="READ", env=env)


def test_policy_production_write_blocked_and_unlisted_action_denied(session):
    prod = _env(session, "PRODUCTION", ["*"])
    qc = principal(make_qc(session))
    with pytest.raises(PolicyBlocked):
        policy.evaluate_action(session, actor=qc, action="WRITE", env=prod)
    stg = _env(session, "STAGING", ["READ"])
    with pytest.raises(PolicyBlocked):
        policy.evaluate_action(session, actor=qc, action="AUTOMATE", env=stg)


def test_policy_production_test_needs_org_confirmation(session):
    env = _env(session, "PRODUCTION_TEST", ["READ"], org=True)
    qc = principal(make_qc(session))
    with pytest.raises(PolicyBlocked):
        policy.evaluate_action(session, actor=qc, action="READ", env=env)
    policy.evaluate_action(session, actor=qc, action="READ", env=env, state=policy.SessionState(org_confirmed=True))


def test_db_forces_org_confirmation_on_production_test(session):
    session.add(Environment(code="bad", name="b", type="PRODUCTION_TEST", base_url="https://x", requires_org_confirmation=False))
    with pytest.raises(IntegrityError):
        session.flush()
    session.rollback()


def test_vault_roundtrip_and_no_plaintext_in_db(session):
    qc = principal(make_qc(session))
    rec = store_secret(session, kind="account_password", plaintext="S3cret-Pass!", aad="account:1", actor=qc)
    session.commit()
    assert b"S3cret-Pass!" not in rec.ciphertext + rec.wrapped_dek
    assert reveal_secret(session, rec, actor=qc, purpose="test") == "S3cret-Pass!"
    assert session.scalars(select(AuditLog).where(AuditLog.action == "SECRET_READ")).all()


def test_vault_ai_cannot_reveal_and_tamper_detected(session):
    qc = principal(make_qc(session))
    rec = store_secret(session, kind="k", plaintext="abc", aad="account:2", actor=qc)
    session.commit()
    with pytest.raises(PermissionDenied):
        reveal_secret(session, rec, actor=AI_PRINCIPAL, purpose="x")
    rec.aad = "account:other"
    with pytest.raises(AppError):
        reveal_secret(session, rec, actor=qc, purpose="x")


def test_account_secret_api_never_returns_password_and_env_rule(client, session):
    make_qc(session, "qcvault")
    login(client, "qcvault")
    stg = client.post("/api/v1/environments", json={"code": "staging", "name": "Staging", "type": "STAGING",
                                                    "base_url": "https://s.example.com", "allowed_actions": ["READ"]}).json()
    prod = client.post("/api/v1/environments", json={"code": "prod", "name": "Prod", "type": "PRODUCTION",
                                                     "base_url": "https://p.example.com"}).json()
    acc = client.post("/api/v1/accounts", json={"environment_id": stg["id"], "name": "A", "username_ref": "a@x.com"}).json()
    assert client.put(f"/api/v1/accounts/{acc['id']}/secret", json={"password": "Pw-For-Staging-1"}).status_code == 204
    listed = client.get("/api/v1/accounts").json()
    assert listed[0]["has_secret"] is True and "Pw-For-Staging-1" not in str(listed)
    acc2 = client.post("/api/v1/accounts", json={"environment_id": prod["id"], "name": "P", "username_ref": "p@x.com"}).json()
    assert client.put(f"/api/v1/accounts/{acc2['id']}/secret", json={"password": "Pw-For-Prod-123"}).status_code == 409
    pt = client.post("/api/v1/environments", json={"code": "pt", "name": "PT", "type": "PRODUCTION_TEST",
                                                   "base_url": "https://t.example.com", "requires_org_confirmation": False}).json()
    assert pt["requires_org_confirmation"] is True


def test_file_sniffing_and_limits(session, env):
    st = LocalStorage(env / "s")
    qc = principal(make_qc(session))
    rec = files.save_file(session, st, data=PNG, name="../../evil.png", owner=qc)
    assert rec.mime == "image/png" and rec.original_name == "evil.png" and st.get(rec.storage_key) == PNG
    again = files.save_file(session, st, data=PNG, name="b.png", owner=qc)
    assert again.storage_key == rec.storage_key
    with pytest.raises(AppError):
        files.save_file(session, st, data=b"MZ\x90\x00 binary", name="x.exe", owner=qc)
    with pytest.raises(AppError):
        files.save_file(session, st, data=b"", name="e.png", owner=qc)
    with pytest.raises(ValueError):
        st.get("../../etc/passwd")


def test_file_upload_download_http(client, session):
    make_qc(session, "qcfile")
    login(client, "qcfile")
    r = client.post("/api/v1/files", files={"file": ("a.png", PNG, "image/png")})
    assert r.status_code == 201, r.text
    d = client.get(f"/api/v1/files/{r.json()['id']}/download")
    assert d.content == PNG and d.headers["x-content-type-options"] == "nosniff"
    assert client.post("/api/v1/files", files={"file": ("a.exe", b"MZ....", "application/octet-stream")}).status_code == 415


def test_audit_redaction(session):
    from app.domains.platform.audit import log_audit

    qc = principal(make_qc(session))
    row = log_audit(session, qc, "X", before={"password": "p", "ok": 1}, after={"note": "Bearer abcdefghijklmnop"},
                    reason="cookie: sid=abcdef123456")
    assert row.before == {"password": "[REDACTED]", "ok": 1}
    assert "abcdefghijklmnop" not in str(row.after) and "abcdef123456" not in row.reason


def test_migration_downgrade_and_upgrade_clean(env):
    from alembic.config import Config

    from alembic import command

    command.downgrade(Config("alembic.ini"), "base")
    command.upgrade(Config("alembic.ini"), "head")
