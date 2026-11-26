import { describe, expect, it } from "vitest";
import { runScript, sha256Hex, ShaMismatchError } from "../src/kit.js";

const base = (script: string, extra: object = {}) => ({
  script, expectedSha256: sha256Hex(script), page: {}, username: "nv", startUrl: "https://staging.example.com", params: {}, ...extra,
});

const options = (texts: string[], clicked: number[] = []) => ({
  first: () => ({ waitFor: async () => {} }),
  allInnerTexts: async () => texts,
  nth: (i: number) => ({ click: async () => void clicked.push(i) }),
});

describe("runScript", () => {
  it("từ chối chạy khi sha256 không khớp bản đã duyệt", async () => {
    await expect(runScript({ ...base("await step('a', async () => {})"), expectedSha256: "0".repeat(64) })).rejects.toBeInstanceOf(ShaMismatchError);
  });

  it("ghi từng bước PASS và trả sha256 đã chạy", async () => {
    const r = await runScript(base("await step('một', async () => {}); await step('hai', async () => {});"));
    expect(r.status).toBe("PASSED");
    expect(r.steps.map((s) => [s.name, s.status])).toEqual([["một", "PASS"], ["hai", "PASS"]]);
    expect(r.sha256).toBe(sha256Hex("await step('một', async () => {}); await step('hai', async () => {});"));
  });

  it("bước lỗi ⇒ FAILED, dừng, ghi lỗi ngắn gọn", async () => {
    const r = await runScript(base("await step('ok', async () => {}); await step('hỏng', async () => assert(false, 'sai rồi')); await step('không tới', async () => {});"));
    expect(r.status).toBe("FAILED");
    expect(r.steps.map((s) => s.status)).toEqual(["PASS", "FAIL"]);
    expect(r.error).toBe("sai rồi");
  });

  it("ctx.val/has/list/log hoạt động theo tham số", async () => {
    const r = await runScript(base("ctx.log('a', 1); assert(ctx.has('x') && !ctx.has('y')); assert(ctx.val('y','mặc định')==='mặc định'); assert(ctx.list('l').length===2);",
      { params: { x: " 1 ", y: "", l: "a, b; a" } }));
    expect(r.status).toBe("PASSED");
    expect(r.log).toEqual(["a 1"]);
  });

  it("pickOption: khớp không dấu/không phân biệt hoa thường; rỗng ⇒ mục đầu hoặc ngẫu nhiên; auto tắt ⇒ lỗi kèm danh sách", async () => {
    const clicked: number[] = [];
    let r = await runScript(base("await pickOption(page.opts, 'loai');", { page: { opts: options(["Bảo trì", "Sửa chữa"], clicked) }, params: { loai: "sua chua" } }));
    expect(r.status).toBe("PASSED");
    expect(clicked).toEqual([1]);
    clicked.length = 0;
    r = await runScript(base("await pickOption(page.opts, 'loai');", { page: { opts: options(["A", "B"], clicked) }, params: { loai: "" } }));
    expect(clicked).toEqual([0]);
    r = await runScript(base("await pickOption(page.opts, 'loai');", {
      page: { opts: options(["A", "B"]) }, params: { loai: "Z" }, paramMeta: [{ key: "loai", value: "Z", auto: false }], }));
    expect(r.status).toBe("FAILED");
    expect(r.error).toContain("Đang có: A | B");
  }, 15_000); // chờ tối đa ~6 giây cho danh sách nạp chậm (giữ nguyên hành vi bản Node)

  it("attachFiles chỉ đính kèm file runner đã tải; không có file ⇒ false", async () => {
    const got: string[][] = [];
    const input = { setInputFiles: async (p: string[]) => void got.push(p) };
    const r = await runScript(base("assert(await attachFiles(page.input, 'f') === true); assert(await attachFiles(page.input, 'none') === false);",
      { page: { input }, files: { f: ["/tmp/a.png"] } }));
    expect(r.status).toBe("PASSED");
    expect(got).toEqual([["/tmp/a.png"]]);
  });

  it("hết thời gian ⇒ FAILED", async () => {
    const r = await runScript({ ...base("await new Promise(() => {});"), timeoutMs: 100 });
    expect(r.status).toBe("FAILED");
    expect(r.error).toContain("Quá");
  });

  it("script không thấy require/process của host", async () => {
    const r = await runScript(base("assert(typeof require === 'undefined' && typeof process === 'undefined');"));
    expect(r.status).toBe("PASSED");
  });

  it("openPopup tự đóng popup kể cả khi assertion bên trong lỗi", async () => {
    let closed = false;
    const popup = {
      waitForLoadState: async () => {},
      on: () => {},
      url: () => "https://tasks.zuizui.io/report/detail",
      close: async () => { closed = true; },
    };
    const fakePage = {
      waitForEvent: async (ev: string) => (ev === "popup" ? popup : null),
    };
    const r = await runScript(
      base("await openPopup(async () => {}, async (p) => { assert(false, 'popup check fail'); });", { page: fakePage }),
    );
    expect(r.status).toBe("FAILED");
    expect(r.error).toBe("popup check fail");
    expect(closed).toBe(true);
  });

  it("expectDownload xác thực tệp tải về và tên file", async () => {
    const fakePage = {
      waitForEvent: async (ev: string) =>
        ev === "download"
          ? { suggestedFilename: () => "bao_cao_hieu_suat.xlsx", failure: async () => null }
          : null,
    };
    const r = await runScript(
      base("const d = await expectDownload(async () => {}, { ext: '.xlsx' }); assert(d.filename.endsWith('.xlsx'), 'ok');", { page: fakePage }),
    );
    expect(r.status).toBe("PASSED");
    expect(r.log.some((l) => l.includes("bao_cao_hieu_suat.xlsx"))).toBe(true);
  });
});
