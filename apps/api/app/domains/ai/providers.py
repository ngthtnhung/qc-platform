"""Nhà cung cấp AI qua REST (Gemini, Anthropic). Chỉ gửi văn bản; khóa API lấy từ vault, đặt trong HEADER (không bao giờ nằm trong URL/log).

CHƯA kiểm chứng với dịch vụ thật (cần khóa của bạn): kiểm thử bằng transport giả. Đầu ra của AI luôn được coi là KHÔNG tin cậy:
chỉ đi vào hệ thống dưới dạng đề xuất chờ QC duyệt (xem ai/service.py).
"""
from __future__ import annotations

import json
import re
from typing import Protocol

import httpx

from app.core.errors import AppError


class AIProvider(Protocol):
    name: str
    model: str

    def complete_json(self, system: str, user: str, max_tokens: int = 4096) -> dict: ...


def _extract_json(text: str) -> dict:
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", t, re.S)
    if m:
        t = m.group(1)
    else:
        a, b = t.find("{"), t.rfind("}")
        if a != -1 and b > a:
            t = t[a:b + 1]
    try:
        out = json.loads(t)
    except ValueError as exc:
        raise AppError("AI trả về nội dung không phải JSON hợp lệ.", code="AI_BAD_OUTPUT", status=502) from exc
    if not isinstance(out, dict):
        raise AppError("AI trả về JSON không đúng cấu trúc (cần một đối tượng).", code="AI_BAD_OUTPUT", status=502)
    return out


class ProviderUnavailable(AppError):
    """429/5xx/timeout: thử nhà cung cấp dự phòng."""

    status, code = 503, "AI_UNAVAILABLE"


def _check(res: httpx.Response, who: str) -> None:
    detail = ""
    try:
        err_obj = res.json().get("error")
        if isinstance(err_obj, dict) and err_obj.get("message"):
            detail = f" — {err_obj['message']}"
    except Exception:  # noqa: BLE001
        pass
    if res.status_code in (401, 403):
        raise AppError(f"Khóa API {who} không hợp lệ hoặc không có quyền.{detail}", code="AI_AUTH", status=502)
    if res.status_code == 429 or res.status_code >= 500:
        raise ProviderUnavailable(f"{who} đang quá tải hoặc lỗi (HTTP {res.status_code}).{detail}")
    if res.status_code >= 400:
        raise AppError(f"{who} từ chối yêu cầu (HTTP {res.status_code}).{detail}", code="AI_ERROR", status=502)


GEMINI_FALLBACK_MODELS = ("gemini-flash-latest", "gemini-3.8-flash", "gemini-3.5-flash", "gemini-flash-lite-latest")


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, base: str, transport: httpx.BaseTransport | None = None, timeout: float = 90.0):
        self.model, self._base, self._key = model, base.rstrip("/"), api_key
        self._http = httpx.Client(transport=transport, timeout=timeout)

    def complete_json(self, system: str, user: str, max_tokens: int = 4096) -> dict:
        payload = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": max_tokens, "temperature": 0.2},
        }
        # Nếu model cấu hình trả 404 (đã ngừng hỗ trợ) hoặc 503 (quá tải), tự động thử model dự phòng
        models_to_try = list(dict.fromkeys([self.model, *GEMINI_FALLBACK_MODELS]))
        res: httpx.Response | None = None
        for idx, m in enumerate(models_to_try):
            try:
                res = self._http.post(
                    f"{self._base}/v1beta/models/{m}:generateContent",
                    headers={"x-goog-api-key": self._key},
                    json=payload,
                )
            except httpx.HTTPError as exc:
                if idx < len(models_to_try) - 1:
                    continue
                raise ProviderUnavailable(f"Không gọi được Gemini ({exc.__class__.__name__}).") from exc
            if res.status_code in (404, 503) and idx < len(models_to_try) - 1:
                continue
            self.model = m
            break
        assert res is not None
        _check(res, "Gemini")
        try:
            text = res.json()["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, ValueError) as exc:
            raise AppError("Gemini không trả về nội dung (có thể bị bộ lọc an toàn chặn).", code="AI_BAD_OUTPUT", status=502) from exc
        return _extract_json(text)


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str, base: str, transport: httpx.BaseTransport | None = None, timeout: float = 90.0):
        self.model, self._base, self._key = model, base.rstrip("/"), api_key
        self._http = httpx.Client(transport=transport, timeout=timeout)

    def complete_json(self, system: str, user: str, max_tokens: int = 4096) -> dict:
        try:
            res = self._http.post(f"{self._base}/v1/messages", headers={"x-api-key": self._key, "anthropic-version": "2023-06-01"},
                                  json={"model": self.model, "max_tokens": max_tokens, "temperature": 0.2, "system": system, "messages": [{"role": "user", "content": user}]})
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"Không gọi được Anthropic ({exc.__class__.__name__}).") from exc
        _check(res, "Anthropic")
        try:
            text = "".join(b.get("text", "") for b in res.json()["content"] if b.get("type") == "text")
        except (KeyError, TypeError, ValueError) as exc:
            raise AppError("Anthropic không trả về nội dung.", code="AI_BAD_OUTPUT", status=502) from exc
        return _extract_json(text)
