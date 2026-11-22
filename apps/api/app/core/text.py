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


def fold_with_map(text: str) -> tuple[str, list[int]]:
    """Như `fold` nhưng KHÔNG gộp khoảng trắng và trả bản đồ vị trí: folded[i] ứng với text[map[i]].
    Dùng để tô sáng đúng vị trí trong văn bản gốc sau khi tìm trên bản không dấu."""
    out: list[str] = []
    idx: list[int] = []
    for i, ch in enumerate(unicodedata.normalize("NFC", text)):
        d = unicodedata.normalize("NFD", ch)
        base = "".join(c for c in d if unicodedata.category(c) != "Mn")
        base = base.replace("đ", "d").replace("Đ", "d").lower()
        for c in base:
            out.append(c)
            idx.append(i)
    return "".join(out), idx


def normalize_text(s: str) -> str:
    """Chuẩn hóa tối thiểu để lưu NGUYÊN VĂN: NFC, bỏ ký tự điều khiển, NBSP→cách, gộp khoảng trắng/tab (giữ xuống dòng)."""
    s = unicodedata.normalize("NFC", s).replace(" ", " ").replace("\r\n", "\n").replace("\r", "\n")
    s = "".join(c for c in s if c == "\n" or c == "\t" or unicodedata.category(c) not in ("Cc", "Cf"))
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    return s.strip()


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str).encode()).hexdigest()


def like_escape(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
