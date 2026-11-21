"""Che bí mật trước khi ghi log/audit."""
from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEYS = re.compile(
    r"(pass(word)?|secret|token|cookie|authorization|api[_-]?key|kek|dek|ciphertext|refresh|csrf|credential)", re.I
)
VALUE_PATTERNS = [
    re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]{8,}", re.I),
    re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"),  # JWT
    re.compile(r"\bqa_[A-Za-z0-9_-]{20,}\b"),  # token hệ thống Node cũ
    re.compile(r"(?i)(cookie\s*[:=]\s*)[^\n]{8,}"),
]
MASK = "[REDACTED]"


def redact_text(value: str) -> str:
    out = value
    for p in VALUE_PATTERNS:
        out = p.sub((lambda m, g=p.groups: (m.group(1) + MASK) if g else MASK), out)
    return out


def redact(value: Any, _depth: int = 0) -> Any:
    if _depth > 8:
        return MASK
    if isinstance(value, dict):
        return {k: (MASK if SENSITIVE_KEYS.search(str(k)) else redact(v, _depth + 1)) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [redact(v, _depth + 1) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value
