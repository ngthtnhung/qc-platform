"use client";

/** Quản lý theme (Sáng/Tối), màu dự án (4 dự án đồng bộ), màu nhãn module (mặc định khác nhau). */

const THEME_KEY = "qc_ui_theme";
const PROJ_COLOR_KEY = "qc_project_colors";
const MOD_COLOR_KEY = "qc_module_colors";

const DEFAULT_PALETTE = [
  "#2563eb", "#059669", "#d97706", "#7c3aed",
  "#db2777", "#0891b2", "#ea580c", "#4f46e5",
  "#16a34a", "#dc2626", "#0284c7", "#9333ea",
  "#0d9488", "#ca8a04", "#be123c", "#4338ca",
];

const DEFAULT_PROJECT_COLORS: Record<string, string> = {
  "Super Team": "#3b82f6",
  "Winx Team": "#ec4899",
  "Integrity Team": "#10b981",
  "Team 1": "#f59e0b",
  "ODOO BUG PRODUCTION": "#64748b",
  "HRWs APP - RELEASE": "#8b5cf6",
  "HRWs - RELEASE CHECKLIST": "#06b6d4",
};

const TEAM_ROW_TINTS: Record<string, { bg: string; border: string }> = {
  "Super Team": { bg: "#f0f7ff", border: "#3b82f6" },
  "Winx Team": { bg: "#fdf2f8", border: "#ec4899" },
  "Integrity Team": { bg: "#f0fdf4", border: "#10b981" },
  "Team 1": { bg: "#fffbeb", border: "#f59e0b" },
  "ODOO BUG PRODUCTION": { bg: "#f8fafc", border: "#64748b" },
  "HRWs APP - RELEASE": { bg: "#faf5ff", border: "#8b5cf6" },
  "HRWs - RELEASE CHECKLIST": { bg: "#ecfeff", border: "#06b6d4" },
};

const TEAM_PALETTE = [
  { bg: "#eff6ff", border: "#3b82f6" },
  { bg: "#fdf2f8", border: "#ec4899" },
  { bg: "#f0fdf4", border: "#10b981" },
  { bg: "#fffbeb", border: "#f59e0b" },
  { bg: "#f5f3ff", border: "#8b5cf6" },
  { bg: "#ecfeff", border: "#06b6d4" },
];

export function getTeamRowVars(projectOrTeam?: string | null): { bg: string; bgDark: string; border: string } {
  const key = String(projectOrTeam || "").trim();
  if (!key) return { bg: "var(--panel)", bgDark: "var(--panel)", border: "var(--line)" };
  const customMap = loadProjectColors();
  // Kiểm tra custom color user tự đổi trong Cài đặt
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(PROJ_COLOR_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed[key] && /^#[0-9a-f]{6}$/i.test(parsed[key])) {
          return { bg: `${parsed[key]}14`, bgDark: `${parsed[key]}24`, border: parsed[key] };
        }
      }
    } catch { /* ignore */ }
  }
  for (const [k, v] of Object.entries(TEAM_ROW_TINTS)) {
    if (key.toLowerCase().includes(k.toLowerCase())) {
      return { bg: v.bg, bgDark: `${v.border}24`, border: v.border };
    }
  }
  if (customMap[key] && /^#[0-9a-f]{6}$/i.test(customMap[key])) {
    return { bg: `${customMap[key]}14`, bgDark: `${customMap[key]}24`, border: customMap[key] };
  }
  const c = TEAM_PALETTE[hashCode(key) % TEAM_PALETTE.length];
  return { bg: c.bg, bgDark: `${c.border}24`, border: c.border };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function getTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return "light";
}

export function setTheme(mode: "light" | "dark"): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_KEY, mode);
  document.documentElement.dataset.theme = mode;
}

export function loadProjectColors(): Record<string, string> {
  if (typeof window === "undefined") return { ...DEFAULT_PROJECT_COLORS };
  try {
    const raw = window.localStorage.getItem(PROJ_COLOR_KEY);
    return raw ? { ...DEFAULT_PROJECT_COLORS, ...JSON.parse(raw) } : { ...DEFAULT_PROJECT_COLORS };
  } catch {
    return { ...DEFAULT_PROJECT_COLORS };
  }
}

