"""Flow Recorder: chuẩn hóa sự kiện ghi từ trình duyệt → bước có locator xếp hạng → code Playwright TẤT ĐỊNH.

Không có AI trong đường này: cùng đầu vào luôn cho cùng code (sha256 ổn định). Code sinh ra vẫn đi qua
`automation.service.create_task` nên ở PENDING cho tới khi một QC duyệt.

Sự kiện đầu vào (do `apps/runner-agent` recorder ghi), mỗi phần tử:
  {"t": "navigate", "url": "..."}
  {"t": "click" | "fill" | "select" | "press", "el": {tag, type, role, name, text, testid, id, label, placeholder, css}, "value": "...", "key": "Enter"}
"""
from __future__ import annotations

import re

MAX_EVENTS = 500
SENSITIVE_TYPES = {"password"}
SENSITIVE_HINT = re.compile(r"pass(word)?|mật\s*khẩu|mat\s*khau|otp|cvv|secret|token", re.I)
KINDS = {"navigate", "click", "fill", "select", "press"}
# Thứ tự ưu tiên locator: bền nhất → mong manh nhất
RANK = ["testid", "role", "label", "placeholder", "text", "id", "css"]


def js_str(s: str) -> str:
    """Chuỗi JS an toàn (nháy đơn); không để lọt xuống dòng/ký tự phân tách dòng."""
    out = s.replace("\\", "\\\\").replace("'", "\\'").replace("\r", "\\r").replace("\n", "\\n").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return f"'{out}'"


def _clean(v, n=120) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def is_sensitive(el: dict) -> bool:
    return str(el.get("type", "")).lower() in SENSITIVE_TYPES or bool(SENSITIVE_HINT.search(" ".join(_clean(el.get(k)) for k in ("name", "label", "placeholder", "id"))))


def locator_candidates(el: dict) -> list[dict]:
    """Danh sách locator ứng viên đã xếp hạng; mỗi mục có `code` (biểu thức Playwright) và `stable`."""
    c: list[dict] = []
    testid, role, name = _clean(el.get("testid")), _clean(el.get("role")), _clean(el.get("name"))
    if testid:
        c.append({"kind": "testid", "code": f"page.getByTestId({js_str(testid)})", "stable": True})
    if role and name:
        c.append({"kind": "role", "code": f"page.getByRole({js_str(role)}, {{ name: {js_str(name)} }})", "stable": True})
    if _clean(el.get("label")):
        c.append({"kind": "label", "code": f"page.getByLabel({js_str(_clean(el.get('label')))})", "stable": True})
    if _clean(el.get("placeholder")):
        c.append({"kind": "placeholder", "code": f"page.getByPlaceholder({js_str(_clean(el.get('placeholder')))})", "stable": True})
    text = _clean(el.get("text"), 80)
    if text and el.get("tag") in {"button", "a", "span", "div", "li", "label", "td", "th"}:
        c.append({"kind": "text", "code": f"page.getByText({js_str(text)}, {{ exact: true }})", "stable": False})
    eid = _clean(el.get("id"))
    # id sinh tự động (số/uuid dài, tiền tố react/ember...) không bền
    if eid and not re.search(r"\d{4,}|^(react|ember|ext|:r)", eid, re.I):
        c.append({"kind": "id", "code": f"page.locator({js_str('#' + eid)})", "stable": False})
    if _clean(el.get("css"), 200):
        c.append({"kind": "css", "code": f"page.locator({js_str(_clean(el.get('css'), 200))})", "stable": False})
    c.sort(key=lambda x: RANK.index(x["kind"]))
    return c


def describe(el: dict) -> str:
    return _clean(el.get("name") or el.get("label") or el.get("placeholder") or el.get("text") or el.get("testid") or el.get("id") or el.get("tag") or "phần tử", 60)


