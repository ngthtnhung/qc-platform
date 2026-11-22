"""Tải file: nhận dạng theo magic bytes (không tin đuôi file), giới hạn kích thước. Port từ `sniff` của bản Node."""
from __future__ import annotations

import hashlib
import re
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.core.principal import Principal
from app.domains.files.models import StoredFile
from app.domains.files.storage import StorageBackend, key_for

ZIP_TYPES = {
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "zip": "application/zip",
}
OLE_TYPES = {"doc": "application/msword", "xls": "application/vnd.ms-excel", "ppt": "application/vnd.ms-powerpoint"}
TEXT_TYPES = {"txt": "text/plain", "csv": "text/csv", "md": "text/markdown", "log": "text/plain", "html": "text/html", "htm": "text/html"}


def sniff(data: bytes, name: str = "") -> tuple[str, str] | None:
    m = re.search(r"\.([a-z0-9]{1,5})$", name.lower())
    ext = m.group(1) if m else ""
    h = data[:12]
    if h.startswith(b"\x89PNG"):
        return "image/png", "png"
    if h.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if h.startswith(b"GIF8"):
        return "image/gif", "gif"
    if h.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp", "webp"
    if h.startswith(b"BM"):
        return "image/bmp", "bmp"
    if data[:4] == b"%PDF":
        return "application/pdf", "pdf"
    if h.startswith(b"PK\x03\x04") and ext in ZIP_TYPES:
        return ZIP_TYPES[ext], ext
    if h.startswith(bytes.fromhex("d0cf11e0a1b11ae1")) and ext in OLE_TYPES:
        return OLE_TYPES[ext], ext
    if data[:5] == b"{\\rtf":
        return "application/rtf", "rtf"
    if len(data) >= 12 and data[4:8] == b"ftyp" and ext in ("mp4", "m4v", "mov"):
        return ("video/quicktime" if ext == "mov" else "video/mp4"), ext
    if h.startswith(b"\x1aE\xdf\xa3") and ext == "webm":
        return "video/webm", "webm"
    if ext in TEXT_TYPES and b"\x00" not in data[:8192]:
        return TEXT_TYPES[ext], ext
    return None


def _clean_name(name: str) -> str:
    base = name.replace("\\", "/").split("/")[-1]
    return re.sub(r"[^\w.\- ]", "_", base)[:100] or "tep"


def save_file(session: Session, storage: StorageBackend, *, data: bytes, name: str, owner: Principal, max_bytes: int | None = None) -> StoredFile:
    s = get_settings()
    if not data:
        raise AppError("File trống", code="FILE_EMPTY")
    if len(data) > (max_bytes or s.max_upload_bytes):
        raise AppError("File vượt quá giới hạn kích thước", code="FILE_TOO_LARGE", status=413)
    kind = sniff(data, name)
    if kind is None:
        raise AppError("Định dạng file không được hỗ trợ", code="FILE_TYPE_NOT_ALLOWED", status=415)
    sha = hashlib.sha256(data).hexdigest()
    key = key_for(sha)
    if not storage.exists(key):
        storage.put(key, data)
    rec = StoredFile(
        sha256=sha, size=len(data), mime=kind[0], original_name=_clean_name(name),
        storage_backend=storage.name, storage_key=key, owner_id=owner.id,
    )
    session.add(rec)
    session.flush()
    return rec


def get_file(session: Session, file_id: uuid.UUID) -> StoredFile:
    rec = session.scalar(select(StoredFile).where(StoredFile.id == file_id))
    if rec is None:
        raise NotFound("Không thấy file")
    return rec
