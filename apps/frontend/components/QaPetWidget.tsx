"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, clearStoredApiError, readStoredApiErrors, type ApiErrorEventDetail } from "@/lib/api";
import {
  DEFAULT_PET_CONFIG,
  formatDateBadge,
  getModuleColor,
  loadPetConfig,
  resolvePetColors,
  type PetConfig,
} from "@/lib/ui-prefs";

export type HwNotiItem = {
  id: string;
  title: string;
  content: string;
  module_name: string;
  actor: string;
  link: string;
  task_id: string;
  created_at: string;
  is_read: boolean;
  is_mention: boolean;
};

type UncheckedBug = {
  id: string;
  external_id: string;
  title: string;
  module: string;
  project: string;
  url: string;
  created_at: string;
  age_minutes: number;
};

export type PetPulse = {
  new_bugs_count: number;
  latest_bug_at: string;
  unchecked_bugs: UncheckedBug[];
  notifications: {
    connected: boolean;
    error: string;
    items: HwNotiItem[];
    unread_count: number;
    synced_at: string;
  };
  mentions: HwNotiItem[];
  missing_integrations?: string[];
  integration_states?: {
    haraworks?: "active" | "missing" | "expired" | "error" | "unchecked";
    gemini?: "active" | "missing" | "expired" | "error" | "unchecked";
    anthropic?: "active" | "missing" | "expired" | "error" | "unchecked";
    ai?: "active" | "missing" | "expired" | "error" | "unchecked";
    figma?: "active" | "missing" | "expired" | "error" | "unchecked";
  };
  integration_details?: Record<string, { label: string; state: string; state_label: string; detail: string; checked_at?: string | null }>;
  data_health?: {
    haraworks_notifications?: { ok: boolean; error: string | null };
    last_sync?: { ok: boolean; code: string | null; message: string | null; at: string | null };
  };
  daily_summary: {
    todo_today: number;
    overdue: number;
    due_today: number;
    need_approval?: number;
    incomplete_bugs: number;
  };
  checked_at: string;
};

type CatAction = "idle" | "typing" | "jump" | "sing";
const ACTIONS: CatAction[] = ["typing", "idle", "jump", "sing"];

const QC_QUIPS = [
  "Meow~ Dev bảo 'máy anh chạy bình thường' hả? Chụp màn hình gửi lại liền nha 😼",
  "Nhớ uống ngụm nước nha QC ơi, soi từng pixel nãy giờ mỏi mắt rồi đó 💧",
  "Hôm nay test nhẹ nhàng thôi, đừng làm dev khóc nhiều quá nha 😆",
  "Trước khi chốt 'không phải bug', ghé Tra cứu Rule check lại 1 phát cho chắc cú! 🔎",
  "Bé vừa gõ code giúp bạn... đùa thôi, bé chỉ biết bấm phím với kêu Meow~ 🐾",
  "Ơ kìa có bug nào quên điền Nền tảng hay Độ nghiêm trọng không? Để bé soi giùm cho 👀",
  "Bấm vào bé là bé hát cho nghe nè, còn bấm 'Đồng bộ' là kéo hết bug mới về liền! ✨",
  "Trời ơi QC chăm chỉ quá đi, nhớ nghỉ mắt 20 giây kẻo cận thêm độ đó nha 💚",
];

const ALERTED_KEYS_STORAGE = "qc_pet_alerted_keys";
const FIRED_REM_KEY = "qc_pet_fired_reminders";
const BUGS_LAST_SEEN_KEY = "qc_bugs_last_seen_at";
const PET_POS_KEY = "qc_pet_position";
const MENTION_WINDOW_MS = 30 * 60 * 1000; // 30 phút gần đây

function getStringSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const arr = JSON.parse(window.localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveStringSet(key: string, s: Set<string>): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(Array.from(s).slice(-500)));
}

function getVnDateTime(): { date: string; hhmm: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now);
  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { date, hhmm };
}

/** Phát tiếng "Meow!" dễ thương bằng Web Audio API. */
function playMeow(): void {
  if (typeof window === "undefined") return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = "triangle";
    osc2.type = "sine";
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1100, now);
    filter.Q.setValueAtTime(1.4, now);

    osc.frequency.setValueAtTime(560, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.13);
    osc.frequency.exponentialRampToValueAtTime(760, now + 0.28);
    osc.frequency.exponentialRampToValueAtTime(460, now + 0.44);

    osc2.frequency.setValueAtTime(1120, now);
    osc2.frequency.exponentialRampToValueAtTime(1840, now + 0.13);
    osc2.frequency.exponentialRampToValueAtTime(920, now + 0.44);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.14, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.28);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 0.48);
    osc2.stop(now + 0.48);
    osc.onended = () => void ctx.close();
  } catch { /* ignore */ }
}

type BubbleItem = {
  id: string;
  title: string;
  subtitle?: string;
  module?: string;
  url: string;
  createdAt?: string;
};

