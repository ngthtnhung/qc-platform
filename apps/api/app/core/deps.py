"""Phụ thuộc FastAPI: xác thực (cookie HttpOnly hoặc Bearer), CSRF, kiểm tra quyền, correlation id."""
from __future__ import annotations

import hmac
import uuid
from collections.abc import Callable

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import AuthRequired, PermissionDenied
from app.core.principal import Perm, Principal

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
CSRF_COOKIE = "csrf_token"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def correlation_id(request: Request) -> str:
    return getattr(request.state, "correlation_id", "") or str(uuid.uuid4())


def client_ip(request: Request) -> str:
    return request.client.host if request.client else ""


def enforce_csrf(request: Request) -> None:
    """Double-submit: yêu cầu ghi dùng cookie phải kèm header X-CSRF-Token khớp cookie csrf_token."""
    if request.method not in UNSAFE:
        return
    cookie, header = request.cookies.get(CSRF_COOKIE, ""), request.headers.get("x-csrf-token", "")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise PermissionDenied("Thiếu hoặc sai CSRF token", code="CSRF_FAILED")


def current_principal(request: Request, session: Session = Depends(get_session)) -> Principal:
    from app.domains.platform.auth import authenticate_access

    bearer = request.headers.get("authorization", "")
    if bearer.lower().startswith("bearer "):
        token = bearer[7:].strip()  # dùng cho CLI/runner: không có CSRF vì không tự động gửi bởi trình duyệt
    else:
        token = request.cookies.get(ACCESS_COOKIE, "")
        if token:
            enforce_csrf(request)
    if not token:
        raise AuthRequired("Cần đăng nhập")
    principal = authenticate_access(session, token)
    request.state.principal = principal
    return principal


def require(perm: Perm) -> Callable[..., Principal]:
    def dep(principal: Principal = Depends(current_principal)) -> Principal:
        if not principal.has(perm):
            raise PermissionDenied("Không đủ quyền")
        return principal

    return dep
