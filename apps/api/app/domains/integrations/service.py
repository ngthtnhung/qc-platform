from __future__ import annotations

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.db import utcnow
from app.core.errors import AppError, NotFound
from app.core.principal import Principal
from app.domains.integrations.clients import FigmaClient, HaraworksClient, html_to_text
from app.domains.platform.audit import log_audit
from app.domains.platform.models import Secret
from app.domains.platform.vault import reveal_secret, store_secret
from app.domains.sources.ingest import ingest_task_functions
from app.domains.sources.models import Integration, SourcePassage

KEYS = {"haraworks": "Cookie phiên Haraworks (chỉ đọc)", "figma": "Token cá nhân Figma (chỉ đọc)", "gemini": "Khóa API Gemini (AI)", "anthropic": "Khóa API Anthropic/Claude (AI)"}
TRANSPORT: dict[str, httpx.BaseTransport | None] = {}  # chỉ dùng trong test: tiêm transport giả cho haraworks/figma


def set_secret(session: Session, actor: Principal, key: str, value: str) -> Integration:
    if key not in KEYS:
        raise NotFound("Tích hợp không tồn tại")
    value = value.strip()
    if key == "haraworks":
        value = value.removeprefix("Cookie:").removeprefix("cookie:").strip()
        if not value or any(ord(c) < 32 or ord(c) > 126 for c in value):
            raise AppError("Cookie không hợp lệ: dán đúng giá trị header Cookie (chỉ ký tự ASCII).", code="VALIDATION_ERROR", status=422)
    integ = session.get(Integration, key)
    if integ is None:
        integ = Integration(key=key)
        session.add(integ)
        session.flush()
    rec = store_secret(session, kind=f"integration_{key}", plaintext=value, aad=f"integration:{key}", actor=actor, secret_id=integ.secret_id)
    integ.secret_id, integ.last_check_status, integ.last_check_at = rec.id, "", None
    log_audit(session, actor, "INTEGRATION_SECRET_SET", resource_type="integration", resource_id=key)
    return integ


def get_secret(session: Session, actor: Principal, key: str, purpose: str) -> str | None:
    integ = session.get(Integration, key)
    if integ is None or integ.secret_id is None:
        return None
    sec = session.get(Secret, integ.secret_id)
    # SYSTEM (tác vụ nền theo lịch) được đọc bí mật TÍCH HỢP đã cấu hình; AI không bao giờ
    return reveal_secret(session, sec, actor=actor, purpose=purpose, allow_system=True) if sec else None


def _classify_status(configured: bool, raw_status: str) -> tuple[str, str, str]:
    if not configured:
        return "missing", "Thiếu token", "Chưa cấu hình token / cookie"
    st = (raw_status or "").strip()
    low = st.lower()
    if not st:
        return "active", "Hoạt động", "Đã lưu (chưa kiểm tra trực tiếp)"
    if low.startswith("ok"):
        return "active", "Hoạt động", st
    if any(w in low for w in ("hết hạn", "expired", "401", "403", "no_cookie", "không hợp lệ")):
        return "expired", "Hết hạn", st
    return "error", "Lỗi", st


def status(session: Session) -> list[dict]:
    out = []
    for key, label in KEYS.items():
        i = session.get(Integration, key)
        configured = bool(i and i.secret_id)
        raw = i.last_check_status if i else ""
        state, state_label, detail = _classify_status(configured, raw)
        out.append({
            "key": key,
            "label": label,
            "configured": configured,
            "state": state,
            "state_label": state_label,
            "detail": detail,
            "last_check_at": i.last_check_at.isoformat() if i and i.last_check_at else None,
            "last_check_status": raw,
        })
    return out


def check_integration(session: Session, actor: Principal, key: str, transport: httpx.BaseTransport | None = None) -> dict:
    """Kiểm tra trực tiếp trạng thái hoạt động của từng loại token/cookie/API key."""
    if key not in KEYS:
        raise NotFound("Tích hợp không tồn tại")
    if key == "haraworks":
        return check_haraworks(session, actor, transport)
    integ = session.get(Integration, key)
    secret_val = get_secret(session, actor, key, f"kiểm tra tích hợp {key}")
    if not secret_val or integ is None:
        return {"ok": False, "state": "missing", "state_label": "Thiếu token", "status": "Chưa cấu hình"}

    s = get_settings()
    ok = False
    msg = ""
    try:
        if key == "figma":
            with httpx.Client(timeout=12, transport=transport or TRANSPORT.get("figma")) as hc:
                r = hc.get(f"{s.figma_api_base.rstrip('/')}/v1/me", headers={"X-Figma-Token": secret_val})
            if r.is_success:
                ok, msg = True, "ok (Figma hoạt động)"
            elif r.status_code in (401, 403):
                msg = f"hết hạn: Token Figma không hợp lệ hoặc đã hết hạn (HTTP {r.status_code})"
            else:
                msg = f"lỗi: Figma trả HTTP {r.status_code}"
        elif key == "gemini":
            with httpx.Client(timeout=12, transport=transport) as hc:
                r = hc.get(f"{s.gemini_api_base.rstrip('/')}/v1beta/models", headers={"x-goog-api-key": secret_val})
            if r.is_success:
                ok, msg = True, "ok (Gemini hoạt động)"
            elif r.status_code in (400, 401, 403):
                msg = f"hết hạn: Khóa Gemini không hợp lệ hoặc bị thu hồi (HTTP {r.status_code})"
            else:
                msg = f"lỗi: Gemini trả HTTP {r.status_code}"
        elif key == "anthropic":
            with httpx.Client(timeout=12, transport=transport) as hc:
                r = hc.get(
                    f"{s.anthropic_api_base.rstrip('/')}/v1/models",
                    headers={"x-api-key": secret_val, "anthropic-version": "2023-06-01"},
                )
            if r.is_success:
                ok, msg = True, "ok (Anthropic hoạt động)"
            elif r.status_code in (401, 403):
                msg = f"hết hạn: Khóa Anthropic không hợp lệ hoặc hết hạn (HTTP {r.status_code})"
            else:
                msg = f"lỗi: Anthropic trả HTTP {r.status_code}"
    except httpx.HTTPError as exc:
        msg = f"lỗi: Không kết nối được ({exc.__class__.__name__})"

    integ.last_check_status = msg
    integ.last_check_at = utcnow()
    session.flush()
    state, state_label, _ = _classify_status(True, msg)
    return {"ok": ok, "state": state, "state_label": state_label, "status": msg}


