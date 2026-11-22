from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.deps import current_principal
from app.core.errors import NotFound
from app.core.principal import Principal
from app.domains.platform.models import Job

router = APIRouter(tags=["jobs"])


@router.get("/jobs/{job_id}")
def get_job(job_id: uuid.UUID, _: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    j = session.get(Job, job_id)
    if j is None:
        raise NotFound("Không thấy tác vụ nền")
    return {"id": str(j.id), "kind": j.kind, "status": j.status, "result": j.result, "created_at": j.created_at.isoformat(),
            "finished_at": j.finished_at.isoformat() if j.finished_at else None}
