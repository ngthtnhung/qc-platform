"""Lớp trừu tượng lưu trữ. Local cho triển khai đầu; S3-compatible cho tương lai."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import BinaryIO, Protocol

from app.core.config import Settings, get_settings


class StorageBackend(Protocol):
    name: str

    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...


_KEY_RE = re.compile(r"^[a-f0-9]{2}/[a-f0-9]{64}$")


def key_for(sha256: str) -> str:
    return f"{sha256[:2]}/{sha256}"


class LocalStorage:
    name = "local"

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        if not _KEY_RE.match(key):  # chặn path traversal: chỉ nhận khóa dạng băm
            raise ValueError("storage key không hợp lệ")
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError("storage key ra ngoài thư mục gốc")
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, p)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


class S3Storage:
    """S3-compatible (MinIO/AWS). CHƯA được kiểm thử tích hợp trong Phase 1 (không có MinIO trong môi trường dựng)."""

    name = "s3"

    def __init__(self, s: Settings):
        import boto3  # tùy chọn: pip install '.[s3]'

        self._bucket = s.s3_bucket
        self._c = boto3.client(
            "s3",
            endpoint_url=s.s3_endpoint or None,
            aws_access_key_id=s.s3_access_key,
            aws_secret_access_key=s.s3_secret_key,
        )

    def put(self, key: str, data: bytes) -> None:
        self._c.put_object(Bucket=self._bucket, Key=key, Body=data)

    def get(self, key: str) -> bytes:
        body: BinaryIO = self._c.get_object(Bucket=self._bucket, Key=key)["Body"]
        return body.read()

    def delete(self, key: str) -> None:
        self._c.delete_object(Bucket=self._bucket, Key=key)

    def exists(self, key: str) -> bool:
        try:
            self._c.head_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:  # noqa: BLE001
            return False


def get_storage() -> StorageBackend:
    s = get_settings()
    if s.storage_backend == "s3":
        return S3Storage(s)
    return LocalStorage(s.storage_local_path)
