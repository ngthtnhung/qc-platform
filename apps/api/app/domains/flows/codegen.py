"""Tiền xử lý xác định & tách luồng cho mã `playwright codegen` trước khi qua AI (hoặc chuẩn hóa tất định).

Mục tiêu an toàn & tối ưu:
1. Tách riêng ghi chú văn bản ngoài code (`context_notes`) để không gây lỗi cú pháp.
2. Xóa & che tuyệt đối thông tin đăng nhập cứng (OIDC, org, username, password) và bước popup mở module đầu phiên.
3. Khử nhiễu gõ tiếng Việt IME (`Shift+ArrowLeft` + `fill` lặp) và các cú click lặp / loading toast / backdrop.
4. Phân đoạn luồng dài theo menu/heading nghiệp vụ và phát hiện selector mong manh, popup, download, bước dở dang.
"""
from __future__ import annotations

import re
from typing import Any

from app.core.text import fold

IMPORT_WRAPPER_RE = re.compile(r"^\s*(import\s+.*from\s+['\"]@playwright/test['\"];?|test\(['\"].*?['\"],\s*async\s*\(\{.*?\}\)\s*=>\s*\{|\}\);)\s*$")
FILL_RE = re.compile(r"^await\s+(page\d*)\.(.*?)\.fill\((['\"])(.*?)\3\);?\s*$")
PRESS_IME_RE = re.compile(r"^await\s+(page\d*)\.(.*?)\.press\(['\"]Shift\+ArrowLeft['\"]\);?\s*$")
CLICK_RE = re.compile(r"^await\s+(page\d*)\.(.*?)\.(click|dblclick)\(\);\s*$")
GOTO_RE = re.compile(r"^await\s+(page\d*)\.goto\((['\"])(.*?)\2\);?\s*$")
POPUP_PROMISE_RE = re.compile(r"^(?:const|let)\s+(page\d+)Promise\s*=\s*(page\d*)\.waitForEvent\(['\"]popup['\"]\);?\s*$")
POPUP_RESOLVE_RE = re.compile(r"^(?:const|let)\s+(page\d+)\s*=\s*await\s+(page\d+)Promise;?\s*$")
DL_PROMISE_RE = re.compile(r"^(?:const|let)\s+(download\d*)Promise\s*=\s*(page\d*)\.waitForEvent\(['\"]download['\"]\);?\s*$")
DL_RESOLVE_RE = re.compile(r"^(?:const|let)\s+(download\d*)\s*=\s*await\s+(download\d*)Promise;?\s*$")

LOGIN_LINE_RE = re.compile(
    r"(/account/org|signin-oidc|ReturnUrl=|Mã công ty|Tên đăng nhập|Nhập mật khẩu|getByRole\(['\"]button['\"],\s*\{\s*name:\s*['\"]Đăng nhập['\"])",
    re.I,
)
NOISE_CLICK_RE = re.compile(
    r"(Vui lòng đợi trong giây lát|^\s*await\s+page\d*\.getByRole\(['\"]dialog['\"]\)\.click\(\);?\s*$|^\s*await\s+page\d*\.locator\(['\"]div['\"]\)\.filter\(\{\s*hasText:\s*['\"]Bộ lọc|Bộ lọcĐặt lại)",
    re.I,
)
FRAGILE_RE = re.compile(r"(#mui-\d+-option-\d+|#hrv-checkbox-\d+|\.nth\(\d+\)|hasText:\s*/\^\$/|\(\d+\))")

CODE_LINE_HINT_RE = re.compile(
    r"^\s*(import\s+|test\(|async\s+|const\s+|let\s+|await\s+|//|/\*|\}|\{|page\d*\.)",
)


def _slug_key(text: str, idx: int) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", fold(text)).strip("_")
    if not base:
        base = f"tham_so_{idx}"
    if base[0].isdigit():
        base = f"p_{base}"
    return base[:28]


def _extract_value_hint(expr: str) -> str:
    m = re.search(r"name:\s*['\"]([^'\"]{2,40})['\"]", expr)
    return m.group(1) if m else ""


