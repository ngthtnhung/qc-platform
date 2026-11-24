"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, type BugItem, type Citation, type Highlight, type LookupResult } from "@/lib/api";
import { SourceViewerModal } from "@/components/SourceViewerModal";
import {
  extractModuleFromText,
  formatDateBadge,
  getModuleColor,
  syncModuleColorsFromServer,
  type ModuleDef,
} from "@/lib/ui-prefs";

type BugMedia = { url: string; name?: string; kind: string };
type LoadedBug = {
  id: string;
  title: string;
  moduleCode: string;
  url: string;
  description: string;
  media: BugMedia[];
};

type HistoryRow = {
  id: string;
  description: string;
  results: number;
  note?: string;
  created_at: string;
};

function mediaProxy(url: string) {
  return `/api/v1/sources/haraworks-media?url=${encodeURIComponent(url)}`;
}

function isCreatedTodayVN(iso?: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  return fmt.format(d) === fmt.format(new Date());
}

const KIND_META: Record<string, { label: string; color: string; bg: string }> = {
  ba_doc: { label: "Tài liệu BA", color: "#2563eb", bg: "#eff6ff" },
  figma: { label: "Figma", color: "#7c3aed", bg: "#f5f3ff" },
  task_function: { label: "Task Function", color: "#059669", bg: "#ecfdf5" },
  code_wiki: { label: "Wiki rule trên code", color: "#0891b2", bg: "#ecfeff" },
  completed_bug: { label: "Bug cũ đã hoàn thành", color: "#d97706", bg: "#fffbeb" },
};

const KIND_OPTIONS = [
  { value: "", label: "Tất cả loại nguồn" },
  { value: "ba_doc", label: "Tài liệu BA" },
  { value: "figma", label: "Figma" },
  { value: "task_function", label: "Task Function" },
  { value: "code_wiki", label: "Wiki rule trên code" },
  { value: "completed_bug", label: "Bug cũ đã hoàn thành" },
];