type ReportStats = {
  todoToday: number;
  overdue: number;
  dueToday: number;
  needApproval: number;
};

type BubbleState = {
  kind: "report" | "alert" | "quip" | "missing_key" | "integration_error" | "data_error";
  title: string;
  text?: string;
  stats?: ReportStats;
  items: BubbleItem[];
  missingKeys?: string[];
  focusKey?: string;
  issueFp?: string;
  issueLines?: string[];
};

const MISSING_LABELS: Record<string, string> = {
  ai: "Khóa AI (Gemini / Anthropic)",
  gemini: "Gemini API Key",
  anthropic: "Anthropic API Key",
  haraworks: "Cookie Haraworks",
  figma: "Token Figma",
};

type HealthDiagnostic = {
  fp: string;
  kind: "integration_error" | "data_error";
  title: string;
  text: string;
  lines: string[];
  focusKey: string;
  missingKeys: string[];
};

function buildHealthDiagnostic(
  pulseData: PetPulse | null,
  storedErrors: Record<string, ApiErrorEventDetail>,
  petName: string,
): HealthDiagnostic | null {
  const st = pulseData?.integration_states || {};
  const details = pulseData?.integration_details || {};
  const lines: string[] = [];
  const fpParts: string[] = [];
  const missingKeys: string[] = [];
  let focusKey = "";

  const hwSt = st.haraworks;
  if (hwSt && hwSt !== "active") {
    fpParts.push(`hw:${hwSt}`);
    missingKeys.push("haraworks");
    focusKey = focusKey || "haraworks";
    if (hwSt === "missing") {
      lines.push("• Cookie Haraworks: Chưa cấu hình nên chưa đồng bộ được bug & thông báo.");
    } else if (hwSt === "unchecked") {
      lines.push("• Cookie Haraworks: Đã lưu nhưng chưa kiểm tra trực tiếp.");
    } else if (hwSt === "expired") {
      lines.push(`• Cookie Haraworks đã hết hạn (${details.haraworks?.detail || "401/302"}), không tải được dữ liệu mới.`);
    } else {
      lines.push(`• Cookie Haraworks gặp lỗi (${details.haraworks?.detail || "không kết nối được"}).`);
    }
  }

  const gemSt = st.gemini;
  const antSt = st.anthropic;
  if (gemSt === "expired" || gemSt === "error") {
    fpParts.push(`gem:${gemSt}`);
    missingKeys.push("gemini");
    focusKey = focusKey || "gemini";
    lines.push(`• Gemini API Key: ${gemSt === "expired" ? "Hết hạn hoặc không hợp lệ" : "Gặp lỗi"} (${details.gemini?.detail || "401/403"}).`);
  }
  if (antSt === "expired" || antSt === "error") {
    fpParts.push(`ant:${antSt}`);
    missingKeys.push("anthropic");
    focusKey = focusKey || "anthropic";
    lines.push(`• Anthropic API Key: ${antSt === "expired" ? "Hết hạn hoặc không hợp lệ" : "Gặp lỗi"} (${details.anthropic?.detail || "401/403"}).`);
  }
  const hasWorkingAi = gemSt === "active" || antSt === "active";
  if (!hasWorkingAi && gemSt && antSt && gemSt !== "expired" && gemSt !== "error" && antSt !== "expired" && antSt !== "error") {
    fpParts.push(`ai:${gemSt}:${antSt}`);
    missingKeys.push("ai");
    focusKey = focusKey || "gemini";
    lines.push("• AI API Key (Gemini / Anthropic): Chưa cấu hình khóa hoạt động nên tính năng AI chưa chạy được.");
  }

  // Lỗi tải dữ liệu từ backend health hoặc Global API Error Bus
  const notiOk = pulseData?.data_health?.haraworks_notifications?.ok;
  const notiErr = pulseData?.data_health?.haraworks_notifications?.error || pulseData?.notifications?.error;
  if (pulseData && notiOk === false && notiErr && hwSt === "active") {
    fpParts.push(`noti_err:${notiErr.slice(0, 40)}`);
    lines.push(`• Không tải được thông báo Haraworks: ${notiErr}`);
  }
  const syncHealth = pulseData?.data_health?.last_sync;
  if (syncHealth && syncHealth.ok === false && syncHealth.message) {
    fpParts.push(`sync:${syncHealth.code || "ERR"}`);
    if (!focusKey && syncHealth.code === "HARAWORKS_AUTH") focusKey = "haraworks";
    lines.push(`• Lỗi đồng bộ Haraworks (${syncHealth.code || "ERR"}): ${syncHealth.message}`);
  }

  const storedList = Object.values(storedErrors || {});
  for (const err of storedList) {
    fpParts.push(`${err.key}:${err.code}`);
    if (err.code === "NO_COOKIE" || err.code === "HARAWORKS_AUTH") {
      if (!focusKey) focusKey = "haraworks";
      if (!lines.some((l) => l.includes("Cookie Haraworks"))) {
        lines.push(`• Cookie Haraworks lỗi khi gọi ${err.path}: ${err.message}`);
      }
    } else if (err.code === "NO_AI_PROVIDER" || err.code === "AI_AUTH") {
      if (!focusKey) focusKey = "gemini";
      if (!lines.some((l) => l.includes("AI"))) {
        lines.push(`• Lỗi AI API Key tại ${err.path}: ${err.message}`);
      }
    } else {
      lines.push(`• Không tải được dữ liệu (${err.path}, mã ${err.code}): ${err.message}`);
    }
  }

  if (lines.length === 0) return null;
  const isToken = missingKeys.length > 0 || storedList.some((e) => e.category === "token_or_key");
  return {
    fp: Array.from(new Set(fpParts)).sort().join("|"),
    kind: isToken ? "integration_error" : "data_error",
    title: isToken ? `🔑 ${petName}: Cần cập nhật Token / API Key` : `⚠️ ${petName}: Lỗi tải dữ liệu`,
    text: lines[0],
    lines,
    focusKey: focusKey || "haraworks",
    missingKeys,
  };
}