def clean_codegen_input(raw_text: str) -> dict[str, Any]:
    lines = (raw_text or "").splitlines()
    code_lines: list[str] = []
    notes: list[str] = []
    in_test_body = False
    has_code = False

    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        if s.startswith("import ") and "@playwright/test" in s:
            has_code = True
            continue
        if s.startswith("test(") and "=>" in s:
            has_code = True
            in_test_body = True
            continue
        if s == "});" and in_test_body:
            in_test_body = False
            continue
        if not has_code and not CODE_LINE_HINT_RE.match(s):
            notes.append(s)
            continue
        if not in_test_body and has_code and not CODE_LINE_HINT_RE.match(s):
            notes.append(s)
            continue
        has_code = True
        code_lines.append(s)

    # 1. Rút trích org/domain an toàn & loại bỏ toàn bộ khối đăng nhập OIDC + popup mở module ban đầu
    detected_org = ""
    detected_domain = ""
    start_url = ""
    main_page_var = "page"
    pre_filtered: list[str] = []
    skipping_login = False

    for i, s in enumerate(code_lines):
        if "getByRole('textbox', { name: 'Mã công ty' }).fill(" in s or 'getByRole("textbox", { name: "Mã công ty" }).fill(' in s:
            m_org = FILL_RE.match(s)
            if m_org:
                detected_org = m_org.group(4)
        gm = GOTO_RE.match(s)
        if gm:
            url = gm.group(3)
            if "/account/org" in url or url.rstrip("/") in ("https://zuizui.io", "https://id.zuizui.io"):
                skipping_login = True
                continue
            if not detected_domain:
                m_dom = re.match(r"^(https?://[^/]+)", url)
                if m_dom:
                    detected_domain = m_dom.group(1)
            if not start_url:
                start_url = url
                main_page_var = gm.group(1)
                continue

        if LOGIN_LINE_RE.search(s):
            skipping_login = True
            continue
        if skipping_login and (
            ".osc-header-icon-hamburger" in s
            or (POPUP_PROMISE_RE.match(s) and i < 20)
            or (POPUP_RESOLVE_RE.match(s) and i < 20)
        ):
            continue
        if skipping_login and i < 20 and "getByRole('link'" in s and i + 1 < len(code_lines) and POPUP_RESOLVE_RE.match(code_lines[i + 1]):
            continue
        skipping_login = False
        pre_filtered.append(s)

    # Chuẩn hóa biến page đầu tiên về `page`
    normalized_page_lines: list[str] = []
    for s in pre_filtered:
        if main_page_var != "page":
            s = re.sub(rf"\b{re.escape(main_page_var)}\b", "page", s)
        normalized_page_lines.append(s)

    # 2. Khử nhiễu IME tiếng Việt (Shift+ArrowLeft + fill lặp trên cùng locator) & click lặp liên tiếp
    deduped: list[str] = []
    for s in normalized_page_lines:
        if PRESS_IME_RE.match(s):
            continue
        if NOISE_CLICK_RE.search(s):
            continue
        fm = FILL_RE.match(s)
        if fm and deduped:
            prev_fm = FILL_RE.match(deduped[-1])
            if prev_fm and prev_fm.group(1) == fm.group(1) and prev_fm.group(2) == fm.group(2):
                deduped[-1] = s
                continue
            # Nếu ngay trước fill là click vào chính textbox đó thì giữ click (hoặc để gọn cũng ổn)
        cm = CLICK_RE.match(s)
        if cm and deduped:
            prev_cm = CLICK_RE.match(deduped[-1])
            if prev_cm and prev_cm.group(1) == cm.group(1) and prev_cm.group(2) == cm.group(2) and prev_cm.group(3) == cm.group(3):
                continue
        deduped.append(s)

    # 3. Thu thập thống kê cảnh báo & phân đoạn luồng
    fragile_selectors: list[str] = []
    for s in deduped:
        for m in FRAGILE_RE.finditer(s):
            tok = m.group(1)
            if tok not in fragile_selectors:
                fragile_selectors.append(tok)

    segments = _segment_lines(deduped)
    if len(deduped) > 0 and len(segments) <= 1 and len(deduped) > 60:
        # Đảm bảo nếu luồng dài chưa tách được theo link rõ ràng thì vẫn chia chunk logic theo nhóm action
        segments = _chunk_fallback(deduped)

    return {
        "context_notes": "\n".join(notes),
        "detected_org": detected_org,
        "detected_domain": detected_domain,
        "start_url": start_url,
        "raw_line_count": len(lines),
        "cleaned_line_count": len(deduped),
        "cleaned_lines": deduped,
        "cleaned_code": "\n".join(deduped),
        "fragile_selectors": fragile_selectors[:25],
        "segments": segments,
    }


