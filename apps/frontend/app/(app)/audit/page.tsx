"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type AuditRow } from "@/lib/api";

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<AuditRow[]>("/audit-logs?limit=200")
      .then(setRows)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Không tải được nhật ký"));
  }, []);
  return (
    <>
      <h2>Nhật ký kiểm toán</h2>
      <p className="muted">Chỉ thêm, không sửa/xóa. Bí mật đã được che.</p>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Thời gian</th><th>Chủ thể</th><th>Hành động</th><th>Đối tượng</th><th>Kết quả</th><th>Lý do</th></tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id}>
                <td className="muted">{new Date(r.at).toLocaleString("vi-VN")}</td>
                <td>{r.actor_username ?? r.actor_type}{r.actor_type !== "USER" && r.actor_username ? ` (${r.actor_type})` : ""}</td>
                <td>{r.action}</td>
                <td className="muted">{r.resource_type} {r.resource_id.slice(0, 8)}</td>
                <td><span className={`badge ${r.decision === "ALLOW" ? "ok" : "bad"}`}>{r.decision}</span></td>
                <td className="muted">{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
