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
    if res.status_code in (401, 403):
        raise AppError(f"Khóa API {who} không hợp lệ hoặc không có quyền.", code="AI_AUTH", status=502)
    if res.status_code == 429 or res.status_code >= 500:
        raise ProviderUnavailable(f"{who} đang quá tải hoặc lỗi (HTTP {res.status_code}).")
    if res.status_code >= 400:
        raise AppError(f"{who} từ chối yêu cầu (HTTP {res.status_code}).", code="AI_ERROR", status=502)


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, base: str, transport: httpx.BaseTransport | None = None, timeout: float = 90.0):
        self.model, self._base, self._key = model, base.rstrip("/"), api_key
        self._http = httpx.Client(transport=transport, timeout=timeout)

    def complete_json(self, system: str, user: str, max_tokens: int = 4096) -> dict:
        try:
            res = self._http.post(f"{self._base}/v1beta/models/{self.model}:generateContent", headers={"x-goog-api-key": self._key},
                                  json={"systemInstruction": {"parts": [{"text": system}]}, "contents": [{"role": "user", "parts": [{"text": user}]}],
                                        "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": max_tokens, "temperature": 0.2}})
        except httpx.HTTPError as exc:
            raise ProviderUnavailable(f"Không gọi được Gemini ({exc.__class__.__name__}).") from exc
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
