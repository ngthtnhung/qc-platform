from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import get_session
from app.core.deps import require
from app.core.errors import AppError
from app.core.principal import Perm, Principal
from app.domains.files import service
from app.domains.files.storage import StorageBackend, get_storage
from app.domains.platform.audit import log_audit
from app.domains.platform.schemas import FileOut

router = APIRouter(tags=["files"])


def storage_dep() -> StorageBackend:
    return get_storage()


@router.post("/files", response_model=FileOut, status_code=201)
async def upload(file: UploadFile = File(...), p: Principal = Depends(require(Perm.FILES_WRITE)),
                 session: Session = Depends(get_session), storage: StorageBackend = Depends(storage_dep)):
    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)  # đọc tối đa limit+1 để phát hiện vượt giới hạn mà không nạp cả file lớn
    if len(data) > limit:
        raise AppError("File vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
    rec = service.save_file(session, storage, data=data, name=file.filename or "tep", owner=p)
    log_audit(session, p, "FILE_UPLOAD", resource_type="file", resource_id=str(rec.id), after={"sha256": rec.sha256, "mime": rec.mime, "size": rec.size})
    return rec


@router.get("/files/{file_id}", response_model=FileOut)
def meta(file_id: uuid.UUID, _: Principal = Depends(require(Perm.FILES_READ)), session: Session = Depends(get_session)):
    return service.get_file(session, file_id)


@router.get("/files/{file_id}/download")
def download(file_id: uuid.UUID, _: Principal = Depends(require(Perm.FILES_READ)), session: Session = Depends(get_session),
             storage: StorageBackend = Depends(storage_dep)):
    rec = service.get_file(session, file_id)
    safe_name = rec.original_name.replace('"', "")
    return Response(storage.get(rec.storage_key), media_type=rec.mime,
                    headers={"Content-Disposition": f'attachment; filename="{safe_name}"', "X-Content-Type-Options": "nosniff"})
