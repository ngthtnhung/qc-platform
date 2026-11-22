/**
 * Flow Recorder: ghi thao tác của QC trên trình duyệt thật → tệp JSON để nạp vào platform (trang "Ghi luồng").
 *   QC_RECORD_URL=https://… [QC_RECORD_OUT=recording.json] node dist/recorder.js
 * - QC tự đăng nhập và tự thao tác; recorder KHÔNG bao giờ ghi giá trị ô mật khẩu (kể cả khi lỡ gõ).
 * - Chỉ mô tả phần tử (testid/role/name/label/placeholder/text/id/css) — không ghi HTML, cookie hay storage.
 * - Kết thúc: đóng trình duyệt hoặc nhấn Enter ở cửa sổ lệnh.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

export type RecEvent = { t: "navigate"; url: string } | { t: "click" | "fill" | "select" | "press"; el: Record<string, string>; value?: string; key?: string };

/** Chạy TRONG trang: mô tả phần tử và gửi sự kiện qua binding `__qcRec`. Tách ra chuỗi để kiểm thử với trình duyệt thật. */
export const CAPTURE_SCRIPT = `(() => {
  if (window.__qcRecInstalled) return; window.__qcRecInstalled = true;
  const clip = (s, n) => String(s || '').replace(/\\s+/g, ' ').trim().slice(0, n || 120);
  const ROLES = { button: 'button', a: 'link', select: 'combobox', textarea: 'textbox' };
  const roleOf = (e) => e.getAttribute('role') || (e.tagName === 'INPUT' ? ({checkbox:'checkbox',radio:'radio',submit:'button',button:'button'}[e.type] || 'textbox') : ROLES[e.tagName.toLowerCase()] || '');
  const labelOf = (e) => {
    if (e.labels && e.labels[0]) return clip(e.labels[0].innerText);
    const l = e.getAttribute('aria-label'); if (l) return clip(l);
    const id = e.getAttribute('aria-labelledby'); const n = id && document.getElementById(id.split(' ')[0]); return n ? clip(n.innerText) : '';
  };
  const cssOf = (e) => { const p = []; for (let n = e; n && n.nodeType === 1 && p.length < 4; n = n.parentElement) { let s = n.tagName.toLowerCase(); const c = clip(n.className && n.className.baseVal === undefined ? n.className : '', 40).split(' ').filter(x => x && !/\\d{3,}/.test(x))[0]; if (c) s += '.' + c; p.unshift(s); } return p.join(' > '); };
  const describe = (e) => {
    const tag = e.tagName.toLowerCase(); const role = roleOf(e); const label = labelOf(e);
    const text = ['button','a','label','li','td','th','span','div'].includes(tag) ? clip(e.innerText, 80) : '';
    return { tag, type: e.type || '', role, name: clip(label || text || e.getAttribute('title') || e.value && e.type === 'submit' && e.value, 80), text, testid: e.getAttribute('data-testid') || e.getAttribute('data-test') || '', id: e.id || '', label, placeholder: e.getAttribute('placeholder') || '', css: cssOf(e) };
  };
  const target = (ev) => { const e = ev.target; return e && e.closest ? (e.closest('button,a,[role=button],[role=menuitem],[role=option],input,select,textarea,label,li,td,th') || e) : e; };
  const send = (o) => { try { window.__qcRec(JSON.stringify(o)); } catch (_) {} };
  document.addEventListener('click', (ev) => { const e = target(ev); if (!e || ['INPUT','SELECT','TEXTAREA'].includes(e.tagName) && !['checkbox','radio','submit','button'].includes(e.type || '')) return; send({ t: 'click', el: describe(e) }); }, true);
  document.addEventListener('change', (ev) => { const e = ev.target; if (!e || !e.tagName) return;
    if (e.tagName === 'SELECT') send({ t: 'select', el: describe(e), value: e.selectedOptions[0] ? clip(e.selectedOptions[0].text) : '' });
    else if (['INPUT','TEXTAREA'].includes(e.tagName) && !['checkbox','radio'].includes(e.type)) send({ t: 'fill', el: describe(e), value: e.type === 'password' ? '' : String(e.value).slice(0, 200) }); }, true);
  document.addEventListener('keydown', (ev) => { if (['Enter','Escape'].includes(ev.key) && ev.target && ev.target.tagName) send({ t: 'press', el: describe(ev.target), key: ev.key }); }, true);
})();`;

export function parseEvent(raw: string): RecEvent | null {
  try {
    const o = JSON.parse(raw) as RecEvent;
    if (o && ["click", "fill", "select", "press"].includes(o.t) && typeof (o as { el?: unknown }).el === "object") return o;
  } catch {
    /* bỏ qua */
  }
  return null;
}

export async function record(startUrl: string, out: string, opts: { waitForEnter?: boolean } = {}): Promise<RecEvent[]> {
  const { chromium } = await import("playwright-core");
  const events: RecEvent[] = [{ t: "navigate", url: startUrl }];
  const profile = path.join(os.homedir(), ".qc-runner", "recorder-profile");
  fs.mkdirSync(profile, { recursive: true });
  let ctx: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
  for (const channel of ["chrome", "msedge", undefined] as (string | undefined)[]) {
    try {
      ctx = await chromium.launchPersistentContext(profile, { channel, headless: false, viewport: null });
      break;
    } catch { /* thử kênh khác */ }
  }
  if (!ctx) throw new Error("Không mở được Chrome/Edge để ghi");
  await ctx.exposeBinding("__qcRec", (_s, raw: string) => {
    const e = parseEvent(String(raw));
    if (e && events.length < 500) events.push(e);
  });
  await ctx.addInitScript(CAPTURE_SCRIPT);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("framenavigated", (f) => { if (f === page.mainFrame() && /^https?:/.test(f.url())) events.push({ t: "navigate", url: f.url() }); });
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  console.log("Đang ghi. Hãy đăng nhập và thao tác như bình thường; xong thì đóng trình duyệt hoặc nhấn Enter ở đây.");
  await new Promise<void>((resolve) => {
    ctx!.on("close", () => resolve());
    if (opts.waitForEnter !== false) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once("line", () => { rl.close(); resolve(); });
    }
  });
  await ctx.close().catch(() => {});
  fs.writeFileSync(out, JSON.stringify({ start_url: startUrl, events }, null, 2), "utf8");
  console.log(`Đã lưu ${events.length} sự kiện vào ${out}. Nạp tệp này ở trang "Ghi luồng" của platform.`);
  return events;
}

if (process.argv[1] && /recorder\.(js|ts)$/.test(process.argv[1])) {
  const url = process.env.QC_RECORD_URL?.trim();
  if (!url || !/^https:\/\//.test(url)) {
    console.error("Cần QC_RECORD_URL=https://… (địa chỉ Staging để bắt đầu ghi)");
    process.exit(1);
  }
  record(url, process.env.QC_RECORD_OUT ?? "recording.json").then(() => process.exit(0), (e) => { console.error(String(e?.message ?? e)); process.exit(1); });
}
