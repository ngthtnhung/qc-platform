/**
 * Tự động hóa đăng nhập bằng Playwright cho từng tài khoản test.
 *
 * - Mở Chrome thật (headed) với profile riêng cho mỗi tài khoản: ~/.qa-launcher/profiles/<accountId>.
 *   Phiên đăng nhập được giữ lại, lần sau mở thường vào thẳng, không cần đăng nhập lại.
 * - Mật khẩu do launcher lấy từ server nhóm cho đúng phiên này, chỉ giữ trong bộ nhớ, không ghi ra đĩa.
 *   Chưa có mật khẩu: tự điền mã công ty và tên đăng nhập rồi dừng chờ bạn nhập mật khẩu.
 * - Gặp CAPTCHA hoặc OTP: dừng và chờ bạn. Không vượt qua.
 * - Môi trường chỉ đọc (PRODUCTION OrgID khác DEMO): chặn mọi request ghi, trừ máy chủ đăng nhập.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Profile Chrome lưu trên máy của từng người, không nằm trong project chung
const PROFILE_DIR = path.join(os.homedir(), '.qa-launcher', 'profiles');

const contexts = new Map(); // accountId -> BrowserContext

async function loadChromium() {
  try { return (await import('playwright-core')).chromium; }
  catch { throw new Error('Chưa cài playwright-core. Chạy: npm i playwright-core'); }
}

async function launchContext(chromium, accountId) {
  const userDataDir = path.join(PROFILE_DIR, accountId.replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(userDataDir, { recursive: true });
  let lastErr;
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launchPersistentContext(userDataDir, {
        channel, headless: false, viewport: null, args: ['--start-maximized']
      });
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Không mở được Chrome/Edge: ${lastErr?.message?.split('\n')[0]}`);
}

const visible = (page, sel) => page.locator(sel).filter({ visible: true }).first();
const exists = async (loc) => (await loc.count()) > 0;

/** Chạy các bước đăng nhập, thích ứng với form nhiều bước (mã công ty, rồi tài khoản, rồi mật khẩu) */
async function runLogin(page, { loginUrl, orgCode, username, password, onStatus }) {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  const isLoginPage = async () =>
    (await exists(visible(page, 'input[type=password], #orgcode, input[name=OrgCode]'))) ||
    /(^|\/\/)id\./.test(page.url());

  for (let step = 0; step < 5; step++) {
    if (!(await isLoginPage())) return 'LOGGED_IN';
    if (await exists(visible(page, 'iframe[src*="captcha" i], iframe[src*="recaptcha" i], .g-recaptcha, [class*="captcha" i]'))) {
      return 'NEEDS_USER_CAPTCHA';
    }

    const submit = () => visible(page, 'button[type=submit], input[type=submit]');
    const next = async () => {
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {}),
        submit().click()
      ]);
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    };

    const org = visible(page, '#orgcode, input[name=OrgCode]');
    if (await exists(org)) {
      if (!orgCode) return 'NEEDS_USER_ORG';
      onStatus?.('Điền mã công ty');
      await org.fill(orgCode);
      await next();
      continue;
    }

    const pw = visible(page, 'input[type=password]');
    const user = visible(page, 'input[type=text], input[type=email], input[type=tel], input:not([type])');
    const hasPw = await exists(pw);
    if (await exists(user) && !(await user.inputValue())) {
      onStatus?.('Điền tên đăng nhập');
      await user.fill(username);
    }
    if (hasPw) {
      if (!password) return 'NEEDS_PASSWORD';
      onStatus?.('Điền mật khẩu');
      await pw.fill(password);
      await next();
      continue;
    }
    if (await exists(user)) { await next(); continue; } // bước chỉ có tên đăng nhập
    break;
  }

  await page.waitForURL(u => !/(^|\/\/)id\./.test(u.toString()), { timeout: 15000 }).catch(() => {});
  return (await isLoginPage()) ? 'NEEDS_USER' : 'LOGGED_IN';
}

export const PlaywrightLogin = {
  /**
   * @param {object} p { accountId, envId, password, loginUrl, username, orgCode, landingUrl, readOnly, onStatus }
   * @returns {Promise<{status:string}>} LOGGED_IN | NEEDS_PASSWORD | NEEDS_USER | NEEDS_USER_CAPTCHA | NEEDS_USER_ORG
   */
  async login(p) {
    const chromium = await loadChromium();

    let ctx = contexts.get(p.accountId);
    if (ctx) { try { await ctx.pages()[0]?.bringToFront(); } catch { contexts.delete(p.accountId); ctx = null; } }
    if (!ctx) {
      ctx = await launchContext(chromium, p.accountId);
      contexts.set(p.accountId, ctx);
      ctx.on('close', () => contexts.delete(p.accountId));

      if (p.readOnly) {
        // Production chỉ đọc: chặn request ghi, trừ máy chủ đăng nhập
        await ctx.route('**/*', route => {
          const r = route.request();
          const host = new URL(r.url()).hostname;
          if (['GET', 'HEAD', 'OPTIONS'].includes(r.method()) || /^id\./.test(host)) return route.continue();
          return route.abort('blockedbyclient');
        });
      }
    }

    const page = ctx.pages()[0] || await ctx.newPage();
    p.onStatus?.('Đang mở trang đăng nhập');
    const status = await runLogin(page, {
      loginUrl: p.loginUrl, orgCode: p.orgCode, username: p.username,
      password: p.password || null, onStatus: p.onStatus
    });

    const hasLanding = /^https?:\/\//.test(p.landingUrl || '');
    if (status === 'LOGGED_IN' && hasLanding) {
      await page.goto(p.landingUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    } else if (status.startsWith('NEEDS_') && hasLanding) {
      // Bạn tự hoàn tất đăng nhập (mật khẩu, OTP...); xong thì tự vào link đã chọn
      page.waitForURL(u => !/(^|\/\/)id\./.test(u.toString()), { timeout: 180000 })
        .then(() => page.goto(p.landingUrl, { waitUntil: 'domcontentloaded' }))
        .catch(() => {});
    }
    return { status, page };
  },

  async close(accountId) {
    const ctx = contexts.get(accountId);
    contexts.delete(accountId);
    if (ctx) await ctx.close().catch(() => {});
  }
};