def _infer_segment_meta(title: str, lines: list[str]) -> dict[str, Any]:
    joined = "\n".join(lines)
    low = fold(title + " " + joined)
    writes = bool(re.search(r"name:\s*['\"](Lưu|Cập nhật|Thêm|Tạo|Xóa|Chỉnh sửa)['\"]", joined))
    roles = ["Nhân viên phụ trách", "Quản lý"]
    flow = "Xử lý chung"
    flow_code = "DS"
    mode = "AUTO"
    if any(w in low for w in ("thiet lap", "nhan vien phu trach", "cau hinh phu trach", "sla", "them nhan vien")):
        roles = ["Quản trị module"]
        flow = "Thiết lập & Cấu hình"
        flow_code = "TL"
        if "sla" in low:
            flow_code = "SLA"
    elif any(w in low for w in ("bao cao", "tong quan", "so lieu van hanh", "hieu suat")):
        roles = ["Quản lý", "Quản trị module"]
        flow = "Báo cáo & Thống kê"
        flow_code = "BC"
        if "waitForEvent('download')" in joined or "Xuất dữ liệu" in joined:
            mode = "SEMI_AUTO"
    elif any(w in low for w in ("cap nhat trang thai", "thay doi nguoi phu trach", "thay doi do uu tien")):
        roles = ["Quản lý", "Quản trị module"]
        flow = "Danh sách & Thao tác hàng loạt"
        flow_code = "DS"
        writes = True
    elif any(w in low for w in ("luu bo loc", "hien thi cot", "bo loc", "tim kiem")):
        flow = "Danh sách & Tìm kiếm phiếu"
        flow_code = "DS"
    return {
        "flow": flow,
        "flow_code": flow_code,
        "automation_mode": mode,
        "required_roles": roles,
        "writes": writes,
    }


def _segment_lines(lines: list[str]) -> list[dict[str, Any]]:
    """Tách danh sách lệnh đã làm sạch thành từng nghiệp vụ dựa trên điểm chuyển màn hình / modal / chức năng."""
    if not lines:
        return []
    anchors: list[tuple[str, list[str]]] = []
    cur_title = "Tìm kiếm & Lọc danh sách"
    cur: list[str] = []

    def push():
        if cur:
            anchors.append((cur_title, list(cur)))
            cur.clear()

    for s in lines:
        m_link = re.search(r"getByRole\('link',\s*\{\s*name:\s*['\"]([^'\"]+)['\"]", s)
        m_btn_sec = re.search(r"getByRole\('button',\s*\{\s*name:\s*['\"](Báo cáo|Thiết Lập|Thêm nhân viên phụ trách|Cập nhật trạng thái|Thay đổi người phụ trách|Thay đổi độ ưu tiên)['\"]", s)
        m_title = re.search(r"getByTitle\(['\"](Thiết lập hiển thị cột)['\"]\)", s)
        is_split = False
        next_title = cur_title
        if m_link:
            next_title = m_link.group(1)
            is_split = True
        elif m_btn_sec:
            next_title = m_btn_sec.group(1)
            is_split = True
        elif m_title:
            next_title = m_title.group(1)
            is_split = True

        if is_split and len(cur) >= 4:
            push()
            cur_title = next_title
        elif is_split and not cur:
            cur_title = next_title
        cur.append(s)

    push()

    out: list[dict[str, Any]] = []
    for idx, (title, seg_lines) in enumerate(anchors, start=1):
        meta = _infer_segment_meta(title, seg_lines)
        warnings: list[str] = []
        if len(seg_lines) <= 2:
            warnings.append(f"Thao tác '{title}' mới dừng ở bước mở menu/click đầu, có thể chưa hoàn chỉnh.")
        if any(FRAGILE_RE.search(x) for x in seg_lines):
            warnings.append("Chứa selector động (#mui-..., #hrv-checkbox-..., .nth()) cần rà soát.")
        out.append({
            "index": idx,
            "title": title,
            "lines": seg_lines,
            "warnings": warnings,
            **meta,
        })
    return out


def _chunk_fallback(lines: list[str], size: int = 35) -> list[dict[str, Any]]:
    out = []
    for i in range(0, len(lines), size):
        chunk = lines[i : i + size]
        title = f"Nhóm thao tác #{len(out) + 1}"
        meta = _infer_segment_meta(title, chunk)
        out.append({"index": len(out) + 1, "title": title, "lines": chunk, "warnings": [], **meta})
    return out


