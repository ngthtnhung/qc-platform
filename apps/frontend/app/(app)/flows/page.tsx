"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Rec = { id: string; name: string; module_code: string; start_url: string; status: string; task_id: string | null; step_count: number; warnings: string[]; script_preview?: string };

export default function FlowsPage() {
  const [items, setItems] = useState<Rec[]>([]);
  const [name, setName] = useState("");
  const [module, setModule] = useState("");
  const [open, setOpen] = useState<Rec | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = useCallback(() => void api<Rec[]>("/flows/recordings").then(setItems).catch(() => undefined), []);
  useEffect(load, [load]);

  async function upload() {
    setMsg(null);
    const f = file.current?.files?.[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as { start_url: string; events: unknown[] };
      const r = await api<Rec>("/flows/recordings", { method: "POST", body: { name, module_code: module, start_url: data.start_url, events: data.events } });
      setOpen(r);
      setMsg({ ok: true, text: `Đã nạp bản ghi: ${r.step_count} bước.` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Tệp ghi không hợp lệ" });
    }
  }

  async function makeTask(r: Rec) {
    setMsg(null);
    try {
      await api(`/flows/recordings/${r.id}/create-task`, { method: "POST", body: { module_code: r.module_code || module } });
      setMsg({ ok: true, text: "Đã tạo tác vụ. Code đang chờ một QC duyệt ở trang Duyệt." });
      setOpen(null);
      load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không tạo được tác vụ" });
    }
  }

  return (
    <>
      <h2>Ghi luồng thao tác (Legacy recording.json)</h2>
      <div className="notice" style={{ marginBottom: 12 }}>
        <strong>Quy trình mới đơn giản hơn:</strong> Bạn có thể dán trực tiếp code từ <code>playwright codegen</code>, tách luồng theo nghiệp vụ, chỉnh sửa code tô màu tham số và chạy thử ngay tại{" "}
        <Link href="/automation" className="btn sm primary" style={{ marginLeft: 6 }}>
          Mở Tác vụ tự động →
        </Link>
      </div>
      <p className="muted">
        Chạy recorder trên máy bạn: <code>QC_RECORD_URL=https://… node dist/recorder.js</code>, đăng nhập và thao tác như bình thường, rồi nạp tệp <code>recording.json</code> ở đây.
        Mật khẩu không bao giờ được ghi. Code sinh ra tất định từ bản ghi và vẫn phải chờ QC duyệt.
      </p>
      <div className="card">
        <div className="row">
          <div className="grow"><label htmlFor="fl-n">Tên luồng</label><input id="fl-n" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><label htmlFor="fl-m">Module</label><input id="fl-m" value={module} onChange={(e) => setModule(e.target.value)} /></div>
        </div>
        <label htmlFor="fl-f">Tệp recording.json</label>
        <input id="fl-f" type="file" accept=".json" ref={file} />
        <p><button className="primary" disabled={!name || !module} onClick={() => void upload()}>Nạp bản ghi</button></p>
        {msg && <div className={msg.ok ? "muted" : "err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      </div>
      {open && (
        <div className="card">
          <strong>{open.name}</strong> · {open.step_count} bước
          {open.warnings.map((w, i) => <div key={i} className="err">{w}</div>)}
          <pre style={{ overflowX: "auto" }}>{open.script_preview}</pre>
          <button className="primary" disabled={!!open.task_id} onClick={() => void makeTask(open)}>Tạo tác vụ (chờ QC duyệt)</button>
        </div>
      )}
      <h3>Bản ghi đã nạp</h3>
      {items.map((r) => (
        <article className="card" key={r.id}>
          <div className="row">
            <strong className="grow">{r.name}</strong>
            <span className="badge">{r.module_code}</span>
            <span className={`badge ${r.task_id ? "ok" : "warn"}`}>{r.task_id ? "Đã tạo tác vụ" : "Chưa tạo tác vụ"}</span>
            <button onClick={() => void api<Rec>(`/flows/recordings/${r.id}`).then(setOpen)}>Xem</button>
          </div>
          <div className="muted">{r.step_count} bước · {r.warnings.length} cảnh báo</div>
        </article>
      ))}
      {items.length === 0 && <div className="muted">Chưa có bản ghi nào.</div>}
    </>
  );
}
