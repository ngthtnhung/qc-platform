"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiForm, waitJob, ApiError, type Coverage, type IntegrationStatus, type SourceItem } from "@/lib/api";

function useMessage() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Thao tác thất bại" });
    }
  };
  return { msg, run };
}
const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <div className={m.ok ? "muted" : "err"} role={m.ok ? "status" : "alert"}>{m.text}</div> : null);
type IngestOut = { passages: number; version: string; duplicate: boolean; note: string };

function UploadForm({ kind, accept, title, hint, onDone }: { kind: "ba_doc" | "code_wiki"; accept: string; title: string; hint: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const { msg, run } = useMessage();
  function submit(e: FormEvent) {
    e.preventDefault();
    const f = file.current?.files?.[0];
    if (!f) return;
    void run(async () => {
      const form = new FormData();
      form.append("kind", kind);
      form.append("title", name);
      form.append("version_label", version);
      form.append("file", f);
      const r = await apiForm<IngestOut>("/sources/upload", form);
      onDone();
      return r.duplicate ? r.note : `Đã nạp ${r.passages} đoạn trích (phiên bản ${r.version}).`;
    });
  }
  return (
    <form className="card" onSubmit={submit}>
      <strong>{title}</strong>
      <div className="muted">{hint}</div>
      <div className="row">
        <div className="grow"><label htmlFor={`${kind}-t`}>Tên nguồn (cùng tên = phiên bản mới)</label><input id={`${kind}-t`} value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div><label htmlFor={`${kind}-v`}>Nhãn phiên bản (tùy chọn)</label><input id={`${kind}-v`} value={version} onChange={(e) => setVersion(e.target.value)} placeholder="tự động v1, v2…" /></div>
      </div>
      <label htmlFor={`${kind}-f`}>Tệp ({accept})</label>
      <input id={`${kind}-f`} type="file" accept={accept} ref={file} required />
      <p><button className="primary" type="submit">Nạp tài liệu</button></p>
      <Msg m={msg} />
    </form>
  );
}

function FigmaForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const { msg, run } = useMessage();
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void run(async () => { const r = await api<IngestOut>("/sources/figma", { method: "POST", body: { url, title, pasted_text: pasted } }); onDone(); return `Đã nạp ${r.passages} đoạn trích từ Figma.`; }); }}>
      <strong>Link Figma</strong>
      <div className="muted">Có token Figma (mục Tích hợp): hệ thống tự đọc chữ trong thiết kế. Chưa có token: dán chú thích/văn bản trong thiết kế vào ô bên dưới.</div>
      <label htmlFor="fg-u">Link (https://www.figma.com/design/…?node-id=…)</label>
      <input id="fg-u" value={url} onChange={(e) => setUrl(e.target.value)} required />
      <label htmlFor="fg-t">Tên hiển thị (tùy chọn)</label>
      <input id="fg-t" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="fg-p">Văn bản dán tay (tùy chọn; các đoạn cách nhau một dòng trống)</label>
      <textarea id="fg-p" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} />
      <p><button className="primary" type="submit">Thêm Figma</button></p>
      <Msg m={msg} />
    </form>
  );
}

