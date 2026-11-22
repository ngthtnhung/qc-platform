"""Cấu hình tập trung. Thiếu biến bắt buộc ⇒ dừng ngay khi khởi động (fail-fast)."""
from __future__ import annotations

import base64
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = Field("dev", pattern="^(dev|team|test)$")
    log_level: str = "INFO"
    public_base_url: str = "http://localhost:3000"
    allowed_origins: str = ""  # danh sách phân tách bằng dấu phẩy; trống = same-origin (qua proxy)

    database_url: str
    redis_url: str = "redis://localhost:6379/0"

    jwt_signing_key: str
    # KEK bọc khóa dữ liệu của vault: base64 của đúng 32 byte. KHÔNG lưu trong DB.
    secret_kek: str

    access_token_minutes: int = 15
    refresh_token_days: int = 14
    cookie_secure: bool = False  # bật True khi chạy sau HTTPS (profile team)
    login_max_failures: int = 5
    login_lock_minutes: int = 15
    password_min_length: int = 12

    storage_backend: str = Field("local", pattern="^(local|s3)$")
    storage_local_path: str = ".data/storage"
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    max_upload_bytes: int = 10 * 1024 * 1024
    max_source_upload_bytes: int = 25 * 1024 * 1024  # tài liệu nguồn (BA .docx, wiki) lớn hơn file đính kèm thường
    figma_api_base: str = "https://api.figma.com"
    haraworks_base_url: str = "https://tasks.haraworks.vn"
    # Chỉ cho phép tải trang wiki từ các host này (phân tách bằng dấu phẩy). Trống = tắt tính năng tải từ URL (chặn SSRF mặc định).
    wiki_fetch_allowed_hosts: str = ""
    ai_provider_order: str = "gemini,anthropic"
    haraworks_sync_seconds: int = 300
    gemini_model: str = "gemini-2.5-flash"
    anthropic_model: str = "claude-sonnet-5-5"
    gemini_api_base: str = "https://generativelanguage.googleapis.com"
    anthropic_api_base: str = "https://api.anthropic.com"
    ai_max_input_chars: int = 60000

    @field_validator("jwt_signing_key")
    @classmethod
    def _jwt_len(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SIGNING_KEY phải dài ít nhất 32 ký tự")
        return v

    @field_validator("secret_kek")
    @classmethod
    def _kek(cls, v: str) -> str:
        try:
            raw = base64.b64decode(v, validate=True)
        except Exception as exc:  # noqa: BLE001
            raise ValueError("SECRET_KEK phải là base64 hợp lệ") from exc
        if len(raw) != 32:
            raise ValueError("SECRET_KEK phải là base64 của đúng 32 byte")
        return v

    @model_validator(mode="after")
    def _team_requires_secure(self) -> Settings:
        if self.app_env == "team" and not self.cookie_secure:
            raise ValueError("Profile team bắt buộc COOKIE_SECURE=true (HTTPS)")
        if self.storage_backend == "s3" and not (self.s3_bucket and self.s3_access_key and self.s3_secret_key):
            raise ValueError("STORAGE_BACKEND=s3 cần S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY")
        return self

    @property
    def kek_bytes(self) -> bytes:
        return base64.b64decode(self.secret_kek)

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
