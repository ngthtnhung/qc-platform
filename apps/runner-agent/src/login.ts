/**
 * Đăng nhập tự động cho tài khoản test (port từ apps/launcher/playwright-login.js).
 * - Mật khẩu do server cấp MỘT lần cho lần chạy này, chỉ giữ trong bộ nhớ, không ghi đĩa.
 * - Gặp CAPTCHA/OTP: dừng, KHÔNG vượt qua (runner báo lỗi để người dùng xử lý).
 * - Form đăng nhập nhiều bước (mã công ty → tài khoản → mật khẩu) được thích ứng theo từng bước.
 * CHƯA kiểm chứng với Staging thật (cần tài khoản test của bạn); logic giữ nguyên bản Node đang dùng.
 */
import type { Locator, Page } from "playwright-core";

export type LoginStatus = "LOGGED_IN" | "NEEDS_PASSWORD" | "NEEDS_USER" | "NEEDS_USER_CAPTCHA" | "NEEDS_USER_ORG";

const visible = (page: Page, sel: string): Locator => page.locator(sel).filter({ visible: true }).first();
const exists = async (loc: Locator) => (await loc.count()) > 0;
const isIdHost = (u: string) => /(^|\/\/)id\./.test(u);

export async function runLogin(
  page: Page,
  p: { loginUrl: string; orgCode?: string; username: string; password: string | null; onStatus?: (s: string) => void },
): Promise<LoginStatus> {
  await page.goto(p.loginUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  const isLoginPage = async () =>
    (await exists(visible(page, "input[type=password], #orgcode, input[name=OrgCode]"))) || isIdHost(page.url());

  for (let step = 0; step < 5; step++) {
    if (!(await isLoginPage())) return "LOGGED_IN";
    if (await exists(visible(page, 'iframe[src*="captcha" i], iframe[src*="recaptcha" i], .g-recaptcha, [class*="captcha" i]'))) {
      return "NEEDS_USER_CAPTCHA";
    }
    const next = async () => {
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {}),
        visible(page, "button[type=submit], input[type=submit]").click(),
      ]);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    };

    const org = visible(page, "#orgcode, input[name=OrgCode]");
    if (await exists(org)) {
      if (!p.orgCode) return "NEEDS_USER_ORG";
      p.onStatus?.("Điền mã công ty");
      await org.fill(p.orgCode);
      await next();
      continue;
    }
    const pw = visible(page, "input[type=password]");
    const user = visible(page, "input[type=text], input[type=email], input[type=tel], input:not([type])");
    const hasPw = await exists(pw);
    if ((await exists(user)) && !(await user.inputValue())) {
      p.onStatus?.("Điền tên đăng nhập");
      await user.fill(p.username);
    }
    if (hasPw) {
      if (!p.password) return "NEEDS_PASSWORD";
      p.onStatus?.("Điền mật khẩu");
      await pw.fill(p.password);
      await next();
      continue;
    }
    if (await exists(user)) {
      await next();
      continue;
    }
    break;
  }
  await page.waitForURL((u) => !isIdHost(u.toString()), { timeout: 15_000 }).catch(() => {});
  return (await isLoginPage()) ? "NEEDS_USER" : "LOGGED_IN";
}
