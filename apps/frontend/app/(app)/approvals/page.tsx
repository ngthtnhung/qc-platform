"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Approval } from "@/lib/api";
import { lineDiff } from "@/lib/diff";

const STATUS_LABEL: Record<string, string> = { PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối", CANCELLED: "Đã hủy" };

function CodeReview({ payload }: { payload: Record<string, unknown> }) {
  const script = String(payload.script ?? "");
  const prev = payload.prev_script == null ? null : String(payload.prev_script);
  const [view, setView] = useState<"diff" | "full">(prev === null ? "full" : "diff");
  const steps = Array.isArray(payload.steps) ? (payload.steps as string[]) : [];
  return (
    <div aria-label="Nội dung cần duyệt">
      <div className="muted">
        {String(payload.task)} · module {String(payload.module)} · v{String(payload.version)} · nguồn: {String(payload.origin)} · {payload.writes ? "GHI dữ liệu trên Staging" : "chỉ đọc"} · sha256 {String(payload.sha256).slice(0, 12)}…
      </div>
      {payload.note ? <div className="notice">Ghi chú của người đề xuất: {String(payload.note)}</div> : null}
      {steps.length > 0 && <ol>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
      <div className="row">
        {prev !== null && <button onClick={() => setView(view === "diff" ? "full" : "diff")}>{view === "diff" ? "Xem toàn bộ code" : `Xem khác biệt so với v${String(payload.prev_version)} đã duyệt`}</button>}
        {prev === null && <span className="muted">Chưa có bản đã duyệt trước đó: xem toàn bộ code.</span>}
      </div>
      <pre style={{ maxHeight: 420 }}>
        {view === "diff" && prev !== null
          ? lineDiff(prev, script).map((l, i) => <div key={i} style={{ background: l.op === "+" ? "color-mix(in srgb, var(--ok) 18%, transparent)" : l.op === "-" ? "color-mix(in srgb, var(--bad) 18%, transparent)" : undefined }}>{l.op} {l.text}</div>)
          : script}
      </pre>
    </div>
  );
}

function Item({ a, onDone, checked, onCheck }: { a: Approval; onDone: () => void; checked: boolean; onCheck: (v: boolean) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      // gửi đúng payload_hash của bản đang hiển thị: nếu nội dung đã đổi, server từ chối
      await api(`/approvals/${a.id}/decision`, { method: "POST", body: { decision, payload_hash: a.payload_hash, note } });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không gửi được quyết định");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card">
      <div className="row">
        {a.status === "PENDING" && <input type="checkbox" aria-label="Chọn để duyệt hàng loạt" checked={checked} onChange={(e) => onCheck(e.target.checked)} style={{ width: "auto" }} />}
        <strong className="grow">{a.title}</strong>
        <span className={`badge ${a.origin === "ai" ? "ai" : ""}`}>{a.origin === "ai" ? "Do AI tạo" : "Do người tạo"}</span>
        <span className={`badge ${a.status === "APPROVED" ? "ok" : a.status === "REJECTED" ? "bad" : "warn"}`}>{STATUS_LABEL[a.status]}</span>
      </div>
      <div className="muted">
        {a.subject_type} · {new Date(a.created_at).toLocaleString("vi-VN")}
      </div>
      {a.subject_type === "automation_code_version" ? <CodeReview payload={a.payload} /> : <pre aria-label="Nội dung cần duyệt">{JSON.stringify(a.payload, null, 2)}</pre>}
      {a.status === "PENDING" ? (
        <>
          <label htmlFor={`n-${a.id}`}>Ghi chú (bắt buộc khi từ chối)</label>
          <textarea id={`n-${a.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && <div className="err" role="alert">{error}</div>}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy} onClick={() => void decide("approve")}>Duyệt</button>
            <button className="danger" disabled={busy || !note.trim()} onClick={() => void decide("reject")}>Từ chối</button>
          </div>
        </>
      ) : (
        a.decision_note && <div className="muted">Ghi chú: {a.decision_note}</div>
      )}
    </article>
  );
}

export default function ApprovalsPage() {
  const [status, setStatus] = useState("PENDING");
  const [origin, setOrigin] = useState("");
  const [subject, setSubject] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const [items, setItems] = useState<Approval[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const q = new URLSearchParams({ status, limit: "500", ...(origin ? { origin } : {}) });
      const all = await api<Approval[]>(`/approvals?${q}`);
      setItems(subject ? all.filter((a) => a.subject_type === subject) : all);
      setPicked(new Set());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được danh sách");
    }
  }, [status, origin, subject]);

  useEffect(() => {
    void load();
  }, [load]);

  async function bulk(decision: "approve" | "reject") {
    if (!items) return;
    setBulkMsg("");
    try {
      const chosen = items.filter((i) => picked.has(i.id)).map((i) => ({ id: i.id, payload_hash: i.payload_hash }));
      const res = await api<{ id: string; ok: boolean; error?: string }[]>("/approvals/bulk-decision", { method: "POST", body: { decision, items: chosen, note: bulkNote } });
      const failed = res.filter((r) => !r.ok);
      setBulkMsg(`Thành công ${res.length - failed.length}/${res.length}.${failed.length ? ` Lỗi: ${failed[0].error}` : ""}`);
      await load();
    } catch (e) {
      setBulkMsg(e instanceof ApiError ? e.message : "Không gửi được");
    }
  }

  return (
    <>
      <h2>Duyệt sản phẩm</h2>
      <p className="muted">
        Mọi tài liệu, rule, test case, code hay hành động do AI tạo ra chỉ có hiệu lực sau khi một QC duyệt. Cả 4 QC có quyền như nhau.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Trạng thái" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: "auto" }}>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="Nguồn" value={origin} onChange={(e) => setOrigin(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi nguồn</option>
          <option value="ai">Do AI tạo</option>
          <option value="human">Do người tạo</option>
        </select>
        <select aria-label="Loại" value={subject} onChange={(e) => setSubject(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi loại</option>
          <option value="rule_version">Rule</option>
          <option value="ai_suggestion">Đề xuất AI</option>
          <option value="reference">Tham chiếu</option>
          <option value="automation_code_version">Code automation</option>
        </select>
        <button onClick={() => void load()}>Làm mới</button>
      </div>
      {status === "PENDING" && items && items.length > 0 && (
        <div className="card">
          <div className="row">
            <button onClick={() => setPicked(new Set(items.map((i) => i.id)))}>Chọn tất cả ({items.length})</button>
            <button onClick={() => setPicked(new Set())}>Bỏ chọn</button>
            <input aria-label="Ghi chú hàng loạt" placeholder="Ghi chú (bắt buộc khi từ chối)" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} style={{ maxWidth: 300 }} />
            <button className="primary" disabled={picked.size === 0} onClick={() => void bulk("approve")}>Duyệt {picked.size} mục đã chọn</button>
            <button className="danger" disabled={picked.size === 0 || !bulkNote.trim()} onClick={() => void bulk("reject")}>Từ chối</button>
          </div>
          <div className="muted">Chỉ chọn sau khi đã đọc nội dung từng mục. Mỗi mục được duyệt theo đúng bản đang hiển thị.</div>
          {bulkMsg && <div role="status">{bulkMsg}</div>}
        </div>
      )}
      {error && <div className="err" role="alert">{error}</div>}
      {items === null && !error && <div className="muted">Đang tải…</div>}
      {items?.length === 0 && <div className="muted">Không có mục nào.</div>}
      {items?.map((a) => <Item key={a.id + a.status} a={a} onDone={() => void load()} checked={picked.has(a.id)} onCheck={(v) => setPicked((p) => { const n = new Set(p); if (v) n.add(a.id); else n.delete(a.id); return n; })} />)}
    </>
  );
}