def _convert_segment_to_sandbox(seg: dict[str, Any], default_start_url: str, module_code: str) -> dict[str, Any]:
    """Chuyển đổi xác định một đoạn codegen thành script chuẩn sandbox `kit.ts` kèm tham số & assert."""
    params: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    body_lines: list[str] = []
    steps: list[str] = []
    dl_vars: set[str] = set()
    popup_vars: dict[str, str] = {}

    for raw in seg["lines"]:
        s = raw
        # Popup
        pm = POPUP_PROMISE_RE.match(s)
        if pm:
            popup_vars[pm.group(1)] = ""
            continue
        rm = POPUP_RESOLVE_RE.match(s)
        if rm and rm.group(1) in popup_vars:
            pvar = rm.group(1)
            prev_line = body_lines.pop() if body_lines else ""
            body_lines.append(
                f"await openPopup(async () => {{\n  {prev_line}\n}}, async ({pvar}) => {{\n  assert({pvar}.url().length > 0, 'Popup mở thành công');\n}});"
            )
            continue
        # Download
        dm = DL_PROMISE_RE.match(s)
        if dm:
            dl_vars.add(dm.group(1))
            continue
        drm = DL_RESOLVE_RE.match(s)
        if drm and drm.group(2) in dl_vars:
            prev_line = body_lines.pop() if body_lines else ""
            body_lines.append(
                f"const dlInfo = await expectDownload(async () => {{\n  {prev_line}\n}});\nassert(Boolean(dlInfo?.filename), 'Tải tệp xuất dữ liệu thành công');"
            )
            continue

        # Tham số hóa `.fill('...')`
        fm = FILL_RE.match(s)
        if fm and fm.group(1) == "page":
            loc_expr, val = fm.group(2), fm.group(4)
            hint = _extract_value_hint(loc_expr) or "noi_dung"
            key = _slug_key(hint, len(params) + 1)
            while key in seen_keys:
                key = f"{key}_{len(params) + 1}"[:28]
            seen_keys.add(key)
            params.append({"key": key, "label": hint or key, "type": "text", "value": val, "auto": True, "fallback": "first"})
            if seg["writes"]:
                s = f"await page.{loc_expr}.fill(`${{ctx.testPrefix}} ${{ctx.val('{key}', {val!r})}}`);"
            else:
                s = f"await page.{loc_expr}.fill(ctx.val('{key}', {val!r}));"

        # Thay thế ID động #mui- / #hrv-checkbox- bằng locator bền vững hơn
        s = re.sub(r"page\.locator\(['\"]#mui-\d+-option-\d+['\"]\)", "page.getByRole('option').first()", s)
        s = re.sub(r"page\.locator\(['\"]#hrv-checkbox-\d+['\"]\)", "page.getByRole('checkbox').first()", s)
        # Bỏ đếm số ngoặc đơn (0) trong text tab
        s = re.sub(r"getByText\('Tôi phụ trách/Hỗ trợ \(\d+\)'\)", "getByText(/Tôi phụ trách\\/Hỗ trợ/i)", s)

        body_lines.append(s)

    step_label = seg["title"]
    steps.append(f"Mở màn hình & thực hiện: {step_label}")
    indented = "\n  ".join(body_lines)
    script = (
        f"await step({step_label!r}, async () => {{\n"
        f"  {indented}\n"
        f"  assert(Boolean(page.url()), 'Trang vẫn hoạt động bình thường sau thao tác');\n"
        f"}});\n"
    )
    if len(script) > 18000:
        script = script[:18000] + "\n// [Đã rút gọn do vượt ngưỡng độ dài]"

    # Chuyển URL sang dạng dùng chung nếu thuộc cụm DV5S
    start_url = default_start_url
    up = (module_code or "").strip().upper()
    if up in ("DV5S", "MAINT", "SCM", "IOT") and start_url:
        start_url = re.sub(r"^https?://[^/]+/(maintenance|scm|iot)/", "/{subsystem}/", start_url, flags=re.I)
    if not start_url:
        start_url = "/{subsystem}/create/list" if up in ("DV5S", "MAINT", "SCM", "IOT") else "/create/list"

    criteria = [
        {
            "id": f"c_{seg['index']}",
            "description": f"Thực hiện thành công luồng '{step_label}' không phát sinh lỗi trang/console.",
            "assertion_hint": "assert(Boolean(page.url()), ...)",
            "required": True,
        }
    ]
    manual_checklist = []
    if seg["automation_mode"] == "SEMI_AUTO":
        manual_checklist.append("Kiểm tra nội dung tệp tải về / bố cục biểu đồ đúng dữ liệu thực tế.")

    return {
        "name": step_label,
        "module_code": up or "MAINT",
        "flow": seg["flow"],
        "flow_code": seg["flow_code"],
        "automation_mode": seg["automation_mode"],
        "start_url": start_url,
        "required_roles": seg["required_roles"],
        "writes": seg["writes"],
        "preconditions": ["Có dữ liệu phiếu mẫu trên môi trường Staging"] if seg["writes"] else [],
        "data_policy": {"test_prefix": "[AI TEST]", "cleanup_strategy": "none"},
        "expected_criteria": criteria,
        "manual_checklist": manual_checklist,
        "steps": steps,
        "params": params,
        "script": script,
        "warnings": seg["warnings"],
    }


def fallback_normalize_codegen(cleaned: dict[str, Any], module_code: str = "", subsystem_slug: str = "") -> list[dict[str, Any]]:
    default_url = cleaned.get("start_url") or (f"/{subsystem_slug}/create/list" if subsystem_slug else "")
    segs = cleaned.get("segments") or []
    if not segs and cleaned.get("cleaned_lines"):
        segs = [{"index": 1, "title": "Luồng thao tác chính", "lines": cleaned["cleaned_lines"], "warnings": [], **_infer_segment_meta("Luồng thao tác chính", cleaned["cleaned_lines"])}]
    return [_convert_segment_to_sandbox(seg, default_url, module_code) for seg in segs]
