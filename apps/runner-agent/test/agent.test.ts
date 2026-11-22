import fs from "node:fs";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { handleJob, type AgentConfig, type BrowserFactory } from "../src/agent.js";
import { ApiError, ServerApi, type Job } from "../src/api.js";
import { sha256Hex } from "../src/kit.js";
import { checkServerUrl } from "../src/serverUrl.js";

const cfg: AgentConfig = { server: "http://x", token: "rn_t", pollMs: 1, headless: true, skipLogin: false, profileDir: os.tmpdir() };
const mkJob = (script: string, sha = sha256Hex(script)): Job => ({
  execution_id: "e1", attempt: 1, lease_seconds: 300, task: { name: "t", start_url: "https://s.example.com", writes: false }, script, sha256: sha,
  params: {}, account: { id: "a1", username: "nv", expected_org: "o", route: "" }, environment: { code: "stg", type: "STAGING", login_url: "https://s.example.com/login" },
});
const fakeBrowser = (closed = { n: 0 }): BrowserFactory => async () => ({ page: {}, screenshot: async () => new Uint8Array([1, 2, 3]), close: async () => void closed.n++ });
const fakeApi = () => {
  const calls: string[] = [];
  const api = {
    credentials: vi.fn(async () => (calls.push("credentials"), { username: "nv", password: "pw" })),
    start: vi.fn(async () => void calls.push("start")),
    report: vi.fn(async (_id: string, _body: unknown) => (calls.push("report"), { status: "PASSED" })),
    artifact: vi.fn(async () => (calls.push("artifact"), { file_id: "f" })),
  };
  return { api: api as unknown as ServerApi, mocks: api, calls };
};

describe("handleJob", () => {
  it("lấy mật khẩu một lần → start → chạy → báo kết quả; mật khẩu chỉ đi vào trình duyệt", async () => {
    const { api, mocks, calls } = fakeApi();
    const seen: (string | null)[] = [];
    const browser: BrowserFactory = async (_j, _c, pw) => (seen.push(pw), fakeBrowser()(_j, _c, pw));
    const r = await handleJob(api, mkJob("await step('a', async () => {});"), cfg, browser, () => {});
    expect(r?.status).toBe("PASSED");
    expect(calls).toEqual(["credentials", "start", "report"]);
    expect(seen).toEqual(["pw"]);
    expect(JSON.stringify(mocks.report.mock.calls)).not.toContain("pw");
  });

  it("script lỗi ⇒ báo FAILED kèm ảnh chụp lỗi; luôn đóng trình duyệt", async () => {
    const { api, calls } = fakeApi();
    const closed = { n: 0 };
    const r = await handleJob(api, mkJob("assert(false, 'x')"), cfg, fakeBrowser(closed), () => {});
    expect(r?.status).toBe("FAILED");
    expect(calls).toEqual(["credentials", "start", "report", "artifact"]);
    expect(closed.n).toBe(1);
  });

  it("sha lệch ⇒ KHÔNG chạy và KHÔNG báo kết quả giả (để lease hết hạn)", async () => {
    const { api, calls } = fakeApi();
    const closed = { n: 0 };
    const r = await handleJob(api, mkJob("await step('a', async () => {});", "0".repeat(64)), cfg, fakeBrowser(closed), () => {});
    expect(r).toBeNull();
    expect(calls).not.toContain("report");
    expect(closed.n).toBe(1);
  });

  it("mở trình duyệt lỗi ⇒ báo FAILED có lý do", async () => {
    const { api, mocks } = fakeApi();
    await handleJob(api, mkJob("await step('a', async () => {});"), cfg, async () => { throw new Error("Không mở được Chrome"); }, () => {});
    expect(mocks.report.mock.calls[0][1]).toMatchObject({ status: "FAILED", error: "Không mở được Chrome" });
  });

  it("skipLogin (chỉ dev) ⇒ không đụng tới mật khẩu", async () => {
    const { api, calls } = fakeApi();
    await handleJob(api, mkJob("await step('a', async () => {});"), { ...cfg, skipLogin: true }, fakeBrowser(), () => {});
    expect(calls).not.toContain("credentials");
  });
});

describe("ServerApi", () => {
  it("gắn Bearer token, đọc lỗi chuẩn của server, 204 không có thân", async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "INVALID_RUNNER_TOKEN", message: "no" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = new ServerApi("http://x/", "rn_abc", f as unknown as typeof fetch);
    expect(await api.claim()).toBeNull();
    expect(f.mock.calls[0][0]).toBe("http://x/api/v1/runner/claim");
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer rn_abc" });
    await expect(api.heartbeat()).rejects.toMatchObject({ status: 401, code: "INVALID_RUNNER_TOKEN" } satisfies Partial<ApiError>);
    await expect(api.start("e1")).resolves.toBeUndefined();
  });
});

describe("integration: Chrome thật", () => {
  const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => fs.existsSync(p));
  it.skipIf(!chrome)("chạy script thật trên trang cục bộ và chụp ảnh", async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    try {
      const script = `
        await step('Dựng trang', async () => { await page.setContent('<h1 id=t>Xin chào</h1><select id=s><option>A</option><option>Bảo trì</option></select>'); });
        await step('Có tiêu đề', async () => assert((await page.locator('#t').innerText()) === 'Xin chào', 'sai tiêu đề'));
        await step('Chọn loại', async () => { await page.locator('#s').selectOption({ label: ctx.val('loai', 'A') }); });`;
      const { runScript } = await import("../src/kit.js");
      const r = await runScript({ script, expectedSha256: sha256Hex(script), page, username: "nv", startUrl: "https://s.example.com", params: { loai: "Bảo trì" } });
      expect(r.status).toBe("PASSED");
      expect(r.steps.map((s) => s.status)).toEqual(["PASS", "PASS", "PASS"]);
      expect(await page.locator("#s").inputValue()).toBe("Bảo trì");
      const fail = await runScript({ script: "await step('x', async () => page.locator('#khong-co').click({ timeout: 500 }));", expectedSha256: sha256Hex("await step('x', async () => page.locator('#khong-co').click({ timeout: 500 }));"), page, username: "nv", startUrl: "", params: {} });
      expect(fail.status).toBe("FAILED");
      expect(fail.error).toContain("waiting for");
      expect((await page.screenshot({ type: "png" })).length).toBeGreaterThan(100);
    } finally {
      await browser.close();
    }
  }, 60_000);
});


describe("checkServerUrl", () => {
  it("https luôn được; http chỉ localhost; http nội bộ cần cờ tường minh", () => {
    expect(checkServerUrl("https://qc.noi-bo.local")).toBeNull();
    expect(checkServerUrl("http://localhost:8000")).toBeNull();
    expect(checkServerUrl("http://127.0.0.1:8000")).toBeNull();
    expect(checkServerUrl("http://api:8000")).not.toBeNull();
    expect(checkServerUrl("http://api:8000", true)).toBeNull();
    expect(checkServerUrl("http://evil.example.com/x@y", false)).not.toBeNull();
    expect(checkServerUrl("ftp://api", true)).not.toBeNull();
  });
});
