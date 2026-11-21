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
    <form className="row" onSubmit={save}>
      <input aria-label={`Mật khẩu ${account.name}`} type="password" autoComplete="new-password" placeholder="Mật khẩu mới" value={pw} onChange={(e) => setPw(e.target.value)} required style={{ maxWidth: 200 }} />
      <button type="submit">Lưu</button>
      {msg && <span className="muted" role="status">{msg}</span>}
    </form>
  );
}

export default function EnvironmentsPage() {
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [env, setEnv] = useState({ code: "", name: "", type: "STAGING", base_url: "", org_identifier: "" });
  const [acc, setAcc] = useState({ environment_id: "", name: "", role_label: "", username_ref: "" });

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

  async function run(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Thao tác thất bại");
    }
  }

  return (
    <>
      <h2>Môi trường & tài khoản test</h2>
      <p className="muted">Mật khẩu chỉ ghi, không bao giờ hiển thị lại; chỉ Staging và Production OrgID DEMO được lưu mật khẩu. Production không cho phép ghi tự động.</p>
      {error && <div className="err" role="alert">{error}</div>}
      <form className="card" onSubmit={(e) => { e.preventDefault(); void run(() => api("/environments", { method: "POST", body: { ...env, allowed_actions: ["READ", "REPRODUCE", "AUTOMATE"] } })); }}>
        <strong>Thêm môi trường</strong>
        <div className="row">
          <div className="grow"><label htmlFor="ec">Mã (chữ thường)</label><input id="ec" value={env.code} onChange={(e) => setEnv({ ...env, code: e.target.value })} pattern="[a-z0-9_-]+" required /></div>
          <div className="grow"><label htmlFor="en">Tên</label><input id="en" value={env.name} onChange={(e) => setEnv({ ...env, name: e.target.value })} required /></div>
          <div><label htmlFor="et">Loại</label><select id="et" value={env.type} onChange={(e) => setEnv({ ...env, type: e.target.value })}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        </div>
        <div className="row">
          <div className="grow"><label htmlFor="eu">URL</label><input id="eu" type="url" value={env.base_url} onChange={(e) => setEnv({ ...env, base_url: e.target.value })} required /></div>
          <div className="grow"><label htmlFor="eo">Org</label><input id="eo" value={env.org_identifier} onChange={(e) => setEnv({ ...env, org_identifier: e.target.value })} /></div>
          <button className="primary" type="submit" style={{ alignSelf: "end" }}>Thêm</button>
        </div>
      </form>
      {envs.map((e) => (
        <section className="card" key={e.id}>
          <div className="row">
            <strong className="grow">{e.name} <span className="muted">({e.code})</span></strong>
            <span className="badge">{e.type}</span>
            {e.requires_org_confirmation && <span className="badge warn">Phải xác nhận Org</span>}
          </div>
          <div className="muted">{e.base_url}</div>
          <table>
            <tbody>
              {accounts.filter((a) => a.environment_id === e.id).map((a) => (
                <tr key={a.id}>
                  <td>{a.name}<div className="muted">{a.username_ref} · {a.role_label}</div></td>
                  <td><span className={`badge ${a.has_secret ? "ok" : "warn"}`}>{a.has_secret ? "Đã có mật khẩu" : "Chưa có mật khẩu"}</span></td>
                  <td>{(e.type === "STAGING" || e.type === "PRODUCTION_TEST") && <SecretForm account={a} onSaved={() => void load()} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {envs.length > 0 && (
        <form className="card" onSubmit={(ev) => { ev.preventDefault(); void run(async () => { await api("/accounts", { method: "POST", body: acc }); setAcc({ ...acc, name: "", username_ref: "" }); }); }}>
          <strong>Thêm tài khoản test</strong>
          <div className="row">
            <div><label htmlFor="ae">Môi trường</label>
              <select id="ae" value={acc.environment_id} onChange={(e) => setAcc({ ...acc, environment_id: e.target.value })} required>
                <option value="">Chọn…</option>{envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select></div>
            <div className="grow"><label htmlFor="an">Tên</label><input id="an" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} required /></div>
            <div className="grow"><label htmlFor="au">Tên đăng nhập</label><input id="au" value={acc.username_ref} onChange={(e) => setAcc({ ...acc, username_ref: e.target.value })} required /></div>
            <div className="grow"><label htmlFor="ar">Vai trò</label><input id="ar" value={acc.role_label} onChange={(e) => setAcc({ ...acc, role_label: e.target.value })} /></div>
            <button className="primary" type="submit" style={{ alignSelf: "end" }}>Thêm</button>
          </div>
        </form>
      )}
    </>
  );
}
