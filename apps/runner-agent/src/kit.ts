/**
 * Chạy script Playwright của một lần thực thi đã được QC duyệt. Port từ apps/launcher/task-runner.js, giữ nguyên API cho script:
 *   page, ctx, step(tên, fn), assert(điều kiện, thông báo), pickOption(locator, 'khóa', giáTrịTùyChọn), attachFiles(input, 'khóa')
 *   ctx = { username, startUrl, testPrefix, params, log, has, val, list }
 *
 * AN TOÀN: `vm` chỉ là hàng rào chống lỗi vô ý, KHÔNG phải ranh giới bảo mật. Kiểm soát thật:
 *  1. server chỉ giao code đã được QC duyệt (APPROVED) kèm sha256;
 *  2. runner tự băm lại và TỪ CHỐI chạy nếu lệch;
 *  3. Docker Runner chạy trong container (cách ly tiến trình/hệ thống tệp); Host Runner chạy với quyền của người dùng máy đó.
 */
import { createHash } from "node:crypto";
import vm from "node:vm";

export const TIMEOUT_MS = 120_000;

export type StepResult = { name: string; status: "PASS" | "FAIL"; ms: number; error?: string };
export type RunResult = { status: "PASSED" | "FAILED"; steps: StepResult[]; log: string[]; error: string; duration_ms: number; sha256: string };
export type Param = { key: string; value: string; auto?: boolean; fallback?: "first" | "random" };

export type LocatorLike = {
  first(): { waitFor(o: object): Promise<void> };
  allInnerTexts(): Promise<string[]>;
  nth(i: number): { click(): Promise<void> };
};
export type InputLike = { setInputFiles(paths: string[]): Promise<void> };
export type PopupPageLike = {
  waitForLoadState?(state?: string, opts?: { timeout?: number }): Promise<void>;
  on?(ev: string, fn: (e: unknown) => void): void;
  url?(): string;
  close(): Promise<void>;
};
export type DownloadLike = {
  suggestedFilename(): string;
  failure(): Promise<string | null>;
};
export type PageLike = {
  waitForEvent?(ev: string, opts?: { timeout?: number }): Promise<unknown>;
};

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

const foldText = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/\s+/g, " ").trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const splitList = (s: unknown) => [...new Set(String(s ?? "").split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean))];

/** Lỗi Playwright có dòng đầu chung chung; kèm dòng "waiting for ..." để biết đang chờ phần tử nào. */
export function brief(e: unknown): string {
  const lines = String((e as Error)?.message ?? e).split("\n").map((l) => l.trim()).filter(Boolean);
  const wait = lines.find((l) => /waiting for/.test(l));
  return ((lines[0] ?? "") + (wait ? " | " + wait : "")).slice(0, 400);
}

export class ShaMismatchError extends Error {}

