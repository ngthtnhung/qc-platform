"use client";

import { useCallback, useEffect, useState } from "react";
import { api, apiForm, ApiError, type Account, type AutoTask, type Environment, type Execution } from "@/lib/api";

const VSTATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Chờ QC duyệt", cls: "warn" }, APPROVED: { label: "Đã duyệt", cls: "ok" }, REJECTED: { label: "Từ chối", cls: "bad" }, RETIRED: { label: "Ngừng", cls: "" },
};
const ESTATUS: Record<string, string> = { QUEUED: "Đang chờ", CLAIMED: "Runner đã nhận", RUNNING: "Đang chạy", PASSED: "Đạt", FAILED: "Lỗi", CANCELLED: "Đã hủy" };

function AiCode({ t, onDone }: { t: AutoTask; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [fails, setFails] = useState<Execution[]>([]);
  const [execId, setExecId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function openPanel() {
    setFails(await api<Execution[]>(`/automation/executions?task_id=${t.id}&status=FAILED&limit=10`).catch(() => []));
    setOpen(true);
  }
  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ version_no: number }>(`/automation/tasks/${t.id}/suggest-code`, { method: "POST", body: { instruction, execution_id: execId || null } });
      setMsg({ ok: true, text: `AI đã tạo phiên bản v${r.version_no} chờ QC duyệt (mục Duyệt). Chưa chạy được cho tới khi được duyệt.` });
      setOpen(false);
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không gọi được AI" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      {!open && <button onClick={() => void openPanel()}>AI đề xuất sửa/viết code</button>}
      {open && (
        <div className="card">
          <label htmlFor={`${t.id}-ai`}>Chỉ dẫn cho AI (để trống = sửa lỗi của lần chạy đã chọn)</label>
          <textarea id={`${t.id}-ai`} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <label htmlFor={`${t.id}-ex`}>Lần chạy lỗi làm bằng chứng (log, lỗi, DOM lúc lỗi)</label>
          <select id={`${t.id}-ex`} value={execId} onChange={(e) => setExecId(e.target.value)}>
            <option value="">Không chọn</option>
            {fails.map((f) => <option key={f.id} value={f.id}>{new Date(f.queued_at).toLocaleString("vi-VN")} — {f.error.slice(0, 70)}</option>)}
          </select>
          <div className="muted">AI chỉ nhận mô tả, code hiện tại, lỗi/log/DOM. Mật khẩu không bao giờ được gửi. Kết quả là phiên bản mới chờ QC duyệt.</div>
          <div className="row" style={{ marginTop: 6 }}><button className="primary" disabled={busy} onClick={() => void run()}>{busy ? "Đang gọi AI…" : "Gửi AI"}</button><button onClick={() => setOpen(false)}>Hủy</button></div>
        </div>
      )}
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "err"}>{msg.text}</div>}
    </div>
  );
}

type Schedule = { id: string; task_id: string; interval_minutes: number; run_count: number; enabled: boolean; next_run_at: string; last_run_at: string | null; last_status: string };

