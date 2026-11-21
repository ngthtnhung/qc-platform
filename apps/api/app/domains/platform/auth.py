"""Đăng nhập, phiên, refresh xoay vòng, khóa tạm thời khi sai nhiều lần."""
from __future__ import annotations

import datetime as dt
import re
import unicodedata
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import AppError, AuthRequired
from app.core.principal import Principal, PrincipalType
from app.domains.platform.audit import log_audit
from app.domains.platform.models import AuthSession, User


def normalize_username(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("đ", "d").replace("Đ", "d")
    return re.sub(r"\s+", "", s.lower().strip())


@dataclass
class IssuedTokens:
    access: str
    access_expires: dt.datetime
    refresh: str
    refresh_expires: dt.datetime
    user: User
    session_id: uuid.UUID


def _aware(d: dt.datetime) -> dt.datetime:
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


def principal_for(user: User, session_id: uuid.UUID | None = None) -> Principal:
    return Principal(type=PrincipalType.USER, id=user.id, role=user.role, username=user.username, session_id=session_id)


def _issue(session: Session, user: User, sess: AuthSession | None, *, ua: str, ip: str) -> IssuedTokens:
    s = get_settings()
    refresh = security.new_opaque_token()
    expires = utcnow() + dt.timedelta(days=s.refresh_token_days)
    if sess is None:
        sess = AuthSession(user_id=user.id, refresh_hash=security.sha256_hex(refresh), expires_at=expires,
                           user_agent=ua[:300], ip=ip)
        session.add(sess)
    else:
        sess.prev_refresh_hash = sess.refresh_hash
        sess.refresh_hash = security.sha256_hex(refresh)
        sess.expires_at = expires
        sess.last_used_at = utcnow()
    session.flush()
    access, aexp = security.create_access_token(user_id=user.id, role=user.role, session_id=sess.id)
    return IssuedTokens(access, aexp, refresh, expires, user, sess.id)


def login(session: Session, *, username: str, password: str, ua: str = "", ip: str = "", correlation_id: str = "") -> IssuedTokens:
    s = get_settings()
    uname = normalize_username(username)
    user = session.scalar(select(User).where(User.username == uname))
    generic = AuthRequired("Tài khoản hoặc mật khẩu không đúng", code="INVALID_CREDENTIALS")

    def fail(reason: str, actor: User | None):
        log_audit(session, principal_for(actor) if actor else None, "LOGIN", resource_type="user",
                  resource_id=str(actor.id) if actor else uname, decision="DENY", reason=reason, correlation_id=correlation_id, ip=ip)
        session.commit()  # giữ lại bộ đếm sai + audit dù request trả lỗi
        raise generic

    if user is None or not user.is_active:
        security.burn_verify(password)
        fail("unknown or inactive user", None)
    assert user is not None
    now = utcnow()
    if user.locked_until and _aware(user.locked_until) > now:
        security.burn_verify(password)
        fail("account locked", user)
    if not security.verify_password(user.password_hash, password):
        user.failed_login_count += 1
        if user.failed_login_count >= s.login_max_failures:
            user.locked_until = now + dt.timedelta(minutes=s.login_lock_minutes)
            user.failed_login_count = 0
        fail("bad password", user)
    user.failed_login_count, user.locked_until, user.last_login_at = 0, None, now
    if security.needs_rehash(user.password_hash):
        user.password_hash = security.hash_password(password)
    tokens = _issue(session, user, None, ua=ua, ip=ip)
    log_audit(session, principal_for(user, tokens.session_id), "LOGIN", resource_type="user", resource_id=str(user.id),
              correlation_id=correlation_id, ip=ip)
    return tokens


def refresh(session: Session, *, refresh_token: str, ua: str = "", ip: str = "", correlation_id: str = "") -> IssuedTokens:
    h = security.sha256_hex(refresh_token)
    sess = session.scalar(select(AuthSession).where(AuthSession.refresh_hash == h))
    if sess is None:
        # có thể là refresh token cũ bị dùng lại ⇒ thu hồi cả phiên
        reused = session.scalar(select(AuthSession).where(AuthSession.prev_refresh_hash == h))
        if reused is not None and reused.revoked_at is None:
            reused.revoked_at = utcnow()
            log_audit(session, None, "SESSION_REUSE_DETECTED", resource_type="session", resource_id=str(reused.id),
                      decision="DENY", reason="refresh token reuse", correlation_id=correlation_id, ip=ip)
            session.commit()
        raise AuthRequired("Phiên không hợp lệ", code="INVALID_SESSION")
    if sess.revoked_at is not None or _aware(sess.expires_at) < utcnow():
        raise AuthRequired("Phiên đã hết hạn", code="SESSION_EXPIRED")
    user = session.get(User, sess.user_id)
    if user is None or not user.is_active:
        raise AuthRequired("Tài khoản không hoạt động", code="INVALID_SESSION")
    return _issue(session, user, sess, ua=ua, ip=ip)


def logout(session: Session, *, session_id: uuid.UUID | None) -> None:
    if session_id is None:
        return
    sess = session.get(AuthSession, session_id)
    if sess and sess.revoked_at is None:
        sess.revoked_at = utcnow()


def revoke_all_for_user(session: Session, user_id: uuid.UUID) -> int:
    n = 0
    for sess in session.scalars(select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))):
        sess.revoked_at = utcnow()
        n += 1
    return n


def authenticate_access(session: Session, token: str) -> Principal:
    import jwt

    try:
        payload = security.decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise AuthRequired("Token không hợp lệ hoặc đã hết hạn", code="INVALID_TOKEN") from exc
    sess = session.get(AuthSession, uuid.UUID(payload["sid"]))
    if sess is None or sess.revoked_at is not None or _aware(sess.expires_at) < utcnow():
        raise AuthRequired("Phiên đã bị thu hồi", code="SESSION_REVOKED")
    user = session.get(User, uuid.UUID(payload["sub"]))
    if user is None or not user.is_active:
        raise AuthRequired("Tài khoản không hoạt động", code="INVALID_TOKEN")
    return principal_for(user, sess.id)


def change_password(session: Session, *, user: User, current: str, new: str, keep_session: uuid.UUID | None) -> None:
    if not security.verify_password(user.password_hash, current):
        raise AppError("Mật khẩu hiện tại không đúng", code="INVALID_CREDENTIALS", status=400)
    try:
        security.validate_password_policy(new, user.username)
    except security.WeakPassword as exc:
        raise AppError(str(exc), code="WEAK_PASSWORD", status=422) from exc
    if security.verify_password(user.password_hash, new):
        raise AppError("Mật khẩu mới phải khác mật khẩu cũ", code="WEAK_PASSWORD", status=422)
    user.password_hash = security.hash_password(new)
    user.must_change_password = False
    for sess in session.scalars(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))):
        if sess.id != keep_session:
            sess.revoked_at = utcnow()
