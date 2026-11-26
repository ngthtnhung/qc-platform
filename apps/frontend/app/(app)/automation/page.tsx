"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  apiForm,
  ApiError,
  type Account,
  type AutomationMode,
  type AutoTask,
  type Environment,
  type Execution,
  type ExecutionDetail,
  type ExpectedCriterion,
  type TaskParam,
} from "@/lib/api";
import { formatDateBadge, getModuleColor, type ModuleDef } from "@/lib/ui-prefs";
import { ScriptEditor } from "@/components/ScriptEditor";

const VSTATUS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Chờ kích hoạt", cls: "warn" },
  APPROVED: { label: "Đang dùng", cls: "ok" },
  REJECTED: { label: "Đã bỏ", cls: "bad" },
  RETIRED: { label: "Cũ", cls: "" },
};
const ESTATUS: Record<string, string> = {
  QUEUED: "Đang chờ",
  CLAIMED: "Runner đã nhận",
  RUNNING: "Đang chạy",
  PASSED: "Đạt",
  FAILED: "Lỗi",
  CANCELLED: "Đã hủy",
};
const MODE_META: Record<AutomationMode, { label: string; cls: string; icon: string }> = {
  AUTO: { label: "Tự động", cls: "ok", icon: "🟢" },
  SEMI_AUTO: { label: "Bán tự động", cls: "warn", icon: "🟡" },
  MANUAL: { label: "Thủ công", cls: "", icon: "⚪" },
};

const DV5S_TARGETS = ["MAINT", "SCM", "IOT"];

type CodegenDraft = {
  selected: boolean;
  name: string;
  module_code: string;
  flow: string;
  flow_code: string;
  automation_mode: AutomationMode;
  start_url: string;
  required_roles: string[];
  writes: boolean;
  preconditions: string[];
  data_policy: { test_prefix?: string; cleanup_strategy?: string };
  expected_criteria: ExpectedCriterion[];
  manual_checklist: string[];
  steps: string[];
  params: TaskParam[];
  script: string;
  warnings: string[];
};

type NormalizeResponse = {
  used_ai: boolean;
  provider: string;
  fallback_reason: string;
  cleaning_summary: {
    raw_lines: number;
    cleaned_lines: number;
    detected_org: string;
    detected_domain: string;
    start_url: string;
    context_notes: string;
    fragile_selectors: string[];
    stripped_login: boolean;
  };
  drafts: Omit<CodegenDraft, "selected">[];
};