def haraworks_client(session: Session, actor: Principal, transport: httpx.BaseTransport | None = None) -> HaraworksClient:
    cookie = get_secret(session, actor, "haraworks", "đồng bộ Haraworks (chỉ đọc)")
    if not cookie:
        raise AppError("Chưa cấu hình cookie Haraworks. Vào trang Nguồn → Tích hợp để nhập (chỉ ghi).", code="NO_COOKIE", status=409)
    return HaraworksClient(get_settings().haraworks_base_url, cookie, transport=transport or TRANSPORT.get("haraworks"))


def check_haraworks(session: Session, actor: Principal, transport: httpx.BaseTransport | None = None) -> dict:
    c = haraworks_client(session, actor, transport)
    integ = session.get(Integration, "haraworks")
    try:
        n = len(c.projects())
        integ.last_check_status, ok = f"ok ({n} dự án)", True
    except AppError as exc:
        if exc.status in (401, 403) or "het han" in exc.message.lower() or "hết hạn" in exc.message.lower() or "cookie" in exc.message.lower():
            integ.last_check_status = f"hết hạn: {exc.message}"
        else:
            integ.last_check_status = f"lỗi: {exc.message}"
        ok = False
        integ.last_check_at = utcnow()
        session.commit()  # giữ trạng thái kiểm tra dù trả lỗi
        raise
    finally:
        c.close()
    integ.last_check_at = utcnow()
    return {"ok": ok, "status": integ.last_check_status}


def sync_function_descriptions(session: Session, actor: Principal, *, limit: int | None = None, only_missing: bool = True,
                               transport: httpx.BaseTransport | None = None) -> dict:
    """Lấy MÔ TẢ đầy đủ (trường `content` HTML → văn bản) của các Task Function đã nạp (chỉ đọc Haraworks), cập nhật đoạn trích."""
    c = haraworks_client(session, actor, transport)
    try:
        rows = session.execute(select(SourcePassage).where(SourcePassage.kind == "task", SourcePassage.is_current.is_(True))).scalars().all()
        todo = [p for p in rows if not (only_missing and (p.locator or {}).get("has_description"))]
        if limit:
            todo = todo[:limit]
        ids = [p.external_key for p in todo if p.external_key]
        tasks = c.get_tasks(ids, "id name content")
    finally:
        c.close()
    desc = {t["id"]: html_to_text(t.get("content")) for t in tasks if t.get("content")}
    by_team: dict[str, list[dict]] = {}
    meta = {p.external_key: p for p in todo}
    for t in tasks:
        p = meta.get(t["id"])
        if p is None or t["id"] not in desc:
            continue
        loc = p.locator or {}
        by_team.setdefault(loc.get("team", "Không rõ"), []).append({"id": t["id"], "name": t.get("name") or p.text.split("\n")[0], "project_Id": loc.get("project_id", ""),
                                                                     "project_Name": loc.get("project", ""), "parent_Id": loc.get("parent_id"),
                                                                     "additionalInfo": [{"key": k, "value": loc[k]} for k in ("module", "customer", "platform", "type", "buildNumber") if loc.get(k)]})
    res = [ingest_task_functions(session, actor=actor, team=team, tasks=items, descriptions={i["id"]: desc[i["id"]] for i in items}) for team, items in by_team.items()]
    log_audit(session, actor, "FUNCTION_DESCRIPTIONS_SYNC", resource_type="source", resource_id="task_function",
              after={"requested": len(ids), "with_description": len(desc), "teams": len(by_team)})
    return {"requested": len(ids), "received": len(tasks), "with_description": len(desc), "teams": res}


def fetch_figma(session: Session, actor: Principal, file_key: str, node_id: str, transport: httpx.BaseTransport | None = None) -> dict | None:
    token = get_secret(session, actor, "figma", "đọc nội dung Figma (chỉ đọc)")
    if not token:
        return None
    c = FigmaClient(get_settings().figma_api_base, token, transport=transport or TRANSPORT.get("figma"))
    try:
        return c.nodes(file_key, node_id)
    finally:
        c.close()
