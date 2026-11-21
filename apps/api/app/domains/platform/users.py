"""Quản lý người dùng. Mọi QC có quyền ngang nhau (kể cả tạo/vô hiệu QC khác)."""
from __future__ import annotations

import secrets
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import security
from app.core.errors import AppError, Conflict, NotFound
from app.core.principal import ROLE_QC, Principal
from app.domains.platform import auth as auth_service
from app.domains.platform.audit import log_audit
from app.domains.platform.models import User


def generate_temp_password() -> str:
    # đủ mạnh để qua policy; hiển thị MỘT lần cho người nhận rồi bắt buộc đổi
    return secrets.token_urlsafe(18)


def create_user(session: Session, *, actor: Principal | None, username: str, display_name: str, password: str | None = None,
                employee_code: str = "", email: str = "", legacy_id: str | None = None,
                must_change_password: bool = True) -> tuple[User, str]:
    uname = auth_service.normalize_username(username)
    if not uname or len(uname) > 64:
        raise AppError("Tên đăng nhập không hợp lệ", code="INVALID_USERNAME", status=422)
    if session.scalar(select(User).where(User.username == uname)):
        raise Conflict(f'Tài khoản "{uname}" đã tồn tại')
    pw = password
    if pw is None:  # mật khẩu tạm tự sinh: thử lại tới khi qua policy (hiếm khi cần)
        for _ in range(10):
            pw = generate_temp_password()
            try:
                security.validate_password_policy(pw, uname)
                break
            except security.WeakPassword:
                continue
    try:
        security.validate_password_policy(pw or "", uname)
    except security.WeakPassword as exc:
        raise AppError(str(exc), code="WEAK_PASSWORD", status=422) from exc
    user = User(username=uname, display_name=display_name.strip() or uname, employee_code=employee_code, email=email,
                password_hash=security.hash_password(pw), role=ROLE_QC, must_change_password=must_change_password, legacy_id=legacy_id)
    session.add(user)
    session.flush()
    log_audit(session, actor, "USER_CREATE", resource_type="user", resource_id=str(user.id),
              after={"username": uname, "role": ROLE_QC, "legacy_id": legacy_id})
    return user, pw


def active_count(session: Session) -> int:
    return session.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True))) or 0


def set_active(session: Session, *, actor: Principal, user_id: uuid.UUID, active: bool) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise NotFound("Không thấy người dùng")
    if not active and user.is_active and active_count(session) <= 1:
        raise Conflict("Không thể vô hiệu QC đang hoạt động cuối cùng")
    user.is_active = active
    if not active:
        auth_service.revoke_all_for_user(session, user.id)
    log_audit(session, actor, "USER_ACTIVATE" if active else "USER_DEACTIVATE", resource_type="user", resource_id=str(user.id))
    return user


def reset_password(session: Session, *, actor: Principal, user_id: uuid.UUID) -> tuple[User, str]:
    user = session.get(User, user_id)
    if user is None:
        raise NotFound("Không thấy người dùng")
    pw = generate_temp_password()
    user.password_hash = security.hash_password(pw)
    user.must_change_password = True
    user.failed_login_count, user.locked_until = 0, None
    auth_service.revoke_all_for_user(session, user.id)
    log_audit(session, actor, "USER_RESET_PASSWORD", resource_type="user", resource_id=str(user.id))
    return user, pw
