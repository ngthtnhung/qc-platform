"""Client chỉ-ĐỌC tới Haraworks (GraphQL, cookie phiên) và Figma (REST, token). Port từ packages/haraworks-live/client.js.

CHƯA kiểm chứng với dịch vụ thật (cần cookie/token của bạn): được kiểm thử bằng transport giả. Không bao giờ ghi lên Haraworks/Figma.
"""
from __future__ import annotations

import re
from typing import Any

import httpx

from app.core.errors import AppError

BATCH_SIZE = 50
HTML_ENT = {"&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'"}


def html_to_text(html: str | None) -> str:
    """HTML của Haraworks → văn bản, giữ xuống dòng (port htmlToText của bản Node)."""
    s = str(html or "")
    s = re.sub(r"<\s*br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</(p|div|li|h\d)>", "\n", s, flags=re.I)
    s = re.sub(r"<li[^>]*>", "- ", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    for k, v in HTML_ENT.items():
        s = s.replace(k, v)
    return re.sub(r"\n{3,}", "\n\n", s).strip()


class HaraworksAuthError(AppError):
    status, code = 401, "HARAWORKS_AUTH"


class HaraworksClient:
    def __init__(self, base_url: str, cookie: str, transport: httpx.BaseTransport | None = None, timeout: float = 30.0):
        self.base = base_url.rstrip("/")
        self.cookie = cookie
        self._http = httpx.Client(transport=transport, timeout=timeout, follow_redirects=False)

    def close(self) -> None:
        self._http.close()

    def gql(self, query: str, allow_partial: bool = False) -> dict[str, Any]:
        res = self._http.post(f"{self.base}/call/ta_api/graphql", json={"query": query},
                              headers={"cookie": self.cookie, "origin": self.base, "referer": f"{self.base}/task/me", "accept": "application/json"})
        if res.status_code in (401, 403) or 300 <= res.status_code < 400:
            raise HaraworksAuthError(f"Cookie Haraworks hết hạn hoặc không hợp lệ (HTTP {res.status_code})")
        if res.status_code >= 400:
            raise AppError(f"Haraworks trả lỗi HTTP {res.status_code}", code="HARAWORKS_ERROR", status=502)
        try:
            body = res.json()
        except ValueError as exc:
            raise HaraworksAuthError("Haraworks không trả JSON, có thể cookie đã hết hạn") from exc
        errs = body.get("errors") or []
        if errs:
            msg = "; ".join(str(e.get("message")) for e in errs)
            if re.search(r"auth|login|unauthor", msg, re.I):
                raise HaraworksAuthError(msg)
            if allow_partial or re.search(r"không tìm thấy dữ liệu|not found", msg, re.I):
                return body.get("data") or {}
            raise AppError(f"GraphQL: {msg}", code="HARAWORKS_ERROR", status=502)
        return body.get("data") or {}

    def projects(self) -> list[dict]:
        return self.gql("{projects{id name}}").get("projects") or []

    def get_tasks(self, ids: list[str], fields: str) -> list[dict]:
        out: list[dict] = []
        for i in range(0, len(ids), BATCH_SIZE):
            chunk = ids[i:i + BATCH_SIZE]
            q = "query{" + " ".join(f't{k}:getTaskById(id:"{tid}"){{{fields}}}' for k, tid in enumerate(chunk) if re.fullmatch(r"[0-9a-f]{24}", tid)) + "}"
            data = self.gql(q, allow_partial=True)
            out.extend(t for t in data.values() if t)
        return out


class FigmaClient:
    def __init__(self, base_url: str, token: str, transport: httpx.BaseTransport | None = None, timeout: float = 60.0):
        self.base = base_url.rstrip("/")
        self._http = httpx.Client(transport=transport, timeout=timeout, headers={"X-Figma-Token": token})

    def close(self) -> None:
        self._http.close()

    def nodes(self, file_key: str, node_id: str = "") -> dict:
        """Nút TEXT của file (hoặc của một node). Chỉ đọc."""
        if not re.fullmatch(r"[A-Za-z0-9]{10,40}", file_key):
            raise AppError("Mã file Figma không hợp lệ", code="VALIDATION_ERROR", status=422)
        url = f"{self.base}/v1/files/{file_key}/nodes?ids={node_id}" if node_id else f"{self.base}/v1/files/{file_key}"
        res = self._http.get(url)
        if res.status_code in (401, 403):
            raise AppError("Token Figma không hợp lệ hoặc không có quyền xem file này.", code="FIGMA_AUTH", status=502)
        if res.status_code == 404:
            raise AppError("Không tìm thấy file/node Figma (kiểm tra link và quyền).", code="FIGMA_NOT_FOUND", status=404)
        if res.status_code >= 400:
            raise AppError(f"Figma trả lỗi HTTP {res.status_code}", code="FIGMA_ERROR", status=502)
        return res.json()
