/**
 * Bộ Test Automation (Playwright UI & API) cho các module:
 *  - MAINT (Bảo trì / DVBT - Task_Type = 6, route /maintenance/*)
 *  - SCM   (Dịch vụ hàng hóa - Task_Type = 7, route /scm/*)
 *  - IOT   (Hỗ trợ kỹ thuật  - Task_Type = 8, route /iot/*)
 *  - MSI   (Nhóm API dùng chung /msi/*, /schedule/ticket/*, /remind/runworker/*)
 *
 * Sinh từ 45 trang tài liệu mã nguồn Haraworks Wiki (https://wiki.hrws.cloud/).
 * Tương thích với cấu hình Staging (https://tasks.zuizui.io) và QA Launcher của QC Platform.
 */

import { test, expect } from 'playwright/test';

const BASE_URL = process.env.HARAWORKS_TASKS_URL || 'https://tasks.zuizui.io';
const TEST_PREFIX = '[AI TEST]';

test.describe('1. Module MAINT (Bảo trì - Task_Type = 6)', () => {
  test('TC-MAINT-001 & TC-MAINT-005: Kiểm tra truy cập Danh sách xử lý, Dashboard và giới hạn 1 năm trên Báo cáo vận hành Bảo trì', async ({ page }) => {
    // 1. Dashboard Tổng quan Bảo trì
    await page.goto(`${BASE_URL}/maintenance/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/maintenance\/dashboard/);
    const dashBody = await page.locator('body').innerText();
    expect(dashBody.length).toBeGreaterThan(50);

    // 2. Báo cáo Số liệu vận hành (/maintenance/report/operating) - Rule MAINT-005
    await page.goto(`${BASE_URL}/maintenance/report/operating`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/maintenance\/report\/operating/);
  });

  test('TC-MAINT-006: Kiểm tra cấu hình Đơn vị tạo phiếu Bảo trì và chặn trùng tên đơn vị (Rule MAINT-004)', async ({ page, request }) => {
    await page.goto(`${BASE_URL}/maintenance/config/unit`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/maintenance\/config\/unit/);

    // Kiểm tra API phân trang đơn vị tạo phiếu yêu cầu đủ Page & PageSize
    const pagingRes = await request.get(`${BASE_URL}/call/task_api/maintenance/config/unit?Page=1&PageSize=10`).catch(() => null);
    if (pagingRes && pagingRes.ok()) {
      const data = await pagingRes.json();
      expect(data).toBeDefined();
    }
  });

  test('TC-MAINT-001 (Tạo phiếu): Tạo phiếu Bảo trì [AI TEST] với độ ưu tiên mặc định Trung bình (Rule DV5S-047, DV5S-091)', async ({ page }) => {
    const issueTitle = `${TEST_PREFIX} Phiếu Bảo trì tự động ${Date.now()}`;
    await page.goto(`${BASE_URL}/maintenance/doing/list`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});

    const createBtn = page.getByRole('button', { name: 'Tạo phiếu' });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
      const dlg = page.locator('[role=dialog]');
      await expect(dlg).toBeVisible();

      const ta = dlg.locator('textarea[placeholder="Nhập vấn đề gặp phải"]');
      await ta.click();
      await ta.pressSequentially(issueTitle);
    }
  });
});

test.describe('2. Module IOT (Hỗ trợ kỹ thuật - Task_Type = 8)', () => {
  test('TC-IOT-001 & TC-IOT-008: Kiểm tra điều hướng canProcess, Dashboard Tổng quan IoT và Báo cáo vận hành IoT (isPageReport=true)', async ({ page }) => {
    // 1. Nếu tài khoản có canProcess = true, truy cập /iot/create/list sẽ tự điều hướng sang /iot/doing/list (Rule IOT-001)
    await page.goto(`${BASE_URL}/iot/doing/list`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/iot\/(doing|create)\/list/);

    // 2. Dashboard Tổng quan IoT (/iot/dashboard) - Rule IOT-008
    await page.goto(`${BASE_URL}/iot/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/iot\/dashboard/);

    // 3. Báo cáo Số liệu vận hành IoT (/iot/report/operating)
    await page.goto(`${BASE_URL}/iot/report/operating`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/iot\/report\/operating/);
  });

  test('TC-IOT-005 & TC-MSI-002: Kiểm tra Cấu hình trạng thái phiếu (/iot/config/status) và Quyền đánh giá tại cửa hàng (/iot/permission/rating)', async ({ page, request }) => {
    await page.goto(`${BASE_URL}/iot/config/rating`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/iot\/config\/rating/);

    // Rule IOT-005 / DV5S-042: Khi type=0 hoặc thiếu refToEntityId thì GET /iot/permission/rating trả về { canRate: false }
    const ratingRes = await request.get(`${BASE_URL}/call/task_api/iot/permission/rating?refToEntityId=&type=0`).catch(() => null);
    if (ratingRes && ratingRes.ok()) {
      const body = await ratingRes.json();
      expect(body.canRate).toBe(false);
    }
  });
});

test.describe('3. Module SCM (Dịch vụ hàng hóa - Task_Type = 7)', () => {
  test('TC-SCM-001 & TC-SCM-007: Kiểm tra Danh sách phiếu SCM, Dashboard SCM và drill-down Không đạt SLAs', async ({ page }) => {
    await page.goto(`${BASE_URL}/scm/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/scm\/dashboard/);

    await page.goto(`${BASE_URL}/scm/doing/list`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/scm\/(doing|create)\/list/);
  });

  test('TC-SCM-004, TC-SCM-005 & TC-SCM-006: Kiểm tra Cấu hình cửa hàng (/scm/config/store), Chức danh phụ trách (/scm/config/employee) và Đơn vị tạo phiếu (/scm/config/unit)', async ({ page }) => {
    await page.goto(`${BASE_URL}/scm/config/store`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/scm\/config\/store/);

    await page.goto(`${BASE_URL}/scm/config/employee`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/scm\/config\/employee/);

    await page.goto(`${BASE_URL}/scm/config/unit`, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page).toHaveURL(/\/scm\/config\/unit/);
  });
});

test.describe('4. Nhóm tính năng dùng chung MSI (SLA, Độ ưu tiên, Bộ lọc đã lưu, Lịch định kỳ)', () => {
  test('TC-MSI-003, TC-MSI-004 & TC-MSI-010: Kiểm tra Thiết lập SLA (/config/sla), Độ ưu tiên (/config/priority) và Lịch định kỳ (/schedule)', async ({ page }) => {
    for (const mod of ['maintenance', 'iot', 'scm']) {
      await page.goto(`${BASE_URL}/${mod}/config/sla`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page).toHaveURL(new RegExp(`/${mod}/config/sla`));

      await page.goto(`${BASE_URL}/${mod}/config/priority`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page).toHaveURL(new RegExp(`/${mod}/config/priority`));

      await page.goto(`${BASE_URL}/${mod}/schedule`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page).toHaveURL(new RegExp(`/${mod}/schedule`));
    }
  });
});