export async function runScript(opts: {
  script: string;
  expectedSha256: string;
  page: unknown;
  username: string;
  startUrl: string;
  params: Record<string, string>;
  paramMeta?: Param[];
  files?: Record<string, string[]>;
  testPrefix?: string;
  timeoutMs?: number;
}): Promise<RunResult> {
  const sha = sha256Hex(opts.script);
  if (sha !== opts.expectedSha256) throw new ShaMismatchError("Mã băm code không khớp bản đã duyệt, từ chối chạy");

  const steps: StepResult[] = [];
  const log: string[] = [];
  const files = opts.files ?? {};
  const meta = Object.fromEntries((opts.paramMeta ?? []).map((p) => [p.key, p]));
  const started = Date.now();

  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    try {
      const r = await fn();
      steps.push({ name, status: "PASS", ms: Date.now() - t });
      return r;
    } catch (e) {
      steps.push({ name, status: "FAIL", ms: Date.now() - t, error: brief(e) });
      throw e;
    }
  };
  const assert = (cond: unknown, msg?: string) => {
    if (!cond) throw new Error(msg || "Điều kiện không đúng");
  };
  const has = (key: string) => (files[key]?.length ?? 0) > 0 || String(opts.params[key] ?? "").trim() !== "";
  const ctx = {
    username: opts.username,
    startUrl: opts.startUrl,
    testPrefix: opts.testPrefix ?? "[AI TEST]",
    params: opts.params,
    log: (...a: unknown[]) => void log.push(a.join(" ")),
    has,
    val: (key: string, dflt = "") => (has(key) ? String(opts.params[key]).trim() : dflt),
    list: (key: string) => splitList(opts.params[key]),
  };

  const pickOption = async (options: LocatorLike, key: string, want?: string) => {
    const target = want !== undefined ? want : opts.params[key];
    const w = foldText(target);
    await options.first().waitFor({ state: "visible", timeout: 10_000 });
    let texts: string[] = [];
    let idx = -1;
    for (let i = 0; i < 20; i++) {
      texts = (await options.allInnerTexts()).map((t) => t.trim());
      idx = w ? texts.findIndex((t) => foldText(t) === w) : -1;
      if (idx < 0 && w) idx = texts.findIndex((t) => foldText(t).includes(w));
      if (!w || idx >= 0) break;
      await sleep(300);
    }
    if (idx < 0) {
      const auto = meta[key]?.auto !== false;
      if (w && !auto) throw new Error(`Không có lựa chọn "${target}" cho "${key}". Đang có: ${texts.slice(0, 8).join(" | ")}`);
      if (!texts.length) throw new Error(`Danh sách "${key}" trống`);
      idx = meta[key]?.fallback === "random" ? Math.floor(Math.random() * texts.length) : 0;
      ctx.log(w ? `Không có "${target}", đã chọn "${texts[idx]}" cho ${key}` : `${key} để trống, đã chọn ${meta[key]?.fallback === "random" ? "ngẫu nhiên" : "mục đầu tiên"}: "${texts[idx]}"`);
    }
    await options.nth(idx).click();
    return texts[idx];
  };

  const attachFiles = async (input: InputLike, key: string) => {
    const paths = files[key] ?? [];
    if (!paths.length) return false;
    await input.setInputFiles(paths);
    return true;
  };

  const openPopup = async <T = void>(
    triggerFn: () => Promise<unknown>,
    checkFn?: (popup: PopupPageLike) => Promise<T>,
    timeoutMs = 30_000,
  ): Promise<T | undefined> => {
    const p = opts.page as PageLike;
    if (!p?.waitForEvent) throw new Error("Trình duyệt không hỗ trợ waitForEvent('popup')");
    const [popup] = await Promise.all([
      p.waitForEvent("popup", { timeout: timeoutMs }) as Promise<PopupPageLike>,
      triggerFn(),
    ]);
    try {
      popup.on?.("pageerror", (e: unknown) => ctx.log(`[popup pageerror] ${String((e as Error)?.message ?? e)}`));
      await popup.waitForLoadState?.("domcontentloaded", { timeout: timeoutMs }).catch(() => {});
      if (checkFn) return await checkFn(popup);
      return undefined;
    } finally {
      await popup.close?.().catch(() => {});
    }
  };

  const expectDownload = async (
    triggerFn: () => Promise<unknown>,
    dlOpts?: { ext?: string; nameContains?: string },
    timeoutMs = 30_000,
  ): Promise<{ filename: string }> => {
    const p = opts.page as PageLike;
    if (!p?.waitForEvent) throw new Error("Trình duyệt không hỗ trợ waitForEvent('download')");
    const [dl] = await Promise.all([
      p.waitForEvent("download", { timeout: timeoutMs }) as Promise<DownloadLike>,
      triggerFn(),
    ]);
    const failure = await dl.failure();
    if (failure) throw new Error(`Tải tệp thất bại: ${failure}`);
    const filename = dl.suggestedFilename();
    if (dlOpts?.ext && !filename.toLowerCase().endsWith(dlOpts.ext.toLowerCase())) {
      throw new Error(`Tên tệp "${filename}" không đúng định dạng ${dlOpts.ext}`);
    }
    if (dlOpts?.nameContains && !filename.toLowerCase().includes(dlOpts.nameContains.toLowerCase())) {
      throw new Error(`Tên tệp "${filename}" không chứa "${dlOpts.nameContains}"`);
    }
    ctx.log(`Đã tải tệp: ${filename}`);
    return { filename };
  };

  const sandbox = vm.createContext({
    page: opts.page,
    ctx,
    step,
    assert,
    pickOption,
    attachFiles,
    openPopup,
    expectDownload,
    console: { log: ctx.log },
    setTimeout,
    URL,
  });
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  let error = "";
  let timer: NodeJS.Timeout | undefined;
  try {
    const fn = vm.runInContext(`(async () => {\n${opts.script}\n})`, sandbox, { timeout: 5000 }) as () => Promise<void>;
    await Promise.race([
      fn(),
      new Promise<never>((_, no) => {
        timer = setTimeout(() => no(new Error(`Quá ${timeoutMs / 1000} giây`)), timeoutMs);
      }),
    ]);
  } catch (e) {
    error = brief(e);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { status: error ? "FAILED" : "PASSED", steps, log, error, duration_ms: Date.now() - started, sha256: sha };
}
