"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function AccountPage() {
  const { user, reload } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/auth/change-password", { method: "POST", body: { current_password: current, new_password: next } });
      setDone(true);
      setCurrent("");
      setNext("");
      await reload();
      router.replace("/lookup");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không đổi được mật khẩu");
    }
  }

  return (
    <>
      <h2>Tài khoản của tôi</h2>
      <p className="muted">{user?.display_name} ({user?.username}) · vai trò QC</p>
      {user?.must_change_password && <div className="notice">Bạn đang dùng mật khẩu tạm. Hãy đặt mật khẩu mới để tiếp tục.</div>}
      <form className="card" onSubmit={submit} style={{ maxWidth: 420 }}>
        <label htmlFor="c">Mật khẩu hiện tại</label>
        <input id="c" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <label htmlFor="n">Mật khẩu mới (từ 12 ký tự)</label>
        <input id="n" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} />
        {error && <div className="err" role="alert">{error}</div>}
        {done && <div role="status">Đã đổi mật khẩu.</div>}
        <p><button className="primary" type="submit">Đổi mật khẩu</button></p>
      </form>
    </>
  );
}
