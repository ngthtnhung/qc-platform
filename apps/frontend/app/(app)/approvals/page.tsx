"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Approval } from "@/lib/api";

const STATUS_LABEL: Record<string, string> = { PENDING: "Chờ duyệt", APPROVED: "Đã duyệt", REJECTED: "Đã từ chối", CANCELLED: "Đã hủy" };

function Item({ a, onDone }: { a: Approval; onDone: () => void }) {
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
        <strong className="grow">{a.title}</strong>
        <span className={`badge ${a.origin === "ai" ? "ai" : ""}`}>{a.origin === "ai" ? "Do AI tạo" : "Do người tạo"}</span>
        <span className={`badge ${a.status === "APPROVED" ? "ok" : a.status === "REJECTED" ? "bad" : "warn"}`}>{STATUS_LABEL[a.status]}</span>
      </div>
      <div className="muted">
        {a.subject_type} · {new Date(a.created_at).toLocaleString("vi-VN")}
      </div>
      <pre aria-label="Nội dung cần duyệt">{JSON.stringify(a.payload, null, 2)}</pre>
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
  const [items, setItems] = useState<Approval[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const q = new URLSearchParams({ status, ...(origin ? { origin } : {}) });
      setItems(await api<Approval[]>(`/approvals?${q}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được danh sách");
    }
  }, [status, origin]);

  useEffect(() => {
    void load();
  }, [load]);

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
        <button onClick={() => void load()}>Làm mới</button>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {items === null && !error && <div className="muted">Đang tải…</div>}
      {items?.length === 0 && <div className="muted">Không có mục nào.</div>}
      {items?.map((a) => <Item key={a.id + a.status} a={a} onDone={() => void load()} />)}
    </>
  );
}