def normalize(events: list[dict]) -> dict:
    """→ {steps: [...], params: [...], warnings: [...]}. Gộp thao tác thừa, che trường nhạy cảm, đặt tham số cho giá trị nhập."""
    if len(events) > MAX_EVENTS:
        raise ValueError(f"Bản ghi quá dài (tối đa {MAX_EVENTS} sự kiện)")
    steps: list[dict] = []
    params: list[dict] = []
    warnings: list[str] = []
    seen_first_nav = False
    for ev in events:
        t = ev.get("t")
        if t not in KINDS:
            warnings.append(f"Bỏ sự kiện lạ: {_clean(t, 20)}")
            continue
        if t == "navigate":
            if not seen_first_nav:
                seen_first_nav = True  # điều hướng đầu tiên = start_url, không thành bước
            elif steps and steps[-1]["t"] in {"click", "press"}:
                pass  # điều hướng do click/Enter gây ra: chờ tải trang là đủ
            else:
                steps.append({"t": "wait_load", "label": "Chờ trang tải"})
            continue
        el = ev.get("el") or {}
        if not isinstance(el, dict) or not locator_candidates(el):
            warnings.append(f"Bỏ bước {t}: không xác định được phần tử")
            continue
        cands = locator_candidates(el)
        if t == "fill":
            if is_sensitive(el):
                warnings.append(f"Bỏ nhập vào ô nhạy cảm “{describe(el)}” (mật khẩu/OTP không được ghi; đăng nhập do Runner lo)")
                continue
            if steps and steps[-1]["t"] == "fill" and steps[-1]["locator"] == cands[0]["code"]:
                params[-1]["value"] = str(ev.get("value", ""))[:200]  # gõ lại cùng ô: giữ giá trị cuối
                continue
            if steps and steps[-1]["t"] == "click" and steps[-1]["locator"] == cands[0]["code"]:
                steps.pop()  # click để focus rồi gõ: bỏ click thừa
            key = f"nhap_{len(params) + 1}"
            params.append({"key": key, "label": f"Nhập “{describe(el)}”", "value": str(ev.get("value", ""))[:200], "type": "text"})
            steps.append({"t": "fill", "label": f"Nhập “{describe(el)}”", "locator": cands[0]["code"], "candidates": cands, "param": key})
        elif t == "select":
            key = f"chon_{len(params) + 1}"
            params.append({"key": key, "label": f"Chọn “{describe(el)}”", "value": str(ev.get("value", ""))[:200], "type": "text"})
            steps.append({"t": "select", "label": f"Chọn “{describe(el)}”", "locator": cands[0]["code"], "candidates": cands, "param": key})
        elif t == "press":
            k = _clean(ev.get("key"), 20)
            if k not in {"Enter", "Tab", "Escape"}:
                warnings.append(f"Bỏ phím {k or '?'} (chỉ hỗ trợ Enter/Tab/Escape)")
                continue
            steps.append({"t": "press", "label": f"Nhấn {k}", "locator": cands[0]["code"], "candidates": cands, "key": k})
        else:  # click
            if steps and steps[-1]["t"] == "click" and steps[-1]["locator"] == cands[0]["code"]:
                continue  # nhấp đúp do ghi trùng
            steps.append({"t": "click", "label": f"Bấm “{describe(el)}”", "locator": cands[0]["code"], "candidates": cands})
    for s in steps:
        if s.get("locator") and not s["candidates"][0]["stable"]:
            warnings.append(f"Bước “{s['label']}” chỉ có locator mong manh ({s['candidates'][0]['kind']}); nên nhờ dev thêm data-testid")
    return {"steps": steps, "params": params, "warnings": warnings}


def generate_script(steps: list[dict]) -> str:
    """Code theo đúng API của Runner: page, ctx, step. Mỗi thao tác một `step` để báo cáo rõ."""
    lines = ["await step('Mở trang', async () => { await page.waitForLoadState('domcontentloaded'); });"]
    for s in steps:
        label = js_str(s["label"])
        if s["t"] == "wait_load":
            body = "await page.waitForLoadState('domcontentloaded');"
        elif s["t"] == "click":
            body = f"await {s['locator']}.click();"
        elif s["t"] == "fill":
            body = f"await {s['locator']}.fill(ctx.val({js_str(s['param'])}));"
        elif s["t"] == "select":
            body = f"await {s['locator']}.selectOption({{ label: ctx.val({js_str(s['param'])}) }});"
        elif s["t"] == "press":
            body = f"await {s['locator']}.press({js_str(s['key'])});"
        else:
            continue
        lines.append(f"await step({label}, async () => {{ {body} }});")
    return "\n".join(lines) + "\n"
