"""Quy tắc kiểm tra tác vụ (port từ packages/automation-tasks/tasks.js).

LƯU Ý AN TOÀN: danh sách cấm chỉ là hàng rào chống lỗi vô ý, KHÔNG phải ranh giới bảo mật. Kiểm soát thật là
(1) chỉ code do QC duyệt, ghim sha256; (2) Runner kiểm tra lại sha256 và chạy cách ly (Phase 4 — Runner)."""
from __future__ import annotations

import hashlib
import re
from urllib.parse import urlparse

MAX_LEN = {"text": 200, "multiline": 5000, "list": 1000, "file": 400, "number": 40, "date": 40, "select": 200}
MAX_PARAMS = 30
MAX_SCRIPT = 20000
# Cho phép chữ hoa: dữ liệu thật của bản Node có khóa như "Tab_kiem_tra"; script đã duyệt tham chiếu đúng tên khóa nên KHÔNG được đổi tên
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,30}$")
FILE_ID_RE = re.compile(r"^(f_[a-z0-9]{8,24}|[0-9a-f-]{36})$")  # mã file cũ hoặc UUID file mới
FORBIDDEN = re.compile(
    r"\b(require|process|child_process|eval|Function|globalThis|constructor|__proto__|setInputFiles|setFiles|filechooser)\b|\bimport\s*\(|\bfs\."
)


def script_sha(script: str) -> str:
    return hashlib.sha256(script.encode()).hexdigest()


def validate_script(script) -> list[str]:
    errs: list[str] = []
    if not isinstance(script, str) or not script.strip():
        return ["Thiếu script"]
    if len(script) > MAX_SCRIPT:
        errs.append(f"Script quá dài (tối đa {MAX_SCRIPT} ký tự)")
    if FORBIDDEN.search(script):
        errs.append("Script dùng cú pháp bị cấm (require, process, import(), eval, Function, constructor, fs, setInputFiles). "
                    "Chỉ dùng page, ctx, step, assert, pickOption, attachFiles, openPopup, expectDownload.")
    return errs


def normalize_params(items) -> tuple[list[dict], list[str]]:
    errs: list[str] = []
    out: list[dict] = []
    seen: set[str] = set()
    for p in items if isinstance(items, list) else []:
        key = str((p or {}).get("key", "")).strip()
        if not KEY_RE.match(key):
            errs.append(f'Khóa tham số "{key}" không hợp lệ (chữ, số, gạch dưới, tối đa 31 ký tự)')
            continue
        if key in seen:
            errs.append(f'Trùng khóa tham số "{key}"')
            continue
        seen.add(key)
        typ = p.get("type") if p.get("type") in MAX_LEN else "text"
        value = str(p.get("value", "") if p.get("value") is not None else "")
        if len(value) > MAX_LEN[typ]:
            errs.append(f'Giá trị của "{key}" tối đa {MAX_LEN[typ]} ký tự')
            continue
        if typ == "file" and value and not all(FILE_ID_RE.match(v.strip()) for v in value.split(",")):
            errs.append(f'Giá trị của "{key}" phải là mã file đã tải lên')
            continue
        raw_opts = p.get("options") if isinstance(p.get("options"), list) else []
        options = [str(o).strip()[:120] for o in raw_opts if str(o).strip()][:50]
        out.append({
            "key": key,
            "label": str(p.get("label") or key)[:80],
            "value": value,
            "options": options,
            "auto": p.get("auto") is not False,
            "type": typ,
            "fallback": "random" if p.get("fallback") == "random" else "first",
        })
    if len(out) > MAX_PARAMS:
        errs.append(f"Tối đa {MAX_PARAMS} tham số")
    return out, errs


def root_domain(host: str) -> str:
    return ".".join(host.split(".")[-2:])


def validate_start_url(url: str, staging_base_urls: list[str]) -> str | None:
    """None nếu hợp lệ. Hỗ trợ đường dẫn tương đối (/...) dùng cho cụm dùng chung hoặc https cùng root domain Staging."""
    raw = (url or "").strip()
    if not raw:
        return "Thiếu start_url"
    if raw.startswith("/"):
        return None
    try:
        u = urlparse(raw)
    except ValueError:
        return "start_url không hợp lệ"
    if u.scheme != "https" or not u.hostname:
        return "start_url phải là https (hoặc đường dẫn tương đối bắt đầu bằng /)"
    roots = {root_domain(urlparse(b).hostname or "") for b in staging_base_urls if urlparse(b).hostname}
    if roots and root_domain(u.hostname) not in roots:
        return f"start_url phải thuộc {', '.join(sorted(roots))}"
    return None


def merge_params(base: list[dict], override: dict | None) -> dict[str, str]:
    """Giá trị chạy = tham số đã lưu, ghi đè bởi `override` (chỉ khóa có sẵn, đúng giới hạn độ dài)."""
    out: dict[str, str] = {}
    for p in base:
        v = p["value"]
        if override and isinstance(override.get(p["key"]), str) and len(override[p["key"]]) <= MAX_LEN.get(p["type"], 200):
            v = override[p["key"]]
        out[p["key"]] = v
    return out


def choose_account(required_roles: list[str], accounts: list[dict]) -> dict | None:
    """Chọn tài khoản Staging để chạy automation (không bao giờ chặn vì vai trò).
    Ưu tiên tài khoản đã lưu mật khẩu, sau đó ưu tiên mềm nếu role_label khớp gợi ý."""
    if not accounts:
        return None
    from app.core.text import fold

    role_tokens = [fold(r) for r in (required_roles or []) if str(r).strip()]

    def _score(a: dict) -> tuple[int, int]:
        has_sec = 1 if a.get("has_secret") else 0
        rl = fold(a.get("role_label") or "")
        role_match = 1 if (role_tokens and rl and any(t in rl or rl in t for t in role_tokens)) else 0
        return (-has_sec, -role_match)

    return min(accounts, key=_score)
