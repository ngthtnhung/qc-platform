from __future__ import annotations

import httpx
import pytest

from app.domains.automation import rules
from app.domains.flows.codegen import clean_codegen_input, fallback_normalize_codegen
from app.domains.integrations import service as integ
from app.domains.sources.models import Integration
from tests.conftest import login, make_qc


@pytest.fixture()
def qc(client, session):
    make_qc(session, "qcupgrade")
    login(client, "qcupgrade")
    return client


def test_codegen_precleaner_strips_login_and_collapses_ime_and_splits_flows():
    sample = """
import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://zuizui.io/');
  await page.goto('https://id.zuizui.io/account/org?ReturnUrl=xyz');
  await page.getByRole('textbox', { name: 'Mã công ty' }).fill('THL');
  await page.getByRole('textbox', { name: 'Tên đăng nhập' }).fill('NTTN191919');
  await page.getByRole('textbox', { name: 'Nhập mật khẩu' }).fill('abc@123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.locator('.osc-header-icon-hamburger').click();
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Bảo trì' }).click();
  const page1 = await page1Promise;
  await page1.goto('https://tasks.zuizui.io/maintenance/create/list');
  await page1.getByRole('textbox', { name: 'Nhập tên phiếu để tìm' }).fill('te');
  await page1.getByRole('textbox', { name: 'Nhập tên phiếu để tìm' }).press('Shift+ArrowLeft');
  await page1.getByRole('textbox', { name: 'Nhập tên phiếu để tìm' }).fill('text');
  await page1.getByRole('button', { name: 'Báo cáo' }).click();
  await page1.getByRole('button', { name: 'Báo cáo' }).click();
  await page1.getByRole('link', { name: 'Hiệu suất làm việc' }).click();
  const downloadPromise = page1.waitForEvent('download');
  await page1.getByRole('button', { name: 'Xuất dữ liệu' }).click();
  const download = await downloadPromise;
  await page1.getByRole('button', { name: 'Thiết Lập' }).click();
  await page1.getByRole('link', { name: 'Nhân Viên Phụ Trách' }).click();
  await page1.getByRole('textbox', { name: 'Mô tả ngắn' }).fill('đây là mô tả');
  await page1.getByRole('button', { name: 'Thêm', exact: true }).click();
  await page1.getByRole('link', { name: 'Thiết lập SLA' }).click();
});
đây là code gen từ playwright cho module MAINT = SCM = IOT = DV5S
"""
    cleaned = clean_codegen_input(sample)
    assert "abc@123" not in cleaned["cleaned_code"]
    assert "NTTN191919" not in cleaned["cleaned_code"]
    assert "id.zuizui.io" not in cleaned["cleaned_code"]
    assert cleaned["detected_org"] == "THL"
    assert cleaned["start_url"] == "https://tasks.zuizui.io/maintenance/create/list"
    assert "DV5S" in cleaned["context_notes"]
    # IME duplicate fill collapsed to last fill('text')
    assert "fill('te')" not in cleaned["cleaned_code"]
    assert "fill('text')" in cleaned["cleaned_code"]

    drafts = fallback_normalize_codegen(cleaned, module_code="DV5S", subsystem_slug="maintenance")
    assert len(drafts) >= 3
    for d in drafts:
        assert d["start_url"] == "/{subsystem}/create/list"
        if d["automation_mode"] != "MANUAL":
            assert rules.validate_script(d["script"]) == []


