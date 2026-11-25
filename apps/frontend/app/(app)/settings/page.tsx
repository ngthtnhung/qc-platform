"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type AuditRow, type IntegrationStatus, type User } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  DEFAULT_PET_CONFIG,
  formatDateBadge,
  getModuleColor,
  getProjectColor,
  getTheme,
  loadPetConfig,
  PET_COLOR_THEMES,
  saveModuleColor,
  savePetConfig,
  saveProjectColor,
  setTheme,
  syncModuleColorsFromServer,
  type ModuleDef,
  type PetColorPreset,
  type PetConfig,
} from "@/lib/ui-prefs";

type TabKey = "account" | "general" | "pet" | "integrations" | "users" | "audit";

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("account");

  // Account profile & password change
  const [profName, setProfName] = useState("");
  const [profCode, setProfCode] = useState("");
  const [profMsg, setProfMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (user) {
      setProfName(user.display_name || "");
      setProfCode(user.employee_code || "");
    }
  }, [user]);

  // General (Theme + Project/Module colors)
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [projects, setProjects] = useState<string[]>(["Super Team", "Winx Team", "Integrity Team", "Team 1"]);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [newProj, setNewProj] = useState("");
  const [modCode, setModCode] = useState("");
  const [modName, setModName] = useState("");
  const [modColor, setModColor] = useState("#2563eb");
  const [modMsg, setModMsg] = useState("");
  const [, setTick] = useState(0);
  const colorTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Pet Config
  const [petCfg, setPetCfg] = useState<PetConfig>(DEFAULT_PET_CONFIG);
  const [newPetTime, setNewPetTime] = useState("16:30");
  const [petMsg, setPetMsg] = useState("");

  // Integrations
  const [integs, setIntegs] = useState<IntegrationStatus[]>([]);
  const [integVals, setIntegVals] = useState<Record<string, string>>({});
  const [integMsg, setIntegMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Users
  const [users, setUsers] = useState<User[]>([]);
  const [uName, setUName] = useState("");
  const [uDisp, setUDisp] = useState("");
  const [uCode, setUCode] = useState("");
  const [uPass, setUPass] = useState("");
  const [uMsg, setUMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Audit
  const [audits, setAudits] = useState<AuditRow[]>([]);

  useEffect(() => {
    setThemeState(getTheme());
    setPetCfg(loadPetConfig());
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("tab");
      if (t === "account" || t === "general" || t === "pet" || t === "integrations" || t === "users" || t === "audit") {
        setTab(t);
      }
    }
  }, []);

  const loadAll = useCallback(() => {
    api<IntegrationStatus[]>("/integrations").then(setIntegs).catch(() => undefined);
    api<{ items: ModuleDef[] }>("/sources/modules")
      .then((r) => {
        setModules(r.items);
        syncModuleColorsFromServer(r.items);
      })
      .catch(() => undefined);
    api<{ projects?: string[] }>("/bugs/meta")
      .then((r) => {
        if (r.projects?.length) {
          setProjects((prev) => Array.from(new Set([...prev, ...r.projects!])));
        }
      })
      .catch(() => undefined);
    api<User[]>("/users").then(setUsers).catch(() => undefined);
    api<AuditRow[]>("/audit-logs?limit=80").then(setAudits).catch(() => undefined);
  }, []);

  useEffect(loadAll, [loadAll]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setProfMsg(null);
    try {
      await api("/auth/me", { method: "PATCH", body: { display_name: profName, employee_code: profCode } });
      setProfMsg({ ok: true, text: "Đã lưu Tên hiển thị và Mã nhân viên (Dashboard sẽ dùng thông tin này)." });
      window.location.reload();
    } catch (err) {
      setProfMsg({ ok: false, text: err instanceof ApiError ? err.message : "Lưu thông tin thất bại" });
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    try {
      await api("/auth/change-password", { method: "POST", body: { current_password: curPw, new_password: newPw } });
      setCurPw("");
      setNewPw("");
      setPwMsg({ ok: true, text: "Đã đổi mật khẩu thành công." });
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof ApiError ? err.message : "Đổi mật khẩu thất bại" });
    }
  }

  async function saveIntegration(key: string) {
    setIntegMsg(null);
    try {
      await api(`/integrations/${key}`, { method: "PUT", body: { value: integVals[key] } });
      setIntegVals((v) => ({ ...v, [key]: "" }));
      setIntegMsg({ ok: true, text: `Đã lưu cấu hình ${key} vào Vault.` });
      loadAll();
    } catch (err) {
      setIntegMsg({ ok: false, text: err instanceof ApiError ? err.message : "Lưu thất bại" });
    }
  }

  async function checkOneIntegration(key: string) {
    setIntegMsg(null);
    try {
      const r = await api<{ ok: boolean; status: string }>(`/integrations/${encodeURIComponent(key)}/check`, { method: "POST" });
      setIntegMsg({ ok: r.ok !== false, text: `Kiểm tra ${key}: ${r.status}` });
      loadAll();
    } catch (err) {
      setIntegMsg({ ok: false, text: err instanceof ApiError ? err.message : "Kiểm tra thất bại" });
      loadAll();
    }
  }

  async function checkAllIntegrations() {
    setIntegMsg(null);
    try {
      const r = await api<{ items: IntegrationStatus[] }>("/integrations/check-all", { method: "POST" });
      setIntegs(r.items);
      setIntegMsg({ ok: true, text: "Đã kiểm tra xong trạng thái tất cả token / khóa API." });
    } catch (err) {
      setIntegMsg({ ok: false, text: err instanceof ApiError ? err.message : "Kiểm tra thất bại" });
    }
  }

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setUMsg(null);
    try {
      await api("/users", {
        method: "POST",
        body: { username: uName, display_name: uDisp, employee_code: uCode, password: uPass },
      });
      setUName("");
      setUDisp("");
      setUCode("");
      setUPass("");
      setUMsg({ ok: true, text: "Đã tạo tài khoản QC mới." });
      loadAll();
    } catch (err) {
      setUMsg({ ok: false, text: err instanceof ApiError ? err.message : "Tạo tài khoản thất bại" });
    }
  }

  async function toggleUser(u: User) {
    await api(`/users/${u.id}`, { method: "PATCH", body: { is_active: !u.is_active } });
    loadAll();
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Cài đặt hệ thống</h2>
          <div className="muted">Quản lý Tài khoản, Giao diện, Màu dự án & Module, Tích hợp ngoài, Người dùng QC và Nhật ký.</div>
        </div>
      </div>

      <div className="settings-layout">
        <div className="settings-nav" role="tablist">
          <button className={tab === "account" ? "active" : ""} onClick={() => setTab("account")}>Tài khoản</button>
          <button className={tab === "general" ? "active" : ""} onClick={() => setTab("general")}>Chung (Giao diện &amp; Màu)</button>
          <button className={tab === "pet" ? "active" : ""} onClick={() => setTab("pet")}>Trợ lý Pet &amp; Báo cáo</button>
          <button className={tab === "integrations" ? "active" : ""} onClick={() => setTab("integrations")}>Tích hợp (Token &amp; Cookie)</button>
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>Người dùng QC</button>
          <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>Nhật ký hoạt động</button>
        </div>

        <div>
          {tab === "account" && (
            <div className="card">
              <div className="card-title">Thông tin tài khoản (dùng để đối chiếu task trên Dashboard Cá Nhân)</div>
              <form onSubmit={(e) => void saveProfile(e)} style={{ maxWidth: 460, marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="badge ok">{user?.username}</span>
                  <span className="muted">Vai trò: QC</span>
                </div>
                <label>Tên hiển thị (trùng tên trên Haraworks để nhận diện task của bạn)</label>
                <input value={profName} onChange={(e) => setProfName(e.target.value)} required placeholder="Vd: Nguyễn Thị Tuyết Nhung" />
                <label>Mã nhân viên</label>
                <input value={profCode} onChange={(e) => setProfCode(e.target.value)} placeholder="Vd: SC017007" />
                <div style={{ marginTop: 10 }}>
                  <button className="primary sm" type="submit">Lưu thông tin cá nhân</button>
                </div>
                {profMsg && <div className={profMsg.ok ? "badge ok" : "err"} style={{ marginTop: 8 }}>{profMsg.text}</div>}
              </form>
              <form onSubmit={(e) => void changePassword(e)} style={{ maxWidth: 460 }}>
                <div className="card-title">Đổi mật khẩu</div>
                <label>Mật khẩu hiện tại</label>
                <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
                <label>Mật khẩu mới (≥ 12 ký tự)</label>
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={12} />
                <div style={{ marginTop: 12 }}>
                  <button className="primary" type="submit">Cập nhật mật khẩu</button>
                </div>
                {pwMsg && <div className={pwMsg.ok ? "badge ok" : "err"} style={{ marginTop: 8 }}>{pwMsg.text}</div>}
              </form>
            </div>
          )}

          {tab === "general" && (
            <>
              <div className="card">
                <div className="card-title">Chế độ giao diện</div>
                <div className="row">
                  <button
                    className={theme === "light" ? "primary" : ""}
                    onClick={() => { setTheme("light"); setThemeState("light"); }}
                  >
                    Giao diện Sáng (Pastel)
                  </button>
                  <button
                    className={theme === "dark" ? "primary" : ""}
                    onClick={() => { setTheme("dark"); setThemeState("dark"); }}
                  >
                    Giao diện Tối (Dark Mode)
                  </button>
                </div>
              </div>

              <div className="card">
                <div className="card-title">Màu sắc Dự án (đồng bộ trên Bug, Task Function, Theo dõi Build)</div>
                <div className="row" style={{ marginBottom: 10 }}>
                  <input style={{ width: 220 }} value={newProj} onChange={(e) => setNewProj(e.target.value)} placeholder="Thêm tên dự án..." />
                  <button className="sm" onClick={() => { if (newProj.trim()) { setProjects((p) => Array.from(new Set([...p, newProj.trim()]))); setNewProj(""); } }}>Thêm</button>
                </div>
                <div className="row" style={{ gap: 12 }}>
                  {projects.map((p) => (
                    <div key={p} className="row" style={{ padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 8 }}>
                      <input
                        type="color"
                        style={{ width: 32, height: 28, padding: 2 }}
                        value={getProjectColor(p)}
                        onChange={(e) => { saveProjectColor(p, e.target.value); setTick((t) => t + 1); }}
                      />
                      <strong>{p}</strong>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-title">Quản lý Module &amp; Màu sắc nhãn (tự động nhận diện theo tiền tố [MÃ])</div>
                <div className="muted" style={{ marginBottom: 10 }}>
                  Khi thêm mới Module, hệ thống tự động tách tiền tố <code>[MÃ]</code> trong tên task / bug để nhận diện đúng Module và áp dụng màu đồng bộ toàn hệ thống.
                </div>
                <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                  <input
                    style={{ width: 140 }}
                    value={modCode}
                    onChange={(e) => setModCode(e.target.value.toUpperCase())}
                    placeholder="Mã / tiền tố (VD: 4RUM)"
                  />
                  <input
                    style={{ width: 200 }}
                    value={modName}
                    onChange={(e) => setModName(e.target.value)}
                    placeholder="Tên hiển thị (VD: Diễn đàn)"
                  />
                  <input
                    type="color"
                    style={{ width: 38, height: 32, padding: 2 }}
                    value={modColor}
                    onChange={(e) => setModColor(e.target.value)}
                    title="Màu nhãn module"
                  />
                  <button
                    className="sm primary"
                    onClick={() => {
                      if (!modCode.trim()) return;
                      setModMsg("");
                      void api<ModuleDef>("/sources/modules", {
                        method: "POST",
                        body: { code: modCode.trim().toUpperCase(), name: modName.trim() || modCode.trim().toUpperCase(), prefix: modCode.trim().toUpperCase(), color: modColor },
                      })
                        .then((created) => {
                          saveModuleColor(created.code, created.color || modColor);
                          setModCode("");
                          setModName("");
                          setModMsg(`Đã lưu module ${created.code}`);
                          loadAll();
                        })
                        .catch((e) => setModMsg(e instanceof ApiError ? e.message : "Không lưu được module"));
                    }}
                  >
                    + Thêm / Cập nhật
                  </button>
                  {modMsg && <span className="muted">{modMsg}</span>}
                </div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  {modules.map((m) => {
                    const c = m.color || getModuleColor(m.code);
                    return (
                      <div key={m.code} className="row" style={{ padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 8, gap: 6 }}>
                        <input
                          type="color"
                          aria-label={`Chọn màu module ${m.code}`}
                          title={`Đổi màu module ${m.code}`}
                          style={{ width: 30, height: 26, padding: 1, cursor: "pointer", flexShrink: 0, background: "transparent" }}
                          value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#2563eb"}
                          onChange={(e) => {
                            const nextColor = e.target.value;
                            saveModuleColor(m.code, nextColor);
                            setModules((prev) => prev.map((x) => (x.code === m.code ? { ...x, color: nextColor } : x)));
                            setTick((t) => t + 1);
                            if (colorTimers.current[m.code]) clearTimeout(colorTimers.current[m.code]);
                            colorTimers.current[m.code] = setTimeout(() => {
                              void api(`/sources/modules/${encodeURIComponent(m.code)}`, { method: "PATCH", body: { color: nextColor } })
                                .then(() => setModMsg(`Đã lưu màu [${m.code}]`))
                                .catch((err) => setModMsg(err instanceof ApiError ? err.message : `Lỗi lưu màu [${m.code}]`));
                            }, 220);
                          }}
                        />
                        <span className="badge" style={{ background: `${c}18`, color: c, borderColor: `${c}55`, fontWeight: 600 }}>
                          [{m.code}]
                        </span>
                        <span style={{ fontSize: 13 }}>{m.name && m.name !== m.code ? m.name : ""}</span>
                        {m.custom && (
                          <button
                            type="button"
                            className="sm"
                            style={{ padding: "1px 6px", fontSize: 11 }}
                            title={`Xóa module ${m.code}`}
                            onClick={() => {
                              if (!window.confirm(`Xóa cấu hình module ${m.code}?`)) return;
                              void api(`/sources/modules/${encodeURIComponent(m.code)}`, { method: "DELETE" })
                                .then(() => loadAll())
                                .catch(() => undefined);
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {modules.length === 0 && <span className="muted">Chưa có module nào trong hệ thống.</span>}
                </div>
              </div>
            </>
          )}

          {tab === "pet" && (
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                <div className="card-title" style={{ margin: 0 }}>Cấu hình Bé Pet Mèo QC &amp; Báo cáo hằng ngày</div>
                {petMsg && <span className="badge ok">{petMsg}</span>}
              </div>

              {/* Helper: cập nhật & áp dụng NGAY LẬP TỨC không cần bấm thêm nút */}
              {(() => {
                const applyPet = (patch: Partial<PetConfig>) => {
                  setPetCfg((prev) => {
                    const next = { ...prev, ...patch };
                    savePetConfig(next);
                    return next;
                  });
                  setPetMsg("Đã áp dụng ngay!");
                  setTimeout(() => setPetMsg(""), 1800);
                };
                return (
                  <>
                    <div className="qc-toggle-row" onClick={() => applyPet({ visible: !petCfg.visible })}>
                      <div>
                        <strong>Hiển thị Bé Pet ở góc màn hình</strong>
                        <div className="muted" style={{ fontSize: 12 }}>Tắt/mở hiển thị Bé Mèo QC trên toàn hệ thống</div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={petCfg.visible}
                        className={`qc-switch${petCfg.visible ? " on" : ""}`}
                        onClick={(e) => { e.stopPropagation(); applyPet({ visible: !petCfg.visible }); }}
                      >
                        <span className="qc-switch-thumb" />
                      </button>
                    </div>

                    <div className="grid-2" style={{ maxWidth: 640 }}>
                      <div>
                        <label htmlFor="pet-name">Tên Bé Pet</label>
                        <input
                          id="pet-name"
                          value={petCfg.name}
                          onChange={(e) => applyPet({ name: e.target.value })}
                          placeholder="Bé Mèo QC"
                        />
                      </div>
                      <div>
                        <label htmlFor="pet-poll">Chu kỳ kiểm tra realtime (giây)</label>
                        <select
                          id="pet-poll"
                          value={String(petCfg.pollSec)}
                          onChange={(e) => applyPet({ pollSec: Number(e.target.value) || 45 })}
                        >
                          <option value="20">Mỗi 20 giây</option>
                          <option value="30">Mỗi 30 giây</option>
                          <option value="45">Mỗi 45 giây (mặc định)</option>
                          <option value="60">Mỗi 60 giây</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label>Màu sắc Bé Pet (bấm để đổi ngay)</label>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        {(Object.entries(PET_COLOR_THEMES) as [Exclude<PetColorPreset, "custom">, { label: string; body: string; ear: string }][]).map(([key, th]) => (
                          <button
                            key={key}
                            type="button"
                            className={petCfg.color === key ? "primary sm" : "sm"}
                            onClick={() => applyPet({ color: key })}
                            style={{ gap: 6 }}
                          >
                            <span style={{ width: 13, height: 13, borderRadius: "50%", background: th.body, border: `2px solid ${th.ear}`, display: "inline-block" }} />
                            {th.label}
                          </button>
                        ))}
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className={petCfg.color === "custom" ? "primary sm" : "sm"}
                            onClick={() => applyPet({ color: "custom" })}
                          >
                            Tự chọn màu
                          </button>
                          <input
                            type="color"
                            title="Chọn màu tùy chỉnh cho Bé Pet"
                            style={{ width: 34, height: 28, padding: 1, cursor: "pointer", flexShrink: 0 }}
                            value={/^#[0-9a-f]{6}$/i.test(petCfg.customHex) ? petCfg.customHex : "#fde68a"}
                            onChange={(e) => applyPet({ color: "custom", customHex: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>

                    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      <div className="qc-toggle-row" onClick={() => applyPet({ reminderEnabled: !petCfg.reminderEnabled })}>
                        <div>
                          <strong>Nhận báo cáo hằng ngày theo giờ</strong>
                          <div className="muted" style={{ fontSize: 12 }}>
                            Đến đúng mốc giờ bên dưới, Bé Pet sẽ báo tổng hợp: Đã trễ · Cần hoàn thành hôm nay · Cần duyệt
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={petCfg.reminderEnabled}
                          className={`qc-switch${petCfg.reminderEnabled ? " on" : ""}`}
                          onClick={(e) => { e.stopPropagation(); applyPet({ reminderEnabled: !petCfg.reminderEnabled }); }}
                        >
                          <span className="qc-switch-thumb" />
                        </button>
                      </div>

                      <div className="row" style={{ gap: 8 }}>
                        <input
                          type="time"
                          style={{ width: 140 }}
                          value={newPetTime}
                          onChange={(e) => setNewPetTime(e.target.value)}
                        />
                        <button
                          type="button"
                          className="sm primary"
                          onClick={() => {
                            if (newPetTime && !petCfg.reminderTimes.includes(newPetTime)) {
                              applyPet({ reminderTimes: [...petCfg.reminderTimes, newPetTime].sort() });
                            }
                          }}
                        >
                          + Thêm mốc giờ
                        </button>
                      </div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        {petCfg.reminderTimes.map((t) => (
                          <span key={t} className="badge ok" style={{ gap: 6, display: "inline-flex", alignItems: "center", fontSize: 13 }}>
                            ⏰ {t}
                            <button
                              type="button"
                              style={{ border: 0, background: "transparent", cursor: "pointer", padding: 0, fontWeight: 700 }}
                              onClick={() => applyPet({ reminderTimes: petCfg.reminderTimes.filter((x) => x !== t) })}
                              title="Xóa mốc giờ"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                        {petCfg.reminderTimes.length === 0 && <span className="muted">Chưa đặt mốc giờ báo cáo nào.</span>}
                      </div>
                    </div>

                    <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div className="qc-toggle-row" onClick={() => applyPet({ alertUncheckedBug: !petCfg.alertUncheckedBug })}>
                        <span>Báo khi có Bug mới được gán cho tôi mà chưa check quá 1 phút</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={petCfg.alertUncheckedBug}
                          className={`qc-switch${petCfg.alertUncheckedBug ? " on" : ""}`}
                          onClick={(e) => { e.stopPropagation(); applyPet({ alertUncheckedBug: !petCfg.alertUncheckedBug }); }}
                        >
                          <span className="qc-switch-thumb" />
                        </button>
                      </div>
                      <div className="qc-toggle-row" onClick={() => applyPet({ alertMentions: !petCfg.alertMentions })}>
                        <span>Báo khi có bình luận nhắc đến (@mention) trong 30 phút gần đây</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={petCfg.alertMentions}
                          className={`qc-switch${petCfg.alertMentions ? " on" : ""}`}
                          onClick={(e) => { e.stopPropagation(); applyPet({ alertMentions: !petCfg.alertMentions }); }}
                        >
                          <span className="qc-switch-thumb" />
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {tab === "integrations" && (
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div className="card-title" style={{ margin: 0 }}>Tích hợp ngoài (mã hóa AES-256-GCM trong Vault, chỉ ghi)</div>
                <button type="button" className="sm" onClick={() => void checkAllIntegrations()}>
                  🔄 Kiểm tra tất cả
                </button>
              </div>
              <div className="muted" style={{ marginBottom: 12 }}>
                Dán Cookie Haraworks, Token Figma hoặc Khóa AI (Gemini / Anthropic) vào ô tương ứng rồi bấm Lưu. Hệ thống hiển thị rõ trạng thái <strong>Hoạt động</strong>, <strong>Thiếu token</strong>, <strong>Hết hạn</strong> hoặc <strong>Lỗi</strong>.
              </div>
              {integs.map((i) => {
                const st = i.state || (i.configured ? "active" : "missing");
                const badgeCls = st === "active" ? "ok" : st === "missing" ? "warn" : "bad";
                const badgeText = i.state_label || (i.configured ? "Hoạt động" : "Thiếu token");
                return (
                  <div key={i.key} style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                    <div className="row" style={{ marginBottom: 6, gap: 8, flexWrap: "wrap" }}>
                      <strong className="grow">{i.label}</strong>
                      <span className={`badge ${badgeCls}`}>{badgeText}</span>
                      {i.last_check_at && (
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          Kiểm tra lúc {formatDateBadge(i.last_check_at)}
                        </span>
                      )}
                    </div>
                    {(i.detail || i.last_check_status) && (
                      <div
                        className="muted"
                        style={{
                          fontSize: 12,
                          marginBottom: 8,
                          color: st === "expired" || st === "error" ? "var(--bad)" : "var(--muted)",
                        }}
                      >
                        {i.detail || i.last_check_status}
                      </div>
                    )}
                    <div className="row">
                      <input
                        className="grow"
                        type="password"
                        autoComplete="off"
                        placeholder={i.key === "haraworks" ? "Dán header Cookie Haraworks..." : `Dán khóa/token ${i.label}...`}
                        value={integVals[i.key] ?? ""}
                        onChange={(e) => setIntegVals((v) => ({ ...v, [i.key]: e.target.value }))}
                      />
                      <button className="primary sm" disabled={!integVals[i.key]} onClick={() => void saveIntegration(i.key)}>Lưu</button>
                      {i.configured && (
                        <button className="sm" onClick={() => void checkOneIntegration(i.key)}>Kiểm tra</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {integMsg && <div className={integMsg.ok ? "badge ok" : "err"} style={{ marginTop: 10 }}>{integMsg.text}</div>}
            </div>
          )}

          {tab === "users" && (
            <>
              <form className="card" onSubmit={(e) => void createUser(e)}>
                <div className="card-title">Thêm tài khoản QC</div>
                <div className="grid-2">
                  <div>
                    <label>Tên đăng nhập *</label>
                    <input value={uName} onChange={(e) => setUName(e.target.value)} required />
                  </div>
                  <div>
                    <label>Tên hiển thị *</label>
                    <input value={uDisp} onChange={(e) => setUDisp(e.target.value)} required />
                  </div>
                  <div>
                    <label>Mã nhân viên</label>
                    <input value={uCode} onChange={(e) => setUCode(e.target.value)} />
                  </div>
                  <div>
                    <label>Mật khẩu ban đầu (≥ 12 ký tự) *</label>
                    <input type="password" value={uPass} onChange={(e) => setUPass(e.target.value)} required minLength={12} />
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <button className="primary sm" type="submit">Tạo tài khoản</button>
                </div>
                {uMsg && <div className={uMsg.ok ? "badge ok" : "err"} style={{ marginTop: 8 }}>{uMsg.text}</div>}
              </form>

              <div className="card">
                <div className="card-title">Danh sách người dùng QC ({users.length})</div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Tài khoản</th>
                        <th>Tên hiển thị</th>
                        <th>Trạng thái</th>
                        <th>Đăng nhập gần nhất</th>
                        <th style={{ textAlign: "right" }}>Thao tác</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td><strong>{u.username}</strong></td>
                          <td>{u.display_name}</td>
                          <td><span className={`badge ${u.is_active ? "ok" : "bad"}`}>{u.is_active ? "Đang hoạt động" : "Đã khóa"}</span></td>
                          <td><span className="badge date">{formatDateBadge(u.last_login_at)}</span></td>
                          <td style={{ textAlign: "right" }}>
                            {u.id !== user?.id && (
                              <button className="sm" onClick={() => void toggleUser(u)}>
                                {u.is_active ? "Khóa" : "Mở khóa"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {tab === "audit" && (
            <div className="card">
              <div className="card-title">Nhật ký hoạt động gần đây</div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ngày</th>
                      <th>Người thực hiện</th>
                      <th>Hành động</th>
                      <th>Đối tượng</th>
                      <th>Kết quả</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audits.map((a) => (
                      <tr key={a.id}>
                        <td><span className="badge date">{formatDateBadge(a.at)}</span></td>
                        <td>{a.actor_username || a.actor_type}</td>
                        <td><code>{a.action}</code></td>
                        <td className="muted">{a.resource_type} {a.resource_id ? a.resource_id.slice(0, 8) : ""}</td>
                        <td><span className={`badge ${a.decision === "ALLOW" ? "ok" : "bad"}`}>{a.decision}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
