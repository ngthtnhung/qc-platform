"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { api, ApiError } from "@/lib/api";
import { formatDateBadge, getModuleColor, getTeamRowVars } from "@/lib/ui-prefs";

export function statusClass(status: number | null | undefined): string {
  if (status === null || status === undefined) return "bh-st-old";
  if (status === 0) return "bh-st-new";
  if (status === 1) return "bh-st-doing";
  if (status === 2 || status === 3 || status === 6) return "bh-st-wait";
  if (status === 5) return "bh-st-done";
  if (status === 4 || status === 10 || status === 11) return "bh-st-rej";
  return "bh-st-new";
}

export function PriorityFlag({ priority, label }: { priority?: number | null; label?: string }) {
  const p = Number(priority);
  const cls = p >= 1 && p <= 2 ? "bh-pr-high" : p === 3 ? "bh-pr-mid" : "bh-pr-low";
  const tip = `Độ ưu tiên: ${label || (p >= 1 && p <= 2 ? "Ưu tiên cao" : p === 3 ? "Ưu tiên" : "Không ưu tiên")}`;
  return (
    <span className={`bh-priority ${cls}`} title={tip} aria-label={tip}>
      <svg viewBox="0 0 16 18" aria-hidden="true">
        <path d="M2 1h2v16H2V1zm3 1h9l-2 4.5L14 11H5V2z" />
      </svg>
    </span>
  );
}

export function TaskRowCard({
  moduleCode,
  teamOrProject,
  priority,
  priorityLabel,
  title,
  statusCode,
  statusLabel,
  approver,
  assignee,
  date,
  closed,
  onClick,
}: {
  moduleCode?: string;
  teamOrProject?: string;
  priority?: number | null;
  priorityLabel?: string;
  title: string;
  statusCode?: number | null;
  statusLabel?: string;
  approver?: string;
  assignee?: string;
  date?: string | null;
  closed?: boolean;
  onClick: () => void;
}) {
  const tint = getTeamRowVars(teamOrProject);
  const modColor = moduleCode ? getModuleColor(moduleCode) : "#64748b";
  const rowStyle = {
    "--row-bg": tint.bg,
    "--row-bg-dark": tint.bgDark,
    "--row-border": tint.border,
  } as CSSProperties;
  const modStyle = moduleCode
    ? ({ "--label-color": modColor, "--label-bg": `${modColor}18` } as CSSProperties)
    : undefined;

  return (
    <article
      className={`bh-card${closed ? " is-closed" : ""}`}
      style={rowStyle}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      title={teamOrProject ? `Dự án: ${teamOrProject}` : undefined}
    >
      <span className="bh-mod" style={modStyle} title={moduleCode || "Chưa rõ module"}>
        {moduleCode || "—"}
      </span>
      <PriorityFlag priority={priority} label={priorityLabel} />
      <span className="bh-card-title" title={title}>{title}</span>
      <span className={`bh-st ${statusClass(statusCode)}`} title="Trạng thái">
        {statusLabel || "—"}
      </span>
      <span className="bh-cell" title={`Người duyệt: ${approver || "—"}`}>{approver || "—"}</span>
      <span className="bh-cell" title={`Người thực hiện: ${assignee || "—"}`}>{assignee || "—"}</span>
      <span className="bh-cell bh-date" title="Ngày tạo">{formatDateBadge(date)}</span>
    </article>
  );
}

type MediaItem = { url: string; name?: string; kind: string };
type HwDetail = {
  id: string;
  project_id?: string;
  name: string;
  description: string;
  description_media: MediaItem[];
  status: number | null;
  status_label: string;
  priority_label: string;
  plan_end_at: string;
  created_at: string;
  updated_at: string;
  created_by: { name: string } | null;
  updated_by: { name: string } | null;
  assignee: { name: string; dept?: string } | null;
  approver: { name: string; dept?: string } | null;
  followers: { name: string }[];
  supporters: { name: string }[];
  attachments: MediaItem[];
  childs: { id: string; name: string; status_label: string; assignee: string; url: string }[];
  logs: { type: number; value: string; reason: string; at: string; by: string; info: Record<string, string> }[];
  comments: {
    total: number;
    items: {
      id: string;
      text: string;
      at: string;
      by: string;
      attachments: MediaItem[];
      media: MediaItem[];
      replies: { id: string; text: string; at: string; by: string }[];
    }[];
  };
};

