from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_session
from app.core.deps import (
    ACCESS_COOKIE,
    CSRF_COOKIE,
    REFRESH_COOKIE,
    client_ip,
    correlation_id,
    current_principal,
    enforce_csrf,
    require,
)
from app.core.errors import AuthRequired, Conflict, NotFound
from app.core.principal import Perm, Principal
from app.domains.platform import approvals as approval_service
from app.domains.platform import auth as auth_service
from app.domains.platform import users as user_service
from app.domains.platform.audit import log_audit
from app.domains.platform.models import Account, AiSuggestion, ApprovalRequest, AuditLog, Environment, User
from app.domains.platform.schemas import (
    AccountIn,
    AccountOut,
    AccountUpdateIn,
    AiSuggestionOut,
    ApprovalOut,
    AuditOut,
    BulkDecisionIn,
    BulkResult,
    ChangePasswordIn,
    DecisionIn,
    EnvironmentIn,
    EnvironmentOut,
    EnvironmentUpdateIn,
    LoginIn,
    LoginOut,
    SecretIn,
    UserCreatedOut,
    UserCreateIn,
    UserOut,
)
from app.domains.platform.vault import store_secret

router = APIRouter()


# ---------------------------------------------------------------- cookies
def _set_auth_cookies(response: Response, tokens: auth_service.IssuedTokens) -> str:
    s = get_settings()
    csrf = secrets.token_urlsafe(32)
    common = {"secure": s.cookie_secure, "samesite": "strict"}
    response.set_cookie(ACCESS_COOKIE, tokens.access, httponly=True, path="/", max_age=s.access_token_minutes * 60, **common)
    response.set_cookie(REFRESH_COOKIE, tokens.refresh, httponly=True, path="/api/v1/auth", max_age=s.refresh_token_days * 86400, **common)
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, path="/", max_age=s.refresh_token_days * 86400, **common)
    return csrf


def _clear_auth_cookies(response: Response) -> None:
    for name, path in ((ACCESS_COOKIE, "/"), (REFRESH_COOKIE, "/api/v1/auth"), (CSRF_COOKIE, "/")):
        response.delete_cookie(name, path=path)


# ---------------------------------------------------------------- auth
@router.post("/auth/login", response_model=LoginOut, tags=["auth"])
def login(body: LoginIn, request: Request, response: Response, session: Session = Depends(get_session)):
    tokens = auth_service.login(session, username=body.username, password=body.password,
                                ua=request.headers.get("user-agent", ""), ip=client_ip(request), correlation_id=correlation_id(request))
    csrf = _set_auth_cookies(response, tokens)
    return LoginOut(user=UserOut.model_validate(tokens.user), csrf_token=csrf)


@router.post("/auth/refresh", response_model=LoginOut, tags=["auth"])
def refresh(request: Request, response: Response, session: Session = Depends(get_session)):
    enforce_csrf(request)
    token = request.cookies.get(REFRESH_COOKIE, "")
    if not token:
        raise AuthRequired("Thiếu refresh token")
    tokens = auth_service.refresh(session, refresh_token=token, ua=request.headers.get("user-agent", ""),
                                  ip=client_ip(request), correlation_id=correlation_id(request))
    csrf = _set_auth_cookies(response, tokens)
    return LoginOut(user=UserOut.model_validate(tokens.user), csrf_token=csrf)


