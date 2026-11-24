"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type Account, type Environment } from "@/lib/api";

const TYPES = ["STAGING", "PRODUCTION_TEST", "PRODUCTION", "TASK_SYSTEM"] as const;

function SecretForm({ account, onSaved }: { account: Account; onSaved: () => void }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    try {
      await api(`/accounts/${account.id}/secret`, { method: "PUT", body: { password: pw } });
      setPw("");
      setMsg("Đã lưu (chỉ ghi, không hiển thị lại).");
      onSaved();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Không lưu được");
    }
  }
  return (
    <form className="row" onSubmit={save} style={{ gap: 6 }}>
      <input
        aria-label={`Mật khẩu ${account.name}`}
        type="password"
        autoComplete="new-password"
        placeholder="Mật khẩu mới"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        required
        style={{ maxWidth: 180 }}
      />
      <button type="submit">Lưu</button>
      {msg && <span className="muted" role="status">{msg}</span>}
    </form>
  );
}

type EnvFormState = { name: string; type: string; base_url: string; org_identifier: string };
type RouteRow = { label: string; url: string };
type AccFormState = { environment_id: string; name: string; username_ref: string; role_label: string; routes: RouteRow[] };

const EMPTY_ENV: EnvFormState = { name: "", type: "STAGING", base_url: "", org_identifier: "" };
const EMPTY_ACC: AccFormState = { environment_id: "", name: "", username_ref: "", role_label: "", routes: [] };