function Schedules({ t, schedules, onChange }: { t: AutoTask; schedules: Schedule[]; onChange: () => void }) {
  const [every, setEvery] = useState(60);
  const [msg, setMsg] = useState("");
  const mine = schedules.filter((s) => s.task_id === t.id);
  async function create() {
    setMsg("");
    try {
      await api("/automation/schedules", { method: "POST", body: { task_id: t.id, interval_minutes: every } });
      onChange();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Không đặt được lịch");
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <strong>Lịch chạy định kỳ</strong>
      {mine.map((s) => (
        <div className="row" key={s.id}>
          <span className="grow">mỗi {s.interval_minutes} phút · lần tới {new Date(s.next_run_at).toLocaleString("vi-VN")}{s.last_status ? ` · ${s.last_status}` : ""}</span>
          <span className={`badge ${s.enabled ? "ok" : "warn"}`}>{s.enabled ? "Đang bật" : "Đã tắt"}</span>
          <button onClick={() => void api(`/automation/schedules/${s.id}`, { method: "PUT", body: { enabled: !s.enabled } }).then(onChange)}>{s.enabled ? "Tắt" : "Bật"}</button>
          <button className="danger" onClick={() => void api(`/automation/schedules/${s.id}`, { method: "DELETE" }).then(onChange)}>Xóa</button>
        </div>
      ))}
      <div className="row">
        <label htmlFor={`${t.id}-iv`} style={{ margin: 0 }}>Chạy mỗi (phút, ≥ 5)</label>
        <input id={`${t.id}-iv`} type="number" min={5} value={every} onChange={(e) => setEvery(Number(e.target.value))} style={{ width: 100 }} />
        <button disabled={!t.runnable} onClick={() => void create()}>Đặt lịch</button>
        <span className="muted">Chạy bằng quyền của bạn, qua đúng kiểm tra như khi bạn bấm chạy.</span>
      </div>
      {msg && <div className="err" role="alert">{msg}</div>}
    </div>
  );
}

function FileParam({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const [err, setErr] = useState("");
  const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
  async function upload(f: File) {
    setErr("");
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await apiForm<{ id: string }>("/files", form);
      onChange([...ids, r.id].join(","));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Không tải lên được");
    }
  }
  return (
    <div>
      <div className="row">
        <input type="file" aria-label={`Tải file cho ${label}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} style={{ maxWidth: 320 }} />
        {ids.map((id) => <span key={id} className="badge">{id.slice(0, 8)}… <button style={{ padding: "0 6px" }} onClick={() => onChange(ids.filter((x) => x !== id).join(","))} aria-label="Gỡ file">×</button></span>)}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

function NewVersion({ t, onDone }: { t: AutoTask; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [script, setScript] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  async function load() {
    const d = await api<{ script_by_version: Record<string, string>; versions: { version_no: number; status: string }[] }>(`/automation/tasks/${t.id}`);
    const approved = d.versions.find((v) => v.status === "APPROVED") ?? d.versions[0];
    setScript(d.script_by_version[String(approved.version_no)] ?? "");
    setOpen(true);
  }
  async function submit() {
    setMsg("");
    try {
      await api(`/automation/tasks/${t.id}/versions`, { method: "POST", body: { script, note, origin: "human" } });
      setMsg("Đã gửi phiên bản mới, chờ QC duyệt ở mục Duyệt.");
      setOpen(false);
      onDone();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Không gửi được");
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      {!open && <button onClick={() => void load()}>Sửa code (tạo phiên bản mới)</button>}
      {open && (
        <>
          <label htmlFor={`${t.id}-s`}>Code Playwright (bắt đầu từ bản đã duyệt gần nhất; sửa sẽ tạo phiên bản MỚI chờ duyệt)</label>
          <textarea id={`${t.id}-s`} rows={14} value={script} onChange={(e) => setScript(e.target.value)} style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13 }} spellCheck={false} />
          <label htmlFor={`${t.id}-n`}>Ghi chú cho người duyệt (vì sao đổi)</label>
          <input id={`${t.id}-n`} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}><button className="primary" onClick={() => void submit()}>Gửi duyệt</button><button onClick={() => setOpen(false)}>Hủy</button></div>
        </>
      )}
      {msg && <div role="status" className="muted">{msg}</div>}
    </div>
  );
}

function NewTask({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", module_code: "", start_url: "", steps: "", script: "", required_roles: "", writes: false, params: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit() {
    setMsg(null);
    try {
      const params = f.params.trim() ? (JSON.parse(f.params) as unknown) : [];
      const steps = f.steps.split("\n").map((s) => s.trim()).filter(Boolean);
      const roles = f.required_roles.split(",").map((s) => s.trim()).filter(Boolean);
      await api("/automation/tasks", { method: "POST", body: { name: f.name, module_code: f.module_code, start_url: f.start_url, steps, script: f.script, required_roles: roles, writes: f.writes, params } });
      setMsg({ ok: true, text: "Đã tạo tác vụ; code đang chờ QC duyệt ở mục Duyệt." });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : e instanceof SyntaxError ? "Tham số không phải JSON hợp lệ" : "Không tạo được" });
    }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <details className="card">
      <summary><strong>Tạo tác vụ mới</strong></summary>
      <div className="row">
        <div className="grow"><label htmlFor="nt-n">Tên</label><input id="nt-n" value={f.name} onChange={set("name")} /></div>
        <div><label htmlFor="nt-m">Module</label><input id="nt-m" value={f.module_code} onChange={set("module_code")} placeholder="MAINT" /></div>
      </div>
      <label htmlFor="nt-u">URL bắt đầu (https, cùng miền Staging)</label><input id="nt-u" value={f.start_url} onChange={set("start_url")} />
      <label htmlFor="nt-s">Các bước bằng lời (mỗi dòng một bước, để người duyệt đọc)</label><textarea id="nt-s" rows={3} value={f.steps} onChange={set("steps")} />
      <label htmlFor="nt-c">Code Playwright (dùng page, ctx, step, assert, pickOption, attachFiles)</label>
      <textarea id="nt-c" rows={10} value={f.script} onChange={set("script")} style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 13 }} spellCheck={false} />
      <div className="row">
        <div className="grow"><label htmlFor="nt-r">Vai trò tài khoản cần (cách nhau dấu phẩy)</label><input id="nt-r" value={f.required_roles} onChange={set("required_roles")} /></div>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={f.writes} onChange={(e) => setF({ ...f, writes: e.target.checked })} style={{ width: "auto" }} /> Ghi dữ liệu (tiền tố [AI TEST])</label>
      </div>
      <label htmlFor="nt-p">Tham số (JSON, tùy chọn)</label>
      <textarea id="nt-p" rows={2} value={f.params} onChange={set("params")} placeholder='[{"key":"loai","label":"Loại","value":"Bảo trì","type":"text"}]' />
      <p><button className="primary" onClick={() => void submit()}>Tạo và gửi duyệt</button></p>
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "err"}>{msg.text}</div>}
    </details>
  );
}

function TaskCard({ t, onChange, accounts, schedules }: { t: AutoTask; onChange: () => void; accounts: Account[]; schedules: Schedule[] }) {
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
              {p.type === "file" ? (
                <FileParam label={p.label || p.key} value={values[p.key] ?? ""} onChange={(v) => setValues({ ...values, [p.key]: v })} />
              ) : p.type === "multiline" ? (
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
          <Schedules t={t} schedules={schedules} onChange={onChange} />
          <NewVersion t={t} onDone={onChange} />
          <AiCode t={t} onDone={onChange} />
        </>
      )}
    </article>
  );
}

export default function AutomationPage() {
  const [tasks, setTasks] = useState<AutoTask[]>([]);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [stagingAccounts, setStagingAccounts] = useState<Account[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [module, setModule] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [t, e, envs, accs, sch] = await Promise.all([api<AutoTask[]>(`/automation/tasks${module ? `?module=${module}` : ""}`), api<Execution[]>("/automation/executions?limit=30"), api<Environment[]>("/environments"), api<Account[]>("/accounts"), api<Schedule[]>("/automation/schedules")]);
      setTasks(t);
      setExecs(e);
      setSchedules(sch);
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
      <NewTask onDone={() => void load()} />
      {tasks.map((t) => <TaskCard key={t.id} t={t} schedules={schedules} accounts={stagingAccounts} onChange={() => void load()} />)}
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
