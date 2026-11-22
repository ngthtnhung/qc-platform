"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Account, type AutoTask, type Environment, type Execution } from "@/lib/api";

const VSTATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Chờ QC duyệt", cls: "warn" }, APPROVED: { label: "Đã duyệt", cls: "ok" }, REJECTED: { label: "Từ chối", cls: "bad" }, RETIRED: { label: "Ngừng", cls: "" },
};
const ESTATUS: Record<string, string> = { QUEUED: "Đang chờ", CLAIMED: "Runner đã nhận", RUNNING: "Đang chạy", PASSED: "Đạt", FAILED: "Lỗi", CANCELLED: "Đã hủy" };

function TaskCard({ t, onChange, accounts }: { t: AutoTask; onChange: () => void; accounts: Account[] }) {
  const [accountId, setAccountId] = useState("");
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(t.params.map((p) => [p.key, p.value])));
  const [msg, setMsg] = useState("");

  async function run() {
    setMsg("");
    try {
      const r = await api<{ executions: unknown[] }>(`/automation/tasks/${t.id}/run`, { method: "POST", body: { count, params: values, ...(accountId ? { account_id: accountId } : {}) } });
      setMsg(`Đã xếp hàng ${r.executions.length} lần chạy.`);
      onChange();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Không xếp hàng được");
    }
  }
  async function saveParams() {
    setMsg("");
    try {
      await api(`/automation/tasks/${t.id}/params`, { method: "PUT", body: { values } });
      setMsg("Đã lưu tham số mặc định.");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Không lưu được");
    }
  }

  return (
    <article className="card">
      <div className="row">
        <strong className="grow">{t.name}</strong>
        <span className="badge">{t.module_code}</span>
        {t.writes && <span className="badge warn">Ghi dữ liệu</span>}
        <span className={`badge ${t.runnable ? "ok" : "warn"}`}>{t.runnable ? `Chạy được (v${t.approved_version})` : "Chưa có bản được duyệt"}</span>
        <button onClick={() => setOpen(!open)}>{open ? "Thu gọn" : "Chi tiết"}</button>
      </div>
      {open && (
        <>
          <div className="muted">{t.start_url}</div>
          <div className="muted">Vai trò tài khoản cần: {t.required_roles.length ? t.required_roles.join(", ") : "không yêu cầu"}</div>
          <ol>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <div className="row">
            {t.versions.map((v) => (
              <span key={v.id} className={`badge ${VSTATUS[v.status]?.cls}`} title={v.sha256}>v{v.version_no} · {VSTATUS[v.status]?.label} · {v.origin}</span>
            ))}
          </div>
          {t.versions.some((v) => v.status === "PENDING") && <div className="notice">Có phiên bản đang chờ QC duyệt trong mục “Duyệt”. Code chỉ chạy được sau khi được duyệt.</div>}
          {t.params.map((p) => (
            <div key={p.key}>
              <label htmlFor={`${t.id}-${p.key}`}>{p.label || p.key}</label>
              {p.type === "multiline" ? (
                <textarea id={`${t.id}-${p.key}`} rows={3} value={values[p.key] ?? ""} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
              ) : (
                <input id={`${t.id}-${p.key}`} value={values[p.key] ?? ""} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="row" style={{ marginTop: 10 }}>
            <button onClick={() => void saveParams()}>Lưu tham số</button>
            <label htmlFor={`${t.id}-n`} style={{ margin: 0 }}>Số lần</label>
            <input id={`${t.id}-n`} type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 80 }} />
            <label htmlFor={`${t.id}-acc`} style={{ margin: 0 }}>Tài khoản</label>
            <select id={`${t.id}-acc`} value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ width: "auto" }}>
              <option value="">Tự chọn theo vai trò</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role_label || "chưa đặt vai trò"})</option>)}
            </select>
            <button className="primary" disabled={!t.runnable} onClick={() => void run()}>Xếp hàng chạy</button>
          </div>
          {msg && <div role="status" className="muted">{msg}</div>}
        </>
      )}
    </article>
  );
}

export default function AutomationPage() {
  const [tasks, setTasks] = useState<AutoTask[]>([]);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [stagingAccounts, setStagingAccounts] = useState<Account[]>([]);
  const [module, setModule] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, e, envs, accs] = await Promise.all([api<AutoTask[]>(`/automation/tasks${module ? `?module=${module}` : ""}`), api<Execution[]>("/automation/executions?limit=30"), api<Environment[]>("/environments"), api<Account[]>("/accounts")]);
      setTasks(t);
      setExecs(e);
      const staging = new Set(envs.filter((x) => x.type === "STAGING" && x.is_active).map((x) => x.id));
      setStagingAccounts(accs.filter((a) => staging.has(a.environment_id)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được");
    }
  }, [module]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const modules = [...new Set(tasks.map((t) => t.module_code))].sort();
  const names = Object.fromEntries(tasks.map((t) => [t.id, t.name]));
  return (
    <>
      <h2>Tác vụ tự động</h2>
      <p className="muted">Chỉ phiên bản code đã được QC duyệt mới chạy được; chạy trên Staging qua Runner. Code do AI viết hoặc sửa luôn phải qua duyệt.</p>
      {error && <div className="err" role="alert">{error}</div>}
      {stagingAccounts.length === 0 && <div className="notice">Chưa có tài khoản nào trong môi trường loại STAGING. Vào \"Môi trường & tài khoản\" để thêm môi trường (loại STAGING) và tài khoản test trước khi chạy.</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi module</option>
          {modules.map((m) => <option key={m}>{m}</option>)}
        </select>
        <span className="muted">{tasks.length} tác vụ</span>
      </div>
      {tasks.map((t) => <TaskCard key={t.id} t={t} accounts={stagingAccounts} onChange={() => void load()} />)}
      <h3>Lần chạy gần đây</h3>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>Tác vụ</th><th>Trạng thái</th><th>Lần thử</th><th>Thời gian</th><th>Lỗi</th><th /></tr></thead>
          <tbody>
            {execs.map((e) => (
              <tr key={e.id}>
                <td>{names[e.task_id] ?? e.task_id.slice(0, 8)}</td>
                <td><span className={`badge ${e.status === "PASSED" ? "ok" : e.status === "FAILED" ? "bad" : "warn"}`}>{ESTATUS[e.status]}</span></td>
                <td>{e.attempt}</td>
                <td className="muted">{e.duration_ms != null ? `${(e.duration_ms / 1000).toFixed(1)} s` : "—"}</td>
                <td className="muted">{e.error}</td>
                <td>{["QUEUED", "CLAIMED", "RUNNING"].includes(e.status) && <button onClick={() => void api(`/automation/executions/${e.id}/cancel`, { method: "POST" }).then(load)}>Hủy</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