export default function EnvironmentsPage() {
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");

  // Modal Môi trường (Thêm / Sửa)
  const [envModalOpen, setEnvModalOpen] = useState(false);
  const [editingEnvId, setEditingEnvId] = useState<string | null>(null);
  const [envForm, setEnvForm] = useState<EnvFormState>(EMPTY_ENV);
  const [envError, setEnvError] = useState("");
  const [envSaving, setEnvSaving] = useState(false);

  // Modal Tài khoản (Thêm / Sửa)
  const [accModalOpen, setAccModalOpen] = useState(false);
  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [accForm, setAccForm] = useState<AccFormState>(EMPTY_ACC);
  const [accError, setAccError] = useState("");
  const [accSaving, setAccSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, a] = await Promise.all([api<Environment[]>("/environments"), api<Account[]>("/accounts")]);
      setEnvs(e);
      setAccounts(a);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openAddEnv() {
    setEditingEnvId(null);
    setEnvForm(EMPTY_ENV);
    setEnvError("");
    setEnvModalOpen(true);
  }

  function openEditEnv(e: Environment) {
    setEditingEnvId(e.id);
    setEnvForm({
      name: e.name,
      type: e.type,
      base_url: e.base_url,
      org_identifier: e.org_identifier || "",
    });
    setEnvError("");
    setEnvModalOpen(true);
  }

  async function submitEnv(ev: FormEvent) {
    ev.preventDefault();
    setEnvError("");
    setEnvSaving(true);
    try {
      if (editingEnvId) {
        await api(`/environments/${editingEnvId}`, { method: "PATCH", body: envForm });
      } else {
        await api("/environments", {
          method: "POST",
          body: { ...envForm, allowed_actions: ["READ", "REPRODUCE", "AUTOMATE"] },
        });
      }
      setEnvModalOpen(false);
      await load();
    } catch (err) {
      setEnvError(err instanceof ApiError ? err.message : "Không lưu được môi trường");
    } finally {
      setEnvSaving(false);
    }
  }

  async function deleteEnv(e: Environment) {
    if (!window.confirm(`Xóa môi trường "${e.name}"? Các tài khoản thuộc môi trường này cũng sẽ bị xóa.`)) return;
    setError("");
    try {
      await api(`/environments/${e.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xóa được môi trường");
    }
  }

  function openAddAcc(envId: string) {
    setEditingAccId(null);
    setAccForm({ environment_id: envId, name: "", username_ref: "", role_label: "", routes: [{ label: "", url: "" }] });
    setAccError("");
    setAccModalOpen(true);
  }

  function openEditAcc(a: Account) {
    setEditingAccId(a.id);
    const existingRoutes: RouteRow[] = (a.routes || [])
      .filter((r) => r && r.url)
      .map((r) => ({ label: r.label || "", url: r.url }));
    if (existingRoutes.length === 0 && a.default_route) {
      existingRoutes.push({ label: "", url: a.default_route });
    }
    setAccForm({
      environment_id: a.environment_id,
      name: a.name,
      username_ref: a.username_ref,
      role_label: a.role_label || "",
      routes: existingRoutes.length ? existingRoutes : [{ label: "", url: "" }],
    });
    setAccError("");
    setAccModalOpen(true);
  }

  function updateRoute(idx: number, field: "label" | "url", val: string) {
    setAccForm((prev) => ({
      ...prev,
      routes: prev.routes.map((r, i) => (i === idx ? { ...r, [field]: val } : r)),
    }));
  }

  function addRouteRow() {
    setAccForm((prev) => ({ ...prev, routes: [...prev.routes, { label: "", url: "" }] }));
  }

  function removeRouteRow(idx: number) {
    setAccForm((prev) => ({ ...prev, routes: prev.routes.filter((_, i) => i !== idx) }));
  }

  async function submitAcc(ev: FormEvent) {
    ev.preventDefault();
    setAccError("");
    setAccSaving(true);
    const cleanedRoutes = accForm.routes
      .map((r) => ({ label: r.label.trim(), url: r.url.trim() }))
      .filter((r) => r.url);
    try {
      if (editingAccId) {
        await api(`/accounts/${editingAccId}`, {
          method: "PATCH",
          body: {
            name: accForm.name,
            username_ref: accForm.username_ref,
            role_label: accForm.role_label,
            routes: cleanedRoutes,
          },
        });
      } else {
        await api("/accounts", {
          method: "POST",
          body: {
            environment_id: accForm.environment_id,
            name: accForm.name,
            username_ref: accForm.username_ref,
            role_label: accForm.role_label,
            routes: cleanedRoutes,
          },
        });
      }
      setAccModalOpen(false);
      await load();
    } catch (err) {
      setAccError(err instanceof ApiError ? err.message : "Không lưu được tài khoản");
    } finally {
      setAccSaving(false);
    }
  }

  async function deleteAcc(a: Account) {
    if (!window.confirm(`Xóa tài khoản "${a.name}" (${a.username_ref})?`)) return;
    setError("");
    try {
      await api(`/accounts/${a.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không xóa được tài khoản");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Môi trường &amp; tài khoản test</h2>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Mật khẩu chỉ ghi, không bao giờ hiển thị lại; chỉ Staging và Production OrgID DEMO được lưu mật khẩu. Production không cho phép ghi tự động.
          </p>
        </div>
        <button type="button" className="primary" onClick={openAddEnv}>
          + Thêm môi trường
        </button>
      </div>

      {error && <div className="err" role="alert">{error}</div>}

      {envs.length === 0 && (
        <div className="card muted" style={{ textAlign: "center", padding: 28 }}>
          Chưa có môi trường nào. Bấm <strong>+ Thêm môi trường</strong> để tạo mới.
        </div>
      )}

      {envs.map((e) => {
        const envAccounts = accounts.filter((a) => a.environment_id === e.id);
        return (
          <section className="card" key={e.id}>
            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong className="grow" style={{ fontSize: 15 }}>{e.name}</strong>
              <span className="badge">{e.type}</span>
              {e.org_identifier && <span className="badge">Org: {e.org_identifier}</span>}
              {e.requires_org_confirmation && <span className="badge warn">Phải xác nhận Org</span>}
              <button type="button" onClick={() => openAddAcc(e.id)}>+ Thêm tài khoản</button>
              <button type="button" onClick={() => openEditEnv(e)}>Sửa</button>
              <button type="button" className="danger" onClick={() => void deleteEnv(e)}>Xóa</button>
            </div>
            <div className="muted" style={{ marginTop: 4, marginBottom: envAccounts.length ? 10 : 0 }}>
              {e.base_url}
            </div>
            {envAccounts.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Tài khoản</th>
                    <th>Mật khẩu</th>
                    <th>Cập nhật mật khẩu</th>
                    <th style={{ width: 130, textAlign: "right" }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {envAccounts.map((a) => {
                    const urls = (a.routes || []).filter((r) => r && r.url);
                    return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                        <div className="muted">
                          {a.username_ref}
                          {a.role_label ? ` · Ghi chú: ${a.role_label}` : ""}
                        </div>
                        {urls.length > 0 && (
                          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                            {urls.map((r, idx) => (
                              <a
                                key={`${r.url}-${idx}`}
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="badge"
                                style={{ textDecoration: "none", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                title={r.url}
                              >
                                {r.label || r.url} ↗
                              </a>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${a.has_secret ? "ok" : "warn"}`}>
                          {a.has_secret ? "Đã có mật khẩu" : "Chưa có mật khẩu"}
                        </span>
                      </td>
                      <td>
                        {(e.type === "STAGING" || e.type === "PRODUCTION_TEST") ? (
                          <SecretForm account={a} onSaved={() => void load()} />
                        ) : (
                          <span className="muted">Không lưu mật khẩu</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <button type="button" onClick={() => openEditAcc(a)}>Sửa</button>
                          <button type="button" className="danger" onClick={() => void deleteAcc(a)}>Xóa</button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                Chưa có tài khoản test nào trong môi trường này.
              </div>
            )}
          </section>
        );
      })}

      {/* Popup Thêm / Sửa Môi trường */}
      {envModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => { if (!envSaving) setEnvModalOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label={editingEnvId ? "Sửa môi trường" : "Thêm môi trường"}
        >
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{editingEnvId ? "Sửa môi trường" : "Thêm môi trường"}</strong>
              <button type="button" onClick={() => setEnvModalOpen(false)} disabled={envSaving} aria-label="Đóng">
                ✕
              </button>
            </div>
            <form onSubmit={submitEnv} className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {envError && <div className="err" role="alert">{envError}</div>}
              <div>
                <label htmlFor="en">Tên</label>
                <input
                  id="en"
                  value={envForm.name}
                  onChange={(e) => setEnvForm({ ...envForm, name: e.target.value })}
                  placeholder="VD: Staging HRWs"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="et">Loại</label>
                <select id="et" value={envForm.type} onChange={(e) => setEnvForm({ ...envForm, type: e.target.value })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="eu">URL</label>
                <input
                  id="eu"
                  type="url"
                  value={envForm.base_url}
                  onChange={(e) => setEnvForm({ ...envForm, base_url: e.target.value })}
                  placeholder="https://..."
                  required
                />
              </div>
              <div>
                <label htmlFor="eo">Org</label>
                <input
                  id="eo"
                  value={envForm.org_identifier}
                  onChange={(e) => setEnvForm({ ...envForm, org_identifier: e.target.value })}
                  placeholder="VD: DEMO (tùy chọn)"
                />
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setEnvModalOpen(false)} disabled={envSaving}>Hủy</button>
                <button className="primary" type="submit" disabled={envSaving}>
                  {envSaving ? "Đang lưu..." : editingEnvId ? "Lưu thay đổi" : "Thêm môi trường"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Popup Thêm / Sửa Tài khoản */}
      {accModalOpen && (
        <div
          className="modal-backdrop"
          onClick={() => { if (!accSaving) setAccModalOpen(false); }}
          role="dialog"
          aria-modal="true"
          aria-label={editingAccId ? "Sửa tài khoản test" : "Thêm tài khoản test"}
        >
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{editingAccId ? "Sửa tài khoản test" : "Thêm tài khoản test"}</strong>
              <button type="button" onClick={() => setAccModalOpen(false)} disabled={accSaving} aria-label="Đóng">
                ✕
              </button>
            </div>
            <form onSubmit={submitAcc} className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {accError && <div className="err" role="alert">{accError}</div>}
              {!editingAccId && (
                <div>
                  <label htmlFor="ae">Môi trường</label>
                  <select
                    id="ae"
                    value={accForm.environment_id}
                    onChange={(e) => setAccForm({ ...accForm, environment_id: e.target.value })}
                    required
                  >
                    <option value="">Chọn môi trường…</option>
                    {envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="an">Tên</label>
                <input
                  id="an"
                  value={accForm.name}
                  onChange={(e) => setAccForm({ ...accForm, name: e.target.value })}
                  placeholder="VD: Tài khoản QC 1"
                  required
                  autoFocus
                />
              </div>
              <div>
                <label htmlFor="au">Tên đăng nhập</label>
                <input
                  id="au"
                  value={accForm.username_ref}
                  onChange={(e) => setAccForm({ ...accForm, username_ref: e.target.value })}
                  placeholder="VD: qc01@company.vn"
                  required
                />
              </div>
              <div>
                <label htmlFor="ar">Vai trò (ghi chú)</label>
                <input
                  id="ar"
                  value={accForm.role_label}
                  onChange={(e) => setAccForm({ ...accForm, role_label: e.target.value })}
                  placeholder="Chỉ để ghi chú phân biệt, không ảnh hưởng chạy automation"
                />
              </div>
              <div>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>URL mở tài khoản (có thể thêm nhiều)</label>
                  <button type="button" onClick={addRouteRow} style={{ padding: "3px 8px", fontSize: 12 }}>
                    + Thêm URL
                  </button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {accForm.routes.map((r, idx) => (
                    <div className="row" key={idx} style={{ gap: 6 }}>
                      <input
                        value={r.label}
                        onChange={(e) => updateRoute(idx, "label", e.target.value)}
                        placeholder="Nhãn (VD: Task, Admin...)"
                        style={{ width: 150, flexShrink: 0 }}
                      />
                      <input
                        type="url"
                        className="grow"
                        value={r.url}
                        onChange={(e) => updateRoute(idx, "url", e.target.value)}
                        placeholder="https://..."
                      />
                      <button
                        type="button"
                        onClick={() => removeRouteRow(idx)}
                        aria-label="Xóa URL"
                        title="Xóa URL"
                        style={{ padding: "4px 8px" }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {accForm.routes.length === 0 && (
                    <div className="muted" style={{ fontSize: 12 }}>
                      Chưa có URL nào. Bấm <strong>+ Thêm URL</strong> để thêm link mở tài khoản này.
                    </div>
                  )}
                </div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                <button type="button" onClick={() => setAccModalOpen(false)} disabled={accSaving}>Hủy</button>
                <button className="primary" type="submit" disabled={accSaving}>
                  {accSaving ? "Đang lưu..." : editingAccId ? "Lưu thay đổi" : "Thêm tài khoản"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
