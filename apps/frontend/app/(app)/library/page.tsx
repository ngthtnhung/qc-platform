"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type RuleDetail, type RuleList } from "@/lib/api";

const VALIDATION: Record<string, { label: string; cls: string }> = {
  UNREVIEWED: { label: "Chưa duyệt", cls: "warn" },
  VALIDATED: { label: "QC đã xác nhận", cls: "ok" },
  REJECTED: { label: "Đã từ chối", cls: "bad" },
  DISPUTED: { label: "Tranh chấp", cls: "bad" },
};
const EXTRA_LABELS: Record<string, string> = {
  business_logic: "Logic nghiệp vụ", expected_behavior: "Hành vi mong đợi", input_conditions: "Điều kiện đầu vào", preconditions: "Điều kiện tiên quyết",
  exceptions: "Ngoại lệ", regression_risk: "Rủi ro hồi quy", ai_interpretation: "Diễn giải của AI", notes: "Ghi chú", feature: "Tính năng", config_note: "Ghi chú cấu hình",
};

function Detail({ ruleKey }: { ruleKey: string }) {
  const [d, setD] = useState<RuleDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setD(null);
    api<RuleDetail>(`/library/rules/${encodeURIComponent(ruleKey)}`).then(setD).catch((e) => setError(e instanceof ApiError ? e.message : "Lỗi"));
  }, [ruleKey]);
  if (error) return <div className="err">{error}</div>;
  if (!d) return <div className="muted">Đang tải…</div>;
  const v = d.versions[0];
  return (
    <div className="card">
      <div className="row">
        <strong className="grow">{d.rule_key} · v{v.version_no}</strong>
        <span className={`badge ${VALIDATION[v.validation_status]?.cls}`}>{VALIDATION[v.validation_status]?.label}</span>
        {v.created_by_type !== "USER" && <span className="badge ai">{v.created_by_type === "AI" ? "AI đề xuất" : "Nhập từ Kho"}</span>}
      </div>
      <h3 style={{ margin: "8px 0" }}>{v.title}</h3>
      <p>{v.description}</p>
      <div className="muted">Vai trò: {v.user_roles.join(", ") || "—"} · Thiết lập: {v.setting_type} · {v.config_path}</div>
      {v.legacy_approval && (
        <div className="notice">
          Đã duyệt ở Kho ngoài ({String(v.legacy_approval.verification_status ?? "")}, {String(v.legacy_approval.approved_at ?? "").slice(0, 10)}). Đây chỉ là thông tin tham khảo:
          rule chỉ được xác nhận ở đây khi một QC duyệt trong mục Duyệt.
        </div>
      )}
      {Object.entries(EXTRA_LABELS).map(([k, label]) => {
        const val = v.extra[k];
        if (val === undefined || val === "" || (Array.isArray(val) && val.length === 0)) return null;
        return <div key={k}><label>{label}</label><div>{typeof val === "string" ? val : JSON.stringify(val)}</div></div>;
      })}
      {v.open_questions.length > 0 && <div><label>Câu hỏi còn mở</label><ul>{v.open_questions.map((q, i) => <li key={i}>{String(q)}</li>)}</ul></div>}
      <label>Nguồn gốc ({d.references.length})</label>
      {d.references.map((r) => (
        <blockquote key={r.id} style={{ margin: "6px 0", paddingLeft: 10, borderLeft: "3px solid var(--line)" }}>
          “{r.quote}”
          <div className="muted">{r.source_title} · {r.source_version} · {[r.locator.section, r.locator.text_lines, r.locator.reference].filter(Boolean).join(" · ")}</div>
        </blockquote>
      ))}
      {d.versions.length > 1 && <div className="muted">Có {d.versions.length} phiên bản; hiển thị bản mới nhất.</div>}
    </div>
  );
}

export default function LibraryPage() {
  const [q, setQ] = useState("");
  const [module, setModule] = useState("");
  const [validation, setValidation] = useState("");
  const [modules, setModules] = useState<{ code: string; name: string }[]>([]);
  const [data, setData] = useState<RuleList | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ code: string; name: string }[]>("/library/modules").then(setModules).catch(() => undefined);
  }, []);
  const load = useCallback(async () => {
    setError("");
    try {
      setData(await api<RuleList>(`/library/rules?${new URLSearchParams({ q, module, validation, limit: "200" })}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được");
    }
  }, [q, module, validation]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <>
      <h2>Thư viện tham chiếu</h2>
      <p className="muted">Rule gắn với nguồn gốc. Rule nhập từ Kho vào ở trạng thái “Chưa duyệt” cho tới khi một QC xác nhận; AI không tự xác nhận rule.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input aria-label="Tìm rule" placeholder="Tìm (không cần dấu)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi module</option>
          {modules.map((m) => <option key={m.code} value={m.code}>{m.code} · {m.name}</option>)}
        </select>
        <select aria-label="Xác nhận" value={validation} onChange={(e) => setValidation(e.target.value)} style={{ width: "auto" }}>
          <option value="">Mọi trạng thái</option>
          {Object.entries(VALIDATION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span className="muted">{data ? `${data.total} rule` : ""}</span>
      </div>
      {error && <div className="err" role="alert">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.4fr)", gap: 12, alignItems: "start" }}>
        <div className="card" style={{ maxHeight: "75vh", overflow: "auto" }}>
          <table>
            <tbody>
              {data?.items.map((r) => (
                <tr key={r.version_id} onClick={() => setSelected(r.rule_key)} style={{ cursor: "pointer", background: selected === r.rule_key ? "color-mix(in srgb, var(--brand) 12%, transparent)" : undefined }}>
                  <td><strong>{r.rule_key}</strong><div className="muted">{r.title}</div></td>
                  <td><span className={`badge ${VALIDATION[r.validation_status]?.cls}`}>{VALIDATION[r.validation_status]?.label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>{selected ? <Detail ruleKey={selected} /> : <div className="muted">Chọn một rule để xem chi tiết và nguồn gốc.</div>}</div>
      </div>
    </>
  );
}