type BuildCheckRes = {
  appBuilds: { id: string; title: string; status_label: string; assignee: string; date: string; url: string }[];
  functionBuilds: { id: string; title: string; status_label: string; assignee: string; date: string; url: string }[];
  total: number;
};

const LOG_TYPE: Record<number, string> = {
  1: "Tạo công việc",
  2: "Cập nhật trạng thái",
  3: "Đổi tên công việc",
  4: "Cập nhật mô tả",
  5: "Thay đổi ngày bắt đầu",
  6: "Thay đổi hạn hoàn thành",
  7: "Thay đổi người thực hiện",
  8: "Thay đổi người theo dõi",
  9: "Thêm tệp đính kèm",
  10: "Xóa tệp đính kèm",
  11: "Thay đổi độ ưu tiên",
  12: "Thay đổi dự án",
  13: "Thêm bình luận",
  14: "Thêm công việc con",
  15: "Thay đổi người duyệt",
  16: "Thay đổi người hỗ trợ",
  17: "Cập nhật thông tin bổ sung",
  18: "Phê duyệt công việc",
  19: "Gửi duyệt / Chuyển trạng thái duyệt",
  20: "Từ chối duyệt",
};

const STATUS_CODE_NAME: Record<string, string> = {
  "0": "Mới",
  "1": "Đang thực hiện",
  "2": "Tạm ngưng",
  "3": "Chờ duyệt",
  "4": "Từ chối",
  "5": "Hoàn thành",
  "6": "Cần duyệt",
  "10": "Không xử lý",
  "11": "Không thực hiện",
};

function formatLogDetail(l: { type: number; value: string; reason: string; info: Record<string, string> }): string {
  const action = LOG_TYPE[l.type] || `Cập nhật công việc (mã ${l.type})`;
  const parts: string[] = [];
  const clean = (v?: string | null) => {
    const s = String(v ?? "").trim();
    return !s || s.toLowerCase() === "null" || s.toLowerCase() === "undefined" ? "" : s;
  };
  const val = clean(l.value);
  if (val) {
    parts.push(l.type === 2 && STATUS_CODE_NAME[val] ? STATUS_CODE_NAME[val] : val);
  }
  if (l.info && typeof l.info === "object") {
    for (const [k, rawV] of Object.entries(l.info)) {
      const v = clean(rawV);
      if (!v) continue;
      if (k.toLowerCase().includes("status") && STATUS_CODE_NAME[v]) {
        parts.push(`${k}: ${STATUS_CODE_NAME[v]}`);
      } else {
        parts.push(`${k}: ${v}`);
      }
    }
  }
  const reason = clean(l.reason);
  if (reason) parts.push(`Lý do: ${reason}`);
  return parts.length ? `${action} — ${parts.join(" · ")}` : action;
}

function vnTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("vi-VN");
}

function mediaPreviewUrl(rawUrl: string): string {
  return `/api/v1/sources/haraworks-media?url=${encodeURIComponent(rawUrl)}`;
}

