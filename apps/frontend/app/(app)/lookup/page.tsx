"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Citation, type Highlight, type LookupResult } from "@/lib/api";

const KIND_LABEL: Record<string, string> = { ba_doc: "Tài liệu BA", figma: "Figma", task_function: "Task Function", code_wiki: "Wiki rule trên code" };

/** Hiển thị NGUYÊN VĂN đoạn trích, chỉ tô sáng các vị trí khớp (không sửa chữ). */
function Quote({ text, highlights }: { text: string; highlights: Highlight[] }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  highlights.forEach((h, i) => {
    if (h.start > pos) parts.push(text.slice(pos, h.start));
    parts.push(<mark key={i} title={h.term}>{text.slice(h.start, h.end)}</mark>);
    pos = h.end;
  });
  parts.push(text.slice(pos));
  return <blockquote style={{ margin: "8px 0", padding: "6px 12px", borderLeft: "3px solid var(--brand)", whiteSpace: "pre-wrap" }}>{parts}</blockquote>;
}

type Ctx = { items: { passage_id: string; is_target: boolean; location: string; text: string }[] };

function CitationCard({ c }: { c: Citation }) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`“${c.quote}”\n— ${c.citation}`).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <article className="card">
      <div className="row">
        <strong className="grow">{c.source_title}</strong>
        <span className="badge">{c.source_version}</span>
        {!c.is_current && <span className="badge warn">Phiên bản cũ</span>}
        <span className="muted">điểm {c.score}</span>
      </div>
      <div className="muted">{[c.heading_path, c.location].filter(Boolean).join(" — ")}</div>
      <Quote text={c.quote} highlights={c.highlights} />
      <div className="row">
        <span className="muted">Khớp: {c.matched_terms.join(", ")}</span>
        <span className="grow" />
        {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer">Mở nguồn</a>}
        <button onClick={() => void copy()}>{copied ? "Đã sao chép" : "Sao chép trích dẫn"}</button>
        <button onClick={() => (ctx ? setCtx(null) : void api<Ctx>(`/sources/passages/${c.passage_id}/context?radius=2`).then(setCtx))}>{ctx ? "Ẩn ngữ cảnh" : "Xem ngữ cảnh"}</button>
      </div>
      {ctx && (
        <div style={{ marginTop: 8 }}>
          {ctx.items.map((i) => (
            <div key={i.passage_id} style={{ padding: "4px 8px", background: i.is_target ? "color-mix(in srgb, var(--brand) 12%, transparent)" : undefined }}>
              <span className="muted">{i.location}</span>
              <div style={{ whiteSpace: "pre-wrap" }}>{i.text}</div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function AiAnalysis({ lookupId, description }: { lookupId: string; description: string }) {
  type Out = { approval_id: string; provider: string; unverified_causes: number; analysis: { summary: string; suspected_causes: { text: string; citations: string[]; verified: boolean }[]; reproduction_steps: string[]; test_suggestions: string[]; missing_information: string[] } };
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true);
    setErr("");
    try {
      setOut(await api<Out>("/ai/bug-analysis", { method: "POST", body: { lookup_id: lookupId, description } }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không phân tích được");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <div className="row">
        <strong className="grow">AI phân tích bug dựa trên các trích dẫn trên</strong>
        <button disabled={busy} onClick={() => void run()}>{busy ? "Đang phân tích…" : "Nhờ AI phân tích"}</button>
      </div>
      <div className="muted">Kết quả chỉ là ĐỀ XUẤT: nguyên nhân nào không có trích dẫn thật được đánh dấu “suy đoán”. Đề xuất được gửi sang mục Duyệt để QC xem xét.</div>
      {err && <div className="err" role="alert">{err}</div>}
      {out && (
        <div role="status">
          <p>{out.analysis.summary}</p>
          <ul>{out.analysis.suspected_causes.map((c, i) => <li key={i}>{c.text} <span className={`badge ${c.verified ? "ok" : "warn"}`}>{c.verified ? `có ${c.citations.length} trích dẫn` : "suy đoán"}</span></li>)}</ul>
          {out.analysis.reproduction_steps.length > 0 && <><strong>Cách tái hiện</strong><ol>{out.analysis.reproduction_steps.map((s, i) => <li key={i}>{s}</li>)}</ol></>}
          {out.analysis.test_suggestions.length > 0 && <><strong>Gợi ý kiểm thử</strong><ul>{out.analysis.test_suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
          {out.analysis.missing_information.length > 0 && <><strong>Còn thiếu thông tin</strong><ul>{out.analysis.missing_information.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
          <div className="muted">Nguồn AI: {out.provider} · đã gửi yêu cầu duyệt.</div>
        </div>
      )}
    </div>
  );
}

export default function LookupPage() {
  const [description, setDescription] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [history, setHistory] = useState<{ id: string; description: string; results: number; created_at: string }[]>([]);

  const loadHistory = useCallback(() => {
    api<typeof history>("/lookups?limit=15").then(setHistory).catch(() => undefined);
  }, []);
  useEffect(loadHistory, [loadHistory]);

  async function run() {
    setBusy(true);
    setError("");
    setSaved("");
    setNote("");
    try {
      setResult(await api<LookupResult>("/lookups", { method: "POST", body: { description, kinds, per_kind: 5 } }));
      loadHistory();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tra cứu được");
    } finally {
      setBusy(false);
    }
  }
  async function openHistory(id: string) {
    const d = await api<{ description: string; results: Citation[]; note: string }>(`/lookups/${id}`);
    setDescription(d.description);
    setNote(d.note);
    setResult(null);
    setSaved(`Đang xem bản lưu: ${d.results.length} trích dẫn (ảnh chụp tại thời điểm tra cứu).`);
    setHistoryResults(d.results);
  }
  const [historyResults, setHistoryResults] = useState<Citation[] | null>(null);
  async function saveNote() {
    if (!result?.lookup_id) return;
    await api(`/lookups/${result.lookup_id}/note`, { method: "PUT", body: { note } });
    setSaved("Đã lưu ghi chú.");
  }
  const toggle = (k: string) => setKinds((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  return (
    <>
      <h2>Tra cứu theo mô tả bug</h2>
      <p className="muted">Nhập mô tả bug. Hệ thống tách từ khóa rồi trích <strong>nguyên văn</strong> từ các nguồn đã nạp (BA, Figma, Task Function, wiki rule), kèm vị trí để đối chiếu. Không có AI viết lại nội dung.</p>
      <div className="card">
        <label htmlFor="d">Mô tả bug</label>
        <textarea id="d" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ví dụ: Khi tạo phiếu bảo trì, độ ưu tiên mặc định không hiển thị đúng ở danh sách xử lý phiếu…" />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">Giới hạn nguồn:</span>
          {Object.entries(KIND_LABEL).map(([k, v]) => (
            <label key={k} style={{ margin: 0, display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} style={{ width: "auto" }} /> {v}
            </label>
          ))}
          <span className="grow" />
          <button className="primary" disabled={busy || description.trim().length < 8} onClick={() => void run()}>{busy ? "Đang tra cứu…" : "Tra cứu"}</button>
        </div>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      {result && (
        <>
          <div className="card">
            <strong>Từ khóa đã tách</strong>
            <div className="row" style={{ marginTop: 6 }}>
              {result.keywords.slice(0, 18).map((k) => <span key={k.term} className={`badge ${k.type === "phrase" || k.type === "identifier" || k.type === "quoted" ? "ok" : ""}`} title={`${k.type}, trọng số ${k.weight}`}>{k.display}</span>)}
            </div>
            {result.keywords.length > 18 && <div className="muted">… và {result.keywords.length - 18} từ khóa phụ (đã dùng khi chấm điểm).</div>}
            <div className="muted" style={{ marginTop: 6 }}>
              Đã nạp: {Object.values(result.coverage).map((c) => `${c.label} ${c.passages} đoạn`).join(" · ")}
            </div>
            {result.hint && <div className="notice">{result.hint}</div>}
          </div>
          {Object.entries(result.groups).map(([kind, cites]) => (
            <section key={kind}>
              <h3>{KIND_LABEL[kind] ?? kind} ({cites.length})</h3>
              {cites.map((c) => <CitationCard key={c.passage_id} c={c} />)}
            </section>
          ))}
          {Object.keys(result.groups).length === 0 && <div className="muted">Không có trích dẫn nào.</div>}
          {result.lookup_id && <AiAnalysis lookupId={result.lookup_id} description={description} />}
          {result.lookup_id && (
            <div className="card">
              <label htmlFor="n">Ghi chú cho lần tra cứu này</label>
              <textarea id="n" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row" style={{ marginTop: 6 }}><button onClick={() => void saveNote()}>Lưu ghi chú</button>{saved && <span role="status" className="muted">{saved}</span>}</div>
            </div>
          )}
        </>
      )}
      {!result && historyResults && (
        <section>
          <div className="muted" role="status">{saved}</div>
          {historyResults.map((c) => <article className="card" key={c.passage_id}><strong>{c.source_title}</strong> <span className="badge">{c.source_version}</span>
            <div className="muted">{c.heading_path} — {c.location}</div><blockquote style={{ whiteSpace: "pre-wrap" }}>{c.quote}</blockquote></article>)}
        </section>
      )}
      {history.length > 0 && (
        <section>
          <h3>Tra cứu gần đây</h3>
          <div className="card">
            <table><tbody>
              {history.map((h) => (
                <tr key={h.id}><td>{h.description}</td><td className="muted">{h.results} trích dẫn</td><td className="muted">{new Date(h.created_at).toLocaleString("vi-VN")}</td>
                  <td><button onClick={() => void openHistory(h.id)}>Xem</button></td></tr>
              ))}
            </tbody></table>
          </div>
        </section>
      )}
    </>
  );
}
