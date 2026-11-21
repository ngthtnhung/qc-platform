from __future__ import annotations

import logging
import uuid

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import install_error_handlers
from app.domains.files.router import router as files_router
from app.domains.platform.router import router as platform_router

SCHEMA_HEAD = "0001"  # revision Alembic mong đợi; /health so sánh với DB


def create_app() -> FastAPI:
    s = get_settings()
    logging.basicConfig(level=s.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    app = FastAPI(title="QC Platform API", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    install_error_handlers(app)
    if s.origins:
        app.add_middleware(CORSMiddleware, allow_origins=s.origins, allow_credentials=True,
                           allow_methods=["GET", "POST", "PUT", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token", "Authorization"])

    @app.middleware("http")
    async def _headers(request: Request, call_next):
        request.state.correlation_id = request.headers.get("x-correlation-id") or str(uuid.uuid4())
        response = await call_next(request)
        response.headers["X-Correlation-Id"] = request.state.correlation_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health", tags=["system"])
    def health(session: Session = Depends(get_session)):
        """Health THẬT: kiểm tra DB, phiên bản schema, Redis và storage (khác /api/v1/health của bản Node luôn trả CONNECTED)."""
        checks: dict[str, str] = {}
        try:
            session.execute(text("SELECT 1"))
            checks["database"] = "ok"
            try:
                rev = session.execute(text("SELECT version_num FROM alembic_version")).scalar()
                checks["schema"] = "ok" if rev == SCHEMA_HEAD else f"mismatch:{rev}"
            except Exception:  # noqa: BLE001
                session.rollback()
                checks["schema"] = "missing"
        except Exception:  # noqa: BLE001
            checks["database"] = "error"
        try:
            import redis

            redis.Redis.from_url(s.redis_url, socket_connect_timeout=1).ping()
            checks["redis"] = "ok"
        except Exception:  # noqa: BLE001
            checks["redis"] = "error"
        try:
            from app.domains.files.storage import get_storage

            st = get_storage()
            st.put("00/" + "0" * 64, b"health")
            checks["storage"] = "ok" if st.get("00/" + "0" * 64) == b"health" else "error"
        except Exception:  # noqa: BLE001
            checks["storage"] = "error"
        ok = all(v == "ok" for v in checks.values())
        return JSONResponse({"status": "ok" if ok else "unhealthy", "checks": checks}, status_code=200 if ok else 503)

    app.include_router(platform_router, prefix="/api/v1")
    app.include_router(files_router, prefix="/api/v1")
    return app
