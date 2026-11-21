from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("app")


class AppError(Exception):
    status = 400
    code = "BAD_REQUEST"

    def __init__(self, message: str, *, code: str | None = None, status: int | None = None, details=None):
        super().__init__(message)
        self.message = message
        if code:
            self.code = code
        if status:
            self.status = status
        self.details = details


class AuthRequired(AppError):
    status, code = 401, "AUTH_REQUIRED"


class PermissionDenied(AppError):
    status, code = 403, "PERMISSION_DENIED"


class NotFound(AppError):
    status, code = 404, "NOT_FOUND"


class Conflict(AppError):
    status, code = 409, "CONFLICT"


class PolicyBlocked(AppError):
    status, code = 403, "POLICY_BLOCKED"


def _body(request: Request, code: str, message: str, details=None) -> dict:
    cid = getattr(request.state, "correlation_id", None) or str(uuid.uuid4())
    return {"error": {"code": code, "message": message, "details": details, "correlation_id": cid}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        return JSONResponse(_body(request, exc.code, exc.message, exc.details), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        details = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        return JSONResponse(_body(request, "VALIDATION_ERROR", "Dữ liệu không hợp lệ", details), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        body = _body(request, "INTERNAL_ERROR", "Lỗi hệ thống")
        # chi tiết chỉ nằm trong log, kèm correlation_id; không trả err.message cho client
        log.exception("unhandled error cid=%s", body["error"]["correlation_id"])
        return JSONResponse(body, status_code=500)
