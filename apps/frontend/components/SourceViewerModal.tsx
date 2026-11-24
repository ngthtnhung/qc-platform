"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import { getModuleColor } from "@/lib/ui-prefs";

type PassageRow = {
  passage_id: string;
  seq: number;
  kind: string;
  heading_path: string;
  location: string;
  text: string;
  is_current: boolean;
};

type SourceImage = { file_id: string; filename: string };

function foldVN(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function highlightInline(text: string, query: string, isActiveMatchBlock: boolean): ReactNode {
  const qFold = foldVN(query.trim());
  if (!qFold) return text;
  const srcFold = foldVN(text);
  const parts: ReactNode[] = [];
  let pos = 0;
  let idx = srcFold.indexOf(qFold, pos);
  let k = 0;
  while (idx !== -1) {
    if (idx > pos) parts.push(text.slice(pos, idx));
    parts.push(
      <mark
        key={k++}
        style={{
          background: isActiveMatchBlock ? "#f59e0b" : "#fef08a",
          color: "#111827",
          padding: "0 2px",
          borderRadius: 3,
        }}
      >
        {text.slice(idx, idx + qFold.length)}
      </mark>
    );
    pos = idx + qFold.length;
    idx = srcFold.indexOf(qFold, pos);
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

export function SourceViewerModal({
  sourceId,
  title,
  moduleCode,
  url,
  fileId,
  highlightPassageId,
  onClose,
}: {
  sourceId: string;
  title: string;
  moduleCode?: string;
  url?: string;
  fileId?: string | null;
  highlightPassageId?: string;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [activeMatchIdx, setActiveMatchIdx] = useState(0);
  const [items, setItems] = useState<PassageRow[]>([]);
  const [images, setImages] = useState<SourceImage[]>([]);
  const [version, setVersion] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [zoomImg, setZoomImg] = useState<SourceImage | null>(null);

  const blockRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setErr("");
    api<{ total: number; version: string; images?: SourceImage[]; items: PassageRow[] }>(
      `/sources/${sourceId}/passages?limit=1000`
    )
      .then((res) => {
        if (!active) return;
        setItems(res.items || []);
        setImages(res.images || []);
        setVersion(res.version || "");
      })
      .catch((e) => {
        if (!active) return;
        setErr(e instanceof ApiError ? e.message : "Không tải được nội dung nguồn");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sourceId]);

  // Danh sách các block khớp với ô tìm kiếm (không cắt bỏ nội dung gốc, chỉ highlight & tự cuộn tới)
  const matchedIds = useMemo(() => {
    const qf = foldVN(q.trim());
    if (!qf) return [];
    return items.filter((p) => foldVN(p.text).includes(qf)).map((p) => p.passage_id);
  }, [items, q]);

  useEffect(() => {
    setActiveMatchIdx(0);
  }, [q]);

  // Tự động scroll tới đoạn được trích dẫn khi mở từ Tra cứu Rule
  useEffect(() => {
    if (!loading && highlightPassageId && !q.trim()) {
      const el = blockRefs.current[highlightPassageId];
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
      }
    }
  }, [loading, highlightPassageId, items, q]);

  // Tự động scroll tới kết quả khớp khi người dùng tìm kiếm
  useEffect(() => {
    if (!q.trim() || matchedIds.length === 0) return;
    const safeIdx = activeMatchIdx % matchedIds.length;
    const targetId = matchedIds[safeIdx];
    const el = blockRefs.current[targetId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [q, matchedIds, activeMatchIdx]);

  function stepMatch(delta: number) {
    if (matchedIds.length === 0) return;
    setActiveMatchIdx((i) => (i + delta + matchedIds.length) % matchedIds.length);
  }

  const activeMatchId = matchedIds.length > 0 ? matchedIds[activeMatchIdx % matchedIds.length] : "";
  const modColor = moduleCode ? getModuleColor(moduleCode) : "";

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Xem nguồn ${title}`}>
      <div className="modal-box" style={{ maxWidth: 960, width: "94vw", maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="row" style={{ gap: 8, minWidth: 0, flex: 1 }}>
            <strong style={{ fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</strong>
            {moduleCode && (
              <span
                className="badge"
                style={{ background: `${modColor}18`, color: modColor, borderColor: `${modColor}55`, fontWeight: 600 }}
              >
                {moduleCode}
              </span>
            )}
            {version && <span className="badge date">{version}</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {url && (
              <a className="btn sm primary" href={url} target="_blank" rel="noopener noreferrer">
                Mở liên kết gốc ↗
              </a>
            )}
            {fileId && (
              <a className="btn sm" href={`/api/v1/files/${fileId}/download`} target="_blank" rel="noopener noreferrer">
                Tải tệp gốc
              </a>
            )}
            <button className="sm" onClick={onClose}>Đóng</button>
          </div>
        </div>

        {/* Thanh tìm kiếm tự động cuộn tới đúng vị trí */}
        <div
          className="row"
          style={{
            padding: "10px 18px",
            borderBottom: "1px solid var(--line)",
            background: "var(--panel-alt)",
            gap: 8,
          }}
        >
          <input
            className="grow"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepMatch(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Tìm từ khóa trong tài liệu (nhấn Enter để cuộn tới kết quả tiếp theo)..."
            aria-label="Tìm trong nguồn"
          />
          {q.trim() && (
            <div className="row" style={{ gap: 4, flexShrink: 0 }}>
              <span className="badge" style={{ fontSize: 12 }}>
                {matchedIds.length > 0 ? `${(activeMatchIdx % matchedIds.length) + 1} / ${matchedIds.length}` : "0 kết quả"}
              </span>
              <button type="button" className="sm" disabled={matchedIds.length === 0} onClick={() => stepMatch(-1)} title="Kết quả trước">
                ↑
              </button>
              <button type="button" className="sm" disabled={matchedIds.length === 0} onClick={() => stepMatch(1)} title="Kết quả tiếp theo">
                ↓
              </button>
              <button type="button" className="sm" onClick={() => setQ("")} title="Xóa tìm kiếm">
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Khung Preview toàn bộ tài liệu mượt mà */}
        <div className="modal-body" style={{ padding: "20px 26px", background: "var(--panel)" }}>
          {err && <div className="err">{err}</div>}
          {loading ? (
            <div className="muted" style={{ padding: 20, textAlign: "center" }}>Đang tải bản xem trước…</div>
          ) : (
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              {/* Thư viện hình ảnh đính kèm (Figma nhiều hình) */}
              {images.length > 0 && (
                <div style={{ marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 10 }}>
                    Hình ảnh thiết kế đính kèm ({images.length}) — bấm vào ảnh để phóng to:
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                    {images.map((im) => (
                      <button
                        key={im.file_id}
                        type="button"
                        onClick={() => setZoomImg(im)}
                        style={{
                          padding: 6,
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          background: "var(--panel-alt)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <img
                          src={`/api/v1/files/${im.file_id}/download?inline=1`}
                          alt={im.filename}
                          style={{ width: "100%", height: 130, objectFit: "cover", borderRadius: 5 }}
                        />
                        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
                          {im.filename}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {items.length === 0 ? (
                <div className="muted" style={{ textAlign: "center", padding: 20 }}>
                  Nguồn này chưa có nội dung văn bản.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 14, lineHeight: 1.7 }}>
                  {items.map((p) => {
                    const isCited = Boolean(highlightPassageId && p.passage_id === highlightPassageId);
                    const isActiveSearch = Boolean(activeMatchId && p.passage_id === activeMatchId);
                    const isHighlighted = isCited || isActiveSearch;
                    const content = highlightInline(p.text, q, isActiveSearch);

                    if (p.kind === "heading") {
                      return (
                        <div
                          key={p.passage_id}
                          ref={(el) => { blockRefs.current[p.passage_id] = el; }}
                          style={{
                            marginTop: 16,
                            marginBottom: 4,
                            padding: isHighlighted ? "6px 10px" : "2px 0",
                            borderBottom: "1px solid var(--line)",
                            borderRadius: isHighlighted ? 6 : 0,
                            background: isHighlighted ? "var(--brand-soft)" : undefined,
                            fontWeight: 700,
                            fontSize: 15.5,
                            color: "var(--ink)",
                          }}
                        >
                          {content}
                        </div>
                      );
                    }

                    if (p.kind === "code") {
                      return (
                        <div
                          key={p.passage_id}
                          ref={(el) => { blockRefs.current[p.passage_id] = el; }}
                          style={{
                            margin: "6px 0",
                            padding: "10px 14px",
                            borderRadius: 8,
                            background: isHighlighted ? "var(--brand-soft)" : "var(--panel-alt)",
                            border: isHighlighted ? "2px solid var(--brand)" : "1px solid var(--line)",
                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                            fontSize: 12.5,
                            whiteSpace: "pre-wrap",
                            overflowX: "auto",
                          }}
                        >
                          {content}
                        </div>
                      );
                    }

                    if (p.kind === "table_row") {
                      return (
                        <div
                          key={p.passage_id}
                          ref={(el) => { blockRefs.current[p.passage_id] = el; }}
                          style={{
                            padding: "7px 12px",
                            borderRadius: 6,
                            background: isHighlighted ? "var(--brand-soft)" : "var(--panel-alt)",
                            borderLeft: isHighlighted ? "3px solid var(--brand)" : "2px solid var(--line)",
                            whiteSpace: "pre-wrap",
                            fontSize: 13.5,
                          }}
                        >
                          {content}
                        </div>
                      );
                    }

                    return (
                      <div
                        key={p.passage_id}
                        ref={(el) => { blockRefs.current[p.passage_id] = el; }}
                        style={{
                          padding: isHighlighted ? "8px 12px" : "2px 0",
                          borderRadius: isHighlighted ? 8 : 0,
                          background: isHighlighted ? "var(--brand-soft)" : undefined,
                          borderLeft: isHighlighted ? "3px solid var(--brand)" : undefined,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Lightbox phóng to hình ảnh Figma */}
      {zoomImg && (
        <div className="bh-lightbox" onClick={() => setZoomImg(null)}>
          <div className="bh-lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <div className="bh-lightbox-bar">
              <strong>{zoomImg.filename}</strong>
              <button className="sm" onClick={() => setZoomImg(null)}>Đóng</button>
            </div>
            <div className="bh-lightbox-body">
              <img src={`/api/v1/files/${zoomImg.file_id}/download?inline=1`} alt={zoomImg.filename} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