function ParamBuilder({
  params,
  onChange,
}: {
  params: TaskParam[];
  onChange: (next: TaskParam[]) => void;
}) {
  function addRow() {
    let idx = params.length + 1;
    while (params.some((p) => p.key === `param_${idx}`)) idx++;
    onChange([
      ...params,
      { key: `param_${idx}`, label: `Tham số ${idx}`, type: "text", value: "", options: [], auto: true, fallback: "first" },
    ]);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 12.5 }}>3. Tham số đầu vào biến thiên ({params.length})</strong>
        <button type="button" className="sm" onClick={addRow}>+ Thêm tham số</button>
      </div>
      {params.map((p, i) => (
        <div key={i} className="row" style={{ gap: 6, flexWrap: "wrap", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 8 }}>
          <input
            value={p.key}
            onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            placeholder="Key (vd: ten_phieu)"
            style={{ width: 130, fontSize: 12 }}
          />
          <input
            value={p.label}
            onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            placeholder="Nhãn hiển thị"
            style={{ width: 140, fontSize: 12 }}
          />
          <select
            value={p.type}
            onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
            style={{ width: 110, fontSize: 12 }}
          >
            <option value="text">Text</option>
            <option value="multiline">Nhiều dòng</option>
            <option value="list">Danh sách</option>
            <option value="number">Số</option>
            <option value="date">Ngày</option>
            <option value="select">Lựa chọn</option>
            <option value="file">Tệp</option>
          </select>
          <input
            className="grow"
            value={p.value}
            onChange={(e) => onChange(params.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
            placeholder="Giá trị mặc định"
            style={{ minWidth: 140, fontSize: 12 }}
          />
          {p.type === "select" && (
            <input
              value={(p.options || []).join(", ")}
              onChange={(e) =>
                onChange(
                  params.map((x, j) =>
                    j === i ? { ...x, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } : x,
                  ),
                )
              }
              placeholder="Các lựa chọn (cách dấu phẩy)"
              style={{ width: 180, fontSize: 12 }}
            />
          )}
          <button type="button" className="sm danger" onClick={() => onChange(params.filter((_, j) => j !== i))} title="Xóa tham số">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function AiCode({ t, onDone }: { t: AutoTask; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [fails, setFails] = useState<Execution[]>([]);
  const [execId, setExecId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function openPanel() {
    const rows = await api<Execution[]>(`/automation/executions?task_id=${t.id}&status=FAILED&limit=10`).catch(() => []);
    setFails(rows);
    if (rows[0]) setExecId(rows[0].id);
    setOpen(true);
  }

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ version_no: number }>(`/ai/tasks/${t.id}/suggest-code`, {
        method: "POST",
        body: { instruction, execution_id: execId || null },
      });
      setMsg({ ok: true, text: `AI đã tạo phiên bản v${r.version_no}. Bạn có thể xem lại code được tô màu và bấm Kích hoạt v${r.version_no} ngay bên trên.` });
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
      {!open && <button type="button" className="sm" onClick={() => void openPanel()}>✨ AI đề xuất sửa/viết code</button>}
      {open && (
        <div className="card" style={{ marginTop: 6 }}>
          <label htmlFor={`${t.id}-ai`}>Chỉ dẫn cho AI (để trống = tự sửa theo lần chạy lỗi đã chọn)</label>
          <textarea id={`${t.id}-ai`} rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <label htmlFor={`${t.id}-ex`}>Lần chạy lỗi làm bằng chứng (log, lỗi, DOM)</label>
          <select id={`${t.id}-ex`} value={execId} onChange={(e) => setExecId(e.target.value)}>
            <option value="">Không chọn</option>
            {fails.map((f) => (
              <option key={f.id} value={f.id}>
                {new Date(f.queued_at).toLocaleString("vi-VN")} — {f.error.slice(0, 70)}
              </option>
            ))}
          </select>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Mật khẩu không bao giờ được gửi cho AI. Sau khi AI sinh xong, bạn vẫn chỉnh sửa được code ngay tại khung bên trên.
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button type="button" className="primary sm" disabled={busy} onClick={() => void run()}>
              {busy ? "Đang gọi AI…" : "Gửi AI"}
            </button>
            <button type="button" className="sm" onClick={() => setOpen(false)}>Hủy</button>
          </div>
        </div>
      )}
      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "muted" : "err"} style={{ marginTop: 4 }}>{msg.text}</div>}
    </div>
  );
}

type Schedule = {
  id: string;
  task_id: string;
  interval_minutes: number;
  run_count: number;
  enabled: boolean;
  target_module?: string | null;
  next_run_at: string;
  last_run_at: string | null;
  last_status: string;
};

function Schedules({ t, schedules, targetModule, onChange }: { t: AutoTask; schedules: Schedule[]; targetModule: string; onChange: () => void }) {
  const [every, setEvery] = useState(60);
  const [msg, setMsg] = useState("");
  const mine = schedules.filter((s) => s.task_id === t.id);

  async function create() {
    setMsg("");
    try {
      await api("/automation/schedules", {
        method: "POST",
        body: { task_id: t.id, interval_minutes: every, ...(targetModule ? { target_module: targetModule } : {}) },
      });
      onChange();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Không đặt được lịch");
    }
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
      <strong style={{ fontSize: 12.5 }}>Lịch chạy định kỳ</strong>
      {mine.map((s) => (
        <div className="row" key={s.id} style={{ marginTop: 4 }}>
          <span className="grow" style={{ fontSize: 12.5 }}>
            mỗi {s.interval_minutes} phút · {s.target_module ? `Module ${s.target_module} · ` : ""}lần tới {new Date(s.next_run_at).toLocaleString("vi-VN")}
            {s.last_status ? ` · ${s.last_status}` : ""}
          </span>
          <span className={`badge ${s.enabled ? "ok" : "warn"}`}>{s.enabled ? "Đang bật" : "Đã tắt"}</span>
          <button type="button" className="sm" onClick={() => void api(`/automation/schedules/${s.id}`, { method: "PUT", body: { enabled: !s.enabled } }).then(onChange)}>
            {s.enabled ? "Tắt" : "Bật"}
          </button>
          <button type="button" className="sm danger" onClick={() => void api(`/automation/schedules/${s.id}`, { method: "DELETE" }).then(onChange)}>
            Xóa
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <label htmlFor={`${t.id}-iv`} style={{ margin: 0, fontSize: 12 }}>Chạy mỗi (phút, ≥ 5)</label>
        <input id={`${t.id}-iv`} type="number" min={5} value={every} onChange={(e) => setEvery(Number(e.target.value))} style={{ width: 90 }} />
        <button type="button" className="sm" disabled={!t.runnable} onClick={() => void create()}>Đặt lịch</button>
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
        <input
          type="file"
          aria-label={`Tải file cho ${label}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
          style={{ maxWidth: 280 }}
        />
        {ids.map((id) => (
          <span key={id} className="badge">
            {id.slice(0, 8)}…{" "}
            <button style={{ padding: "0 6px" }} onClick={() => onChange(ids.filter((x) => x !== id).join(","))} aria-label="Gỡ file">
              ×
            </button>
          </span>
        ))}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
    </div>
  );
}

function CodegenPanel({
  modules,
  defaultModule,
  onCreated,
}: {
  modules: ModuleDef[];
  defaultModule: string;
  onCreated: () => void;
}) {
  const [modeTab, setModeTab] = useState<"codegen" | "manual">("codegen");
  const [rawCode, setRawCode] = useState("");
  const [cgModule, setCgModule] = useState(defaultModule || "MAINT");
  const [cgNote, setCgNote] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [busy, setBusy] = useState(false);
  const [normRes, setNormRes] = useState<NormalizeResponse | null>(null);
  const [drafts, setDrafts] = useState<CodegenDraft[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // State cho tab Tạo thủ công / mới
  const [manualForm, setManualForm] = useState<{
    name: string;
    module_code: string;
    flow: string;
    flow_code: string;
    automation_mode: AutomationMode;
    start_url: string;
    rolesText: string;
    writes: boolean;
    test_prefix: string;
    preconditionsText: string;
    criteriaText: string;
    stepsText: string;
    manualChecklistText: string;
    params: TaskParam[];
    script: string;
  }>({
    name: "",
    module_code: defaultModule || "MAINT",
    flow: "",
    flow_code: "DS",
    automation_mode: "AUTO",
    start_url: "/{subsystem}/create/list",
    rolesText: "Nhân viên phụ trách",
    writes: false,
    test_prefix: "[AI TEST]",
    preconditionsText: "",
    criteriaText: "Trang tải xong và hiển thị đúng danh sách/kết quả",
    stepsText: "Mở màn hình chức năng\nThực hiện thao tác kiểm tra",
    manualChecklistText: "",
    params: [],
    script:
      "await step('Mở và kiểm tra màn hình', async () => {\n  assert(Boolean(page.url()), 'Trang tải thành công');\n});\n",
  });

  useEffect(() => {
    if (defaultModule) {
      setCgModule(defaultModule);
      setManualForm((prev) => ({ ...prev, module_code: defaultModule }));
    }
  }, [defaultModule]);

  async function onPickFile(f: File) {
    const txt = await f.text();
    setRawCode(txt);
    setMsg(null);
  }

  async function runNormalize() {
    if (!rawCode.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<NormalizeResponse>("/ai/codegen/normalize", {
        method: "POST",
        body: { raw_code: rawCode, module_code: cgModule, note: cgNote, use_ai: useAi },
      });
      setNormRes(r);
      setDrafts(r.drafts.map((d) => ({ ...d, selected: true })));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không phân tích được codegen" });
    } finally {
      setBusy(false);
    }
  }

  async function saveSelectedDrafts() {
    const chosen = drafts.filter((d) => d.selected);
    if (!chosen.length) return;
    setBusy(true);
    setMsg(null);
    let savedCount = 0;
    try {
      for (const d of chosen) {
        await api("/automation/tasks", {
          method: "POST",
          body: {
            name: d.name,
            module_code: d.module_code || cgModule || "MAINT",
            flow: d.flow,
            flow_code: d.flow_code,
            automation_mode: d.automation_mode,
            start_url: d.start_url,
            steps: d.steps.length ? d.steps : [d.name],
            script: d.automation_mode === "MANUAL" ? "" : d.script,
            params: d.params,
            required_roles: d.required_roles,
            writes: d.writes,
            preconditions: d.preconditions,
            data_policy: d.data_policy,
            expected_criteria: d.expected_criteria,
            manual_checklist: d.manual_checklist,
            activate_immediately: true,
          },
        });
        savedCount++;
      }
      setMsg({ ok: true, text: `Đã lưu và kích hoạt ngay ${savedCount} tác vụ vào danh sách Module!` });
      setDrafts([]);
      setNormRes(null);
      setRawCode("");
      onCreated();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : `Mới lưu được ${savedCount} tác vụ thì gặp lỗi` });
    } finally {
      setBusy(false);
    }
  }

  async function createManualTask() {
    setBusy(true);
    setMsg(null);
    try {
      const criteria = manualForm.criteriaText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((desc, idx) => ({ id: `c_${idx + 1}`, description: desc, required: true }));
      await api("/automation/tasks", {
        method: "POST",
        body: {
          name: manualForm.name,
          module_code: manualForm.module_code,
          flow: manualForm.flow,
          flow_code: manualForm.flow_code,
          automation_mode: manualForm.automation_mode,
          start_url: manualForm.start_url,
          steps: manualForm.stepsText.split("\n").map((s) => s.trim()).filter(Boolean),
          script: manualForm.automation_mode === "MANUAL" ? "" : manualForm.script,
          params: manualForm.params,
          required_roles: manualForm.rolesText.split(",").map((s) => s.trim()).filter(Boolean),
          writes: manualForm.writes,
          preconditions: manualForm.preconditionsText.split("\n").map((s) => s.trim()).filter(Boolean),
          data_policy: { test_prefix: manualForm.test_prefix || "[AI TEST]", cleanup_strategy: "none" },
          expected_criteria: criteria,
          manual_checklist: manualForm.manualChecklistText.split("\n").map((s) => s.trim()).filter(Boolean),
          activate_immediately: true,
        },
      });
      setMsg({ ok: true, text: "Đã tạo và kích hoạt tác vụ mới!" });
      setManualForm((prev) => ({ ...prev, name: "" }));
      onCreated();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không tạo được tác vụ" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="card" open>
      <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>➕ Nhập từ <code>playwright codegen</code> hoặc Tạo tác vụ mới (Chạy thẳng Staging không cần duyệt tách trang)</strong>
      </summary>

      <div className="seg-tabs" style={{ marginTop: 10, marginBottom: 12 }}>
        <button type="button" className={`seg-tab${modeTab === "codegen" ? " active" : ""}`} onClick={() => setModeTab("codegen")}>
          ⚡ Dán / Tải code Playwright Codegen
        </button>
        <button type="button" className={`seg-tab${modeTab === "manual" ? " active" : ""}`} onClick={() => setModeTab("manual")}>
          📝 Tạo mới (Tự động / Bán tự động / Thủ công)
        </button>
      </div>

      {modeTab === "codegen" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <div>
              <label htmlFor="cg-mod">Module mục tiêu</label>
              <select id="cg-mod" value={cgModule} onChange={(e) => setCgModule(e.target.value)} style={{ width: 230 }}>
                <option value="DV5S">DV5S (Dùng chung MAINT / SCM / IOT)</option>
                {modules.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code}{m.name && m.name !== m.code ? ` — ${m.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grow">
              <label htmlFor="cg-note">Ghi chú vai trò / mục tiêu luồng (tùy chọn)</label>
              <input
                id="cg-note"
                value={cgNote}
                onChange={(e) => setCgNote(e.target.value)}
                placeholder="VD: Luồng cho Quản trị module; DV5S = MAINT, SCM, IOT..."
              />
            </div>
            <div>
              <label htmlFor="cg-file">Hoặc nạp tệp `.spec.ts` / `.js`</label>
              <input
                id="cg-file"
                ref={fileRef}
                type="file"
                accept=".ts,.js,.txt"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onPickFile(f);
                }}
              />
            </div>
          </div>

          <label htmlFor="cg-raw">Dán trực tiếp code sinh từ `npx playwright codegen ...` (hệ thống tự bỏ bước đăng nhập cứng, khử nhiễu gõ tiếng Việt &amp; tách nghiệp vụ)</label>
          <textarea
            id="cg-raw"
            rows={7}
            value={rawCode}
            onChange={(e) => setRawCode(e.target.value)}
            placeholder={"import { test, expect } from '@playwright/test';\ntest('test', async ({ page }) => {\n  ...\n});"}
            style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12.5 }}
            spellCheck={false}
          />

          <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} style={{ width: "auto" }} />
              Dùng AI tách luồng nghiệp vụ &amp; tối ưu selector (tự fallback về bộ tách chuẩn nếu chưa có API Key AI)
            </label>
            <button type="button" className="primary" disabled={busy || !rawCode.trim()} onClick={() => void runNormalize()}>
              {busy ? "Đang phân tích & chuẩn hóa…" : "🔍 Phân tích & Tách luồng"}
            </button>
          </div>

          {normRes && (
            <div className="notice" style={{ marginTop: 4 }}>
              <strong>Kết quả tiền xử lý:</strong> Rút gọn {normRes.cleaning_summary.raw_lines} dòng → {normRes.cleaning_summary.cleaned_lines} lệnh sạch
              {normRes.cleaning_summary.stripped_login && " · Đã loại bỏ thông tin đăng nhập cứng"}
              {normRes.cleaning_summary.fragile_selectors.length > 0 && ` · Phát hiện ${normRes.cleaning_summary.fragile_selectors.length} selector động đã làm sạch`}
              {" · "}
              <span className={`badge ${normRes.used_ai ? "ok" : "warn"}`}>
                {normRes.used_ai ? `AI (${normRes.provider})` : "Chế độ chuẩn hóa tất định"}
              </span>
              {normRes.fallback_reason && <div className="muted" style={{ fontSize: 12 }}>Lưu ý AI: {normRes.fallback_reason}</div>}
            </div>
          )}

          {drafts.map((d, idx) => (
            <div key={idx} className="card" style={{ border: "1.5px solid var(--accent)" }}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <input
                  type="checkbox"
                  checked={d.selected}
                  onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, selected: e.target.checked } : x)))}
                  style={{ width: "auto" }}
                />
                <input
                  className="grow"
                  value={d.name}
                  onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, name: e.target.value } : x)))}
                  style={{ fontWeight: 600 }}
                />
                <select
                  value={d.automation_mode}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, automation_mode: e.target.value as AutomationMode } : x)))
                  }
                  style={{ width: 150 }}
                >
                  <option value="AUTO">🟢 Tự động (AUTO)</option>
                  <option value="SEMI_AUTO">🟡 Bán tự động</option>
                  <option value="MANUAL">⚪ Thủ công (MANUAL)</option>
                </select>
                <input
                  value={d.flow}
                  onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, flow: e.target.value } : x)))}
                  placeholder="Nhóm luồng (Flow)"
                  style={{ width: 180 }}
                />
              </div>

              {d.warnings.map((w, wi) => (
                <div key={wi} className="notice" style={{ fontSize: 12, marginBottom: 6 }}>⚠ {w}</div>
              ))}

              {/* 5 nhóm đầu vào chuẩn */}
              <div className="grid-2" style={{ gap: 8, marginBottom: 8 }}>
                <div>
                  <label>1. URL bắt đầu (Staging hoặc /{`{subsystem}`}/...)</label>
                  <input
                    value={d.start_url}
                    onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, start_url: e.target.value } : x)))}
                  />
                </div>
                <div>
                  <label>2. Gợi ý vai trò tài khoản (thông tin tham khảo)</label>
                  <input
                    value={d.required_roles.join(", ")}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, j) =>
                          j === idx
                            ? { ...x, required_roles: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
              </div>

              <ParamBuilder
                params={d.params}
                onChange={(nextParams) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, params: nextParams } : x)))}
              />

              <div className="grid-2" style={{ gap: 8, marginTop: 8 }}>
                <div>
                  <label>4. Tiền điều kiện &amp; chính sách dữ liệu test</label>
                  <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                    <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={d.writes}
                        onChange={(e) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, writes: e.target.checked } : x)))}
                        style={{ width: "auto" }}
                      />
                      Có ghi dữ liệu (ghép tiền tố test)
                    </label>
                    <input
                      value={d.data_policy?.test_prefix ?? "[AI TEST]"}
                      onChange={(e) =>
                        setDrafts((prev) =>
                          prev.map((x, j) => (j === idx ? { ...x, data_policy: { ...x.data_policy, test_prefix: e.target.value } } : x)),
                        )
                      }
                      style={{ width: 120, fontSize: 12 }}
                    />
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Mỗi dòng 1 tiền điều kiện..."
                    value={d.preconditions.join("\n")}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, j) => (j === idx ? { ...x, preconditions: e.target.value.split("\n") } : x)),
                      )
                    }
                  />
                </div>
                <div>
                  <label>5. Tiêu chí kiểm tra Pass / Fail mong đợi</label>
                  <textarea
                    rows={3}
                    value={d.expected_criteria.map((c) => c.description).join("\n")}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, j) =>
                          j === idx
                            ? {
                                ...x,
                                expected_criteria: e.target.value
                                  .split("\n")
                                  .map((line, ci) => ({ id: `c_${ci + 1}`, description: line, required: true })),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
              </div>

              {d.automation_mode !== "MANUAL" ? (
                <ScriptEditor
                  script={d.script}
                  params={d.params}
                  onChangeScript={(nextScript) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, script: nextScript } : x)))}
                  onChangeParams={(nextParams) => setDrafts((prev) => prev.map((x, j) => (j === idx ? { ...x, params: nextParams } : x)))}
                />
              ) : (
                <div className="muted" style={{ marginTop: 8 }}>
                  Tác vụ phân loại <strong>Thủ công (MANUAL)</strong> — hệ thống chỉ lưu quy trình &amp; checklist, không sinh script.
                </div>
              )}
            </div>
          ))}

          {drafts.length > 0 && (
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button type="button" className="sm" onClick={() => setDrafts([])}>Bỏ bản nháp</button>
              <button
                type="button"
                className="primary"
                disabled={busy || drafts.filter((d) => d.selected).length === 0}
                onClick={() => void saveSelectedDrafts()}
              >
                ✅ Lưu &amp; Kích hoạt ngay ({drafts.filter((d) => d.selected).length} tác vụ)
              </button>
            </div>
          )}
        </div>
      )}

      {modeTab === "manual" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="grid-2" style={{ gap: 8 }}>
            <div>
              <label>Tên tác vụ *</label>
              <input value={manualForm.name} onChange={(e) => setManualForm({ ...manualForm, name: e.target.value })} placeholder="VD: Xuất báo cáo hiệu suất" />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <div className="grow">
                <label>Module *</label>
                <select value={manualForm.module_code} onChange={(e) => setManualForm({ ...manualForm, module_code: e.target.value })}>
                  <option value="DV5S">DV5S (Dùng chung MAINT / SCM / IOT)</option>
                  {modules.map((m) => (
                    <option key={m.code} value={m.code}>{m.code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Phân loại</label>
                <select
                  value={manualForm.automation_mode}
                  onChange={(e) => setManualForm({ ...manualForm, automation_mode: e.target.value as AutomationMode })}
                >
                  <option value="AUTO">🟢 Tự động</option>
                  <option value="SEMI_AUTO">🟡 Bán tự động</option>
                  <option value="MANUAL">⚪ Thủ công</option>
                </select>
              </div>
            </div>
            <div>
              <label>1. URL bắt đầu (Staging hoặc /{`{subsystem}`}/...)</label>
              <input value={manualForm.start_url} onChange={(e) => setManualForm({ ...manualForm, start_url: e.target.value })} />
            </div>
            <div>
              <label>2. Gợi ý vai trò tài khoản (thông tin tham khảo)</label>
              <input value={manualForm.rolesText} onChange={(e) => setManualForm({ ...manualForm, rolesText: e.target.value })} />
            </div>
            <div>
              <label>Luồng nghiệp vụ (Flow)</label>
              <input value={manualForm.flow} onChange={(e) => setManualForm({ ...manualForm, flow: e.target.value })} placeholder="VD: Danh sách phiếu" />
            </div>
            <div>
              <label>4. Tiền điều kiện (mỗi dòng 1 ý) &amp; Ghi dữ liệu</label>
              <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                  <input type="checkbox" checked={manualForm.writes} onChange={(e) => setManualForm({ ...manualForm, writes: e.target.checked })} style={{ width: "auto" }} />
                  Ghi dữ liệu ({manualForm.test_prefix})
                </label>
              </div>
              <textarea rows={2} value={manualForm.preconditionsText} onChange={(e) => setManualForm({ ...manualForm, preconditionsText: e.target.value })} />
            </div>
          </div>

          <ParamBuilder params={manualForm.params} onChange={(p) => setManualForm({ ...manualForm, params: p })} />

          <div className="grid-2" style={{ gap: 8 }}>
            <div>
              <label>Các bước thực hiện (mỗi dòng 1 bước)</label>
              <textarea rows={3} value={manualForm.stepsText} onChange={(e) => setManualForm({ ...manualForm, stepsText: e.target.value })} />
            </div>
            <div>
              <label>5. Tiêu chí kiểm tra Pass / Fail mong đợi</label>
              <textarea rows={3} value={manualForm.criteriaText} onChange={(e) => setManualForm({ ...manualForm, criteriaText: e.target.value })} />
            </div>
          </div>

          {manualForm.automation_mode !== "AUTO" && (
            <div>
              <label>Checklist kiểm tra thủ công (dành cho Bán tự động / Thủ công)</label>
              <textarea rows={2} value={manualForm.manualChecklistText} onChange={(e) => setManualForm({ ...manualForm, manualChecklistText: e.target.value })} />
            </div>
          )}

          {manualForm.automation_mode !== "MANUAL" && (
            <ScriptEditor
              script={manualForm.script}
              params={manualForm.params}
              onChangeScript={(s) => setManualForm({ ...manualForm, script: s })}
              onChangeParams={(p) => setManualForm({ ...manualForm, params: p })}
            />
          )}

          <div>
            <button type="button" className="primary" disabled={busy || !manualForm.name.trim()} onClick={() => void createManualTask()}>
              {manualForm.automation_mode === "MANUAL" ? "💾 Lưu tác vụ Thủ công" : "✅ Lưu & Kích hoạt ngay"}
            </button>
          </div>
        </div>
      )}

      {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "badge ok" : "err"} style={{ marginTop: 8 }}>{msg.text}</div>}
    </details>
  );
}

