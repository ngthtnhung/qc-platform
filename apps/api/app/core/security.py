"""Mật khẩu (argon2id), JWT truy cập ngắn hạn, refresh token xoay vòng (lưu băm)."""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets
import uuid

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

_ph = PasswordHasher()  # argon2id mặc định, tham số theo khuyến nghị argon2-cffi

# Danh sách mật khẩu yếu tối thiểu (bao gồm mật khẩu mặc định cũ của hệ thống Node).
WEAK_PASSWORDS = {
    "123456", "123456789", "12345678", "password", "qwerty", "111111", "000000",
    "admin", "admin123", "matkhau", "123456789012", "passwordpassword",
}


class WeakPassword(ValueError):
    pass


def validate_password_policy(password: str, username: str | None = None) -> None:
    s = get_settings()
    if len(password) < s.password_min_length:
        raise WeakPassword(f"Mật khẩu phải có ít nhất {s.password_min_length} ký tự")
    low = password.lower()
    if low in WEAK_PASSWORDS or len(set(password)) < 5:
        raise WeakPassword("Mật khẩu quá dễ đoán")
    if username and len(username) >= 4 and username.lower() in low:
        raise WeakPassword("Mật khẩu không được chứa tên đăng nhập")


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    try:
        return _ph.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# Băm giả để thời gian phản hồi không lộ việc tồn tại tài khoản
_DUMMY_HASH = _ph.hash("dummy-password-for-timing")


def burn_verify(password: str) -> None:
    verify_password(_DUMMY_HASH, password)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(48)


def create_access_token(*, user_id: uuid.UUID, role: str, session_id: uuid.UUID) -> tuple[str, dt.datetime]:
    s = get_settings()
    now = dt.datetime.now(dt.timezone.utc)
    exp = now + dt.timedelta(minutes=s.access_token_minutes)
    token = jwt.encode(
        {"sub": str(user_id), "role": role, "sid": str(session_id), "iat": now, "exp": exp, "typ": "access"},
        s.jwt_signing_key,
        algorithm="HS256",
    )
    return token, exp


def decode_access_token(token: str) -> dict:
    s = get_settings()
    payload = jwt.decode(token, s.jwt_signing_key, algorithms=["HS256"], options={"require": ["exp", "sub", "sid"]})
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("wrong token type")
    return payload