export function saveProjectColor(name: string, color: string): void {
  if (typeof window === "undefined") return;
  const map = loadProjectColors();
  map[name] = color;
  window.localStorage.setItem(PROJ_COLOR_KEY, JSON.stringify(map));
}

export function getProjectColor(name: string): string {
  if (!name) return "#64748b";
  const map = loadProjectColors();
  if (map[name]) return map[name];
  for (const [k, v] of Object.entries(map)) {
    if (name.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return DEFAULT_PALETTE[hashCode(name) % 4];
}

const DEFAULT_MODULE_COLORS: Record<string, string> = {
  "4RUM": "#e11d48",
  ACC: "#2563eb",
  ACCOUNT: "#2563eb",
  ANNOUN: "#dc2626",
  BONUS: "#d97706",
  BOOKING: "#0d9488",
  BOSS: "#1e293b",
  BUDGET: "#15803d",
  CHAT: "#7c3aed",
  ZUIZUI: "#7c3aed",
  CHECK: "#0284c7",
  CHECKLIST: "#0891b2",
  COMMON: "#475569",
  CUS: "#db2777",
  DELP: "#ea580c",
  DEPL: "#ea580c",
  DRIVE: "#4f46e5",
  DV5S: "#ca8a04",
  EFORM: "#9333ea",
  ESIGN: "#be123c",
  FILE: "#0f766e",
  HOME: "#0369a1",
  HRM: "#059669",
  HR: "#059669",
  "HRWS DIS": "#6d28d9",
  IOT: "#b45309",
  LISTEN: "#c026d3",
  LND: "#16a34a",
  MAIL: "#0e7490",
  MAINT: "#b91c1c",
  NEWS: "#a21caf",
  NPS: "#65a30d",
  QC: "#1d4ed8",
  REC: "#ec4899",
  RISK: "#991b1b",
  SAL: "#047857",
  SCM: "#c2410c",
  SHIFT: "#4338ca",
  SMART: "#06b6d4",
  TASK: "#3b82f6",
  VHST: "#854d0e",
};

const SKIP_PREFIX_TAGS = new Set([
  "BUG", "QC", "WEB", "APP", "MOBILE", "IOS", "ANDROID",
  "INTERNAL", "PRODUCTION", "STAGING", "BUILD", "RELEASE",
  "TATCA", "TẤT CẢ", "EH", "ODOO", "MINIAPP",
]);

export type ModuleDef = {
  id?: string;
  code: string;
  name: string;
  prefix?: string;
  color?: string;
  aliases?: string[];
  custom?: boolean;
};

export function loadModuleColors(): Record<string, string> {
  if (typeof window === "undefined") return { ...DEFAULT_MODULE_COLORS };
  try {
    const raw = window.localStorage.getItem(MOD_COLOR_KEY);
    return raw ? { ...DEFAULT_MODULE_COLORS, ...JSON.parse(raw) } : { ...DEFAULT_MODULE_COLORS };
  } catch {
    return { ...DEFAULT_MODULE_COLORS };
  }
}

export function saveModuleColor(code: string, color: string): void {
  if (typeof window === "undefined") return;
  const map = loadModuleColors();
  map[code.toUpperCase()] = color;
  window.localStorage.setItem(MOD_COLOR_KEY, JSON.stringify(map));
}

export function syncModuleColorsFromServer(items: ModuleDef[]): void {
  if (typeof window === "undefined" || !items.length) return;
  const map = loadModuleColors();
  let changed = false;
  for (const m of items) {
    if (m.code && m.color && /^#[0-9a-f]{6}$/i.test(m.color)) {
      const up = m.code.trim().toUpperCase();
      if (map[up] !== m.color) {
        map[up] = m.color;
        changed = true;
      }
    }
  }
  if (changed) {
    window.localStorage.setItem(MOD_COLOR_KEY, JSON.stringify(map));
  }
}

export function getModuleColor(code: string): string {
  if (!code) return "#64748b";
  const up = code.trim().toUpperCase();
  const map = loadModuleColors();
  if (map[up]) return map[up];
  return DEFAULT_PALETTE[hashCode(up) % DEFAULT_PALETTE.length];
}

/** Tự động trích xuất mã module từ tiền tố [TAG] của tiêu đề/mô tả bug hoặc task. */
export function extractModuleFromText(text: string, knownModules: ModuleDef[] = []): string {
  const firstLine = (text || "").split("\n")[0] || "";
  const tags = Array.from(firstLine.matchAll(/\[([^\]]{1,30})\]/g)).map((m) =>
    m[1].trim().toUpperCase().replace(/\s+/g, "")
  );
  if (!tags.length) return "";
  // Ưu tiên khớp chính xác với danh sách module đã cấu hình (code, prefix, aliases)
  if (knownModules.length > 0) {
    const lookup = new Map<string, string>();
    for (const mod of knownModules) {
      const c = mod.code.trim().toUpperCase();
      if (c) lookup.set(c, c);
      if (mod.prefix) lookup.set(mod.prefix.trim().toUpperCase(), c);
      for (const a of mod.aliases || []) {
        if (a) lookup.set(a.trim().toUpperCase(), c);
      }
    }
    for (const t of tags) {
      const hit = lookup.get(t);
      if (hit) return hit;
    }
  }
  // Fallback: lấy thẻ [TAG] đầu tiên không nằm trong danh sách thẻ chung (BUG, QC, WEB, APP, B12345...)
  for (const t of tags) {
    if (!t || SKIP_PREFIX_TAGS.has(t) || /^B\d{4,}$/.test(t)) continue;
    return t;
  }
  return "";
}

export function formatDateBadge(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/* ==================== Cấu hình Bé Pet QA ==================== */
export type PetColorPreset = "amber" | "peach" | "mint" | "sky" | "lavender" | "custom";

export const PET_COLOR_THEMES: Record<Exclude<PetColorPreset, "custom">, { label: string; body: string; ear: string; accent: string }> = {
  amber: { label: "Vàng hổ phách", body: "#fde68a", ear: "#f59e0b", accent: "#b45309" },
  peach: { label: "Hồng đào", body: "#fecdd3", ear: "#fb7185", accent: "#be123c" },
  mint: { label: "Xanh mint", body: "#a7f3d0", ear: "#10b981", accent: "#047857" },
  sky: { label: "Xanh dương", body: "#bae6fd", ear: "#0ea5e9", accent: "#0369a1" },
  lavender: { label: "Tím lavender", body: "#ddd6fe", ear: "#8b5cf6", accent: "#6d28d9" },
};

export type PetConfig = {
  visible: boolean;
  name: string;
  color: PetColorPreset;
  customHex: string;
  reminderEnabled: boolean;
  reminderTimes: string[];
  alertUncheckedBug: boolean;
  alertMentions: boolean;
  pollSec: number;
};

const PET_CFG_KEY = "qc_pet_config";

export const DEFAULT_PET_CONFIG: PetConfig = {
  visible: true,
  name: "Bé Mèo QC",
  color: "amber",
  customHex: "#fde68a",
  reminderEnabled: true,
  reminderTimes: ["09:00", "16:30"],
  alertUncheckedBug: true,
  alertMentions: true,
  pollSec: 45,
};

export function loadPetConfig(): PetConfig {
  if (typeof window === "undefined") return { ...DEFAULT_PET_CONFIG };
  try {
    const raw = window.localStorage.getItem(PET_CFG_KEY);
    if (!raw) return { ...DEFAULT_PET_CONFIG };
    const parsed = JSON.parse(raw) as Partial<PetConfig>;
    return {
      ...DEFAULT_PET_CONFIG,
      ...parsed,
      reminderTimes: Array.isArray(parsed.reminderTimes) && parsed.reminderTimes.length ? parsed.reminderTimes : DEFAULT_PET_CONFIG.reminderTimes,
    };
  } catch {
    return { ...DEFAULT_PET_CONFIG };
  }
}

export function savePetConfig(cfg: PetConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PET_CFG_KEY, JSON.stringify(cfg));
  window.dispatchEvent(new CustomEvent("qc:pet-config", { detail: cfg }));
}

export function resolvePetColors(cfg: PetConfig): { body: string; ear: string; accent: string } {
  if (cfg.color === "custom" && /^#[0-9a-f]{6}$/i.test(cfg.customHex || "")) {
    return { body: cfg.customHex, ear: cfg.customHex, accent: "#334155" };
  }
  const preset = PET_COLOR_THEMES[cfg.color === "custom" ? "amber" : cfg.color] || PET_COLOR_THEMES.amber;
  return { body: preset.body, ear: preset.ear, accent: preset.accent };
}
