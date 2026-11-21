"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type RunnerRow } from "@/lib/api";

export default function RunnersPage() {
  const [runners, setRunners] = useState<RunnerRow[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<"host" | "docker">("host");
  const [created, setCreated] = useState<RunnerRow | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRunners(await api<RunnerRow[]>("/runners"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được");
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      setCreated(await api<RunnerRow>("/runners", { method: "POST", body: { name, type, capabilities: ["web"] } }));
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tạo được");
    }
  }

  const online = (r: RunnerRow) => r.last_heartbeat_at && Date.now() - new Date(r.last_heartbeat_at).getTime() < 90_000;
  return (
    <>
      <h2>Runner</h2>
      <p className="muted">Runner chạy trên máy từng người (Host) hoặc trong container (Docker), tự đăng ký bằng token riêng và chỉ nhận code đã được QC duyệt.</p>
      {error && <div className="err" role="alert">{error}</div>}
      {created?.token && (
        <div className="notice" role="status">
          Token của <strong>{created.name}</strong> (chỉ hiện một lần; hãy cấu hình vào Runner ngay):
          <pre>{created.token}</pre>
          <button onClick={() => setCreated(null)}>Đã lưu token</button>
        </div>
      )}
      <form className="card" onSubmit={create}>
        <div className="row">
          <div className="grow"><label htmlFor="rn">Tên runner</label><input id="rn" value={name} onChange={(e) => setName(e.target.value)} pattern="[A-Za-z0-9._-]+" required /></div>
          <div><label htmlFor="rt">Loại</label><select id="rt" value={type} onChange={(e) => setType(e.target.value as "host" | "docker")}><option value="host">Host (máy cá nhân)</option><option value="docker">Docker</option></select></div>
          <button className="primary" type="submit" style={{ alignSelf: "end" }}>Tạo runner</button>
        </div>
      </form>
      <div className="card">
        <table>
          <thead><tr><th>Tên</th><th>Loại</th><th>Trạng thái</th><th>Heartbeat gần nhất</th><th /></tr></thead>
          <tbody>
            {runners.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.type}</td>
                <td><span className={`badge ${r.revoked ? "bad" : online(r) ? "ok" : "warn"}`}>{r.revoked ? "Đã thu hồi" : online(r) ? "Trực tuyến" : "Ngoại tuyến"}</span></td>
                <td className="muted">{r.last_heartbeat_at ? new Date(r.last_heartbeat_at).toLocaleString("vi-VN") : "—"}</td>
                <td>{!r.revoked && <button className="danger" onClick={() => void api(`/runners/${r.id}/revoke`, { method: "POST" }).then(load)}>Thu hồi</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