function TaskCard({
  t,
  onChange,
  accounts,
  schedules,
  currentModule,
}: {
  t: AutoTask;
  onChange: () => void;
  accounts: Account[];
  schedules: Schedule[];
  currentModule: string;
}) {
  const [accountId, setAccountId] = useState("");
  const [targetModule, setTargetModule] = useState(() =>
    DV5S_TARGETS.includes(currentModule) ? currentModule : t.module_code === "DV5S" ? "MAINT" : "",
  );
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(t.params.map((p) => [p.key, p.value])));
  const [editParams, setEditParams] = useState<TaskParam[]>(t.params);
  const [editScript, setEditScript] = useState("");
  const [loadedScript, setLoadedScript] = useState("");
  const [editRoles, setEditRoles] = useState((t.required_roles || []).join(", "));
  const [editPre, setEditPre] = useState((t.preconditions || []).join("\n"));
  const [editCriteria, setEditCriteria] = useState((t.expected_criteria || []).map((c) => c.description).join("\n"));
  const [editStartUrl, setEditStartUrl] = useState(t.start_url);
  const [editMode, setEditMode] = useState<AutomationMode>(t.automation_mode || "AUTO");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savingCode, setSavingCode] = useState(false);

  const mode = t.automation_mode || "AUTO";
  const mMeta = MODE_META[mode] || MODE_META.AUTO;
  const isSharedCluster = t.module_code === "DV5S" || Boolean(t.inherited_from_cluster);

  useEffect(() => {
    setEditParams(t.params);
    setValues(Object.fromEntries(t.params.map((p) => [p.key, p.value])));
  }, [t.params]);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next && mode !== "MANUAL" && !loadedScript) {
      try {
        const d = await api<{ script_by_version: Record<string, string>; versions: { version_no: number; status: string }[] }>(
          `/automation/tasks/${t.id}`,
        );
        const approved = d.versions.find((v) => v.status === "APPROVED") ?? d.versions[0];
        const s = approved ? d.script_by_version[String(approved.version_no)] ?? "" : "";
        setLoadedScript(s);
        setEditScript(s);
      } catch { /* ignore */ }
    }
  }

  async function run() {
    setMsg(null);
    try {
      const r = await api<{ executions: unknown[] }>(`/automation/tasks/${t.id}/run`, {
        method: "POST",
        body: {
          count,
          params: values,
          ...(accountId ? { account_id: accountId } : {}),
          ...(isSharedCluster && targetModule ? { target_module: targetModule } : {}),
        },
      });
      setMsg({ ok: true, text: `Đã xếp hàng ${r.executions.length} lần chạy trên Staging.` });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không xếp hàng được" });
    }
  }

  async function saveMetaAndInputs() {
    setMsg(null);
    try {
      await api(`/automation/tasks/${t.id}`, {
        method: "PATCH",
        body: {
          start_url: editStartUrl,
          automation_mode: editMode,
          required_roles: editRoles.split(",").map((s) => s.trim()).filter(Boolean),
          preconditions: editPre.split("\n").map((s) => s.trim()).filter(Boolean),
          expected_criteria: editCriteria
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((desc, idx) => ({ id: `c_${idx + 1}`, description: desc, required: true })),
        },
      });
      await api(`/automation/tasks/${t.id}/params`, { method: "PUT", body: { params: editParams } });
      setMsg({ ok: true, text: "Đã lưu 5 nhóm đầu vào & tham số." });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không lưu được thông tin" });
    }
  }

  async function saveCodeAndActivate() {
    setSavingCode(true);
    setMsg(null);
    try {
      await api(`/automation/tasks/${t.id}/params`, { method: "PUT", body: { params: editParams } });
      if (editScript.trim() && editScript !== loadedScript) {
        await api(`/automation/tasks/${t.id}/versions`, {
          method: "POST",
          body: { script: editScript, note: "QC chỉnh sửa trực tiếp", origin: "human", activate_immediately: true },
        });
        setLoadedScript(editScript);
        setMsg({ ok: true, text: "Đã lưu code mới, tham số & kích hoạt chạy ngay!" });
      } else {
        setMsg({ ok: true, text: "Đã cập nhật tham số." });
      }
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không lưu được code" });
    } finally {
      setSavingCode(false);
    }
  }

  async function activate(verId: string, verNo: number) {
    setMsg(null);
    try {
      await api(`/automation/tasks/${t.id}/versions/${verId}/activate`, { method: "POST" });
      setMsg({ ok: true, text: `Đã kích hoạt phiên bản v${verNo} để chạy.` });
      onChange();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Không kích hoạt được" });
    }
  }

  async function removeTask() {
    if (!confirm(`Xóa tác vụ "${t.name}"?`)) return;
    await api(`/automation/tasks/${t.id}`, { method: "DELETE" });
    onChange();
  }

  const modColor = getModuleColor(t.module_code);

  return (
    <article className="card">
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="badge" style={{ background: `${modColor}18`, color: modColor, borderColor: `${modColor}55` }}>{t.module_code}</span>
        {t.inherited_from_cluster && <span className="badge">Dùng chung {t.inherited_from_cluster}</span>}
        <span className={`badge ${mMeta.cls}`}>{mMeta.icon} {mMeta.label}</span>
        <strong className="grow">{t.name}</strong>
        {t.required_roles.length > 0 && (
          <span className="muted" style={{ fontSize: 11.5 }} title="Chỉ là thông tin gợi ý tài khoản nên dùng">
            Gợi ý: {t.required_roles.join(", ")}
          </span>
        )}
        {t.created_at && <span className="badge date">{formatDateBadge(t.created_at)}</span>}
        {t.writes && <span className="badge warn">Ghi dữ liệu</span>}
        {mode !== "MANUAL" && (
          <span className={`badge ${t.runnable ? "ok" : "warn"}`}>
            {t.runnable ? `Sẵn sàng (v${t.approved_version})` : "Chưa kích hoạt"}
          </span>
        )}
        <button type="button" className="sm" onClick={() => void toggleOpen()}>{open ? "Thu gọn" : "Chi tiết & Code"}</button>
        <button type="button" className="sm danger" onClick={() => void removeTask()}>Xóa</button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {/* 5 nhóm đầu vào chuẩn */}
          <div className="grid-2" style={{ gap: 8, marginBottom: 8 }}>
            <div>
              <label>1. URL bắt đầu</label>
              <input value={editStartUrl} onChange={(e) => setEditStartUrl(e.target.value)} />
            </div>
            <div>
              <label>2. Gợi ý vai trò tài khoản (không bắt buộc khi chạy)</label>
              <input value={editRoles} onChange={(e) => setEditRoles(e.target.value)} />
            </div>
            <div>
              <label>Phân loại tác vụ</label>
              <select value={editMode} onChange={(e) => setEditMode(e.target.value as AutomationMode)}>
                <option value="AUTO">🟢 Tự động (AUTO)</option>
                <option value="SEMI_AUTO">🟡 Bán tự động (SEMI_AUTO)</option>
                <option value="MANUAL">⚪ Thủ công (MANUAL)</option>
              </select>
            </div>
            <div>
              <label>4. Tiền điều kiện (mỗi dòng 1 ý)</label>
              <textarea rows={2} value={editPre} onChange={(e) => setEditPre(e.target.value)} />
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>5. Tiêu chí kiểm tra Pass / Fail mong đợi</label>
            <textarea rows={2} value={editCriteria} onChange={(e) => setEditCriteria(e.target.value)} />
          </div>

          <div className="row" style={{ marginBottom: 10, justifyContent: "flex-end" }}>
            <button type="button" className="sm" onClick={() => void saveMetaAndInputs()}>💾 Lưu thông tin 5 nhóm đầu vào</button>
          </div>

          {t.steps.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 12.5 }}>Các bước thực hiện:</strong>
              <ol style={{ margin: "4px 0 0 18px", fontSize: 12.5 }}>{t.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            </div>
          )}

          {(t.manual_checklist || []).length > 0 && (
            <div className="notice" style={{ marginBottom: 8 }}>
              <strong>Checklist kiểm tra thủ công:</strong>
              <ul style={{ margin: "4px 0 0 18px" }}>
                {(t.manual_checklist || []).map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          {mode !== "MANUAL" && (
            <>
              <div className="row" style={{ marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                {t.versions.map((v) => (
                  <span key={v.id} className="row" style={{ gap: 4 }}>
                    <span className={`badge ${VSTATUS[v.status]?.cls}`} title={v.sha256}>
                      v{v.version_no} · {VSTATUS[v.status]?.label || v.status} · {v.origin}
                    </span>
                    {v.status === "PENDING" && (
                      <button type="button" className="sm primary" onClick={() => void activate(v.id, v.version_no)}>
                        Kích hoạt v{v.version_no}
                      </button>
                    )}
                  </span>
                ))}
              </div>

              <ScriptEditor
                script={editScript}
                params={editParams}
                onChangeScript={setEditScript}
                onChangeParams={(next) => {
                  setEditParams(next);
                  setValues(Object.fromEntries(next.map((p) => [p.key, p.value])));
                }}
              />

              <div className="row" style={{ marginTop: 8, justifyContent: "flex-end", gap: 8 }}>
                <button type="button" className="primary sm" disabled={savingCode} onClick={() => void saveCodeAndActivate()}>
                  {savingCode ? "Đang lưu…" : "💾 Lưu code & tham số & Kích hoạt ngay"}
                </button>
              </div>

              {/* Khung chạy thử trực tiếp trên Staging */}
              <div className="card" style={{ marginTop: 10, background: "var(--panel-alt)" }}>
                <strong style={{ fontSize: 13 }}>▶ Chạy thử trên Staging</strong>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  {t.required_roles.length > 0
                    ? `Gợi ý tài khoản vai trò: ${t.required_roles.join(", ")} (chỉ để tham khảo — bạn chọn bất kỳ tài khoản Staging nào bên dưới đều chạy được).`
                    : "Chọn tài khoản Staging bạn muốn dùng để chạy."}
                </div>

                {t.params.map((p) => (
                  <div key={p.key} style={{ marginBottom: 6 }}>
                    <label htmlFor={`${t.id}-run-${p.key}`}>{p.label || p.key}</label>
                    {p.type === "file" ? (
                      <FileParam label={p.label || p.key} value={values[p.key] ?? ""} onChange={(v) => setValues({ ...values, [p.key]: v })} />
                    ) : p.type === "multiline" ? (
                      <textarea id={`${t.id}-run-${p.key}`} rows={2} value={values[p.key] ?? ""} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
                    ) : p.type === "select" && (p.options || []).length > 0 ? (
                      <select id={`${t.id}-run-${p.key}`} value={values[p.key] ?? ""} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}>
                        {(p.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <input id={`${t.id}-run-${p.key}`} value={values[p.key] ?? ""} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
                    )}
                  </div>
                ))}

                <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  {isSharedCluster && (
                    <>
                      <label htmlFor={`${t.id}-tm`} style={{ margin: 0, fontSize: 12 }}>Module chạy</label>
                      <select id={`${t.id}-tm`} value={targetModule} onChange={(e) => setTargetModule(e.target.value)} style={{ width: 110 }}>
                        {DV5S_TARGETS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </>
                  )}
                  <label htmlFor={`${t.id}-n`} style={{ margin: 0, fontSize: 12 }}>Số lần</label>
                  <input id={`${t.id}-n`} type="number" min={1} max={50} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 70 }} />
                  <label htmlFor={`${t.id}-acc`} style={{ margin: 0, fontSize: 12 }}>Tài khoản Staging</label>
                  <select id={`${t.id}-acc`} value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ width: "auto", minWidth: 200 }}>
                    <option value="">Tự chọn tài khoản Staging</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role_label || "chưa ghi vai trò"})
                      </option>
                    ))}
                  </select>
                  <button type="button" className="primary" disabled={!t.runnable} onClick={() => void run()}>
                    ▶ Chạy thử trên Staging
                  </button>
                </div>
              </div>

              <Schedules t={t} schedules={schedules} targetModule={isSharedCluster ? targetModule : ""} onChange={onChange} />
              <AiCode t={t} onDone={onChange} />
            </>
          )}

          {msg && <div role={msg.ok ? "status" : "alert"} className={msg.ok ? "badge ok" : "err"} style={{ marginTop: 8 }}>{msg.text}</div>}
        </div>
      )}
    </article>
  );
}

