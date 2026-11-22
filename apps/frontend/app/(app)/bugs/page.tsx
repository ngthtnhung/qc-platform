"use client";

import { useCallback, useEffect, useState } from "react";
import { api, waitJob, ApiError, type BugItem } from "@/lib/api";

type Meta = { sources: Record<string, number>; modules: string[]; status_labels: Record<string, string> };
const SOURCE_LABEL: Record<string, string> = { haraworks: "Haraworks (realtime)", legacy_kb: "Kho bug cũ" };
const PAGE = 50;

export default function BugsPage() {
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [module, setModule] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [data, setData] = useState<{ total: number; items: BugItem[] } | null>(null);
  const [error, setError] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const q = await api<{ job_id: string }>("/bugs/sync", { method: "POST" });
      const j = await waitJob(q.job_id);
      const r = (j.result ?? {}) as { created?: number; updated?: number; error?: { message?: string } };
      setSyncMsg(j.status === "DONE" ? `Đồng bộ xong: ${r.created ?? 0} bug mới, ${r.updated ?? 0} bug đổi.` : `Lỗi: ${r.error?.message ?? "đồng bộ thất bại"}`);
      void load();
    } catch (e) {
      setSyncMsg(e instanceof ApiError ? e.message : "Không đồng bộ được");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    api<Meta>("/bugs/meta").then(setMeta).catch(() => undefined);
  }, []);
  useEffect(() => setOffset(0), [q, source, module, status]);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api(`/bugs?${new URLSearchParams({ q, source, module, ...(status ? { status } : {}), limit: String(PAGE), offset: String(offset) })}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được");
    }
  }, [q, source, module, status, offset]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <h2>Tra cứu bug</h2>
      <p className="muted">Dữ liệu nhập từ bản Node (bug cũ và bug Haraworks). Đồng bộ realtime sẽ bật sau khi admin cấp quyền truy cập Haraworks.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input aria-label="Tìm bug" placeholder="Tìm tiêu đề (không cần dấu)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <select aria-label="Nguồn" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi nguồn</option>
          {meta && Object.entries(meta.sources).map(([k, n]) => <option key={k} value={k}>{SOURCE_LABEL[k] ?? k} ({n})</option>)}
        </select>
        <select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi module</option>
          {meta?.modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi trạng thái</option>
          {meta && Object.entries(meta.status_labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="muted">{data ? `${data.total} bug` : ""}</span>
        <button disabled={syncing} onClick={() => void syncNow()}>{syncing ? "Đang đồng bộ…" : "Đồng bộ từ Haraworks"}</button>
      </div>
      {syncMsg && <div role="status" className="muted">{syncMsg}</div>}
      {error && <div className="err" role="alert">{error}</div>}
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Tiêu đề</th><th>Module</th><th>Trạng thái</th><th>Ưu tiên</th><th>Ngày tạo</th><th>Người thực hiện</th><th>Nguồn</th></tr></thead>
          <tbody>
            {data?.items.map((b) => (
              <tr key={b.id}>
                <td>{b.url ? <a href={b.url} target="_blank" rel="noopener noreferrer">{b.title}</a> : b.title}</td>
                <td>{b.module_code}</td>
                <td>{b.status_label || (b.classification ? <span className="muted">{b.classification}</span> : "")}</td>
                <td>{b.priority_label}</td>
                <td className="muted">{b.created_at_ext ? new Date(b.created_at_ext).toLocaleDateString("vi-VN") : ""}</td>
                <td>{b.assignee}</td>
                <td className="muted">{SOURCE_LABEL[b.source] ?? b.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Trước</button>
        <button disabled={!data || offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Sau</button>
        <span className="muted">{data && data.total > 0 ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} / ${data.total}` : ""}</span>
      </div>
    </>
  );
}
