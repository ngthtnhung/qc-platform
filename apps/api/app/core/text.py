from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from typing import Any


def fold(s: str | None) -> str:
    """Không dấu + chữ thường (giống `fold()` của bản Node) để tìm kiếm tiếng Việt."""
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("đ", "d").replace("Đ", "d")
    return re.sub(r"\s+", " ", s.lower()).strip()


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str).encode()).hexdigest()


def like_escape(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