function MediaList({ items, onPreview }: { items: MediaItem[]; onPreview: (m: MediaItem) => void }) {
  const seen = new Set<string>();
  const clean = (items || []).filter((m) => m && /^https?:\/\//i.test(m.url) && !seen.has(m.url) && (seen.add(m.url), true));
  if (!clean.length) return null;
  return (
    <div className="bh-media">
      {clean.map((m) => {
        const src = mediaPreviewUrl(m.url);
        if (m.kind === "image") {
          return (
            <button
              key={m.url}
              type="button"
              onClick={() => onPreview(m)}
              title={m.name || "Nhấn để xem phóng to"}
              style={{ padding: 0, border: 0, background: "transparent", cursor: "zoom-in" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={m.name || "ảnh"} loading="lazy" />
            </button>
          );
        }
        if (m.kind === "video") {
          return (
            <div key={m.url} style={{ width: "100%" }}>
              <video controls preload="metadata" src={src} />
              <div>
                <button type="button" className="sm" onClick={() => onPreview(m)}>Phóng to video</button>
              </div>
            </div>
          );
        }
        if (m.kind === "audio") return <audio key={m.url} controls preload="none" src={src} style={{ width: "100%" }} />;
        if (m.kind === "pdf") {
          return (
            <div key={m.url} style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: 8, background: "var(--panel-alt)" }}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <strong style={{ fontSize: 12 }}>PDF: {m.name || "Tài liệu PDF"}</strong>
                <button type="button" className="sm primary" onClick={() => onPreview(m)}>Xem toàn màn hình</button>
              </div>
              <iframe src={src} title={m.name || "PDF preview"} style={{ width: "100%", height: 260, border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }} />
            </div>
          );
        }
        return (
          <button key={m.url} type="button" className="sm" onClick={() => onPreview(m)} title="Xem trước tệp đính kèm">
            Xem trước: {m.name || "Tệp đính kèm"}
          </button>
        );
      })}
    </div>
  );
}

export type DrawerTask = {
  kind: "bug" | "function" | "build";
  externalId: string;
  title: string;
  moduleCode?: string;
  project?: string;
  team?: string;
  sourceTeam?: string;
  sourceFunction?: { id: string; title: string; url: string } | null;
  kindLabel?: string;
  statusLabel?: string;
  priorityLabel?: string;
  assignee?: string;
  approver?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  closed?: boolean;
  url?: string;
  fallbackDescription?: string;
};

export function TaskDrawer({ task, onClose }: { task: DrawerTask; onClose: () => void }) {
  const [detail, setDetail] = useState<HwDetail | null>(null);
  const [detailErr, setDetailErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [buildCheck, setBuildCheck] = useState<BuildCheckRes | null>(null);
  const [checkingBuild, setCheckingBuild] = useState(false);
  const [buildCheckErr, setBuildCheckErr] = useState("");
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);

  useEffect(() => {
    setDetail(null);
    setDetailErr("");
    setBuildCheck(null);
    setBuildCheckErr("");
    if (!/^[0-9a-f]{24}$/i.test(task.externalId || "")) return;
    let active = true;
    setLoading(true);
    api<HwDetail>(`/sources/haraworks-detail/${encodeURIComponent(task.externalId)}`)
      .then((d) => { if (active) setDetail(d); })
      .catch((e) => { if (active) setDetailErr(e instanceof ApiError ? e.message : "Không tải được chi tiết từ Haraworks"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [task.externalId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function checkBuilds() {
    setCheckingBuild(true);
    setBuildCheckErr("");
    try {
      const qs = new URLSearchParams({ id: task.externalId || "", title: task.title || "" });
      setBuildCheck(await api<BuildCheckRes>(`/sources/builds/check?${qs.toString()}`));
    } catch (e) {
      setBuildCheckErr(e instanceof ApiError ? e.message : "Không kiểm tra được đợt build");
    } finally {
      setCheckingBuild(false);
    }
  }

  const openHwUrl =
    task.url ||
    (detail?.project_id && task.externalId
      ? `https://tasks.haraworks.vn/task/project/${detail.project_id}/${task.externalId}`
      : /^[0-9a-f]{24}$/i.test(task.externalId || "")
        ? `https://tasks.haraworks.vn/task/me/${task.externalId}`
        : "");

  return (
    <>
      <div className="bh-drawer-backdrop" onClick={onClose} />
      <aside className="bh-drawer-panel" role="dialog" aria-label="Chi tiết công việc">
        <div className="bh-drawer-head">
          <span className={`badge ${task.closed ? "" : "ok"}`}>{task.closed ? "Đã đóng" : "Đang mở"}</span>
          <button className="sm" onClick={onClose}>Đóng ✕</button>
        </div>
        <div className="bh-drawer-body">
          <h3 className="bh-d-title">{task.title}</h3>

          {task.kind === "build" && task.kindLabel && (
            <div className="bh-row"><span>Loại build</span><b>{task.kindLabel}</b></div>
          )}
          <div className="bh-row"><span>Dự án / Team</span><b>{task.team || task.project || "—"}</b></div>
          {task.kind === "build" && (
            <>
              <div className="bh-row"><span>Team / Dự án nguồn</span><b>{task.sourceTeam || "—"}</b></div>
              <div className="bh-row">
                <span>Task Function nguồn</span>
                <b>
                  {task.sourceFunction ? (
                    <a href={task.sourceFunction.url} target="_blank" rel="noopener noreferrer">
                      {task.sourceFunction.title} ↗
                    </a>
                  ) : (
                    <span className="muted">Không tìm thấy liên kết</span>
                  )}
                </b>
              </div>
            </>
          )}
          <div className="bh-row"><span>Module</span><b>{task.moduleCode || "Chưa rõ"}</b></div>
          <div className="bh-row"><span>Trạng thái</span><b>{detail?.status_label || task.statusLabel || "—"}</b></div>
          <div className="bh-row"><span>Độ ưu tiên</span><b>{detail?.priority_label || task.priorityLabel || "—"}</b></div>
          <div className="bh-row"><span>Người thực hiện</span><b>{detail?.assignee?.name || task.assignee || "—"}</b></div>
          <div className="bh-row"><span>Người duyệt</span><b>{detail?.approver?.name || task.approver || "Chưa có"}</b></div>
          <div className="bh-row"><span>Ngày tạo</span><b>{vnTime(detail?.created_at || task.createdAt)}</b></div>
          <div className="bh-row"><span>Cập nhật gần nhất</span><b>{vnTime(detail?.updated_at || task.updatedAt)}</b></div>

          <div className="row" style={{ marginTop: 12 }}>
            {openHwUrl && (
              <a className="btn sm primary" href={openHwUrl} target="_blank" rel="noopener noreferrer">
                Mở trên Haraworks ↗
              </a>
            )}
            {task.kind === "bug" && task.externalId && (
              <a className="btn sm" href={`/lookup?bugId=${encodeURIComponent(task.externalId)}`}>
                Tra cứu nguồn cho bug này
              </a>
            )}
            {task.kind !== "build" && (
              <button className="sm" onClick={() => void checkBuilds()} disabled={checkingBuild}>
                {checkingBuild ? "Đang dò đợt build…" : "Kiểm tra đợt build"}
              </button>
            )}
          </div>

          {(buildCheck || buildCheckErr) && (
            <div className="build-check-box">
              {buildCheckErr ? (
                <div className="err" style={{ margin: 0 }}>{buildCheckErr}</div>
              ) : buildCheck && buildCheck.total === 0 ? (
                <div>
                  <strong>Kết quả kiểm tra đợt build:</strong>{" "}
                  <span className="muted">Chưa nằm trong đợt Build App Mobile hay Build Task Function nào.</span>
                </div>
              ) : buildCheck ? (
                <div>
                  {buildCheck.appBuilds.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      <span className="badge ok">Build App Mobile ({buildCheck.appBuilds.length})</span>
                      {buildCheck.appBuilds.map((b) => (
                        <div key={b.id} className="build-check-item">
                          <div>
                            <a href={b.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{b.title} ↗</a>
                            <div className="muted">{[b.status_label, formatDateBadge(b.date), b.assignee].filter(Boolean).join(" · ")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {buildCheck.functionBuilds.length > 0 && (
                    <div>
                      <span className="badge ai">Build Task Function ({buildCheck.functionBuilds.length})</span>
                      {buildCheck.functionBuilds.map((b) => (
                        <div key={b.id} className="build-check-item">
                          <div>
                            <a href={b.url} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>{b.title} ↗</a>
                            <div className="muted">{[b.status_label, formatDateBadge(b.date), b.assignee].filter(Boolean).join(" · ")}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            {loading && <div className="muted">Đang tải chi tiết, lịch sử và bình luận từ Haraworks…</div>}
            {detailErr && <div className="notice">{detailErr}</div>}

            {!detail && task.fallbackDescription && (
              <div>
                <h4 style={{ margin: "10px 0 4px" }}>Mô tả</h4>
                <div style={{ whiteSpace: "pre-wrap" }}>{task.fallbackDescription}</div>
              </div>
            )}

            {detail && (
              <>
                <h4 style={{ margin: "10px 0 6px" }}>Chi tiết từ Haraworks</h4>
                {detail.created_by?.name && <div className="bh-row"><span>Người tạo</span><b>{detail.created_by.name}</b></div>}
                {detail.plan_end_at && <div className="bh-row"><span>Hạn thực hiện</span><b>{vnTime(detail.plan_end_at)}</b></div>}
                {detail.followers.length > 0 && <div className="bh-row"><span>Người theo dõi</span><b>{detail.followers.map((f) => f.name).join(", ")}</b></div>}

                {(detail.description || detail.description_media.length > 0) && (
                  <>
                    <h4 style={{ margin: "12px 0 4px" }}>
                      {task.kind === "build" ? "Mô tả (Danh sách Bug / Function)" : "Mô tả"}
                    </h4>
                    {detail.description && <div style={{ whiteSpace: "pre-wrap" }}>{detail.description}</div>}
                    <MediaList items={detail.description_media} onPreview={setPreviewItem} />
                  </>
                )}

                {detail.attachments.length > 0 && (
                  <>
                    <h4 style={{ margin: "12px 0 4px" }}>File đính kèm ({detail.attachments.length})</h4>
                    <MediaList items={detail.attachments} onPreview={setPreviewItem} />
                  </>
                )}

                {detail.childs.length > 0 && (
                  <>
                    <h4 style={{ margin: "12px 0 4px" }}>Task con ({detail.childs.length})</h4>
                    <ul className="bh-logs">
                      {detail.childs.map((ch) => (
                        <li key={ch.id}>
                          <a href={ch.url} target="_blank" rel="noopener noreferrer">{ch.name} ↗</a>
                          <div className="muted">{[ch.status_label, ch.assignee].filter(Boolean).join(" · ")}</div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <h4 style={{ margin: "12px 0 4px" }}>Lịch sử cập nhật ({detail.logs.length})</h4>
                {detail.logs.length === 0 ? (
                  <div className="muted">Không có.</div>
                ) : (
                  <ul className="bh-logs">
                    {[...detail.logs].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((l, idx) => (
                      <li key={idx}>
                        <strong>{l.by || "—"}</strong>: {formatLogDetail(l)}
                        <div className="muted">{vnTime(l.at)}</div>
                      </li>
                    ))}
                  </ul>
                )}

                <h4 style={{ margin: "12px 0 6px" }}>Bình luận ({detail.comments.total})</h4>
                {detail.comments.items.length === 0 ? (
                  <div className="muted">Chưa có bình luận.</div>
                ) : (
                  detail.comments.items.map((c) => (
                    <div key={c.id} className="bh-comment">
                      <strong>{c.by || "—"}</strong>{" "}
                      <span className="muted" style={{ fontSize: 11 }}>{vnTime(c.at)}</span>
                      <div style={{ whiteSpace: "pre-wrap", marginTop: 3 }}>{c.text}</div>
                      <MediaList items={[...(c.media || []), ...(c.attachments || [])]} onPreview={setPreviewItem} />
                      {c.replies.map((r) => (
                        <div key={r.id} className="bh-reply">
                          <strong>{r.by || "—"}</strong>{" "}
                          <span className="muted" style={{ fontSize: 11 }}>{vnTime(r.at)}</span>
                          <div style={{ whiteSpace: "pre-wrap" }}>{r.text}</div>
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </>
            )}
          </div>
        </div>
      </aside>

      {previewItem && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 1000 }}
          onClick={() => setPreviewItem(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Xem trước tệp đính kèm"
        >
          <div className="modal-box" style={{ maxWidth: 1020, maxHeight: "92vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {previewItem.name || "Xem trước tệp đính kèm"}
              </strong>
              <div className="row">
                <a className="btn sm" href={mediaPreviewUrl(previewItem.url)} target="_blank" rel="noopener noreferrer">
                  Tải / Mở tab mới ↗
                </a>
                <button className="sm" onClick={() => setPreviewItem(null)}>Đóng ✕</button>
              </div>
            </div>
            <div className="modal-body" style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 360 }}>
              {previewItem.kind === "image" ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={mediaPreviewUrl(previewItem.url)}
                  alt={previewItem.name || "preview"}
                  style={{ maxWidth: "100%", maxHeight: "76vh", objectFit: "contain", borderRadius: 6 }}
                />
              ) : previewItem.kind === "video" ? (
                <video
                  controls
                  autoPlay
                  src={mediaPreviewUrl(previewItem.url)}
                  style={{ maxWidth: "100%", maxHeight: "76vh", borderRadius: 6 }}
                />
              ) : (
                <iframe
                  src={mediaPreviewUrl(previewItem.url)}
                  title={previewItem.name || "Document preview"}
                  style={{ width: "100%", height: "76vh", border: "1px solid var(--line)", borderRadius: 6, background: "#fff" }}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