const KW_TYPE_STYLE: Record<string, { bg: string; color: string; border: string; title: string }> = {
  flow: { bg: "#f5f3ff", color: "#6d28d9", border: "#c4b5fd", title: "Chức năng / Luồng ứng dụng" },
  url_root: { bg: "#ecfeff", color: "#0e7490", border: "#a5f3fc", title: "URL root" },
  quoted: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", title: "Cụm từ trích dẫn" },
  identifier: { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe", title: "Định danh / Mã" },
  phrase: { bg: "var(--panel-alt)", color: "var(--ink)", border: "var(--line)", title: "Cụm từ" },
  word: { bg: "var(--panel-alt)", color: "var(--muted)", border: "var(--line)", title: "Từ khóa" },
};

/** Hiển thị NGUYÊN VĂN đoạn trích, chỉ tô sáng các vị trí khớp (không sửa chữ). */
function Quote({ text, highlights, accent }: { text: string; highlights: Highlight[]; accent: string }) {
  const parts: ReactNode[] = [];
  let pos = 0;
  highlights.forEach((h, i) => {
    if (h.start > pos) parts.push(text.slice(pos, h.start));
    parts.push(<mark key={i} title={h.term}>{text.slice(h.start, h.end)}</mark>);
    pos = h.end;
  });
  parts.push(text.slice(pos));
  return (
    <blockquote
      style={{
        margin: "8px 0",
        padding: "10px 14px",
        borderLeft: `3px solid ${accent}`,
        background: "var(--panel-alt)",
        borderRadius: "0 8px 8px 0",
        whiteSpace: "pre-wrap",
        lineHeight: 1.55,
      }}
    >
      {parts}
    </blockquote>
  );
}

type Ctx = { items: { passage_id: string; is_target: boolean; location: string; text: string }[] };

function CitationCard({ c, onOpenSource }: { c: Citation; onOpenSource: (c: Citation) => void }) {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(`“${c.quote}”\n— ${c.citation}`).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const modColor = c.source_module ? getModuleColor(c.source_module) : "";
  const kindMeta = KIND_META[c.source_kind] || { label: c.source_kind, color: "var(--brand)", bg: "var(--panel-alt)" };
  const isCompletedBug = c.source_kind === "completed_bug";

  return (
    <article className="card" style={{ borderLeft: `4px solid ${kindMeta.color}`, marginBottom: 10 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {c.source_module && (
          <span
            className="badge"
            style={{ background: `${modColor}18`, color: modColor, borderColor: `${modColor}55`, fontWeight: 600 }}
          >
            {c.source_module}
          </span>
        )}
        <strong className="grow" style={{ fontSize: 14 }}>{c.source_title}</strong>
        <span className="badge" style={{ background: kindMeta.bg, color: kindMeta.color, borderColor: `${kindMeta.color}44` }}>
          {c.source_version}
        </span>
        {c.source_updated_at && <span className="badge date">{formatDateBadge(c.source_updated_at)}</span>}
        {!c.is_current && <span className="badge warn">Phiên bản cũ</span>}
        <span className="muted" style={{ fontSize: 12 }}>điểm {c.score}</span>
      </div>
      {(c.heading_path || c.location) && (
        <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>
          {[c.heading_path, c.location].filter(Boolean).join(" — ")}
        </div>
      )}
      <Quote text={c.quote} highlights={c.highlights} accent={kindMeta.color} />
      <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 12 }}>Khớp: {c.matched_terms.join(", ")}</span>
        <span className="grow" />
        {!isCompletedBug && (
          <button
            className="sm primary"
            onClick={() => onOpenSource(c)}
            title="Mở toàn bộ nội dung nguồn và cuộn tới đúng đoạn trích dẫn này"
          >
            Xem trực tiếp nguồn
          </button>
        )}
        {c.url && (
          <a className="btn sm" href={c.url} target="_blank" rel="noopener noreferrer">
            {isCompletedBug ? "Mở Bug trên Haraworks ↗" : "Mở link gốc ↗"}
          </a>
        )}
        <button className="sm" onClick={() => void copy()}>{copied ? "Đã sao chép" : "Sao chép"}</button>
        {!isCompletedBug && (
          <button
            className="sm"
            onClick={() =>
              ctx
                ? setCtx(null)
                : void api<Ctx>(`/sources/passages/${c.passage_id}/context?radius=2`).then(setCtx)
            }
          >
            {ctx ? "Ẩn ngữ cảnh" : "Ngữ cảnh gần"}
          </button>
        )}
      </div>
      {ctx && (
        <div style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          {ctx.items.map((i) => (
            <div
              key={i.passage_id}
              style={{
                padding: "5px 8px",
                borderRadius: 6,
                background: i.is_target ? "var(--brand-soft)" : undefined,
              }}
            >
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
  type Out = {
    provider: string;
    unverified_causes: number;
    analysis: {
      summary: string;
      suspected_causes: { text: string; citations: string[]; verified: boolean }[];
      reproduction_steps: string[];
      test_suggestions: string[];
      missing_information: string[];
    };
  };
  const [out, setOut] = useState<Out | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [needKey, setNeedKey] = useState(false);

  async function run() {
    setBusy(true);
    setErr("");
    setNeedKey(false);
    try {
      setOut(await api<Out>("/ai/bug-analysis", { method: "POST", body: { lookup_id: lookupId, description } }));
    } catch (e) {
      if (e instanceof ApiError && e.code === "NO_AI_PROVIDER") {
        setNeedKey(true);
        setErr(e.message);
      } else {
        setErr(e instanceof ApiError ? e.message : "Không phân tích được");
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card" style={{ borderLeft: "4px solid #7c3aed" }}>
      <div className="row" style={{ gap: 8 }}>
        <strong className="grow">AI đối chiếu &amp; phân tích từ các đoạn trích trên</strong>
        <button className="sm" disabled={busy} onClick={() => void run()}>
          {busy ? "Đang phân tích…" : "Nhờ AI phân tích"}
        </button>
      </div>
      <div className="muted" style={{ fontSize: 12.5 }}>Nguyên nhân không có trích dẫn thật sẽ được gắn nhãn “suy đoán”.</div>
      {err && (
        <div className="err row" role="alert" style={{ marginTop: 8, justifyContent: "space-between", gap: 8 }}>
          <span>{err}</span>
          {needKey && (
            <Link className="btn sm primary" href="/settings?tab=integrations">
              Cấu hình khóa AI →
            </Link>
          )}
        </div>
      )}
      {out && (
        <div role="status" style={{ marginTop: 10 }}>
          <p>{out.analysis.summary}</p>
          <ul>
            {out.analysis.suspected_causes.map((c, i) => (
              <li key={i}>
                {c.text}{" "}
                <span className={`badge ${c.verified ? "ok" : "warn"}`}>
                  {c.verified ? `có ${c.citations.length} trích dẫn` : "suy đoán"}
                </span>
              </li>
            ))}
          </ul>
          {out.analysis.reproduction_steps.length > 0 && (
            <>
              <strong>Cách tái hiện</strong>
              <ol>{out.analysis.reproduction_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </>
          )}
          {out.analysis.test_suggestions.length > 0 && (
            <>
              <strong>Gợi ý kiểm thử</strong>
              <ul>{out.analysis.test_suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
          {out.analysis.missing_information.length > 0 && (
            <>
              <strong>Còn thiếu thông tin</strong>
              <ul>{out.analysis.missing_information.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function LookupPage() {
  const [description, setDescription] = useState("");
  const [flowHint, setFlowHint] = useState("");
  const [moduleCode, setModuleCode] = useState("");
  const [autoDetectedMod, setAutoDetectedMod] = useState("");
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [selectedKind, setSelectedKind] = useState(""); // Dropdown: "" = Tất cả loại nguồn
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // AI gợi ý chức năng / luồng trước khi tìm từ khóa
  const [aiFlowBusy, setAiFlowBusy] = useState(false);
  const [aiFlowErr, setAiFlowErr] = useState("");
  const [aiNeedKey, setAiNeedKey] = useState(false);
  const [aiFlowSummary, setAiFlowSummary] = useState("");
  const [aiFlowKeywords, setAiFlowKeywords] = useState<string[]>([]);

  // Ghi chú & Lịch sử dạng icon mở popup/drawer
  const [noteOpen, setNoteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [note, setNote] = useState("");
  const [savedNoteMsg, setSavedNoteMsg] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [viewing, setViewing] = useState<Citation | null>(null);

  // Nạp trực tiếp mô tả & file đính kèm từ Danh sách Bug
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bugSearch, setBugSearch] = useState("");
  const [bugOptions, setBugOptions] = useState<BugItem[]>([]);
  const [loadingBug, setLoadingBug] = useState(false);
  const [loadedBug, setLoadedBug] = useState<LoadedBug | null>(null);
  const [previewMedia, setPreviewMedia] = useState<BugMedia | null>(null);

  const loadMeta = useCallback(() => {
    api<HistoryRow[]>("/lookups?limit=25").then(setHistory).catch(() => undefined);
    api<{ items: ModuleDef[] }>("/sources/modules")
      .then((r) => {
        setModules(r.items);
        syncModuleColorsFromServer(r.items);
      })
      .catch(() => undefined);
  }, []);
  useEffect(loadMeta, [loadMeta]);

  useEffect(() => {
    if (!pickerOpen) return;
    const qs = new URLSearchParams({ limit: "30" });
    if (bugSearch.trim()) qs.set("q", bugSearch.trim());
    api<{ items: BugItem[] }>(`/bugs?${qs.toString()}`).then((r) => setBugOptions(r.items)).catch(() => undefined);
  }, [pickerOpen, bugSearch]);

  // Tự động trích xuất tiền tố [MODULE] khi nhập hoặc dán bug
  const handleDescriptionChange = useCallback(
    (nextText: string) => {
      setDescription(nextText);
      const detected = extractModuleFromText(nextText, modules);
      if (detected) {
        setAutoDetectedMod(detected);
        setModuleCode(detected);
      } else {
        setAutoDetectedMod("");
      }
    },
    [modules]
  );

  const loadBugFromHaraworks = useCallback(
    async (externalId: string, fallbackTitle = "", fallbackMod = "", fallbackUrl = "") => {
      setLoadingBug(true);
      setError("");
      try {
        const d = await api<{
          id: string;
          name: string;
          description: string;
          description_media: BugMedia[];
          attachments: BugMedia[];
        }>(`/sources/haraworks-detail/${encodeURIComponent(externalId)}`);
        const title = d.name || fallbackTitle;
        const desc = d.description || "";
        const fullText = desc ? `${title}\n\n${desc}` : title;
        const seen = new Set<string>();
        const allMedia = [...(d.description_media || []), ...(d.attachments || [])].filter(
          (m) => m && m.url && !seen.has(m.url) && (seen.add(m.url), true)
        );
        setDescription(fullText);
        const detected = fallbackMod?.trim().toUpperCase() || extractModuleFromText(title, modules);
        if (detected) {
          setModuleCode(detected);
          setAutoDetectedMod(detected);
        }
        setLoadedBug({
          id: externalId,
          title,
          moduleCode: detected,
          url: fallbackUrl || `https://tasks.haraworks.vn/task/me/${externalId}`,
          description: desc,
          media: allMedia,
        });
        setPickerOpen(false);
      } catch (e) {
        if (fallbackTitle) {
          setDescription(fallbackTitle);
          const detected = fallbackMod?.trim().toUpperCase() || extractModuleFromText(fallbackTitle, modules);
          if (detected) {
            setModuleCode(detected);
            setAutoDetectedMod(detected);
          }
        }
        setError(e instanceof ApiError ? e.message : "Không tải được chi tiết bug từ Haraworks");
      } finally {
        setLoadingBug(false);
      }
    },
    [modules]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bid = new URLSearchParams(window.location.search).get("bugId");
    if (bid && /^[0-9a-f]{24}$/i.test(bid)) {
      void loadBugFromHaraworks(bid);
    }
  }, [loadBugFromHaraworks]);

  async function suggestFlowWithAi() {
    if (description.trim().length < 4) {
      setAiFlowErr("Hãy nhập hoặc nạp mô tả bug trước khi nhờ AI phân tích chức năng / luồng.");
      return;
    }
    setAiFlowBusy(true);
    setAiFlowErr("");
    setAiNeedKey(false);
    setAiFlowSummary("");
    setAiFlowKeywords([]);
    try {
      const r = await api<{ provider: string; flow_name: string; keywords: string[]; summary: string }>("/ai/suggest-flow", {
        method: "POST",
        body: { description, module: moduleCode },
      });
      if (r.flow_name) setFlowHint(r.flow_name);
      setAiFlowSummary(r.summary || "");
      setAiFlowKeywords(r.keywords || []);
    } catch (e) {
      if (e instanceof ApiError && e.code === "NO_AI_PROVIDER") {
        setAiNeedKey(true);
        setAiFlowErr(e.message);
      } else {
        setAiFlowErr(e instanceof ApiError ? e.message : "Không gọi được AI phân tích luồng");
      }
    } finally {
      setAiFlowBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError("");
    setSavedNoteMsg("");
    setNote("");
    try {
      const combinedFlow = [flowHint.trim(), ...aiFlowKeywords].filter(Boolean).join(", ");
      const r = await api<LookupResult>("/lookups", {
        method: "POST",
        body: {
          description,
          kinds: selectedKind ? [selectedKind] : [],
          module: moduleCode,
          flow_hint: combinedFlow,
          per_kind: 6,
        },
      });
      setResult(r);
      loadMeta();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tra cứu được");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!result?.lookup_id) return;
    await api(`/lookups/${result.lookup_id}/note`, { method: "PUT", body: { note } });
    setSavedNoteMsg("Đã lưu ghi chú.");
    loadMeta();
  }

  const modColor = moduleCode ? getModuleColor(moduleCode) : "";
  const totalHits = result ? Object.values(result.groups).reduce((n, g) => n + g.length, 0) : 0;

  const moduleOptions = useMemo(() => {
    const list = [...modules];
    if (moduleCode && !list.some((m) => m.code === moduleCode)) {
      list.unshift({ code: moduleCode, name: moduleCode, color: getModuleColor(moduleCode) });
    }
    return list;
  }, [modules, moduleCode]);

  return (
    <div>
      {/* Header gọn gàng, tích hợp icon Ghi chú, Lịch sử, Quản lý Module */}
      <div className="page-head">
        <div>
          <h2>Tra cứu Rule</h2>
          <div className="muted">
            Tự động nhận diện Module theo tiền tố <code>[MÃ]</code>, định hướng theo chức năng / luồng ứng dụng và trích xuất nguyên văn 100% từ tài liệu + Bug cũ đã hoàn thành.
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="sm primary" onClick={() => setPickerOpen((o) => !o)}>
            {pickerOpen ? "Đóng chọn Bug" : "Nạp từ danh sách Bug"}
          </button>
          <button
            className="sm"
            onClick={() => setNoteOpen(true)}
            title="Ghi chú kết luận cho lần tra cứu hiện tại"
            style={{ position: "relative" }}
          >
            📝 Ghi chú{note.trim() ? " •" : ""}
          </button>
          <button
            className="sm"
            onClick={() => setHistoryOpen(true)}
            title="Xem lịch sử tra cứu và ghi chú đã lưu"
          >
            🕒 Lịch sử ({history.length})
          </button>
        </div>
      </div>

      {/* Bug Picker với nhãn "Mới hôm nay" */}
      {pickerOpen && (
        <div className="card" style={{ background: "var(--panel-alt)", borderLeft: "4px solid var(--brand)" }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>Chọn Bug để nạp Mô tả &amp; File đính kèm</div>
            <button className="sm" onClick={() => setPickerOpen(false)}>Đóng</button>
          </div>
          <input
            value={bugSearch}
            onChange={(e) => setBugSearch(e.target.value)}
            placeholder="Gõ tên bug cần nạp..."
            style={{ marginBottom: 8 }}
          />
          {loadingBug && <div className="muted">Đang tải mô tả &amp; tệp đính kèm từ Haraworks…</div>}
          <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
            {bugOptions.map((b) => {
              const isToday = isCreatedTodayVN(b.created_at_ext);
              const mc = b.module_code ? getModuleColor(b.module_code) : "";
              return (
                <button
                  key={b.id}
                  type="button"
                  disabled={loadingBug}
                  onClick={() => void loadBugFromHaraworks(b.external_id, b.title, b.module_code, b.url)}
                  style={{
                    justifyContent: "space-between",
                    textAlign: "left",
                    padding: "8px 10px",
                    background: isToday ? "#fffbeb" : "var(--panel)",
                    borderColor: isToday ? "#f59e0b" : "var(--line)",
                  }}
                >
                  <span className="row" style={{ gap: 6, minWidth: 0, flex: 1 }}>
                    {isToday && (
                      <span
                        className="badge"
                        style={{ background: "#fef3c7", color: "#b45309", borderColor: "#f59e0b", fontWeight: 700, flexShrink: 0 }}
                      >
                        Mới hôm nay
                      </span>
                    )}
                    {b.module_code && (
                      <span
                        className="badge"
                        style={{ background: `${mc}18`, color: mc, borderColor: `${mc}55`, fontWeight: 600, flexShrink: 0 }}
                      >
                        {b.module_code}
                      </span>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {b.title}
                    </span>
                  </span>
                  <span className="muted" style={{ whiteSpace: "nowrap", fontSize: 12 }}>
                    {formatDateBadge(b.created_at_ext)}
                  </span>
                </button>
              );
            })}
            {bugOptions.length === 0 && <div className="muted" style={{ padding: 12, textAlign: "center" }}>Không có bug nào khớp.</div>}
          </div>
        </div>
      )}

      {/* Bug đang nạp + preview đính kèm */}
      {loadedBug && (
        <div className="card" style={{ borderLeft: `4px solid ${modColor || "var(--brand)"}` }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6, gap: 8 }}>
            <div className="row" style={{ gap: 6, minWidth: 0, flex: 1 }}>
              <strong>Bug đang nạp:</strong>
              {loadedBug.moduleCode && (
                <span
                  className="badge"
                  style={{
                    background: `${getModuleColor(loadedBug.moduleCode)}18`,
                    color: getModuleColor(loadedBug.moduleCode),
                    borderColor: `${getModuleColor(loadedBug.moduleCode)}55`,
                  }}
                >
                  {loadedBug.moduleCode}
                </span>
              )}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loadedBug.title}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <a className="btn sm" href={loadedBug.url} target="_blank" rel="noopener noreferrer">Mở trên Haraworks ↗</a>
              <button className="sm" onClick={() => setLoadedBug(null)}>Bỏ</button>
            </div>
          </div>
          {loadedBug.media.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="muted" style={{ marginBottom: 4, fontSize: 12.5 }}>
                File đính kèm / ảnh của Bug ({loadedBug.media.length}) — nhấn để xem phóng to:
              </div>
              <div className="bh-media">
                {loadedBug.media.map((m) =>
                  m.kind === "image" ? (
                    <button
                      key={m.url}
                      type="button"
                      className="bh-media-thumb"
                      onClick={() => setPreviewMedia(m)}
                      title={m.name || "Xem ảnh phóng to"}
                    >
                      <img src={mediaProxy(m.url)} alt={m.name || "Ảnh đính kèm"} />
                    </button>
                  ) : (
                    <button key={m.url} type="button" className="sm" onClick={() => setPreviewMedia(m)}>
                      {m.kind === "video" ? "▶ " : "📎 "}
                      {m.name || "Xem tệp"}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Khung nhập Tra cứu Rule */}
      <div
        className="card"
        style={{
          borderTop: `3px solid ${modColor || "var(--brand)"}`,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {/* Hàng lọc dạng sổ danh sách: Module + Loại nguồn */}
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 230, flex: "1 1 230px" }}>
            <label htmlFor="lk-mod" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span>Module (chỉ tìm trong nguồn của Module này)</span>
              {autoDetectedMod && moduleCode === autoDetectedMod && (
                <span
                  className="badge"
                  style={{ background: `${modColor}18`, color: modColor, borderColor: `${modColor}55`, fontSize: 11 }}
                >
                  Tự nhận diện [{autoDetectedMod}]
                </span>
              )}
            </label>
            <select
              id="lk-mod"
              value={moduleCode}
              onChange={(e) => {
                setModuleCode(e.target.value);
                setAutoDetectedMod("");
              }}
              style={modColor ? { borderColor: modColor } : undefined}
            >
              <option value="">Tất cả Module</option>
              {moduleOptions.map((m) => (
                <option key={m.code} value={m.code}>
                  [{m.code}]{m.name && m.name !== m.code ? ` — ${m.name}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 220, flex: "1 1 220px" }}>
            <label htmlFor="lk-kind">Loại nguồn</label>
            <select id="lk-kind" value={selectedKind} onChange={(e) => setSelectedKind(e.target.value)}>
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Mô tả bug */}
        <div>
          <label htmlFor="lk-desc">Mô tả bug / tiêu đề task cần đối chiếu</label>
          <textarea
            id="lk-desc"
            rows={4}
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder="Dán tiêu đề & mô tả bug (VD: [BUG][4RUM][Internal] Xuất danh sách thành viên tham gia nhóm bị thiếu cột...) — hệ thống tự nhận diện mã Module trong ngoặc vuông [MÃ]."
          />
        </div>

        {/* Bước định hướng Chức năng / Luồng ứng dụng trước khi tách từ khóa */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--panel-alt)",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <label htmlFor="lk-flow" style={{ margin: 0, fontWeight: 600 }}>
              Chức năng / Luồng ứng dụng liên quan <span className="muted" style={{ fontWeight: 400 }}>(định hướng vùng tìm trước khi lọc theo từ khóa)</span>
            </label>
            <button
              type="button"
              className="sm"
              disabled={aiFlowBusy || description.trim().length < 4}
              onClick={() => void suggestFlowWithAi()}
              style={{ borderColor: "#7c3aed66", color: "#6d28d9" }}
            >
              {aiFlowBusy ? "AI đang phân tích…" : "✨ Phân tích bằng AI"}
            </button>
          </div>
          <input
            id="lk-flow"
            value={flowHint}
            onChange={(e) => setFlowHint(e.target.value)}
            placeholder="Nhập tên chức năng / màn hình / luồng (VD: Thành viên nhóm - Xuất danh sách) hoặc bấm Phân tích bằng AI..."
          />
          {aiFlowErr && (
            <div className="err row" role="alert" style={{ justifyContent: "space-between", gap: 8 }}>
              <span>{aiFlowErr}</span>
              {aiNeedKey && (
                <Link className="btn sm primary" href="/settings?tab=integrations">
                  Đi tới Cài đặt AI →
                </Link>
              )}
            </div>
          )}
          {(aiFlowSummary || aiFlowKeywords.length > 0) && (
            <div style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 4 }}>
              {aiFlowSummary && <div className="muted"><strong>AI tóm tắt:</strong> {aiFlowSummary}</div>}
              {aiFlowKeywords.length > 0 && (
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  <span className="muted">Từ khóa AI gợi ý:</span>
                  {aiFlowKeywords.map((kw) => (
                    <span
                      key={kw}
                      className="badge"
                      style={{ background: "#f5f3ff", color: "#6d28d9", borderColor: "#c4b5fd" }}
                    >
                      {kw}
                    </span>
                  ))}
                  <button
                    type="button"
                    className="sm"
                    style={{ padding: "1px 6px", fontSize: 11 }}
                    onClick={() => { setAiFlowKeywords([]); setAiFlowSummary(""); }}
                  >
                    Xóa gợi ý AI
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Nút Tra cứu */}
        <div className="row" style={{ gap: 10 }}>
          <button
            className="primary"
            disabled={busy || description.trim().length < 4}
            onClick={() => void run()}
            style={{ minWidth: 150 }}
          >
            {busy ? "Đang tra cứu…" : "Tra cứu Rule"}
          </button>
          {moduleCode && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Phạm vi: chỉ nguồn thuộc module{" "}
              <strong style={{ color: modColor }}>{moduleCode}</strong>
            </span>
          )}
          <span className="grow" />
          {result?.lookup_id && (
            <button type="button" className="sm" onClick={() => setNoteOpen(true)}>
              📝 Ghi chú cho lần tra cứu này
            </button>
          )}
        </div>
        {error && <div className="err" role="alert">{error}</div>}
      </div>

      {/* Kết quả tra cứu */}
      {result && (
        <>
          {/* Từ khóa đã tách (đã lọc bỏ ID rác trong URL, chỉ giữ URL root) */}
          <div className="card" style={{ padding: "12px 16px" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Từ khóa đã tách ({result.keywords.length})</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Tìm thấy <strong>{totalHits}</strong> đoạn khớp
                {moduleCode ? ` trong module ${moduleCode}` : ""}
              </span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {result.keywords.slice(0, 24).map((k) => {
                const st = KW_TYPE_STYLE[k.type] || KW_TYPE_STYLE.word;
                return (
                  <span
                    key={k.term}
                    className="badge"
                    title={`${st.title} (trọng số ${k.weight})`}
                    style={{ background: st.bg, color: st.color, borderColor: st.border }}
                  >
                    {k.type === "flow" ? "🎯 " : k.type === "url_root" ? "🌐 " : ""}
                    {k.display}
                  </span>
                );
              })}
              {result.keywords.length === 0 && <span className="muted">Chưa tách được từ khóa rõ nghĩa.</span>}
            </div>
          </div>

          {/* Trạng thái không có nguồn / không có kết quả */}
          {(result.module_empty || totalHits === 0) && (
            <div
              className="card"
              style={{
                borderLeft: "4px solid #f59e0b",
                background: "#fffbeb",
                color: "#92400e",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong>
                  {result.module_empty
                    ? `Không có nguồn nào thuộc module ${moduleCode}`
                    : "Không tìm thấy kết quả khớp"}
                </strong>
                <div style={{ marginTop: 4, fontSize: 13 }}>{result.hint}</div>
              </div>
              <Link className="btn sm primary" href="/sources">
                Quản lý nguồn rule →
              </Link>
            </div>
          )}

          {/* Nhóm kết quả theo từng loại nguồn (bao gồm Bug cũ đã hoàn thành) */}
          {Object.entries(result.groups).map(([kind, items]) => {
            const meta = KIND_META[kind] || { label: kind, color: "var(--brand)", bg: "var(--panel-alt)" };
            return (
              <section key={kind} style={{ marginTop: 18 }}>
                <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: meta.color,
                      display: "inline-block",
                    }}
                  />
                  <h3 style={{ margin: 0, color: meta.color }}>{meta.label}</h3>
                  <span className="badge" style={{ background: meta.bg, color: meta.color, borderColor: `${meta.color}44` }}>
                    {items.length} kết quả
                  </span>
                </div>
                {items.map((c) => (
                  <CitationCard key={c.passage_id} c={c} onOpenSource={setViewing} />
                ))}
              </section>
            );
          })}

          {result.lookup_id && totalHits > 0 && (
            <div style={{ marginTop: 16 }}>
              <AiAnalysis lookupId={result.lookup_id} description={description} />
            </div>
          )}
        </>
      )}

      {/* Popup Ghi chú (nhấn icon 📝 Ghi chú để mở & lưu) */}
      {noteOpen && (
        <div className="modal-backdrop" onClick={() => setNoteOpen(false)} role="dialog" aria-modal="true" aria-label="Ghi chú tra cứu">
          <div className="modal-box" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>📝 Ghi chú &amp; Kết luận QC</strong>
              <button type="button" onClick={() => setNoteOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {!result?.lookup_id ? (
                <div className="muted">
                  Hãy bấm <strong>Tra cứu Rule</strong> trước, sau đó bạn có thể lưu ghi chú kết luận gắn với lần tra cứu đó (và xem lại trong mục <strong>Lịch sử</strong>).
                </div>
              ) : (
                <>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    Ghi chú được lưu kèm vào lịch sử tra cứu để cả nhóm tra lại khi cần.
                  </div>
                  <textarea
                    rows={5}
                    value={note}
                    onChange={(e) => { setNote(e.target.value); setSavedNoteMsg(""); }}
                    placeholder="VD: Đúng bug theo Tài liệu BA mục 3.2 — đã trả dev sửa..."
                    autoFocus
                  />
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                    <span className="muted">{savedNoteMsg}</span>
                    <div className="row" style={{ gap: 8 }}>
                      <button type="button" onClick={() => setNoteOpen(false)}>Đóng</button>
                      <button type="button" className="primary" onClick={() => void saveNote()}>
                        Lưu ghi chú
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drawer / Modal Lịch sử tra cứu (kèm ghi chú đã lưu) */}
      {historyOpen && (
        <div className="modal-backdrop" onClick={() => setHistoryOpen(false)} role="dialog" aria-modal="true" aria-label="Lịch sử tra cứu">
          <div className="modal-box" style={{ maxWidth: 680 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>🕒 Lịch sử tra cứu ({history.length})</strong>
              <button type="button" onClick={() => setHistoryOpen(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {history.length === 0 && <div className="muted">Chưa có lịch sử tra cứu nào.</div>}
              {history.map((h) => (
                <div
                  key={h.id}
                  style={{
                    padding: "10px 12px",
                    border: "1px solid var(--line)",
                    borderRadius: 8,
                    background: "var(--panel-alt)",
                  }}
                >
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <button
                      type="button"
                      style={{
                        border: 0,
                        background: "transparent",
                        padding: 0,
                        textAlign: "left",
                        fontWeight: 600,
                        color: "var(--brand)",
                        cursor: "pointer",
                        flex: 1,
                      }}
                      onClick={() => {
                        handleDescriptionChange(h.description);
                        setNote(h.note || "");
                        setHistoryOpen(false);
                      }}
                    >
                      {h.description}
                    </button>
                    <span className="badge">{h.results} kết quả</span>
                    <span className="muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {formatDateBadge(h.created_at)}
                    </span>
                  </div>
                  {h.note && (
                    <div
                      style={{
                        marginTop: 6,
                        padding: "6px 10px",
                        borderRadius: 6,
                        background: "var(--panel)",
                        borderLeft: "3px solid var(--brand)",
                        fontSize: 12.5,
                      }}
                    >
                      <strong>📝 Ghi chú:</strong> {h.note}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Xem trực tiếp nguồn */}
      {viewing && (
        <SourceViewerModal
          sourceId={viewing.source_id}
          title={viewing.source_title}
          moduleCode={viewing.source_module}
          url={viewing.url}
          highlightPassageId={viewing.passage_id}
          onClose={() => setViewing(null)}
        />
      )}

      {/* Lightbox xem file đính kèm bug */}
      {previewMedia && (
        <div className="bh-lightbox" onClick={() => setPreviewMedia(null)}>
          <div className="bh-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="bh-lightbox-bar">
              <strong>{previewMedia.name || "Xem trước tệp đính kèm"}</strong>
              <div className="row">
                <a className="btn sm" href={previewMedia.url} target="_blank" rel="noopener noreferrer">Mở link gốc ↗</a>
                <button className="sm" onClick={() => setPreviewMedia(null)}>Đóng</button>
              </div>
            </div>
            <div className="bh-lightbox-body">
              {previewMedia.kind === "image" && <img src={mediaProxy(previewMedia.url)} alt={previewMedia.name || "Ảnh"} />}
              {previewMedia.kind === "video" && <video src={mediaProxy(previewMedia.url)} controls autoPlay />}
              {previewMedia.kind === "audio" && <audio src={mediaProxy(previewMedia.url)} controls autoPlay />}
              {previewMedia.kind === "pdf" && (
                <iframe src={mediaProxy(previewMedia.url)} title={previewMedia.name || "PDF"} style={{ width: "80vw", height: "75vh", border: 0 }} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
