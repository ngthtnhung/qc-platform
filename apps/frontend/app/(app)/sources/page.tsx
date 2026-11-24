"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, apiForm, ApiError, type SourceItem } from "@/lib/api";
import { SourceViewerModal } from "@/components/SourceViewerModal";
import { formatDateBadge, getModuleColor, syncModuleColorsFromServer, type ModuleDef } from "@/lib/ui-prefs";

type IngestOut = { passages: number; version: string; duplicate: boolean; note: string };

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

const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) =>
  m ? <div className={m.ok ? "badge ok" : "err"} style={{ marginTop: 8 }} role={m.ok ? "status" : "alert"}>{m.text}</div> : null;

function ModuleSelect({
  id,
  value,
  onChange,
  modules,
  required = true,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  modules: ModuleDef[];
  required?: boolean;
}) {
  const hasValue = Boolean(value && modules.some((m) => m.code === value));
  return (
    <div>
      <label htmlFor={id}>Module {required ? "*" : "(tùy chọn)"}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required}>
        <option value="">Chọn Module…</option>
        {value && !hasValue && <option value={value}>[{value}]</option>}
        {modules.map((m) => (
          <option key={m.code} value={m.code}>
            [{m.code}]{m.name && m.name !== m.code ? ` — ${m.name}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function UploadForm({
  kind,
  accept,
  title,
  hint,
  modules,
  onDone,
}: {
  kind: "ba_doc" | "code_wiki";
  accept: string;
  title: string;
  hint: string;
  modules: ModuleDef[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [mod, setMod] = useState("");
  const [url, setUrl] = useState("");
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
      form.append("module", mod.trim().toUpperCase());
      form.append("external_url", url);
      form.append("file", f);
      const r = await apiForm<IngestOut>("/sources/upload", form);
      setName("");
      setUrl("");
      if (file.current) file.current.value = "";
      onDone();
      return r.duplicate ? r.note : `Đã nạp ${r.passages} đoạn trích (ngày ${r.version}).`;
    });
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-title">{title}</div>
      <div className="muted" style={{ marginBottom: 10 }}>{hint}</div>
      <div className="grid-2">
        <ModuleSelect id={`${kind}-mod`} value={mod} onChange={setMod} modules={modules} required />
        <div>
          <label htmlFor={`${kind}-t`}>Tên nguồn *</label>
          <input id={`${kind}-t`} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Vd: Spec Nghỉ phép" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label htmlFor={`${kind}-u`}>Link gốc (tùy chọn)</label>
          <input id={`${kind}-u`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </div>
      </div>
      <label htmlFor={`${kind}-f`}>Chọn tệp ({accept}) *</label>
      <input id={`${kind}-f`} type="file" accept={accept} ref={file} required />
      <div style={{ marginTop: 12 }}>
        <button className="primary" type="submit">Nạp tài liệu</button>
      </div>
      <Msg m={msg} />
    </form>
  );
}

function FigmaForm({ modules, onDone }: { modules: ModuleDef[]; onDone: () => void }) {
  const [mod, setMod] = useState("");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pasted, setPasted] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const { msg, run } = useMessage();

  function onPickFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(fl)]);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const form = new FormData();
          form.append("module", mod.trim().toUpperCase());
          form.append("title", title.trim());
          form.append("url", url.trim());
          form.append("pasted_text", pasted);
          for (const f of files) {
            form.append("images", f);
          }
          const r = await apiForm<IngestOut>("/sources/figma/upload", form);
          setUrl("");
          setTitle("");
          setPasted("");
          setFiles([]);
          onDone();
          return `Đã thêm nguồn Figma (${r.passages} đoạn trích${files.length ? `, ${files.length} hình ảnh` : ""}, ngày ${r.version}).`;
        });
      }}
    >
      <div className="card-title">Thêm nguồn Figma theo Module</div>
      <div
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          background: "var(--panel-alt)",
          border: "1px solid var(--line)",
          marginBottom: 12,
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        <strong>Hướng dẫn lấy rule từ Figma:</strong>
        <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
          <li>
            <strong>Cách nhanh (không cần Token):</strong> Chọn frame/màn hình trên Figma → chuột phải →{" "}
            <code>Copy/Paste as → Copy as CSS</code> (hoặc bôi đen copy chữ/ghi chú thiết kế) rồi dán vào ô nội dung bên dưới.
          </li>
          <li>
            <strong>Đính kèm hình ảnh:</strong> Có thể chọn <strong>nhiều ảnh chụp màn hình Figma</strong> để xem trực tiếp khi mở preview.
          </li>
          <li>
            <strong>Tự động qua Token:</strong> Nếu đã nhập Token Figma trong <Link href="/settings?tab=integrations">Cài đặt → Tích hợp</Link>, chỉ cần dán Link Figma.
          </li>
        </ul>
      </div>

      <div className="grid-2">
        <ModuleSelect id="fg-mod" value={mod} onChange={setMod} modules={modules} required />
        <div>
          <label htmlFor="fg-t">Tên nguồn *</label>
          <input id="fg-t" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Vd: UI Thành viên nhóm 4RUM" />
        </div>
      </div>

      <label htmlFor="fg-u">Link Figma (tùy chọn nếu đã dán nội dung hoặc tải ảnh)</label>
      <input id="fg-u" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.figma.com/design/…?node-id=…" />

      <label htmlFor="fg-p">Nội dung dán từ Figma (Copy as CSS / chữ thiết kế / ghi chú)</label>
      <textarea
        id="fg-p"
        rows={5}
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
        placeholder="Dán CSS hoặc nội dung text từ Figma vào đây..."
      />

      <div style={{ marginTop: 10 }}>
        <label htmlFor="fg-imgs">Hình ảnh thiết kế Figma (chọn được nhiều hình)</label>
        <input
          id="fg-imgs"
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => onPickFiles(e.target.files)}
        />
        {files.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {files.map((f, idx) => (
              <span key={`${f.name}-${idx}`} className="badge" style={{ gap: 6, display: "inline-flex", alignItems: "center" }}>
                🖼 {f.name}
                <button
                  type="button"
                  style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, fontWeight: 700 }}
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Bỏ ảnh"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <button className="primary" type="submit">Thêm Figma</button>
      </div>
      <Msg m={msg} />
    </form>
  );
}

export default function SourcesPage() {
  const [tab, setTab] = useState<"list" | "ba_doc" | "figma" | "code_wiki">("list");
  const [items, setItems] = useState<SourceItem[]>([]);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [filterMod, setFilterMod] = useState("");
  const [filterKind, setFilterKind] = useState("");
  const [q, setQ] = useState("");
  const [viewing, setViewing] = useState<SourceItem | null>(null);

  // State modal Sửa & Thay thế nội dung (đúng theo loại nguồn)
  const [editing, setEditing] = useState<SourceItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editMod, setEditMod] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editPasted, setEditPasted] = useState("");
  const [editExistingImgs, setEditExistingImgs] = useState<{ file_id: string; filename: string }[]>([]);
  const [editRemovedImgIds, setEditRemovedImgIds] = useState<string[]>([]);
  const [editNewImgs, setEditNewImgs] = useState<File[]>([]);
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState("");
  const editFileRef = useRef<HTMLInputElement>(null);
  const editImgRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (filterMod) qs.set("module", filterMod);
    if (filterKind) qs.set("kind", filterKind);
    api<{ items: SourceItem[] }>(`/sources?${qs.toString()}`)
      .then((r) => {
        // Ẩn Task Function khỏi danh sách Quản lý nguồn rule vì đã lấy trực tiếp từ danh sách Task Function
        setItems(r.items.filter((x) => x.kind !== "task_function"));
      })
      .catch(() => undefined);
    api<{ items: ModuleDef[] }>("/sources/modules")
      .then((r) => {
        setModules(r.items);
        syncModuleColorsFromServer(r.items);
      })
      .catch(() => undefined);
  }, [filterMod, filterKind]);

  useEffect(load, [load]);

  function openEdit(s: SourceItem) {
    setEditing(s);
    setEditTitle(s.title);
    setEditMod(s.module || "");
    setEditUrl(s.url || "");
    setEditPasted("");
    setEditExistingImgs(s.meta?.images || []);
    setEditRemovedImgIds([]);
    setEditNewImgs([]);
    setEditErr("");
    if (editFileRef.current) editFileRef.current.value = "";
    if (editImgRef.current) editImgRef.current.value = "";
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditErr("");
    setEditSaving(true);
    try {
      const form = new FormData();
      form.append("title", editTitle.trim());
      form.append("module", editMod.trim().toUpperCase());
      form.append("external_url", editUrl.trim());
      if (editing.kind === "figma") {
        form.append("pasted_text", editPasted);
        if (editRemovedImgIds.length > 0) {
          form.append("remove_image_ids", editRemovedImgIds.join(","));
        }
        for (const f of editNewImgs) {
          form.append("images", f);
        }
      } else {
        const replacementFile = editFileRef.current?.files?.[0];
        if (replacementFile) {
          form.append("file", replacementFile);
        }
      }
      await apiForm(`/sources/${editing.id}/replace`, form);
      setEditing(null);
      load();
    } catch (err) {
      setEditErr(err instanceof ApiError ? err.message : "Không cập nhật được nguồn");
    } finally {
      setEditSaving(false);
    }
  }

  async function removeSource(s: SourceItem) {
    if (!confirm(`Xóa nguồn “${s.title}”? Nguồn sẽ không còn xuất hiện trong Tra cứu Rule.`)) return;
    await api(`/sources/${s.id}`, { method: "DELETE" });
    load();
  }

  const shown = items.filter((s) => !q.trim() || `${s.title} ${s.module || ""} ${s.kind_label}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Quản lý nguồn rule</h2>
          <div className="muted">
            Nạp, xem trước, sửa/thay thế và xóa Tài liệu BA, Figma (kèm nhiều hình ảnh) và Wiki theo từng Module.
          </div>
        </div>
        <div className="seg-tabs">
          <button className={`seg-tab${tab === "list" ? " active" : ""}`} onClick={() => setTab("list")}>
            Danh sách ({items.length})
          </button>
          <button className={`seg-tab${tab === "ba_doc" ? " active" : ""}`} onClick={() => setTab("ba_doc")}>
            + Tài liệu BA
          </button>
          <button className={`seg-tab${tab === "figma" ? " active" : ""}`} onClick={() => setTab("figma")}>
            + Figma
          </button>
          <button className={`seg-tab${tab === "code_wiki" ? " active" : ""}`} onClick={() => setTab("code_wiki")}>
            + Wiki rule
          </button>
        </div>
      </div>

      {tab === "ba_doc" && (
        <UploadForm
          kind="ba_doc"
          accept=".docx"
          title="Nạp Tài liệu BA (.docx)"
          hint="Chọn đúng Module từ danh sách. Ngày nạp được dùng tự động làm mốc phiên bản."
          modules={modules}
          onDone={() => { load(); setTab("list"); }}
        />
      )}

      {tab === "figma" && (
        <FigmaForm modules={modules} onDone={() => { load(); setTab("list"); }} />
      )}

      {tab === "code_wiki" && (
        <UploadForm
          kind="code_wiki"
          accept=".docx,.html,.htm,.md,.txt"
          title="Nạp Wiki rule trên code"
          hint="Chọn đúng Module và tải tệp HTML / Markdown / Word / TXT của trang wiki."
          modules={modules}
          onDone={() => { load(); setTab("list"); }}
        />
      )}

      {tab === "list" && (
        <div className="card">
          <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
            <input
              className="grow"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm tên nguồn rule, mã module..."
            />
            <select style={{ width: 190 }} value={filterMod} onChange={(e) => setFilterMod(e.target.value)}>
              <option value="">Tất cả Module</option>
              {modules.map((m) => (
                <option key={m.code} value={m.code}>
                  [{m.code}]{m.name && m.name !== m.code ? ` — ${m.name}` : ""}
                </option>
              ))}
            </select>
            <select style={{ width: 190 }} value={filterKind} onChange={(e) => setFilterKind(e.target.value)}>
              <option value="">Tất cả loại nguồn</option>
              <option value="ba_doc">Tài liệu BA</option>
              <option value="figma">Figma</option>
              <option value="code_wiki">Wiki rule trên code</option>
            </select>
          </div>

          <table>
            <thead>
              <tr>
                <th>Module</th>
                <th>Loại</th>
                <th>Tên nguồn rule</th>
                <th>Ngày thêm / cập nhật</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const modColor = s.module ? getModuleColor(s.module) : "";
                const latest = s.versions[0];
                const imgCount = s.meta?.images?.length || 0;
                return (
                  <tr key={s.id}>
                    <td>
                      {s.module ? (
                        <span
                          className="badge"
                          style={{ background: `${modColor}18`, color: modColor, borderColor: `${modColor}55`, fontWeight: 600 }}
                        >
                          {s.module}
                        </span>
                      ) : (
                        <span className="muted">Chưa gắn</span>
                      )}
                    </td>
                    <td><span className="badge">{s.kind_label}</span></td>
                    <td>
                      <strong>{s.title}</strong>
                      {imgCount > 0 && (
                        <span className="badge" style={{ marginLeft: 6, fontSize: 11 }}>
                          🖼 {imgCount} ảnh
                        </span>
                      )}
                      {s.url && (
                        <div className="muted" style={{ fontSize: 12, maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="badge date">{latest?.label || formatDateBadge(s.updated_at || s.created_at)}</span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <button className="sm primary" onClick={() => setViewing(s)}>Xem nguồn</button>
                        <button className="sm" onClick={() => openEdit(s)}>Sửa</button>
                        <button className="sm danger" onClick={() => void removeSource(s)}>Xóa</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>
                    Chưa có nguồn rule nào. Chọn tab <strong>+ Tài liệu BA</strong>, <strong>+ Figma</strong> hoặc <strong>+ Wiki rule</strong> để thêm mới.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Xem trước toàn bộ nội dung nguồn */}
      {viewing && (
        <SourceViewerModal
          sourceId={viewing.id}
          title={viewing.title}
          moduleCode={viewing.module}
          url={viewing.url}
          fileId={viewing.versions[0]?.file_id}
          onClose={() => setViewing(null)}
        />
      )}

      {/* Popup Sửa & Thay thế nội dung (đúng loại nguồn) */}
      {editing && (
        <div className="modal-backdrop" onClick={() => { if (!editSaving) setEditing(null); }} role="dialog" aria-modal="true" aria-label="Sửa nguồn rule">
          <div className="modal-box" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Sửa nguồn rule ({editing.kind_label})</strong>
              <button className="sm" onClick={() => setEditing(null)} disabled={editSaving}>✕</button>
            </div>
            <form className="modal-body" onSubmit={saveEdit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="grid-2">
                <ModuleSelect id="ed-m" value={editMod} onChange={setEditMod} modules={modules} required />
                <div>
                  <label htmlFor="ed-t">Tên nguồn *</label>
                  <input id="ed-t" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
                </div>
              </div>
              <div>
                <label htmlFor="ed-u">Link gốc (tùy chọn)</label>
                <input id="ed-u" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} placeholder="https://..." />
              </div>

              {/* Thay thế nội dung đúng loại nguồn */}
              {(editing.kind === "ba_doc" || editing.kind === "code_wiki") && (
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--panel-alt)", border: "1px solid var(--line)" }}>
                  <label htmlFor="ed-file" style={{ marginTop: 0 }}>
                    Thay thế bằng tệp mới ({editing.kind === "ba_doc" ? ".docx" : ".docx, .html, .md, .txt"}) — bỏ trống nếu chỉ sửa thông tin
                  </label>
                  <input
                    id="ed-file"
                    ref={editFileRef}
                    type="file"
                    accept={editing.kind === "ba_doc" ? ".docx" : ".docx,.html,.htm,.md,.txt"}
                  />
                </div>
              )}

              {editing.kind === "figma" && (
                <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--panel-alt)", border: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <label htmlFor="ed-pasted" style={{ marginTop: 0 }}>
                      Thay thế nội dung dán từ Figma (Copy as CSS / text) — bỏ trống nếu giữ nội dung cũ
                    </label>
                    <textarea
                      id="ed-pasted"
                      rows={4}
                      value={editPasted}
                      onChange={(e) => setEditPasted(e.target.value)}
                      placeholder="Dán nội dung/CSS mới từ Figma nếu muốn cập nhật..."
                    />
                  </div>

                  {editExistingImgs.length > 0 && (
                    <div>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Hình ảnh hiện có ({editExistingImgs.length}):</div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        {editExistingImgs.map((im) => (
                          <div
                            key={im.file_id}
                            style={{
                              position: "relative",
                              border: "1px solid var(--line)",
                              borderRadius: 8,
                              padding: 4,
                              background: "var(--panel)",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <img
                              src={`/api/v1/files/${im.file_id}/download?inline=1`}
                              alt={im.filename}
                              style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 4 }}
                            />
                            <span style={{ fontSize: 12, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {im.filename}
                            </span>
                            <button
                              type="button"
                              className="sm"
                              style={{ padding: "1px 6px", fontSize: 11 }}
                              title="Xóa ảnh này"
                              onClick={() => {
                                setEditExistingImgs((prev) => prev.filter((x) => x.file_id !== im.file_id));
                                setEditRemovedImgIds((prev) => [...prev, im.file_id]);
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label htmlFor="ed-imgs">Thêm hình ảnh Figma mới (chọn được nhiều hình)</label>
                    <input
                      id="ed-imgs"
                      ref={editImgRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          setEditNewImgs((prev) => [...prev, ...Array.from(e.target.files!)]);
                          e.target.value = "";
                        }
                      }}
                    />
                    {editNewImgs.length > 0 && (
                      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        {editNewImgs.map((f, idx) => (
                          <span key={`${f.name}-${idx}`} className="badge">
                            + 🖼 {f.name}{" "}
                            <button
                              type="button"
                              style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, fontWeight: 700 }}
                              onClick={() => setEditNewImgs((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {editErr && <div className="err">{editErr}</div>}
              <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setEditing(null)} disabled={editSaving}>Hủy</button>
                <button type="submit" className="primary" disabled={editSaving}>
                  {editSaving ? "Đang lưu…" : "Lưu thay đổi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
