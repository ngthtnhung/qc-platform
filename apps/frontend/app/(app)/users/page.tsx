"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type User } from "@/lib/api";

type Created = { user: User; temporary_password: string };

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");

  const load = useCallback(async () => {
    try {
      setUsers(await api<User[]>("/users"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được danh sách");
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
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Thao tác thất bại");
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      setCreated(await api<Created>("/users", { method: "POST", body: { username, display_name: displayName } }));
      setUsername("");
      setDisplayName("");
    });
  }

  return (
    <>
      <h2>Người dùng QC</h2>
      <p className="muted">Chỉ có một vai trò là QC; mọi QC đều có quyền ngang nhau, kể cả thêm hoặc vô hiệu QC khác.</p>
      {error && <div className="err" role="alert">{error}</div>}
      {created && (
        <div className="notice" role="status">
          Đã tạo <strong>{created.user.username}</strong>. Mật khẩu tạm (chỉ hiện một lần, người dùng phải đổi khi đăng nhập):
          <pre>{created.temporary_password}</pre>
          <button onClick={() => setCreated(null)}>Đã chuyển cho người dùng</button>
        </div>
      )}
      <form className="card" onSubmit={create}>
        <div className="row">
          <div className="grow">
            <label htmlFor="un">Tên đăng nhập</label>
            <input id="un" value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div className="grow">
            <label htmlFor="dn">Tên hiển thị</label>
            <input id="dn" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </div>
          <button className="primary" type="submit" style={{ alignSelf: "end" }}>Thêm QC</button>
        </div>
      </form>
      <div className="card">
        <table>
          <thead><tr><th>Tài khoản</th><th>Tên</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.display_name}</td>
                <td><span className={`badge ${u.is_active ? "ok" : "bad"}`}>{u.is_active ? "Hoạt động" : "Vô hiệu"}</span></td>
                <td className="muted">{u.last_login_at ? new Date(u.last_login_at).toLocaleString("vi-VN") : "—"}</td>
                <td className="row">
                  {u.is_active ? (
                    <button onClick={() => void run(() => api(`/users/${u.id}/deactivate`, { method: "POST" }))}>Vô hiệu</button>
                  ) : (
                    <button onClick={() => void run(() => api(`/users/${u.id}/activate`, { method: "POST" }))}>Kích hoạt</button>
                  )}
                  <button onClick={() => void run(async () => setCreated(await api<Created>(`/users/${u.id}/reset-password`, { method: "POST" })))}>
                    Đặt lại mật khẩu
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