export default function AutomationPage() {
  const [tasks, setTasks] = useState<AutoTask[]>([]);
  const [modulesList, setModulesList] = useState<ModuleDef[]>([]);
  const [execs, setExecs] = useState<Execution[]>([]);
  const [stagingAccounts, setStagingAccounts] = useState<Account[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [moduleFilter, setModuleFilter] = useState("");
  const [flowFilter, setFlowFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [execDetail, setExecDetail] = useState<ExecutionDetail | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (moduleFilter) params.set("module", moduleFilter);
      params.set("include_shared", "true");
      if (modeFilter) params.set("automation_mode", modeFilter);
      const [t, e, envs, accs, sch, mods] = await Promise.all([
        api<AutoTask[]>(`/automation/tasks?${params.toString()}`),
        api<Execution[]>("/automation/executions?limit=30"),
        api<Environment[]>("/environments"),
        api<Account[]>("/accounts"),
        api<Schedule[]>("/automation/schedules"),
        api<{ items: ModuleDef[] }>("/sources/modules"),
      ]);
      setTasks(t);
      setExecs(e);
      setSchedules(sch);
      setModulesList(mods.items || []);
      const staging = new Set(envs.filter((x) => x.type === "STAGING" && x.is_active).map((x) => x.id));
      setStagingAccounts(accs.filter((a) => staging.has(a.environment_id)));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không tải được");
    }
  }, [moduleFilter, modeFilter]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  async function openExecutionDetail(id: string) {
    try {
      setExecDetail(await api<ExecutionDetail>(`/automation/executions/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không tải được chi tiết lần chạy");
    }
  }

  const flowOptions = useMemo(() => {
    return Array.from(new Set(tasks.map((t) => t.flow || t.flow_code).filter(Boolean))).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (flowFilter && (t.flow || t.flow_code) !== flowFilter) return false;
      if (ql && !`${t.name} ${t.module_code} ${t.flow} ${t.description}`.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [tasks, flowFilter, q]);

  const groupedByFlow = useMemo(() => {
    const map = new Map<string, AutoTask[]>();
    for (const t of filteredTasks) {
      const g = t.flow || t.flow_code || "Chung";
      const arr = map.get(g) || [];
      arr.push(t);
      map.set(g, arr);
    }
    return Array.from(map.entries());
  }, [filteredTasks]);

  const counts = useMemo(() => {
    let auto = 0, semi = 0, manual = 0;
    for (const t of filteredTasks) {
      const m = t.automation_mode || "AUTO";
      if (m === "MANUAL") manual++;
      else if (m === "SEMI_AUTO") semi++;
      else auto++;
    }
    return { auto, semi, manual };
  }, [filteredTasks]);

  const names = Object.fromEntries(tasks.map((t) => [t.id, t.name]));

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Tác vụ tự động &amp; Danh mục kiểm thử theo Module</h2>
          <div className="muted">
            Quản lý trọn vẹn tác vụ <strong>Tự động / Bán tự động / Thủ công</strong> theo từng Module, dán code <code>playwright codegen</code>, chỉnh sửa code có tô màu tham số và chạy trực tiếp trên Staging.
          </div>
        </div>
      </div>

      {error && <div className="err" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      {stagingAccounts.length === 0 && (
        <div className="notice" style={{ marginBottom: 10 }}>
          Chưa có tài khoản nào trong môi trường loại STAGING. Vào &quot;Môi trường &amp; Tài khoản&quot; để thêm tài khoản trước khi bấm chạy thử.
        </div>
      )}

      {(moduleFilter === "MAINT" || moduleFilter === "SCM" || moduleFilter === "IOT" || moduleFilter === "DV5S") && (
        <div className="notice" style={{ marginBottom: 10 }}>
          Cụm <strong>DV5S</strong> dùng chung giao diện cho <code>MAINT</code>, <code>SCM</code>, <code>IOT</code> — hệ thống tự hiển thị các tác vụ dùng chung kèm nút chọn Module đích khi chạy.
        </div>
      )}

      {/* Bộ lọc Module / Flow / Phân loại */}
      <div className="card" style={{ padding: "10px 14px", marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <select aria-label="Module" value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setFlowFilter(""); }} style={{ width: 210 }}>
            <option value="">Mọi module</option>
            <option value="DV5S">DV5S (Cụm dùng chung)</option>
            {modulesList.map((m) => (
              <option key={m.code} value={m.code}>{m.code}{m.name && m.name !== m.code ? ` — ${m.name}` : ""}</option>
            ))}
          </select>
          <select aria-label="Luồng nghiệp vụ" value={flowFilter} onChange={(e) => setFlowFilter(e.target.value)} style={{ width: 190 }}>
            <option value="">Mọi luồng (Flow)</option>
            {flowOptions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select aria-label="Phân loại" value={modeFilter} onChange={(e) => setModeFilter(e.target.value)} style={{ width: 170 }}>
            <option value="">Mọi phân loại</option>
            <option value="AUTO">🟢 Tự động</option>
            <option value="SEMI_AUTO">🟡 Bán tự động</option>
            <option value="MANUAL">⚪ Thủ công</option>
          </select>
          <input className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên tác vụ, luồng, mô tả..." />
          <span className="muted" style={{ fontSize: 12 }}>
            {filteredTasks.length} tác vụ (🟢 {counts.auto} · 🟡 {counts.semi} · ⚪ {counts.manual})
          </span>
        </div>
      </div>

      <CodegenPanel modules={modulesList} defaultModule={moduleFilter} onCreated={() => void load()} />

      {groupedByFlow.map(([flowName, items]) => (
        <section key={flowName} style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 14, marginBottom: 6, color: "var(--muted)" }}>
            📂 Luồng: {flowName} ({items.length})
          </h3>
          {items.map((t) => (
            <TaskCard key={t.id} t={t} schedules={schedules} accounts={stagingAccounts} currentModule={moduleFilter} onChange={() => void load()} />
          ))}
        </section>
      ))}
      {filteredTasks.length === 0 && <div className="muted" style={{ marginTop: 12 }}>Chưa có tác vụ nào khớp bộ lọc.</div>}

      <h3 style={{ marginTop: 20 }}>Lần chạy gần đây</h3>
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Tác vụ</th>
              <th>Module chạy</th>
              <th>Trạng thái</th>
              <th>Lần thử</th>
              <th>Thời gian</th>
              <th>Lỗi</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {execs.map((e) => (
              <tr key={e.id}>
                <td>{names[e.task_id] ?? e.task_id.slice(0, 8)}</td>
                <td>{e.target_module || "—"}</td>
                <td>
                  <span className={`badge ${e.status === "PASSED" ? "ok" : e.status === "FAILED" ? "bad" : "warn"}`}>
                    {ESTATUS[e.status] || e.status}
                  </span>
                </td>
                <td>{e.attempt}</td>
                <td className="muted">{e.duration_ms != null ? `${(e.duration_ms / 1000).toFixed(1)} s` : "—"}</td>
                <td className="muted">{e.error}</td>
                <td className="row" style={{ gap: 6 }}>
                  <button type="button" className="sm" onClick={() => void openExecutionDetail(e.id)}>Xem chi tiết</button>
                  {["QUEUED", "CLAIMED", "RUNNING"].includes(e.status) && (
                    <button type="button" className="sm danger" onClick={() => void api(`/automation/executions/${e.id}/cancel`, { method: "POST" }).then(load)}>
                      Hủy
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Execution Detail Modal */}
      {execDetail && (
        <div className="modal-backdrop" onClick={() => setExecDetail(null)} role="dialog" aria-modal="true" aria-label="Chi tiết lần chạy">
          <div className="modal-box" style={{ maxWidth: 820, width: "94vw", maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Chi tiết lần chạy · {ESTATUS[execDetail.status] || execDetail.status}</strong>
              <button type="button" className="sm" onClick={() => setExecDetail(null)}>Đóng ✕</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {execDetail.error && <div className="err">{execDetail.error}</div>}
              <div>
                <strong>Các bước ({execDetail.steps.length})</strong>
                {execDetail.steps.length === 0 ? (
                  <div className="muted">Chưa ghi nhận bước nào.</div>
                ) : (
                  <ul className="bh-logs">
                    {execDetail.steps.map((s, i) => (
                      <li key={i}>
                        <span className={`badge ${s.status === "PASS" ? "ok" : "bad"}`}>{s.status}</span>{" "}
                        <strong>{s.name}</strong> <span className="muted">({s.ms} ms)</span>
                        {s.error && <div className="err">{s.error}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {execDetail.artifacts.length > 0 && (
                <div>
                  <strong>Ảnh &amp; Bằng chứng lỗi ({execDetail.artifacts.length})</strong>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
                    {execDetail.artifacts.map((a) => (
                      <div key={a.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 8 }}>
                        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                          <span className="badge">{a.kind}</span>
                          <a className="btn sm" href={`/api/v1/files/${a.file_id}/download?inline=true`} target="_blank" rel="noopener noreferrer">
                            Mở / Tải xuống ↗
                          </a>
                        </div>
                        {a.kind === "screenshot" && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={`/api/v1/files/${a.file_id}/download?inline=true`} alt="Ảnh lỗi" style={{ maxWidth: "100%", borderRadius: 6 }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <strong>Runner Log ({execDetail.log.length})</strong>
                <pre style={{ maxHeight: 220, overflow: "auto", fontSize: 12, background: "#0f172a", color: "#e2e8f0", padding: 10, borderRadius: 8 }}>
                  {execDetail.log.join("\n") || "(trống)"}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
