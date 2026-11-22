import { describe, expect, it } from "vitest";
import { CAPTURE_SCRIPT, parseEvent, type RecEvent } from "../src/recorder.js";

describe("parseEvent", () => {
  it("chỉ nhận sự kiện hợp lệ", () => {
    expect(parseEvent('{"t":"click","el":{"tag":"button"}}')).toMatchObject({ t: "click" });
    expect(parseEvent('{"t":"evil","el":{}}')).toBeNull();
    expect(parseEvent("không phải json")).toBeNull();
    expect(parseEvent('{"t":"click"}')).toBeNull();
  });
});

describe("CAPTURE_SCRIPT trong trình duyệt thật", () => {
  it("ghi click/fill/select, che mật khẩu", async () => {
    const { chromium } = await import("playwright-core");
    let browser;
    for (const channel of ["chrome", "msedge", undefined] as (string | undefined)[]) {
      try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* thử tiếp */ }
    }
    if (!browser) return; // máy không có trình duyệt: bỏ qua
    const events: RecEvent[] = [];
    const page = await browser.newPage();
    await page.exposeBinding("__qcRec", (_s, raw: string) => { const e = parseEvent(String(raw)); if (e) events.push(e); });
    await page.addInitScript(CAPTURE_SCRIPT); // áp dụng cho các lần điều hướng sau; trang about:blank hiện tại cần chạy tay
    await page.setContent(`<form><label for="n">Tên phiếu</label><input id="n" data-testid="name"><label for="p">Mật khẩu</label><input id="p" type="password">
      <select aria-label="Loại"><option>A</option><option>Khẩn cấp</option></select><button type="button">Lưu</button></form>`);
    await page.evaluate(CAPTURE_SCRIPT);
    await page.getByTestId("name").pressSequentially("Phiếu thử");
    await page.getByTestId("name").blur();
    await page.locator("#p").pressSequentially("Sup3r-Secret!");
    await page.locator("#p").blur();
    await page.getByLabel("Loại").selectOption({ label: "Khẩn cấp" });
    await page.getByRole("button", { name: "Lưu" }).click();
    await browser.close();
    const blob = JSON.stringify(events);
    expect(blob).not.toContain("Sup3r-Secret");
    expect(events.find((e) => e.t === "fill" && e.el.testid === "name")).toMatchObject({ value: "Phiếu thử" });
    expect(events.find((e) => e.t === "select")).toMatchObject({ value: "Khẩn cấp" });
    expect((events.find((e) => e.t === "click") as { el: object } | undefined)?.el).toMatchObject({ role: "button", name: "Lưu" });
  }, 60_000);
});