@router.post("/auth/logout", status_code=204, tags=["auth"])
def logout(response: Response, principal: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    auth_service.logout(session, session_id=principal.session_id)
    log_audit(session, principal, "LOGOUT", resource_type="user", resource_id=str(principal.id))
    _clear_auth_cookies(response)


@router.get("/auth/me", response_model=UserOut, tags=["auth"])
def me(principal: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return session.get(User, principal.id)


@router.patch("/auth/me", response_model=UserOut, tags=["auth"])
def update_me(body: dict, principal: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    user = session.get(User, principal.id)
    if user is None:
        raise NotFound("Không thấy tài khoản")
    if "display_name" in body and str(body["display_name"] or "").strip():
        user.display_name = str(body["display_name"]).strip()[:120]
    if "employee_code" in body:
        user.employee_code = str(body["employee_code"] or "").strip()[:40]
    if "email" in body:
        user.email = str(body["email"] or "").strip()[:160]
    log_audit(session, principal, "PROFILE_UPDATE", resource_type="user", resource_id=str(user.id))
    return user


@router.post("/auth/change-password", status_code=204, tags=["auth"])
def change_password(body: ChangePasswordIn, request: Request, principal: Principal = Depends(current_principal),
                    session: Session = Depends(get_session)):
    user = session.get(User, principal.id)
    auth_service.change_password(session, user=user, current=body.current_password, new=body.new_password, keep_session=principal.session_id)
    log_audit(session, principal, "PASSWORD_CHANGE", resource_type="user", resource_id=str(user.id),
              correlation_id=correlation_id(request), ip=client_ip(request))


# ---------------------------------------------------------------- users (mọi QC ngang quyền)
@router.get("/users", response_model=list[UserOut], tags=["users"])
def list_users(_: Principal = Depends(require(Perm.USERS_MANAGE)), session: Session = Depends(get_session)):
    return list(session.scalars(select(User).order_by(User.username)))


@router.post("/users", response_model=UserCreatedOut, status_code=201, tags=["users"])
def create_user(body: UserCreateIn, p: Principal = Depends(require(Perm.USERS_MANAGE)), session: Session = Depends(get_session)):
    user, pw = user_service.create_user(session, actor=p, username=body.username, display_name=body.display_name,
                                        employee_code=body.employee_code, email=body.email)
    return UserCreatedOut(user=UserOut.model_validate(user), temporary_password=pw)


@router.post("/users/{user_id}/deactivate", response_model=UserOut, tags=["users"])
def deactivate(user_id: uuid.UUID, p: Principal = Depends(require(Perm.USERS_MANAGE)), session: Session = Depends(get_session)):
    return user_service.set_active(session, actor=p, user_id=user_id, active=False)


@router.post("/users/{user_id}/activate", response_model=UserOut, tags=["users"])
def activate(user_id: uuid.UUID, p: Principal = Depends(require(Perm.USERS_MANAGE)), session: Session = Depends(get_session)):
    return user_service.set_active(session, actor=p, user_id=user_id, active=True)


@router.post("/users/{user_id}/reset-password", response_model=UserCreatedOut, tags=["users"])
def reset_password(user_id: uuid.UUID, p: Principal = Depends(require(Perm.USERS_MANAGE)), session: Session = Depends(get_session)):
    user, pw = user_service.reset_password(session, actor=p, user_id=user_id)
    return UserCreatedOut(user=UserOut.model_validate(user), temporary_password=pw)


# ---------------------------------------------------------------- approvals
@router.get("/approvals", response_model=list[ApprovalOut], tags=["approvals"])
def list_approvals(status: str | None = None, origin: str | None = None, limit: int = 100,
                   _: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    return approval_service.list_requests(session, status=status, origin=origin, limit=limit)


@router.get("/approvals/{approval_id}", response_model=ApprovalOut, tags=["approvals"])
def get_approval(approval_id: uuid.UUID, _: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    req = session.get(ApprovalRequest, approval_id)
    if req is None:
        raise NotFound("Không thấy yêu cầu duyệt")
    return req


@router.post("/approvals/{approval_id}/decision", response_model=ApprovalOut, tags=["approvals"])
def decide(approval_id: uuid.UUID, body: DecisionIn, request: Request, principal: Principal = Depends(current_principal),
           session: Session = Depends(get_session)):
    # Không dùng require(APPROVE): để service tự ghi audit DENY khi chủ thể không phải QC
    return approval_service.decide(session, actor=principal, request_id=approval_id, approve=body.decision == "approve",
                                   payload_hash=body.payload_hash, note=body.note,
                                   correlation_id=correlation_id(request), ip=client_ip(request))


@router.post("/approvals/bulk-decision", response_model=list[BulkResult], tags=["approvals"])
def bulk_decide(body: BulkDecisionIn, request: Request, principal: Principal = Depends(require(Perm.APPROVE)),
                session: Session = Depends(get_session)):
    """Duyệt/từ chối nhiều mục (ví dụ rule nhập từ Kho). Mỗi mục vẫn phải kèm đúng payload_hash của bản QC đã đọc;
    từng mục độc lập: mục lỗi không làm hỏng mục khác."""
    from app.core.errors import AppError

    out: list[BulkResult] = []
    for item in body.items:
        try:
            with session.begin_nested():
                req = approval_service.decide(session, actor=principal, request_id=item.id, approve=body.decision == "approve",
                                              payload_hash=item.payload_hash, note=body.note,
                                              correlation_id=correlation_id(request), ip=client_ip(request))
            out.append(BulkResult(id=item.id, ok=True, status=req.status))
        except AppError as exc:
            out.append(BulkResult(id=item.id, ok=False, error=exc.message))
    return out


@router.get("/ai-suggestions", response_model=list[AiSuggestionOut], tags=["approvals"])
def list_suggestions(status: str | None = None, kind: str | None = None, limit: int = 100,
                     _: Principal = Depends(require(Perm.AI_SUGGESTION_READ)), session: Session = Depends(get_session)):
    q = select(AiSuggestion).order_by(AiSuggestion.created_at.desc()).limit(min(limit, 500))
    if status:
        q = q.where(AiSuggestion.status == status)
    if kind:
        q = q.where(AiSuggestion.kind == kind)
    return list(session.scalars(q))


# ---------------------------------------------------------------- environments / accounts
@router.get("/environments", response_model=list[EnvironmentOut], tags=["environments"])
def list_envs(_: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    return list(session.scalars(select(Environment).where(Environment.is_active.is_(True)).order_by(Environment.name)))


@router.post("/environments", response_model=EnvironmentOut, status_code=201, tags=["environments"])
def create_env(body: EnvironmentIn, p: Principal = Depends(require(Perm.ENV_MANAGE)), session: Session = Depends(get_session)):
    import re
    from app.core.text import fold

    data = body.model_dump()
    code = (data.get("code") or "").strip().lower()
    if not code:
        base_slug = re.sub(r"[^a-z0-9]+", "-", fold(body.name)).strip("-")[:50] or "env"
        code = base_slug
        n = 2
        while session.scalar(select(Environment).where(Environment.code == code)):
            code = f"{base_slug[:50]}-{n}"
            n += 1
        data["code"] = code
    elif session.scalar(select(Environment).where(Environment.code == code)):
        raise Conflict("Mã môi trường đã tồn tại")
    if data["type"] == "PRODUCTION_TEST":
        data["requires_org_confirmation"] = True  # luật cứng
    env = Environment(**data)
    session.add(env)
    session.flush()
    log_audit(session, p, "ENV_CREATE", resource_type="environment", resource_id=str(env.id), after=data)
    return env


@router.patch("/environments/{env_id}", response_model=EnvironmentOut, tags=["environments"])
def update_env(env_id: uuid.UUID, body: EnvironmentUpdateIn, p: Principal = Depends(require(Perm.ENV_MANAGE)), session: Session = Depends(get_session)):
    env = session.get(Environment, env_id)
    if env is None or not env.is_active:
        raise NotFound("Không thấy môi trường")
    before = {"name": env.name, "type": env.type, "base_url": env.base_url, "org_identifier": env.org_identifier}
    if body.name is not None:
        env.name = body.name.strip()
    if body.type is not None:
        env.type = body.type
        env.requires_org_confirmation = body.type == "PRODUCTION_TEST"
    if body.base_url is not None:
        env.base_url = body.base_url.strip()
    if body.org_identifier is not None:
        env.org_identifier = body.org_identifier.strip()
    session.flush()
    after = {"name": env.name, "type": env.type, "base_url": env.base_url, "org_identifier": env.org_identifier}
    log_audit(session, p, "ENV_UPDATE", resource_type="environment", resource_id=str(env.id), before=before, after=after)
    return env


@router.delete("/environments/{env_id}", status_code=204, tags=["environments"])
def delete_env(env_id: uuid.UUID, p: Principal = Depends(require(Perm.ENV_MANAGE)), session: Session = Depends(get_session)):
    from app.domains.automation.models import Execution

    env = session.get(Environment, env_id)
    if env is None or not env.is_active:
        raise NotFound("Không thấy môi trường")
    accs = list(session.scalars(select(Account).where(Account.environment_id == env.id)))
    acc_ids = [a.id for a in accs]
    has_exec = bool(acc_ids and session.scalar(select(Execution.id).where(Execution.account_id.in_(acc_ids)).limit(1)))
    before = {"name": env.name, "type": env.type, "base_url": env.base_url}
    if has_exec:
        env.is_active = False
        for a in accs:
            a.is_active = False
    else:
        for a in accs:
            session.delete(a)
        session.flush()
        session.delete(env)
    session.flush()
    log_audit(session, p, "ENV_DELETE", resource_type="environment", resource_id=str(env_id), before=before)


def _account_out(acc: Account) -> AccountOut:
    out = AccountOut.model_validate(acc)
    out.has_secret = acc.secret_id is not None
    return out


@router.get("/accounts", response_model=list[AccountOut], tags=["accounts"])
def list_accounts(environment_id: uuid.UUID | None = None, _: Principal = Depends(current_principal),
                  session: Session = Depends(get_session)):
    q = (
        select(Account)
        .join(Environment, Environment.id == Account.environment_id)
        .where(Account.is_active.is_(True), Environment.is_active.is_(True))
        .order_by(Account.name)
    )
    if environment_id:
        q = q.where(Account.environment_id == environment_id)
    return [_account_out(a) for a in session.scalars(q)]


def _clean_routes(routes: list[dict] | None) -> list[dict]:
    out: list[dict] = []
    for r in routes or []:
        if not isinstance(r, dict):
            continue
        url = str(r.get("url") or "").strip()
        if not url:
            continue
        label = str(r.get("label") or "").strip()
        out.append({"label": label, "url": url})
    return out


@router.post("/accounts", response_model=AccountOut, status_code=201, tags=["accounts"])
def create_account(body: AccountIn, p: Principal = Depends(require(Perm.ENV_MANAGE)), session: Session = Depends(get_session)):
    env = session.get(Environment, body.environment_id)
    if env is None or not env.is_active:
        raise NotFound("Không thấy môi trường")
    cleaned_routes = _clean_routes(body.routes)
    default_route = body.default_route.strip() or (cleaned_routes[0]["url"] if cleaned_routes else "")
    existing = session.scalar(
        select(Account).where(Account.environment_id == body.environment_id, Account.username_ref == body.username_ref)
    )
    if existing is not None:
        if not existing.is_active:
            existing.is_active = True
            existing.name = body.name
            existing.role_label = body.role_label
            existing.routes = cleaned_routes
            existing.default_route = default_route
            existing.owner_user_id = p.id
            session.flush()
            log_audit(session, p, "ACCOUNT_CREATE", resource_type="account", resource_id=str(existing.id),
                      after={**body.model_dump(mode="json"), "routes": cleaned_routes, "default_route": default_route})
            return _account_out(existing)
        raise Conflict("Tài khoản này đã tồn tại trong môi trường")
    data = body.model_dump()
    data["routes"] = cleaned_routes
    data["default_route"] = default_route
    acc = Account(**data, owner_user_id=p.id)
    session.add(acc)
    try:
        session.flush()
    except Exception as exc:  # noqa: BLE001
        raise Conflict("Tài khoản này đã tồn tại trong môi trường") from exc
    log_audit(session, p, "ACCOUNT_CREATE", resource_type="account", resource_id=str(acc.id),
              after={**body.model_dump(mode="json"), "routes": cleaned_routes, "default_route": default_route})
    return _account_out(acc)


@router.patch("/accounts/{account_id}", response_model=AccountOut, tags=["accounts"])
def update_account(account_id: uuid.UUID, body: AccountUpdateIn, p: Principal = Depends(require(Perm.ENV_MANAGE)), session: Session = Depends(get_session)):
    acc = session.get(Account, account_id)
    if acc is None or not acc.is_active:
        raise NotFound("Không thấy tài khoản")
    before = {"name": acc.name, "username_ref": acc.username_ref, "role_label": acc.role_label, "routes": acc.routes}
    if body.name is not None:
        acc.name = body.name.strip()
    if body.username_ref is not None:
        acc.username_ref = body.username_ref.strip()
    if body.role_label is not None:
        acc.role_label = body.role_label.strip()
    if body.routes is not None:
        acc.routes = _clean_routes(body.routes)
        if body.default_route is None:
            acc.default_route = acc.routes[0]["url"] if acc.routes else ""
    if body.default_route is not None:
        acc.default_route = body.default_route.strip()
    try:
        session.flush()
    except Exception as exc:  # noqa: BLE001
        raise Conflict("Tên đăng nhập này đã tồn tại trong môi trường") from exc
    after = {"name": acc.name, "username_ref": acc.username_ref, "role_label": acc.role_label, "routes": acc.routes}
    log_audit(session, p, "ACCOUNT_UPDATE", resource_type="account", resource_id=str(acc.id), before=before, after=after)
    return _account_out(acc)


@router.delete("/accounts/{account_id}", status_code=204, tags=["accounts"])
def delete_account(account_id: uuid.UUID, p: Principal = Depends(require(Perm.ENV_MANAGE)), session: Session = Depends(get_session)):
    from app.domains.automation.models import Execution

    acc = session.get(Account, account_id)
    if acc is None or not acc.is_active:
        raise NotFound("Không thấy tài khoản")
    has_exec = bool(session.scalar(select(Execution.id).where(Execution.account_id == acc.id).limit(1)))
    before = {"name": acc.name, "username_ref": acc.username_ref}
    if has_exec:
        acc.is_active = False
    else:
        session.delete(acc)
    session.flush()
    log_audit(session, p, "ACCOUNT_DELETE", resource_type="account", resource_id=str(account_id), before=before)


@router.put("/accounts/{account_id}/secret", status_code=204, tags=["accounts"])
def set_account_secret(account_id: uuid.UUID, body: SecretIn, p: Principal = Depends(require(Perm.SECRET_WRITE)),
                       session: Session = Depends(get_session)):
    """Chỉ ghi. Không có API nào trả mật khẩu về giao diện."""
    acc = session.get(Account, account_id)
    if acc is None:
        raise NotFound("Không thấy tài khoản")
    env = session.get(Environment, acc.environment_id)
    if env is None or env.type not in ("STAGING", "PRODUCTION_TEST"):
        raise Conflict("Chỉ lưu mật khẩu cho tài khoản Staging và Production OrgID DEMO", code="SECRET_ENV_NOT_ALLOWED")
    rec = store_secret(session, kind="account_password", plaintext=body.password, aad=f"account:{acc.id}", actor=p, secret_id=acc.secret_id)
    acc.secret_id = rec.id


# ---------------------------------------------------------------- audit
@router.get("/audit-logs", response_model=list[AuditOut], tags=["audit"])
def audit_logs(action: str | None = None, limit: int = 100, _: Principal = Depends(require(Perm.AUDIT_READ)),
               session: Session = Depends(get_session)):
    q = select(AuditLog).order_by(AuditLog.at.desc()).limit(min(limit, 500))
    if action:
        q = q.where(AuditLog.action == action)
    return list(session.scalars(q))
