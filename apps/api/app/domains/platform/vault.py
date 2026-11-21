"""Vault mã hóa phong bì (AES-256-GCM): DEK ngẫu nhiên mỗi bí mật, DEK bọc bằng KEK từ biến môi trường.
Không phụ thuộc DPAPI/Windows. Chỉ ghi qua API; đọc rõ chỉ qua `reveal` (nội bộ, luôn ghi audit)."""
from __future__ import annotations

import os
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AppError, PermissionDenied
from app.core.principal import Principal, PrincipalType
from app.domains.platform.audit import log_audit
from app.domains.platform.models import Secret

KEY_VERSION = 1


def store_secret(session: Session, *, kind: str, plaintext: str, aad: str, actor: Principal, secret_id: uuid.UUID | None = None) -> Secret:
    if not plaintext:
        raise AppError("Bí mật trống", code="SECRET_EMPTY")
    kek = AESGCM(get_settings().kek_bytes)
    dek = AESGCM.generate_key(bit_length=256)
    nonce, dek_nonce = os.urandom(12), os.urandom(12)
    ciphertext = AESGCM(dek).encrypt(nonce, plaintext.encode(), aad.encode())
    wrapped = kek.encrypt(dek_nonce, dek, aad.encode())
    rec = session.get(Secret, secret_id) if secret_id else None
    if rec is None:
        rec = Secret(kind=kind)
        session.add(rec)
    rec.ciphertext, rec.nonce, rec.wrapped_dek, rec.dek_nonce = ciphertext, nonce, wrapped, dek_nonce
    rec.key_version, rec.aad, rec.updated_by = KEY_VERSION, aad, actor.id
    session.flush()
    log_audit(session, actor, "SECRET_WRITE", resource_type="secret", resource_id=str(rec.id), reason=f"kind={kind}")
    return rec


def reveal_secret(session: Session, secret: Secret, *, actor: Principal, purpose: str) -> str:
    """Chỉ USER (qc) hoặc RUNNER đã xác thực mới được đọc; AI/SYSTEM không bao giờ. Luôn ghi audit."""
    if actor.type not in (PrincipalType.USER, PrincipalType.RUNNER):
        log_audit(session, actor, "SECRET_READ", resource_type="secret", resource_id=str(secret.id), decision="DENY", reason=purpose)
        raise PermissionDenied("Chủ thể này không được đọc bí mật")
    try:
        dek = AESGCM(get_settings().kek_bytes).decrypt(secret.dek_nonce, secret.wrapped_dek, secret.aad.encode())
        plaintext = AESGCM(dek).decrypt(secret.nonce, secret.ciphertext, secret.aad.encode()).decode()
    except InvalidTag as exc:
        raise AppError("Không giải mã được bí mật (sai KEK hoặc dữ liệu bị sửa)", code="SECRET_DECRYPT_FAILED", status=500) from exc
    log_audit(session, actor, "SECRET_READ", resource_type="secret", resource_id=str(secret.id), reason=purpose)
    return plaintext
