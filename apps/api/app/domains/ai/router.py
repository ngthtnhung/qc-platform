from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.deps import require
from app.core.principal import Perm, Principal
from app.domains.ai import service
from app.domains.files.storage import StorageBackend, get_storage

router = APIRouter(prefix="/ai", tags=["ai"])


class BugAnalysisIn(BaseModel):
    description: str = Field("", max_length=6000)
    lookup_id: uuid.UUID | None = None


class CodeIn(BaseModel):
    instruction: str = Field("", max_length=3000)
    execution_id: uuid.UUID | None = None
    error_text: str = Field("", max_length=10000)


@router.post("/bug-analysis")
def bug_analysis(body: BugAnalysisIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    """AI phân tích bug dựa trên các trích dẫn của một lần tra cứu. Kết quả là ĐỀ XUẤT chờ QC duyệt (mục Duyệt), không phải sự thật."""
    return service.analyze_bug(session, p, description=body.description, lookup_id=body.lookup_id)


@router.post("/tasks/{task_id}/suggest-code", status_code=201)
def suggest_code(task_id: uuid.UUID, body: CodeIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session),
                 storage: StorageBackend = Depends(lambda: get_storage())):
    """AI sửa/viết code: tạo PHIÊN BẢN MỚI (origin=ai) chờ QC duyệt. Không bao giờ tự chạy."""
    return service.suggest_code(session, p, storage, task_id=task_id, instruction=body.instruction, execution_id=body.execution_id, error_text=body.error_text)
