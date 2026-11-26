from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.deps import current_principal, require
from app.core.principal import Perm, Principal
from app.domains.ai import service
from app.domains.files.storage import StorageBackend, get_storage

router = APIRouter(prefix="/ai", tags=["ai"])


class FlowSuggestIn(BaseModel):
    description: str = Field(..., min_length=4, max_length=6000)
    module: str = ""


class BugAnalysisIn(BaseModel):
    description: str = Field("", max_length=6000)
    lookup_id: uuid.UUID | None = None


class CodeIn(BaseModel):
    instruction: str = Field("", max_length=3000)
    execution_id: uuid.UUID | None = None
    error_text: str = Field("", max_length=10000)


class CodegenNormalizeIn(BaseModel):
    raw_code: str = Field(..., min_length=5, max_length=120000)
    module_code: str = Field("", max_length=40)
    flow_code: str = Field("", max_length=60)
    note: str = Field("", max_length=4000)
    use_ai: bool = True


@router.post("/suggest-flow")
def suggest_flow(body: FlowSuggestIn, p: Principal = Depends(current_principal), session: Session = Depends(get_session)):
    """AI xác định tên chức năng / luồng ứng dụng liên quan trước khi tra cứu từ khóa."""
    return service.suggest_flow(session, p, description=body.description, module=body.module)


@router.post("/bug-analysis")
def bug_analysis(body: BugAnalysisIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    """AI phân tích bug dựa trên các trích dẫn của một lần tra cứu. Kết quả là ĐỀ XUẤT chờ QC duyệt (mục Duyệt), không phải sự thật."""
    return service.analyze_bug(session, p, description=body.description, lookup_id=body.lookup_id)


@router.post("/tasks/{task_id}/suggest-code", status_code=201)
def suggest_code(task_id: uuid.UUID, body: CodeIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session),
                 storage: StorageBackend = Depends(lambda: get_storage())):
    """AI sửa/viết code: tạo PHIÊN BẢN MỚI (origin=ai) chờ QC duyệt. Không bao giờ tự chạy."""
    return service.suggest_code(session, p, storage, task_id=task_id, instruction=body.instruction, execution_id=body.execution_id, error_text=body.error_text)


@router.post("/codegen/normalize")
def normalize_codegen(body: CodegenNormalizeIn, p: Principal = Depends(require(Perm.APPROVE)), session: Session = Depends(get_session)):
    """Tiền xử lý + AI chuẩn hóa mã `playwright codegen` thành các luồng nghiệp vụ tách biệt kèm 5 nhóm đầu vào chuẩn."""
    return service.normalize_codegen(
        session,
        p,
        raw_code=body.raw_code,
        module_code=body.module_code,
        flow_code=body.flow_code,
        note=body.note,
        use_ai=body.use_ai,
    )