export function QaPetWidget({
  onPulseUpdate,
}: {
  onPulseUpdate?: (pulse: PetPulse) => void;
}) {
  const [cfg, setCfg] = useState<PetConfig>(DEFAULT_PET_CONFIG);
  const [pulse, setPulse] = useState<PetPulse | null>(null);
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const [popup, setPopup] = useState<BubbleState | null>(null);
  const [action, setAction] = useState<CatAction>("typing");
  const [meowFlash, setMeowFlash] = useState(false);

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [bubbleAlign, setBubbleAlign] = useState<{ horiz: "left" | "right"; vert: "above" | "below" }>({
    horiz: "right",
    vert: "above",
  });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number; moved: boolean } | null>(null);
  const quipIdxRef = useRef(0);
  const dismissedErrFpRef = useRef<string>("");
  const [storedErrors, setStoredErrors] = useState<Record<string, ApiErrorEventDetail>>({});
  const [rechecking, setRechecking] = useState(false);

  // Tự động chọn hướng hiển thị bong bóng để không bao giờ bị che khuất ở mép trái / mép trên màn hình
  const updateBubbleDirection = useCallback(() => {
    if (typeof window === "undefined" || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const horiz = rect.left < 320 ? "left" : "right";
    const vert = rect.top < 270 ? "below" : "above";
    setBubbleAlign({ horiz, vert });
  }, []);

  useEffect(() => {
    if (bubble) updateBubbleDirection();
  }, [bubble, offset, updateBubbleDirection]);

  useEffect(() => {
    setCfg(loadPetConfig());
    try {
      const savedPos = JSON.parse(window.localStorage.getItem(PET_POS_KEY) || "null");
      if (savedPos && typeof savedPos.x === "number" && typeof savedPos.y === "number") {
        setOffset(savedPos);
      }
    } catch { /* ignore */ }

    const onCfg = (ev: Event) => {
      const detail = (ev as CustomEvent<PetConfig>).detail;
      setCfg(detail || loadPetConfig());
    };
    window.addEventListener("qc:pet-config", onCfg);
    return () => window.removeEventListener("qc:pet-config", onCfg);
  }, []);

  // Tự động thay đổi hành động (bấm máy tính, thư giãn, nhảy, hát) mỗi 7 giây
  useEffect(() => {
    if (!cfg.visible) return;
    let idx = 0;
    const t = setInterval(() => {
      idx = (idx + 1) % ACTIONS.length;
      setAction(ACTIONS[idx]);
    }, 7000);
    return () => clearInterval(t);
  }, [cfg.visible]);

  // Tính cách vui nhộn: lâu lâu (mỗi ~95s) nói 1 câu trêu chọc QC hoặc nhắc nhẹ nếu thiếu token / API key AI
  useEffect(() => {
    if (!cfg.visible) return;
    const t = setInterval(() => {
      setBubble((cur) => {
        if (cur) return cur; // Đang hiện cảnh báo/báo cáo thì không đè lên
        const missing = pulse?.missing_integrations || [];
        // Cứ 3 lượt thì 1 lượt nhắc nhẹ thiếu khóa tích hợp nếu đang thiếu
        if (missing.length > 0 && quipIdxRef.current % 3 === 2) {
          quipIdxRef.current += 1;
          const names = missing.map((k) => MISSING_LABELS[k] || k).join(", ");
          return {
            kind: "missing_key",
            title: `🔑 ${cfg.name} nhắc nhẹ`,
            text: `Bạn chưa cấu hình ${names} đó nha! Thêm vào để bé hỗ trợ đầy đủ hơn nè.`,
            items: [],
            missingKeys: missing,
          };
        }
        const msg = QC_QUIPS[quipIdxRef.current % QC_QUIPS.length];
        quipIdxRef.current += 1;
        setAction("sing");
        return {
          kind: "quip",
          title: `🐾 ${cfg.name}`,
          text: msg,
          items: [],
        };
      });
    }, 95_000);
    return () => clearInterval(t);
  }, [cfg.visible, cfg.name, pulse]);

  // Tự ẩn câu trêu chọc vui sau 9 giây cho đỡ vướng màn hình
  useEffect(() => {
    if (!bubble || bubble.kind !== "quip") return;
    const t = setTimeout(() => setBubble((cur) => (cur?.kind === "quip" ? null : cur)), 9000);
    return () => clearTimeout(t);
  }, [bubble]);

  // Đồng bộ các lỗi API đã ghi nhận từ localStorage & Global Error Bus
  useEffect(() => {
    setStoredErrors(readStoredApiErrors());
    const onApiErr = (ev: Event) => {
      const detail = (ev as CustomEvent<ApiErrorEventDetail>).detail;
      if (!detail) return;
      const next = readStoredApiErrors();
      setStoredErrors(next);
      // Nếu xuất hiện lỗi mới hoặc lỗi khác lần đã đóng tạm -> bật bong bóng ngay lập tức
      const diag = buildHealthDiagnostic(pulse, next, cfg.name);
      if (diag && dismissedErrFpRef.current !== diag.fp) {
        setAction("jump");
        setBubble({
          kind: diag.kind,
          title: diag.title,
          text: diag.lines.join("\n"),
          items: [],
          missingKeys: diag.missingKeys,
          focusKey: diag.focusKey,
          issueFp: diag.fp,
          issueLines: diag.lines,
        });
      }
    };
    const onApiOk = () => {
      setStoredErrors(readStoredApiErrors());
    };
    window.addEventListener("qc:api-error", onApiErr);
    window.addEventListener("qc:api-success", onApiOk);
    return () => {
      window.removeEventListener("qc:api-error", onApiErr);
      window.removeEventListener("qc:api-success", onApiOk);
    };
  }, [pulse, cfg.name]);

  const fetchPulse = useCallback(
    async (force = false) => {
      try {
        if (force) setRechecking(true);
        const since = typeof window !== "undefined" ? window.localStorage.getItem(BUGS_LAST_SEEN_KEY) || "" : "";
        const qs = new URLSearchParams();
        if (since) qs.set("since", since);
        if (force) qs.set("force", "true");
        const data = await api<PetPulse>(`/sources/pet-pulse?${qs.toString()}`);
        setPulse(data);
        onPulseUpdate?.(data);

        // Nếu trạng thái tích hợp trên server đã active -> xóa các lỗi tích hợp tương ứng trong localStorage
        const st = data.integration_states || {};
        if (st.haraworks === "active") clearStoredApiError("integ:haraworks");
        if (st.gemini === "active" || st.anthropic === "active") clearStoredApiError("integ:ai");
        const curStored = readStoredApiErrors();
        setStoredErrors(curStored);

        const diag = buildHealthDiagnostic(data, curStored, cfg.name);
        if (!diag) {
          dismissedErrFpRef.current = "";
        }

        const alerted = getStringSet(ALERTED_KEYS_STORAGE);
        const nowMs = Date.now();

        const freshBugs = cfg.alertUncheckedBug
          ? (data.unchecked_bugs || []).filter((b) => !alerted.has(`bug:${b.id}`))
          : [];

        const freshMentions = cfg.alertMentions
          ? (data.notifications?.items || []).filter((n) => {
              if (!n.is_mention || n.is_read) return false;
              if (alerted.has(`mention:${n.id}`)) return false;
              const ts = new Date(n.created_at).getTime();
              if (Number.isNaN(ts)) return false;
              return nowMs - ts >= 0 && nowMs - ts <= MENTION_WINDOW_MS;
            })
          : [];

        // Ưu tiên cao nhất: thiếu / hết hạn Token, AI Key hoặc lỗi tải dữ liệu (nhắc lại ngay khi vào hệ thống / F5)
        if (diag && dismissedErrFpRef.current !== diag.fp) {
          setAction("jump");
          setBubble({
            kind: diag.kind,
            title: diag.title,
            text: diag.lines.join("\n"),
            items: [],
            missingKeys: diag.missingKeys,
            focusKey: diag.focusKey,
            issueFp: diag.fp,
            issueLines: diag.lines,
          });
        } else if (freshBugs.length > 0) {
          for (const b of freshBugs) alerted.add(`bug:${b.id}`);
          saveStringSet(ALERTED_KEYS_STORAGE, alerted);
          setAction("jump");
          setBubble({
            kind: "alert",
            title: `🚨 Bug mới gán chưa check (${freshBugs.length})`,
            text:
              freshBugs.length === 1
                ? freshBugs[0].title.slice(0, 110)
                : `Có ${freshBugs.length} bug mới gán cho bạn quá 1 phút chưa check!`,
            items: freshBugs.map((b) => ({
              id: b.id,
              title: b.title,
              subtitle: `Chưa check · ${b.age_minutes} phút${b.project ? ` · ${b.project}` : ""}`,
              module: b.module,
              url: b.url,
              createdAt: b.created_at,
            })),
          });
        } else if (freshMentions.length > 0) {
          for (const m of freshMentions) alerted.add(`mention:${m.id}`);
          saveStringSet(ALERTED_KEYS_STORAGE, alerted);
          setAction("jump");
          setBubble({
            kind: "alert",
            title: `💬 Nhắc đến bạn (${freshMentions.length})`,
            text:
              freshMentions.length === 1
                ? `${freshMentions[0].actor ? `${freshMentions[0].actor}: ` : ""}${freshMentions[0].title || freshMentions[0].content}`.slice(0, 115)
                : `Có ${freshMentions.length} bình luận nhắc đến bạn trong 30 phút gần đây!`,
            items: freshMentions.map((m) => ({
              id: m.id,
              title: m.title || m.content,
              subtitle: [m.actor, m.content && m.title ? m.content : ""].filter(Boolean).join(" — "),
              module: m.module_name,
              url: m.link,
              createdAt: m.created_at,
            })),
          });
        } else if (!diag) {
          setBubble((cur) => (cur && (cur.kind === "integration_error" || cur.kind === "data_error" || cur.kind === "missing_key") ? null : cur));
        }
      } catch (err) {
        const nextStored = readStoredApiErrors();
        setStoredErrors(nextStored);
        const msg = err instanceof Error ? err.message : "Không thể kiểm tra dữ liệu hệ thống";
        const diag = buildHealthDiagnostic(pulse, nextStored, cfg.name) || {
          fp: "pulse_unreachable",
          kind: "data_error" as const,
          title: `⚠️ ${cfg.name}: Lỗi kết nối dữ liệu`,
          text: msg,
          lines: [`• Không tải được trạng thái hệ thống (${msg}).`],
          focusKey: "haraworks",
          missingKeys: [],
        };
        if (dismissedErrFpRef.current !== diag.fp) {
          setBubble({
            kind: diag.kind,
            title: diag.title,
            text: diag.lines.join("\n"),
            items: [],
            missingKeys: diag.missingKeys,
            focusKey: diag.focusKey,
            issueFp: diag.fp,
            issueLines: diag.lines,
          });
        }
      } finally {
        if (force) setRechecking(false);
      }
    },
    [cfg.alertMentions, cfg.alertUncheckedBug, cfg.name, onPulseUpdate, pulse]
  );

  useEffect(() => {
    void fetchPulse(false);
    const ms = Math.max(15, cfg.pollSec || 45) * 1000;
    const timer = setInterval(() => void fetchPulse(false), ms);
    const onSynced = () => void fetchPulse(true);
    window.addEventListener("qc:synced", onSynced);
    return () => {
      clearInterval(timer);
      window.removeEventListener("qc:synced", onSynced);
    };
  }, [fetchPulse, cfg.pollSec]);

  // Báo cáo hằng ngày đúng mốc giờ đã cài đặt (đồng nhất 100% số liệu với Dashboard)
  useEffect(() => {
    if (!cfg.reminderEnabled || !cfg.reminderTimes.length) return;
    const checkSchedule = () => {
      const { date, hhmm } = getVnDateTime();
      if (!cfg.reminderTimes.includes(hhmm)) return;
      const fireKey = `${date}_${hhmm}`;
      let fired: Record<string, boolean> = {};
      try {
        fired = JSON.parse(window.localStorage.getItem(FIRED_REM_KEY) || "{}") || {};
      } catch {
        fired = {};
      }
      if (fired[fireKey]) return;
      fired[fireKey] = true;
      window.localStorage.setItem(FIRED_REM_KEY, JSON.stringify(fired));
      const s = pulse?.daily_summary;
      setAction("sing");
      setBubble({
        kind: "report",
        title: `⏰ Báo cáo hằng ngày (${hhmm})`,
        stats: {
          todoToday: s?.todo_today ?? 0,
          overdue: s?.overdue ?? 0,
          dueToday: s?.due_today ?? 0,
          needApproval: s?.need_approval ?? 0,
        },
        missingKeys: pulse?.missing_integrations || [],
        items: [],
      });
    };
    checkSchedule();
    const t = setInterval(checkSchedule, 25_000);
    return () => clearInterval(t);
  }, [cfg.reminderEnabled, cfg.reminderTimes, pulse]);

  const colors = resolvePetColors(cfg);
  const activeDiag = buildHealthDiagnostic(pulse, storedErrors, cfg.name);
  if (!cfg.visible && !popup && !activeDiag) return null;

  return (
    <>
      {!cfg.visible && activeDiag && (
        <Link
          href={`/settings?tab=integrations&focus=${encodeURIComponent(activeDiag.focusKey)}`}
          className="qa-pet-widget"
          style={{
            background: "var(--panel)",
            border: "1.5px solid var(--bad)",
            color: "var(--bad)",
            borderRadius: 999,
            padding: "8px 14px",
            fontSize: 12.5,
            fontWeight: 600,
            textDecoration: "none",
            boxShadow: "0 6px 20px rgba(0,0,0,0.14)",
          }}
          title={activeDiag.lines.join("\n")}
        >
          {activeDiag.kind === "integration_error" ? "🔑 Thiếu/hết hạn Token · Cài đặt →" : "⚠️ Lỗi tải dữ liệu · Kiểm tra →"}
        </Link>
      )}
      {cfg.visible && (
        <div className="qa-pet-widget" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}>
          {bubble && (
            <div
              className={`qa-pet-bubble align-${bubbleAlign.horiz} pos-${bubbleAlign.vert}`}
              role="status"
              style={{ borderColor: (bubble.kind === "integration_error" || bubble.kind === "data_error") ? "var(--bad)" : colors.ear }}
            >
              <div className="qa-pet-bubble-head" style={{ color: (bubble.kind === "integration_error" || bubble.kind === "data_error") ? "var(--bad)" : colors.accent }}>
                <span>{bubble.title}</span>
                <button
                  type="button"
                  onClick={() => {
                    if (bubble.issueFp) dismissedErrFpRef.current = bubble.issueFp;
                    setBubble(null);
                  }}
                  aria-label="Đóng"
                  style={{ border: 0, background: "transparent", cursor: "pointer", padding: "0 2px", fontSize: 12, color: "var(--muted)" }}
                >
                  ✕
                </button>
              </div>

              {bubble.text && (
                <div className="qa-pet-bubble-text" style={{ whiteSpace: "pre-line" }}>
                  {bubble.text}
                </div>
              )}

              {/* Các chỉ số báo cáo có màu tách biệt rõ ràng (đồng nhất 100% với Dashboard) */}
              {bubble.stats && (
                <div className="pet-stat-grid">
                  <div className="pet-stat-pill" style={{ background: "#eff6ff", color: "#1d4ed8", borderColor: "#bfdbfe" }}>
                    <span>Cần làm hôm nay</span>
                    <strong>{bubble.stats.todoToday}</strong>
                  </div>
                  <div className="pet-stat-pill" style={{ background: "#fef2f2", color: "#dc2626", borderColor: "#fecaca" }}>
                    <span>Đã trễ</span>
                    <strong>{bubble.stats.overdue}</strong>
                  </div>
                  <div className="pet-stat-pill" style={{ background: "#fffbeb", color: "#d97706", borderColor: "#fde68a" }}>
                    <span>Hạn hôm nay</span>
                    <strong>{bubble.stats.dueToday}</strong>
                  </div>
                  <div className="pet-stat-pill" style={{ background: "#f5f3ff", color: "#7c3aed", borderColor: "#ddd6fe" }}>
                    <span>Cần duyệt</span>
                    <strong>{bubble.stats.needApproval}</strong>
                  </div>
                </div>
              )}

              {/* Nhắc nhẹ nếu thiếu Token / API Key AI */}
              {bubble.missingKeys && bubble.missingKeys.length > 0 && bubble.kind === "report" && (
                <div className="pet-missing-hint">
                  🔑 Thiếu/lỗi: {bubble.missingKeys.map((k) => MISSING_LABELS[k] || k).join(", ")}.{" "}
                  <Link href="/settings?tab=integrations" onClick={() => setBubble(null)}>
                    Cài đặt →
                  </Link>
                </div>
              )}

              <div className="qa-pet-bubble-actions">
                {bubble.kind === "report" && (
                  <Link href="/overview" className="btn sm primary" onClick={() => setBubble(null)}>
                    Mở Dashboard
                  </Link>
                )}
                {(bubble.kind === "missing_key" || bubble.kind === "integration_error" || bubble.kind === "data_error") && (
                  <>
                    <Link
                      href={`/settings?tab=integrations${bubble.focusKey ? `&focus=${encodeURIComponent(bubble.focusKey)}` : ""}`}
                      className="btn sm primary"
                      onClick={() => setBubble(null)}
                    >
                      Cập nhật tại Cài đặt →
                    </Link>
                    <button
                      type="button"
                      className="sm"
                      disabled={rechecking}
                      onClick={() => {
                        dismissedErrFpRef.current = "";
                        void fetchPulse(true);
                      }}
                    >
                      {rechecking ? "Đang kiểm tra…" : "Thử kiểm tra lại"}
                    </button>
                  </>
                )}
                {bubble.kind === "alert" && bubble.items.length === 1 && bubble.items[0].url && (
                  <a
                    href={bubble.items[0].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn sm primary"
                    onClick={() => setBubble(null)}
                  >
                    Mở task
                  </a>
                )}
                {bubble.kind === "alert" && bubble.items.length > 1 && (
                  <button
                    type="button"
                    className="sm primary"
                    onClick={() => {
                      setPopup(bubble);
                      setBubble(null);
                    }}
                  >
                    Xem danh sách ({bubble.items.length})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bé Mèo QC toàn thân — kéo thả tự do, bấm kêu Meow~ & hiện báo cáo đồng nhất Dashboard */}
          <div
            ref={stageRef}
            className={`qa-pet-stage cat-act-${action}${bubble?.kind === "alert" ? " has-alert" : ""}`}
            title={`${cfg.name} — Kéo để di chuyển · Bấm để nghe Meow~ & xem báo cáo nhanh`}
            onPointerDown={(e) => {
              dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y, moved: false };
              (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dx = e.clientX - dragRef.current.startX;
              const dy = e.clientY - dragRef.current.startY;
              if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
              if (dragRef.current.moved) {
                setOffset({ x: dragRef.current.ox + dx, y: dragRef.current.oy + dy });
              }
            }}
            onPointerUp={() => {
              const wasMoved = dragRef.current?.moved;
              dragRef.current = null;
              if (wasMoved) {
                try {
                  window.localStorage.setItem(PET_POS_KEY, JSON.stringify(offset));
                } catch { /* ignore */ }
              } else {
                playMeow();
                setMeowFlash(true);
                setTimeout(() => setMeowFlash(false), 900);
                setAction((prev) => ACTIONS[(ACTIONS.indexOf(prev) + 1) % ACTIONS.length]);
                const s = pulse?.daily_summary;
                setBubble({
                  kind: "report",
                  title: `🐾 ${cfg.name} báo cáo nhanh`,
                  stats: {
                    todoToday: s?.todo_today ?? 0,
                    overdue: s?.overdue ?? 0,
                    dueToday: s?.due_today ?? 0,
                    needApproval: s?.need_approval ?? 0,
                  },
                  missingKeys: pulse?.missing_integrations || [],
                  items: [],
                });
              }
            }}
          >
            {meowFlash && (
              <span
                style={{
                  position: "absolute",
                  top: -14,
                  left: 0,
                  fontSize: 11,
                  fontWeight: 700,
                  color: colors.accent,
                  background: "var(--panel)",
                  border: `1px solid ${colors.ear}`,
                  borderRadius: 999,
                  padding: "1px 6px",
                  pointerEvents: "none",
                }}
              >
                Meow~
              </span>
            )}
            <svg width="82" height="82" viewBox="0 0 80 80" className="qa-pet-svg" aria-hidden="true">
              {action === "sing" && (
                <g fill={colors.accent} fontSize="11" fontWeight="700">
                  <text x="60" y="18" className="cat-note-1">♪</text>
                  <text x="10" y="20" className="cat-note-2">♫</text>
                </g>
              )}
              {action === "jump" && (
                <g fill={colors.ear} fontSize="10">
                  <text x="6" y="22">✦</text>
                  <text x="66" y="20">✦</text>
                </g>
              )}
              <path className="cat-tail" d="M54 58 Q70 54 67 40 Q65 34 60 37" fill="none" stroke={colors.accent} strokeWidth="4.2" strokeLinecap="round" />
              <path className="cat-tail" d="M54 58 Q70 54 67 40 Q65 34 60 37" fill="none" stroke={colors.body} strokeWidth="2.4" strokeLinecap="round" />
              <ellipse cx="40" cy="57" rx="18" ry="15" fill={colors.body} stroke={colors.accent} strokeWidth="2.2" />
              <ellipse cx="40" cy="59" rx="10" ry="9" fill="#ffffff" opacity="0.65" />
              <ellipse cx="29" cy="69" rx="5.5" ry="3.6" fill={colors.body} stroke={colors.accent} strokeWidth="2" />
              <ellipse cx="51" cy="69" rx="5.5" ry="3.6" fill={colors.body} stroke={colors.accent} strokeWidth="2" />
              <path d="M23 26 L19 10 L34 19 Z" fill={colors.body} stroke={colors.accent} strokeWidth="2.2" strokeLinejoin="round" />
              <path d="M57 26 L61 10 L46 19 Z" fill={colors.body} stroke={colors.accent} strokeWidth="2.2" strokeLinejoin="round" />
              <path d="M24 23 L22 14 L31 19 Z" fill={colors.ear} opacity="0.55" />
              <path d="M56 23 L58 14 L49 19 Z" fill={colors.ear} opacity="0.55" />
              <ellipse cx="40" cy="31" rx="20" ry="17" fill={colors.body} stroke={colors.accent} strokeWidth="2.2" />
              <ellipse cx="27" cy="35" rx="3.8" ry="2.2" fill="#fb7185" opacity="0.5" />
              <ellipse cx="53" cy="35" rx="3.8" ry="2.2" fill="#fb7185" opacity="0.5" />
              {action === "jump" || action === "sing" ? (
                <g fill="none" stroke="#1e293b" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M29 31 Q32 27 35 31" />
                  <path d="M45 31 Q48 27 51 31" />
                </g>
              ) : (
                <g>
                  <circle cx="32" cy="30" r="2.8" fill="#1e293b" />
                  <circle cx="48" cy="30" r="2.8" fill="#1e293b" />
                  <circle cx="33" cy="29" r="0.9" fill="#ffffff" />
                  <circle cx="49" cy="29" r="0.9" fill="#ffffff" />
                </g>
              )}
              <polygon points="40,33 37.8,35.5 42.2,35.5" fill={colors.accent} />
              {action === "sing" ? (
                <circle cx="40" cy="39.5" r="2.6" fill="#fb7185" stroke={colors.accent} strokeWidth="1.5" />
              ) : (
                <path d="M35.5 38 Q40 41.5 44.5 38" fill="none" stroke={colors.accent} strokeWidth="1.8" strokeLinecap="round" />
              )}
              <line x1="17" y1="31" x2="24" y2="32" stroke={colors.accent} strokeWidth="1.4" strokeLinecap="round" />
              <line x1="17" y1="35" x2="24" y2="35" stroke={colors.accent} strokeWidth="1.4" strokeLinecap="round" />
              <line x1="63" y1="31" x2="56" y2="32" stroke={colors.accent} strokeWidth="1.4" strokeLinecap="round" />
              <line x1="63" y1="35" x2="56" y2="35" stroke={colors.accent} strokeWidth="1.4" strokeLinecap="round" />
              {action === "typing" ? (
                <g>
                  <rect x="26" y="54" width="28" height="16" rx="2.5" fill="#334155" stroke="#0f172a" strokeWidth="1.5" />
                  <rect x="28.5" y="56.5" width="23" height="10.5" rx="1.2" fill="#38bdf8" opacity="0.85" />
                  <rect x="22" y="69" width="36" height="3.5" rx="1.5" fill="#64748b" />
                  <ellipse cx="32" cy="56" rx="3.8" ry="3" fill={colors.body} stroke={colors.accent} strokeWidth="1.8" className="cat-paw-l" />
                  <ellipse cx="48" cy="56" rx="3.8" ry="3" fill={colors.body} stroke={colors.accent} strokeWidth="1.8" className="cat-paw-r" />
                </g>
              ) : action === "jump" ? (
                <g>
                  <ellipse cx="22" cy="48" rx="4" ry="3.2" fill={colors.body} stroke={colors.accent} strokeWidth="1.8" transform="rotate(-35 22 48)" />
                  <ellipse cx="58" cy="48" rx="4" ry="3.2" fill={colors.body} stroke={colors.accent} strokeWidth="1.8" transform="rotate(35 58 48)" />
                </g>
              ) : (
                <g>
                  <ellipse cx="30" cy="56" rx="4" ry="3.2" fill={colors.body} stroke={colors.accent} strokeWidth="1.8" />
                  <ellipse cx="50" cy="56" rx="4" ry="3.2" fill={colors.body} stroke={colors.accent} strokeWidth="1.8" />
                </g>
              )}
            </svg>
          </div>
        </div>
      )}

      {/* Popup danh sách nhiều task được nhắc đến / bug mới chưa check */}
      {popup && (
        <div className="modal-backdrop" onClick={() => setPopup(null)} role="dialog" aria-modal="true" aria-label={popup.title}>
          <div className="modal-box" style={{ maxWidth: 560, width: "92vw" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{popup.title}</strong>
              <button type="button" className="sm" onClick={() => setPopup(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {popup.items.map((it) => {
                const mc = it.module ? getModuleColor(it.module) : "";
                return (
                  <a
                    key={it.id}
                    href={it.url || "#"}
                    target={it.url ? "_blank" : undefined}
                    rel="noopener noreferrer"
                    onClick={() => setPopup(null)}
                    style={{
                      display: "block",
                      padding: "10px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--line)",
                      background: "var(--panel)",
                      color: "var(--text)",
                      textDecoration: "none",
                    }}
                  >
                    <div className="row" style={{ justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                      {it.module && (
                        <span className="badge" style={{ background: `${mc}18`, color: mc, borderColor: `${mc}55`, fontWeight: 600 }}>
                          {it.module}
                        </span>
                      )}
                      {it.createdAt && <span className="muted" style={{ fontSize: 11.5 }}>{formatDateBadge(it.createdAt)}</span>}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{it.title}</div>
                    {it.subtitle && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{it.subtitle}</div>}
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