def test_direct_activate_manual_task_and_nonblocking_roles(qc, session):
    # Tạo môi trường + 1 tài khoản vai trò "Nhân viên" (khác required_roles=["Quản trị module"])
    env = qc.post(
        "/api/v1/environments",
        json={"code": "stg", "name": "Staging", "type": "STAGING", "base_url": "https://tasks.zuizui.io", "allowed_actions": ["AUTOMATE"]},
    ).json()
    acc = qc.post(
        "/api/v1/accounts",
        json={"environment_id": env["id"], "name": "NV", "username_ref": "nv@x.com", "role_label": "Nhân viên"},
    ).json()

    # 1. Tạo tác vụ AUTO dùng activate_immediately=True -> chạy ngay không qua /approvals
    r = qc.post(
        "/api/v1/automation/tasks",
        json={
            "name": "Thiết lập nhân viên (DV5S)",
            "module_code": "DV5S",
            "flow": "Thiết lập",
            "automation_mode": "AUTO",
            "start_url": "/{subsystem}/create/list",
            "steps": ["Mở trang", "Kiểm tra"],
            "script": "await step('Mở', async () => { assert(Boolean(page.url()), 'ok'); });",
            "required_roles": ["Quản trị module"],
            "preconditions": ["Đang trên Staging"],
            "data_policy": {"test_prefix": "[QA TEST]"},
            "expected_criteria": [{"id": "c1", "description": "Trang hiển thị đúng"}],
            "activate_immediately": True,
        },
    )
    assert r.status_code == 201
    t = r.json()
    assert t["runnable"] is True
    assert t["approved_version"] == 1

    # 2. Chọn account bất kỳ (không cần trùng required_roles) đều chạy được & nhận target_module SCM
    run_res = qc.post(f"/api/v1/automation/tasks/{t['id']}/run", json={"account_id": acc["id"], "target_module": "SCM"})
    assert run_res.status_code == 201

    # 3. Thêm code version thủ công + kích hoạt bằng endpoint /activate (đã sửa crash 500)
    v2 = qc.post(
        f"/api/v1/automation/tasks/{t['id']}/versions",
        json={"script": "await step('Mở v2', async () => { assert(true, 'ok'); });", "note": "sửa code"},
    )
    assert v2.status_code == 201
    act = qc.post(f"/api/v1/automation/tasks/{t['id']}/versions/{v2.json()['id']}/activate")
    assert act.status_code == 200 and act.json()["status"] == "APPROVED"

    # 4. Tạo tác vụ MANUAL -> không tạo CodeVersion, từ chối /run
    man = qc.post(
        "/api/v1/automation/tasks",
        json={
            "name": "Kiểm tra layout biểu đồ bằng mắt",
            "module_code": "MAINT",
            "automation_mode": "MANUAL",
            "steps": ["Mở tab Báo cáo Tổng quan"],
            "manual_checklist": ["Biểu đồ tròn hiển thị đủ màu"],
        },
    )
    assert man.status_code == 201
    assert man.json()["runnable"] is False
    assert man.json()["versions"] == []
    assert qc.post(f"/api/v1/automation/tasks/{man.json()['id']}/run", json={}).status_code == 422

    # 5. Filter theo MAINT tự động lấy cả tác vụ dùng chung của cụm DV5S
    maint_tasks = qc.get("/api/v1/automation/tasks?module=MAINT&include_shared=true").json()
    assert any(x["id"] == t["id"] and x["inherited_from_cluster"] == "DV5S" for x in maint_tasks)


def test_integration_status_long_text_and_granular_pet_pulse(qc, session):
    assert qc.put("/api/v1/integrations/gemini", json={"value": "fake-gem-key"}).status_code == 204
    assert qc.put("/api/v1/integrations/anthropic", json={"value": "fake-ant-key"}).status_code == 204

    # Ngay khi mới lưu chưa check -> state == "unchecked"
    st_list = {x["key"]: x for x in qc.get("/api/v1/integrations").json()}
    assert st_list["gemini"]["state"] == "unchecked"

    # Mock Gemini active nhưng Anthropic expired (401) -> pet-pulse không được che giấu Anthropic lỗi!
    integ.TRANSPORT["gemini"] = httpx.MockTransport(lambda req: httpx.Response(200, json={"models": []}))
    integ.TRANSPORT["anthropic"] = httpx.MockTransport(lambda req: httpx.Response(401, json={"error": {"message": "invalid x-api-key"}}))
    try:
        pulse = qc.get("/api/v1/sources/pet-pulse?force=true").json()
        assert pulse["integration_states"]["gemini"] == "active"
        assert pulse["integration_states"]["anthropic"] == "expired"
        assert "anthropic" in pulse["missing_integrations"]
        # last_check_status có thể dài > 40 ký tự không bị lỗi DB
        ant = session.get(Integration, "anthropic")
        assert ant and len(ant.last_check_status) > 40
    finally:
        integ.TRANSPORT.clear()