function TaskFunctions({ onDone }: { onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const { msg, run } = useMessage();
  return (
    <div className="card">
      <strong>Mô tả Task Function (toàn bộ danh sách)</strong>
      <div className="muted">Bước 1: nạp danh sách task (tệp <code>functions-live.json</code>, chỉ có tên và thuộc tính). Bước 2: “Đồng bộ mô tả” lấy mô tả đầy đủ từ Haraworks (chỉ đọc, cần cookie ở mục Tích hợp).</div>
      <div className="row" style={{ marginTop: 8 }}>
        <input type="file" accept=".json" ref={file} style={{ maxWidth: 320 }} aria-label="Tệp danh sách task" />
        <button onClick={() => { const f = file.current?.files?.[0]; if (!f) return; void run(async () => { const form = new FormData(); form.append("file", f); const r = await apiForm<{ teams: { team: string; created: number; updated: number; unchanged: number }[] }>("/sources/task-functions/upload", form); onDone(); return r.teams.map((t) => `${t.team}: +${t.created} mới, ${t.updated} đổi, ${t.unchanged} giữ`).join(" · "); }); }}>Nạp danh sách</button>
        <button className="primary" onClick={() => void run(async () => { const q = await api<{ job_id: string }>("/sources/task-functions/sync-descriptions", { method: "POST" }); const j = await waitJob(q.job_id); onDone(); if (j.status === "FAILED") throw new ApiError(500, "JOB_FAILED", String((j.result as { error?: { message?: string } })?.error?.message ?? "Đồng bộ thất bại")); const r = j.result as { requested: number; with_description: number }; return `Đã lấy mô tả cho ${r.with_description}/${r.requested} task.`; })}>Đồng bộ mô tả</button>
      </div>
      <Msg m={msg} />
    </div>
  );
}

function Integrations() {
  const [items, setItems] = useState<IntegrationStatus[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const { msg, run } = useMessage();
  const load = useCallback(() => void api<IntegrationStatus[]>("/integrations").then(setItems).catch(() => undefined), []);
  useEffect(load, [load]);
  return (
    <div className="card">
      <strong>Tích hợp (chỉ ghi, mã hóa trong vault; không bao giờ hiển thị lại)</strong>
      {items.map((i) => (
        <div key={i.key} style={{ marginTop: 10 }}>
          <div className="row">
            <span className="grow">{i.label}</span>
            <span className={`badge ${i.configured ? "ok" : "warn"}`}>{i.configured ? "Đã cấu hình" : "Chưa cấu hình"}</span>
            {i.last_check_status && <span className="muted">Kiểm tra: {i.last_check_status}</span>}
          </div>
          <div className="row">
            <input aria-label={i.label} type="password" autoComplete="off" placeholder={i.key === "haraworks" ? "Dán giá trị header Cookie" : "Dán token Figma"} value={values[i.key] ?? ""} onChange={(e) => setValues({ ...values, [i.key]: e.target.value })} style={{ flex: 1 }} />
            <button onClick={() => void run(async () => { await api(`/integrations/${i.key}`, { method: "PUT", body: { value: values[i.key] } }); setValues({ ...values, [i.key]: "" }); load(); return "Đã lưu."; })} disabled={!values[i.key]}>Lưu</button>
            {i.key === "haraworks" && i.configured && <button onClick={() => void run(async () => { const r = await api<{ status: string }>("/integrations/haraworks/check", { method: "POST" }); load(); return `Kết nối: ${r.status}`; })}>Kiểm tra</button>}
          </div>
        </div>
      ))}
      <Msg m={msg} />
    </div>
  );
}

export default function SourcesPage() {
  const [items, setItems] = useState<SourceItem[]>([]);
  const [coverage, setCoverage] = useState<Coverage>({});
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await api<{ items: SourceItem[]; coverage: Coverage }>("/sources");
      setItems(r.items);
      setCoverage(r.coverage);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được");
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <>
      <h2>Nguồn tài liệu</h2>
      <p className="muted">Mọi nguồn được tách thành đoạn trích nguyên văn kèm vị trí. Nạp lại cùng tên là thêm phiên bản mới; tra cứu mặc định chỉ dùng phiên bản mới nhất.</p>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        {Object.entries(coverage).map(([k, c]) => <span key={k} className={`badge ${c.passages ? "ok" : "warn"}`}>{c.label}: {c.sources} nguồn · {c.passages} đoạn</span>)}
      </div>
      <UploadForm kind="ba_doc" accept=".docx" title="Tài liệu BA (.docx)" hint="Tiêu đề, đoạn văn và hàng bảng được tách riêng; vị trí ghi theo dòng/đoạn/bảng." onDone={() => void load()} />
      <FigmaForm onDone={() => void load()} />
      <TaskFunctions onDone={() => void load()} />
      <UploadForm kind="code_wiki" accept=".html,.htm,.md,.txt,.docx" title="Trang wiki tổng hợp rule chạy thực tế trên code" hint="Lưu trang wiki thành tệp (HTML/Markdown/văn bản) rồi nạp. Tải trực tiếp từ URL chỉ bật khi admin cho phép host." onDone={() => void load()} />
      <Integrations />
      <h3>Nguồn đã nạp</h3>
      {items.map((s) => (
        <article className="card" key={s.id}>
          <div className="row">
            <strong className="grow">{s.title}</strong>
            <span className="badge">{s.kind_label}</span>
            <button className="danger" onClick={() => { if (confirm(`Ngừng dùng nguồn “${s.title}”? Dữ liệu và các tra cứu cũ vẫn được giữ.`)) void api(`/sources/${s.id}`, { method: "DELETE" }).then(load); }}>Ngừng dùng</button>
          </div>
          <div className="row">
            {s.versions.map((v) => <span key={v.id} className="badge" title={new Date(v.created_at).toLocaleString("vi-VN")}>{v.label} · {v.current_passages} đoạn hiện hành</span>)}
            {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer">Mở nguồn</a>}
          </div>
        </article>
      ))}
      {items.length === 0 && <div className="muted">Chưa có nguồn nào. Hãy nạp tài liệu ở trên.</div>}
    </>
  );
}
