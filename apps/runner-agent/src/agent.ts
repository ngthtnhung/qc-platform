import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ServerApi, ApiError, type Job } from "./api.js";
import { runScript, ShaMismatchError, type RunResult } from "./kit.js";
import { runLogin } from "./login.js";

export type AgentConfig = {
  server: string;
  token: string;
  pollMs: number;
  headless: boolean;
  /** CHỈ để kiểm thử giao thức trên máy dev: bỏ đăng nhập và không lấy mật khẩu. Cần đặt tường minh. */
  skipLogin: boolean;
  profileDir: string;
};

export type Diagnostics = { url: string; title: string; html: string; errors: string[] };
export type BrowserSession = {
  page: unknown;
  screenshot: () => Promise<Uint8Array | null>;
  /** Chẩn đoán khi script lỗi: trang đang ở đâu, lỗi JS của trang, DOM lúc đó (để biết trang trắng/sập hay selector sai). */
  diagnostics?: () => Promise<Diagnostics>;
  close: () => Promise<void>;
};
export type BrowserFactory = (job: Job, cfg: AgentConfig, password: string | null) => Promise<BrowserSession>;

const safe = (s: string) => s.replace(/[^\w.-]/g, "_");

/** Mở Chrome thật (hồ sơ riêng cho từng tài khoản, giữ phiên) và đăng nhập. Mật khẩu không ghi đĩa. */
export const playwrightBrowser: BrowserFactory = async (job, cfg, password) => {
  const { chromium } = await import("playwright-core");
  const userDataDir = path.join(cfg.profileDir, safe(job.account.id));
  fs.mkdirSync(userDataDir, { recursive: true });
  let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  let last: unknown;
  // Headless (Docker/Linux): ưu tiên Chromium đi kèm Playwright; có giao diện: Chrome/Edge thật của người dùng, rồi mới tới Chromium đi kèm
  const channels: (string | undefined)[] = cfg.headless ? [undefined, "chrome", "msedge"] : ["chrome", "msedge", undefined];
  for (const channel of channels) {
    try {
      ctx = await chromium.launchPersistentContext(userDataDir, { channel, headless: cfg.headless, viewport: cfg.headless ? { width: 1366, height: 800 } : null });
      break;
    } catch (e) {
      last = e;
    }
  }
  if (!ctx) throw new Error(`Không mở được trình duyệt (Chrome/Edge/Chromium): ${String((last as Error)?.message).split("\n")[0]}`);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const pageErrors: string[] = [];
  const keep = (m: string) => { if (pageErrors.length < 30) pageErrors.push(m.replace(/\s+/g, " ").slice(0, 300)); };
  page.on("pageerror", (e) => keep(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") keep(`[console.error] ${m.text()}`); });
  page.on("crash", () => keep("[crash] tab của trình duyệt bị sập"));
  if (!cfg.skipLogin) {
    const status = await runLogin(page, { loginUrl: job.environment.login_url, orgCode: job.account.expected_org, username: job.account.username, password });
    if (status !== "LOGGED_IN") {
      await ctx.close().catch(() => {});
      throw new Error(`Đăng nhập chưa hoàn tất (${status}); cần người dùng xử lý rồi chạy lại`);
    }
    if (/^https:\/\//.test(job.task.start_url)) await page.goto(job.task.start_url, { waitUntil: "domcontentloaded" });
  }
  return {
    page,
    screenshot: async () => page.screenshot({ type: "png" }).catch(() => null),
    diagnostics: async () => ({
      url: page.url(),
      title: await page.title().catch(() => ""),
      html: (await page.content().catch(() => "")).slice(0, 1_500_000),
      errors: [...pageErrors],
    }),
    close: () => ctx!.close().catch(() => {}),
  };
};

export type Logger = (msg: string) => void;

/** Xử lý MỘT việc: lấy mật khẩu (một lần) → mở trình duyệt → kiểm tra sha → chạy → báo kết quả (+ ảnh khi lỗi). */
export async function handleJob(api: ServerApi, job: Job, cfg: AgentConfig, browser: BrowserFactory, log: Logger): Promise<RunResult | null> {
  let session: BrowserSession | null = null;
  try {
    const password = cfg.skipLogin ? null : (await api.credentials(job.execution_id)).password;
    session = await browser(job, cfg, password);
    await api.start(job.execution_id);
    const meta = Object.keys(job.params).map((key) => ({ key, value: job.params[key] }));
    const result = await runScript({
      script: job.script, expectedSha256: job.sha256, page: session.page, username: job.account.username,
      startUrl: job.task.start_url, params: job.params, paramMeta: meta,
    });
    const diag = result.status === "FAILED" ? await session.diagnostics?.().catch(() => undefined) : undefined;
    if (diag) {
      result.log.push(`[chẩn đoán] URL khi lỗi: ${diag.url}`, `[chẩn đoán] Tiêu đề: ${diag.title || "(trống)"}`, `[chẩn đoán] Kích thước DOM: ${diag.html.length} ký tự`);
      result.log.push(...diag.errors.map((e) => `[chẩn đoán] ${e}`));
    }
    await api.report(job.execution_id, result);
    if (result.status === "FAILED") {
      const shot = await session.screenshot();
      if (shot) await api.artifact(job.execution_id, "screenshot", "failure.png", shot, "image/png").catch((e) => log(`Không tải được ảnh: ${(e as Error).message}`));
      if (diag?.html) await api.artifact(job.execution_id, "log", "failure-dom.txt", new TextEncoder().encode(diag.html), "text/plain").catch((e) => log(`Không tải được DOM: ${(e as Error).message}`));
    }
    return result;
  } catch (e) {
    const msg = e instanceof ShaMismatchError ? e.message : (e as Error).message;
    log(`Việc ${job.execution_id} lỗi: ${msg}`);
    // sha lệch thì không có sha hợp lệ để báo: để lease hết hạn (server xếp lại hoặc đánh FAILED), không báo kết quả giả
    if (!(e instanceof ShaMismatchError) && !(e instanceof ApiError && e.status === 409)) {
      await api.report(job.execution_id, { status: "FAILED", sha256: job.sha256, steps: [], log: [], error: msg.slice(0, 400), duration_ms: 0 }).catch(() => {});
    }
    return null;
  } finally {
    await session?.close();
  }
}

export async function runLoop(cfg: AgentConfig, browser: BrowserFactory, log: Logger, signal?: AbortSignal): Promise<void> {
  const api = new ServerApi(cfg.server, cfg.token);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  log(`Runner sẵn sàng → ${cfg.server} (${os.hostname()})`);
  while (!signal?.aborted) {
    try {
      const job = await api.claim();
      if (job) {
        log(`Nhận việc ${job.execution_id}: ${job.task.name}`);
        await handleJob(api, job, cfg, browser, log);
        await api.heartbeat("ONLINE").catch(() => {});
        continue; // còn việc thì nhận tiếp ngay
      }
      await api.heartbeat("ONLINE");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        log("Token runner không hợp lệ hoặc đã bị thu hồi. Dừng.");
        return;
      }
      log(`Lỗi kết nối: ${(e as Error).message}`);
    }
    await sleep(cfg.pollMs);
  }
}
