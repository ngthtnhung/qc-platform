"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { TaskDrawer, type DrawerTask } from "@/components/TaskDrawer";
import { formatDateBadge, getModuleColor, getTeamRowVars } from "@/lib/ui-prefs";

type SubTab = "kanban" | "gantt" | "charts" | "personal";

type DashTask = {
  uid: string;
  kind: "bug" | "function" | "release";
  external_id: string;
  title: string;
  module: string;
  project: string;
  status: number | null;
  status_label: string;
  closed: boolean;
  priority: number | null;
  priority_label: string;
  assignee: string;
  approver: string;
  role: "assignee" | "approver";
  is_assignee: boolean;
  is_approver: boolean;
  plan_start_at: string;
  plan_end_at: string;
  created_at: string;
  updated_at: string;
  url: string;
  missing_fields: string[];
  source_team?: string;
  source_function?: { id: string; title: string; url: string } | null;
};

type TodoItem = {
  id: string;
  text: string;
  dueDate: string;
  done: boolean;
  linkedTask?: { kind: string; title: string; url?: string } | null;
  createdAt: string;
};

type NoteItem = {
  id: string;
  title: string;
  content: string;
  linkedTask?: { kind: string; title: string; url?: string } | null;
  updatedAt: string;
};

/** Ngày theo giờ Việt Nam (YYYY-MM-DD) */
function vnDateStr(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
}

function todayVnStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
}

/** Màu theo 5 trạng thái chuẩn Haraworks */
function statusBarColor(status: number | null): string {
  if (status === 1) return "#3b82f6"; // Đang thực hiện
  if (status === 2 || status === 3 || status === 6) return "#f59e0b"; // Tạm ngưng / Chờ duyệt
  if (status === 4 || status === 10 || status === 11) return "#e11d48"; // Từ chối
  if (status === 5) return "#10b981"; // Hoàn thành
  return "#64748b"; // Mới
}

function toDrawer(t: DashTask): DrawerTask {
  return {
    kind: t.kind === "release" ? "build" : t.kind,
    externalId: t.external_id,
    title: t.title,
    moduleCode: t.module,
    project: t.project,
    team: t.project,
    sourceTeam: t.source_team,
    sourceFunction: t.source_function,
    statusLabel: t.status_label,
    priorityLabel: t.priority_label,
    assignee: t.assignee,
    approver: t.approver,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    closed: t.closed,
    url: t.url,
  };
}

function DonutChart({ slices, total }: { slices: { label: string; value: number; color: string }[]; total: number }) {
  const safeTotal = total || 1;
  let acc = 0;
  const stops = slices
    .filter((s) => s.value > 0)
    .map((s) => {
      const start = (acc / safeTotal) * 360;
      acc += s.value;
      const end = (acc / safeTotal) * 360;
      return `${s.color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
    });
  const bg = stops.length ? `conic-gradient(${stops.join(", ")})` : "var(--panel-alt)";

  return (
    <div className="donut-wrap">
      <div className="donut-ring" style={{ background: bg }}>
        <div className="donut-hole">{total}</div>
      </div>
      <div className="legend-list">
        {slices.map((s) => (
          <div key={s.label} className="legend-row">
            <span className="row" style={{ gap: 6 }}>
              <span className="legend-dot" style={{ background: s.color }} />
              <span>{s.label}</span>
            </span>
            <strong>{s.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const [subtab, setSubtab] = useState<SubTab>("kanban");
  const [tasks, setTasks] = useState<DashTask[]>([]);
  const [selected, setSelected] = useState<DrawerTask | null>(null);

  // Bộ lọc thời gian chung mặc định Tuần này + 3 dropdown còn lại (không có checkbox Chỉ task của tôi)
  const [q, setQ] = useState("");
  const [timeRange, setTimeRange] = useState<"week" | "month" | "30d" | "2026" | "all">("week");
  const [projectFilter, setProjectFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "bug" | "function" | "release">("");
  const [alertFilter, setAlertFilter] = useState<"" | "overdue" | "dueToday" | "missing" | "new24h">("");
  const [kpiModal, setKpiModal] = useState<{ title: string; items: DashTask[] } | null>(null);

  // Personal Todo & Notes
  const todoKey = `qc_personal_todos_v2_${user?.id || "me"}`;
  const notesKey = `qc_personal_notes_v2_${user?.id || "me"}`;
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [todoText, setTodoText] = useState("");
  const [todoDue, setTodoDue] = useState("");
  const [todoLinked, setTodoLinked] = useState<{ kind: string; title: string; url?: string } | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteLinked, setNoteLinked] = useState<{ kind: string; title: string; url?: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<"todo" | "note" | null>(null);
  const [pickerQ, setPickerQ] = useState("");
  const [loadErr, setLoadErr] = useState("");

  const loadData = useCallback(() => {
    api<{ items: DashTask[] }>("/sources/dashboard")
      .then((r) => { setLoadErr(""); setTasks(r.items || []); })
      .catch((err) => setLoadErr(err instanceof Error ? err.message : "Không tải được dữ liệu Tổng quan"));
  }, []);

  useEffect(loadData, [loadData]);
  useEffect(() => {
    window.addEventListener("qc:synced", loadData);
    return () => window.removeEventListener("qc:synced", loadData);
  }, [loadData]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const tRaw = window.localStorage.getItem(todoKey);
      if (tRaw) setTodos(JSON.parse(tRaw));
      const nRaw = window.localStorage.getItem(notesKey);
      if (nRaw) setNotes(JSON.parse(nRaw));
    } catch { /* ignore */ }
  }, [todoKey, notesKey]);

  function persistTodos(next: TodoItem[]) {
    setTodos(next);
    try { window.localStorage.setItem(todoKey, JSON.stringify(next)); } catch { /* ignore */ }
  }
  function persistNotes(next: NoteItem[]) {
    setNotes(next);
    try { window.localStorage.setItem(notesKey, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const projects = useMemo(() => Array.from(new Set(tasks.map((t) => t.project).filter(Boolean))).sort(), [tasks]);

  const today = todayVnStr();

  /** Quy tắc lọc thời gian đồng nhất:
   * - Luôn giữ các task trong tương lai (từ hôm nay trở đi: plan_end >= today || plan_start >= today || created >= today).
   * - Các task trong quá khứ lọc theo bộ lọc thời gian (Tuần này, Tháng này, 30 ngày gần đây, Năm 2026, Tất cả).
   */
  const baseFiltered = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const ql = q.trim().toLowerCase();
    // Đầu tuần hiện tại (Thứ 2)
    const dayOfWeek = (now.getDay() + 6) % 7;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - dayOfWeek);
    const weekStartStr = weekStart.toLocaleDateString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
    const monthPrefix = today.slice(0, 7);

    return tasks.filter((t) => {
      if (typeFilter && t.kind !== typeFilter) return false;
      if (projectFilter && t.project !== projectFilter) return false;
      if (ql && !`${t.title} ${t.module} ${t.project} ${t.assignee}`.toLowerCase().includes(ql)) return false;

      if (timeRange === "all") return true;

      const pStart = vnDateStr(t.plan_start_at);
      const pEnd = vnDateStr(t.plan_end_at);
      const created = vnDateStr(t.created_at);

      // Luôn giữ task chưa đóng đang trễ hạn (plan_end < hôm nay) để không bao giờ bị ẩn khi lọc Tuần này
      if (!t.closed && pEnd && pEnd < today) {
        return true;
      }

      // Luôn giữ task từ hôm nay trở đi (tương lai / hôm nay)
      if ((pEnd && pEnd >= today) || (pStart && pStart >= today) || (created && created >= today)) {
        return true;
      }

      const refDate = pEnd || pStart || created;
      if (!refDate) return true;
      if (timeRange === "week") return refDate >= weekStartStr;
      if (timeRange === "month") return refDate.startsWith(monthPrefix);
      if (timeRange === "30d") {
        const ts = new Date(refDate).getTime();
        return !Number.isNaN(ts) && (nowMs - ts) <= 30 * 86_400_000;
      }
      if (timeRange === "2026") return refDate.startsWith("2026");
      return true;
    });
  }, [tasks, q, timeRange, projectFilter, typeFilter, today]);

  // Kiểm tra 1 task có nằm trong timeline hôm nay hay không
  const isInTodayTimeline = useCallback((t: DashTask) => {
    const ps = vnDateStr(t.plan_start_at);
    const pe = vnDateStr(t.plan_end_at);
    const cr = vnDateStr(t.created_at);
    if (ps && pe) return ps <= today && today <= pe;
    if (pe) return pe === today;
    if (ps) return ps === today;
    return cr === today;
  }, [today]);

  const isOverdueTask = useCallback((t: DashTask) => {
    if (t.closed) return false;
    const pe = vnDateStr(t.plan_end_at);
    return Boolean(pe && pe < today);
  }, [today]);

  const isDueTodayTask = useCallback((t: DashTask) => {
    if (t.closed) return false;
    const pe = vnDateStr(t.plan_end_at);
    return Boolean(pe && pe === today);
  }, [today]);

  // 5 nhóm KPI theo đúng quy tắc đặc tả
  const kpi = useMemo(() => {
    const nowMs = Date.now();
    const todoToday = baseFiltered.filter((t) => {
      if (t.closed) return false;
      const overdue = isOverdueTask(t);
      const inToday = isInTodayTimeline(t);
      if (t.kind === "bug") {
        return t.is_assignee || (t.is_approver && inToday) || overdue;
      }
      if (t.kind === "function") {
        return inToday || overdue;
      }
      // Release Function: chỉ tính task đã được gán ngày (plan_start_at hoặc plan_end_at)
      const hasPlanDate = Boolean(vnDateStr(t.plan_start_at) || vnDateStr(t.plan_end_at));
      return hasPlanDate && (inToday || overdue);
    });

    const overdue = baseFiltered.filter(isOverdueTask);
    const dueToday = baseFiltered.filter(isDueTodayTask);
    const incompleteBugs = baseFiltered.filter((t) => t.kind === "bug" && t.missing_fields.length > 0);
    const recent24h = baseFiltered.filter((t) => {
      if (t.kind !== "bug" || !t.is_assignee || t.closed) return false;
      const ts = new Date(t.created_at).getTime();
      return !Number.isNaN(ts) && (nowMs - ts) <= 86_400_000;
    });

    return { todoToday, overdue, dueToday, incompleteBugs, recent24h, totalFiltered: baseFiltered.length };
  }, [baseFiltered, isOverdueTask, isDueTodayTask, isInTodayTimeline]);

  const filtered = useMemo(() => {
    if (alertFilter === "overdue") return kpi.overdue;
    if (alertFilter === "dueToday") return kpi.dueToday;
    if (alertFilter === "missing") return kpi.incompleteBugs;
    if (alertFilter === "new24h") return kpi.recent24h;
    return baseFiltered;
  }, [baseFiltered, alertFilter, kpi]);

  // Kanban 4 cột chuẩn trạng thái Haraworks
  const kanbanCols = useMemo(() => {
    const todo = filtered
      .filter((t) => t.status === 0 || t.status === null)
      .sort((a, b) => {
        const pa = a.priority ?? 99;
        const pb = b.priority ?? 99;
        if (pa !== pb) return pa - pb;
        return String(b.created_at).localeCompare(String(a.created_at));
      });
    const doing = filtered.filter((t) => t.status === 1);
    const hold = filtered.filter((t) => t.status === 2 || t.status === 3 || t.status === 4 || t.status === 6 || t.status === 10 || t.status === 11);
    const done = filtered.filter((t) => t.status === 5);
    return [
      { key: "todo", label: "TO DO · MỚI", color: "#64748b", items: todo },
      { key: "doing", label: "IN PROGRESS · ĐANG THỰC HIỆN", color: "#3b82f6", items: doing },
      { key: "hold", label: "TẠM NGƯNG", color: "#f59e0b", items: hold },
      { key: "done", label: "HOÀN THÀNH", color: "#10b981", items: done },
    ];
  }, [filtered]);

  // Gantt chia rõ: Bug Tôi duyệt, Bug Tôi thực hiện, Task Function (QC), Release Function
  const ganttGroups = useMemo(() => {
    const bugApprove = filtered.filter((t) => t.kind === "bug" && t.is_approver && !t.is_assignee);
    const bugAssign = filtered.filter((t) => t.kind === "bug" && t.is_assignee);
    const fnQc = filtered.filter((t) => t.kind === "function");
    const relFn = filtered.filter((t) => t.kind === "release");
    return [
      { key: "bug_app", title: `Bug — Tôi duyệt (${bugApprove.length})`, items: bugApprove },
      { key: "bug_asg", title: `Bug — Tôi thực hiện (${bugAssign.length})`, items: bugAssign },
      { key: "fn_qc", title: `Task Function (QC) (${fnQc.length})`, items: fnQc },
      { key: "rel_fn", title: `Release Function (${relFn.length})`, items: relFn },
    ];
  }, [filtered]);

  function addTodo() {
    if (!todoText.trim()) return;
    persistTodos([
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text: todoText.trim(),
        dueDate: todoDue,
        done: false,
        linkedTask: todoLinked,
        createdAt: new Date().toISOString(),
      },
      ...todos,
    ]);
    setTodoText("");
    setTodoDue("");
    setTodoLinked(null);
  }

  function addNote() {
    if (!noteTitle.trim() && !noteContent.trim()) return;
    persistNotes([
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: noteTitle.trim() || "Ghi chú không tiêu đề",
        content: noteContent.trim(),
        linkedTask: noteLinked,
        updatedAt: new Date().toISOString(),
      },
      ...notes,
    ]);
    setNoteTitle("");
    setNoteContent("");
    setNoteLinked(null);
  }

  const pickerMatches = useMemo(() => {
    const ql = pickerQ.trim().toLowerCase();
    return tasks.filter((t) => !ql || `${t.title} ${t.module} ${t.project}`.toLowerCase().includes(ql)).slice(0, 25);
  }, [tasks, pickerQ]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Dashboard Cá Nhân</h2>
          <div className="muted">
            <strong>{user?.display_name}</strong>
            {user?.employee_code ? ` · Mã NV: ${user.employee_code}` : (
              <> · <Link href="/settings">Cập nhật Tên & Mã NV trong Cài đặt</Link></>
            )}
          </div>
        </div>
        <div className="seg-tabs" role="tablist">
          <button className={`seg-tab${subtab === "kanban" ? " active" : ""}`} onClick={() => setSubtab("kanban")}>Kanban Board</button>
          <button className={`seg-tab${subtab === "gantt" ? " active" : ""}`} onClick={() => setSubtab("gantt")}>Gantt Chart</button>
          <button className={`seg-tab${subtab === "charts" ? " active" : ""}`} onClick={() => setSubtab("charts")}>Biểu Đồ & Phân Tích</button>
          <button className={`seg-tab${subtab === "personal" ? " active" : ""}`} onClick={() => setSubtab("personal")}>To-do & Note cá nhân</button>
        </div>
      </div>

      {/* Bộ lọc thời gian chung + 3 bộ lọc (bỏ checkbox Chỉ task của tôi) */}
      {loadErr && <div className="err" role="alert" style={{ marginBottom: 10 }}>{loadErr} <button className="sm" onClick={loadData}>Thử lại</button></div>}
      <div className="card" style={{ padding: "10px 14px" }}>
        <div className="row">
          <input
            className="grow"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Lọc task theo tên, mã module, khách hàng..."
          />
          <select style={{ width: 155 }} value={timeRange} onChange={(e) => setTimeRange(e.target.value as typeof timeRange)} title="Lọc theo khoảng thời gian tạo task">
            <option value="week">Tuần này</option>
            <option value="month">Tháng này</option>
            <option value="30d">30 ngày gần đây</option>
            <option value="2026">Năm 2026</option>
            <option value="all">Tất cả</option>
          </select>
          <select style={{ width: 175 }} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} title="Lọc theo dự án / team">
            <option value="">Tất cả dự án</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select style={{ width: 165 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)} title="Lọc theo loại công việc">
            <option value="">Tất cả loại</option>
            <option value="bug">Chỉ Bug</option>
            <option value="function">Chỉ Task Function</option>
            <option value="release">Chỉ Release Function</option>
          </select>
          <select style={{ width: 165 }} value={alertFilter} onChange={(e) => setAlertFilter(e.target.value as typeof alertFilter)} title="Lọc nhanh theo trạng thái cảnh báo">
            <option value="">Tất cả</option>
            <option value="overdue">Chỉ task trễ hạn</option>
            <option value="dueToday">Hết hạn hôm nay</option>
            <option value="missing">Bug thiếu thông tin</option>
            <option value="new24h">Gán mới trong 24h</option>
          </select>
        </div>
      </div>

      {/* 5 thẻ KPI — nhấn vào mở popup danh sách chi tiết */}
      <div className="kpi-grid-5">
        <div
          className="kpi-accent"
          style={{ "--kpi-c": "#1e3a5f", cursor: "pointer" } as CSSProperties}
          onClick={() => setKpiModal({ title: `Tổng task cần làm hôm nay (${kpi.todoToday.length})`, items: kpi.todoToday })}
          title="Nhấn để xem danh sách các task cần làm hôm nay"
        >
          <div className="kpi-label">Tổng task cần làm</div>
          <div className="kpi-val">{kpi.todoToday.length}</div>
          <div className="kpi-sub">Trong hôm nay (Tổng lọc: {kpi.totalFiltered})</div>
        </div>
        <div
          className="kpi-accent"
          style={{ "--kpi-c": "#ef4444", cursor: "pointer" } as CSSProperties}
          onClick={() => setKpiModal({ title: `Task trễ hạn (${kpi.overdue.length})`, items: kpi.overdue })}
          title="Nhấn để xem danh sách các task trễ hạn"
        >
          <div className="kpi-label">Trễ hạn</div>
          <div className="kpi-val">{kpi.overdue.length}</div>
          <div className="kpi-sub">Cần xử lý gấp</div>
        </div>
        <div
          className="kpi-accent"
          style={{ "--kpi-c": "#f59e0b", cursor: "pointer" } as CSSProperties}
          onClick={() => setKpiModal({ title: `Hết hạn hôm nay (${kpi.dueToday.length})`, items: kpi.dueToday })}
          title="Nhấn để xem danh sách các task hết hạn hôm nay"
        >
          <div className="kpi-label">Hết hạn hôm nay</div>
          <div className="kpi-val">{kpi.dueToday.length}</div>
          <div className="kpi-sub">Trước 16:30</div>
        </div>
        <div
          className="kpi-accent"
          style={{ "--kpi-c": "#8b5cf6", cursor: "pointer" } as CSSProperties}
          onClick={() => setKpiModal({ title: `Bug chưa đủ thông tin (${kpi.incompleteBugs.length})`, items: kpi.incompleteBugs })}
          title="Nhấn để xem danh sách bug thiếu ít nhất 1 trong 5 trường"
        >
          <div className="kpi-label">Bug chưa đủ thông tin</div>
          <div className="kpi-val">{kpi.incompleteBugs.length}</div>
          <div className="kpi-sub">Cần bổ sung trường</div>
        </div>
        <div
          className="kpi-accent"
          style={{ "--kpi-c": "#06b6d4", cursor: "pointer" } as CSSProperties}
          onClick={() => setKpiModal({ title: `Gán mới trong 24h (${kpi.recent24h.length})`, items: kpi.recent24h })}
          title="Nhấn để xem danh sách Bug mới gán trong 24h"
        >
          <div className="kpi-label">Gán mới trong 24h</div>
          <div className="kpi-val">{kpi.recent24h.length}</div>
          <div className="kpi-sub">Chưa xử lý</div>
        </div>
      </div>

      {/* Subtab 1: Kanban Board */}
      {subtab === "kanban" && (
        <div className="kanban-grid">
          {kanbanCols.map((col) => (
            <div key={col.key} className="kanban-col" style={{ "--col-c": col.color } as CSSProperties}>
              <div className="kanban-head">
                <span>{col.label}</span>
                <span className="badge">{col.items.length}</span>
              </div>
              <div className="kanban-list">
                {col.items.map((t) => {
                  const tint = getTeamRowVars(t.project);
                  const modColor = t.module ? getModuleColor(t.module) : "#64748b";
                  const dueToday = isDueTodayTask(t);
                  return (
                    <div
                      key={t.uid}
                      className={`kanban-card${dueToday ? " due-today" : ""}`}
                      style={{ "--row-border": tint.border } as CSSProperties}
                      onClick={() => setSelected(toDrawer(t))}
                    >
                      <div className="row" style={{ gap: 4 }}>
                        <span className={`badge ${t.kind === "bug" ? "bad" : t.kind === "release" ? "ai" : "ok"}`}>
                          {t.kind === "release" ? "RELEASE" : t.kind.toUpperCase()}
                        </span>
                        <span className="badge">{t.is_assignee ? "Tôi thực hiện" : "Tôi duyệt"}</span>
                        {t.module && (
                          <span className="badge" style={{ color: modColor, borderColor: `${modColor}55`, background: `${modColor}14` }}>
                            {t.module}
                          </span>
                        )}
                        {dueToday && <span className="due-today-pill">🔥 Hạn hôm nay</span>}
                      </div>
                      <div className="kanban-title" title={t.title}>{t.title}</div>
                      {t.missing_fields.length > 0 && (
                        <div style={{ fontSize: 11, color: "var(--bad)", marginBottom: 4 }}>
                          Thiếu: {t.missing_fields.join(", ")}
                        </div>
                      )}
                      <div className="kanban-foot">
                        <span>{t.project || "—"}</span>
                        <span>{t.plan_end_at ? `Hạn ${formatDateBadge(t.plan_end_at)}` : formatDateBadge(t.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
                {col.items.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 16 }}>Trống</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Subtab 2: Gantt Chart chuẩn trục thời gian (Bug tách rõ Tôi duyệt / Tôi thực hiện + tô màu 5 trạng thái + nổi bật Hạn hôm nay) */}
      {subtab === "gantt" && (() => {
        const COL_W = 40;
        const parseDay = (s: string): number | null => {
          const d = vnDateStr(s);
          if (!d) return null;
          const t = Date.parse(`${d}T00:00:00Z`);
          return Number.isNaN(t) ? null : t;
        };
        const DAY_MS = 86_400_000;
        const todayMs = Date.parse(`${today}T00:00:00Z`);

        // Xác định khung ngày trục ngang dựa trên toàn bộ task đang lọc (tối thiểu từ hôm nay - 3 ngày đến hôm nay + 11 ngày)
        let minMs = todayMs - 3 * DAY_MS;
        let maxMs = todayMs + 11 * DAY_MS;
        const allGanttTasks = ganttGroups.flatMap((g) => g.items.slice(0, 30));
        for (const t of allGanttTasks) {
          const s = parseDay(t.plan_start_at) ?? parseDay(t.created_at);
          const e = parseDay(t.plan_end_at) ?? s;
          if (s !== null && s < minMs && todayMs - s <= 45 * DAY_MS) minMs = s;
          if (e !== null && e > maxMs && e - todayMs <= 45 * DAY_MS) maxMs = e;
        }
        minMs -= DAY_MS;
        maxMs += DAY_MS;
        const totalDays = Math.min(62, Math.max(14, Math.round((maxMs - minMs) / DAY_MS) + 1));
        const days = Array.from({ length: totalDays }, (_, i) => {
          const ms = minMs + i * DAY_MS;
          const d = new Date(ms);
          const iso = d.toISOString().slice(0, 10);
          const wd = d.getUTCDay();
          const wdLabel = wd === 0 ? "CN" : `T${wd + 1}`;
          return {
            ms,
            iso,
            ddmm: `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
            wdLabel,
            isToday: iso === today,
            isWeekend: wd === 0 || wd === 6,
          };
        });
        const todayIdx = days.findIndex((d) => d.isToday);
        const gridW = totalDays * COL_W;

        return (
          <div className="card" style={{ padding: "14px 16px" }}>
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>Gantt Chart — Tiến độ theo dòng thời gian</div>
              <div className="row" style={{ fontSize: 11.5, gap: 10 }}>
                <span className="row" style={{ gap: 4 }}><span className="legend-dot" style={{ background: "#64748b" }} /> Mới</span>
                <span className="row" style={{ gap: 4 }}><span className="legend-dot" style={{ background: "#3b82f6" }} /> Đang thực hiện</span>
                <span className="row" style={{ gap: 4 }}><span className="legend-dot" style={{ background: "#f59e0b" }} /> Tạm ngưng</span>
                <span className="row" style={{ gap: 4 }}><span className="legend-dot" style={{ background: "#e11d48" }} /> Từ chối</span>
                <span className="row" style={{ gap: 4 }}><span className="legend-dot" style={{ background: "#10b981" }} /> Hoàn thành</span>
              </div>
            </div>

            <div className="gantt-scroll">
              <div style={{ minWidth: 320 + gridW }}>
                {/* Thanh ngày tháng */}
                <div className="gantt-header-row">
                  <div className="gantt-left-col gantt-sticky-head">Công việc</div>
                  <div className="gantt-timeline-head" style={{ width: gridW }}>
                    {days.map((d) => (
                      <div
                        key={d.iso}
                        className={`gantt-day-cell${d.isToday ? " is-today" : ""}${d.isWeekend ? " is-weekend" : ""}`}
                        style={{ width: COL_W }}
                      >
                        <div style={{ fontSize: 10, opacity: 0.75 }}>{d.wdLabel}</div>
                        <div style={{ fontSize: 11, fontWeight: d.isToday ? 700 : 600 }}>{d.ddmm}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Các nhóm task */}
                {ganttGroups.map((grp) => (
                  <div key={grp.key}>
                    <div className="gantt-group-bar">
                      <div className="gantt-left-col" style={{ fontWeight: 700, fontSize: 12.5 }}>{grp.title}</div>
                      <div style={{ width: gridW }} />
                    </div>
                    {grp.items.length === 0 ? (
                      <div className="muted" style={{ padding: "8px 12px", fontSize: 12.5 }}>Không có task nào trong kỳ lọc.</div>
                    ) : (
                      grp.items.slice(0, 30).map((t) => {
                        const barColor = statusBarColor(t.status);
                        const dueToday = isDueTodayTask(t);
                        const rawStart = parseDay(t.plan_start_at) ?? parseDay(t.plan_end_at) ?? parseDay(t.created_at) ?? todayMs;
                        const rawEnd = parseDay(t.plan_end_at) ?? rawStart;
                        const sMs = Math.min(rawStart, rawEnd);
                        const eMs = Math.max(rawStart, rawEnd);
                        const startIdx = Math.max(0, Math.min(totalDays - 1, Math.floor((sMs - minMs) / DAY_MS)));
                        const endIdx = Math.max(startIdx, Math.min(totalDays - 1, Math.floor((eMs - minMs) / DAY_MS)));
                        const leftPx = startIdx * COL_W + 3;
                        const widthPx = Math.max(COL_W - 6, (endIdx - startIdx + 1) * COL_W - 6);
                        const tip = `${t.title}\nTrạng thái: ${t.status_label}\n${t.plan_start_at ? `Bắt đầu: ${formatDateBadge(t.plan_start_at)}\n` : ""}${t.plan_end_at ? `Hạn chót: ${formatDateBadge(t.plan_end_at)}` : `Ngày tạo: ${formatDateBadge(t.created_at)}`}`;

                        return (
                          <div
                            key={t.uid}
                            className="gantt-task-row"
                            onClick={() => setSelected(toDrawer(t))}
                            title={tip}
                          >
                            <div className="gantt-left-col gantt-task-label">
                              {t.module && (
                                <span
                                  className="badge"
                                  style={{
                                    background: `${getModuleColor(t.module)}18`,
                                    color: getModuleColor(t.module),
                                    borderColor: `${getModuleColor(t.module)}55`,
                                    fontSize: 10.5,
                                    flexShrink: 0,
                                  }}
                                >
                                  {t.module}
                                </span>
                              )}
                              <span className="gantt-task-name">
                                {dueToday ? "🔥 " : ""}{t.title}
                              </span>
                            </div>
                            <div className="gantt-track" style={{ width: gridW }}>
                              {/* Lưới cột ngày */}
                              {days.map((d, idx) => (
                                <div
                                  key={d.iso}
                                  className={`gantt-grid-cell${d.isWeekend ? " is-weekend" : ""}${d.isToday ? " is-today-col" : ""}`}
                                  style={{ left: idx * COL_W, width: COL_W }}
                                />
                              ))}
                              {/* Đường đỏ đánh dấu Hôm nay */}
                              {todayIdx >= 0 && (
                                <div className="gantt-today-line" style={{ left: todayIdx * COL_W + COL_W / 2 }} />
                              )}
                              {/* Thanh Gantt định vị đúng ngày bắt đầu -> hạn chót */}
                              <div
                                className={`gantt-bar-item${dueToday ? " gantt-bar-due-today" : ""}`}
                                style={{ left: leftPx, width: widthPx, background: barColor }}
                              >
                                <span className="gantt-bar-text">
                                  {dueToday ? "🔥 " : ""}{t.status_label}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Subtab 3: Biểu Đồ & Phân Tích */}
      {subtab === "charts" && (() => {
        const byStatus = [
          { label: "Mới", value: filtered.filter((t) => t.status === 0 || t.status === null).length, color: "#64748b" },
          { label: "Đang thực hiện", value: filtered.filter((t) => t.status === 1).length, color: "#3b82f6" },
          { label: "Tạm ngưng", value: filtered.filter((t) => t.status === 2 || t.status === 3 || t.status === 6).length, color: "#f59e0b" },
          { label: "Từ chối", value: filtered.filter((t) => t.status === 4 || t.status === 10 || t.status === 11).length, color: "#e11d48" },
          { label: "Hoàn thành", value: filtered.filter((t) => t.status === 5).length, color: "#10b981" },
        ];
        const byPriority = [
          { label: "Ưu tiên cao", value: filtered.filter((t) => t.priority === 1 || t.priority === 2).length, color: "#e11d48" },
          { label: "Ưu tiên", value: filtered.filter((t) => t.priority === 3).length, color: "#f59e0b" },
          { label: "Không ưu tiên / Khác", value: filtered.filter((t) => !t.priority || t.priority >= 4).length, color: "#94a3b8" },
        ];
        const byKind = [
          { label: "Bug", value: filtered.filter((t) => t.kind === "bug").length, color: "#e11d48" },
          { label: "Task Function (QC)", value: filtered.filter((t) => t.kind === "function").length, color: "#3b82f6" },
          { label: "Release Function", value: filtered.filter((t) => t.kind === "release").length, color: "#8b5cf6" },
        ];
        const allBugs = filtered.filter((t) => t.kind === "bug");
        const bugQual = [
          { label: "Đủ 5 trường", value: allBugs.filter((b) => b.missing_fields.length === 0).length, color: "#10b981" },
          { label: "Thiếu thông tin", value: allBugs.filter((b) => b.missing_fields.length > 0).length, color: "#8b5cf6" },
        ];
        const allRel = filtered.filter((t) => t.kind === "release");
        const relDist = [
          { label: "Đang mở", value: allRel.filter((b) => !b.closed).length, color: "#06b6d4" },
          { label: "Đã đóng", value: allRel.filter((b) => b.closed).length, color: "#10b981" },
        ];
        const maxSt = Math.max(1, ...byStatus.map((s) => s.value));
        return (
          <>
            <div className="chart-grid-3">
              <div className="card">
                <div className="card-title">Phân Bổ Theo Trạng Thái</div>
                {byStatus.map((s) => (
                  <div key={s.label} className="bar-row">
                    <div className="legend-row"><span>{s.label}</span><strong>{s.value}</strong></div>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(s.value / maxSt) * 100}%`, background: s.color }} /></div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title">Phân Bổ Theo Độ Ưu Tiên</div>
                <DonutChart slices={byPriority} total={filtered.length} />
              </div>
              <div className="card">
                <div className="card-title">Phân Bổ Loại Công Việc</div>
                <DonutChart slices={byKind} total={filtered.length} />
              </div>
            </div>
            <div className="grid-2">
              <div className="card">
                <div className="card-title">Chất Lượng Điền Thông Tin Bug</div>
                <DonutChart slices={bugQual} total={allBugs.length} />
              </div>
              <div className="card">
                <div className="card-title">Task Release Function</div>
                <DonutChart slices={relDist} total={allRel.length} />
              </div>
            </div>
          </>
        );
      })()}

      {/* Subtab 4: To-do & Note cá nhân */}
      {subtab === "personal" && (
        <div className="grid-2">
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>To-do List Cá Nhân</div>
              <span className="badge">{todos.filter((t) => !t.done).length} cần làm / {todos.length}</span>
            </div>
            <input
              value={todoText}
              onChange={(e) => setTodoText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addTodo(); }}
              placeholder="Nhập việc cần làm..."
              style={{ marginBottom: 8 }}
            />
            <div className="row" style={{ marginBottom: 8 }}>
              <input type="date" style={{ width: 155 }} value={todoDue} onChange={(e) => setTodoDue(e.target.value)} />
              <button type="button" className="sm" onClick={() => { setPickerFor("todo"); setPickerQ(""); }}>
                + Gán Task (Bug / Function / Build)
              </button>
              <button type="button" className="primary sm" onClick={addTodo}>Thêm To-do</button>
            </div>
            {todoLinked && (
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="badge ok">Gắn: [{todoLinked.kind.toUpperCase()}] {todoLinked.title.slice(0, 48)}</span>
                <button className="sm" onClick={() => setTodoLinked(null)}>Bỏ</button>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {todos.map((t) => (
                <div key={t.id} className="row" style={{ padding: "7px 9px", border: "1px solid var(--line)", borderRadius: 7 }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={t.done}
                    onChange={() => persistTodos(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
                  />
                  <div className="grow" style={{ textDecoration: t.done ? "line-through" : undefined, opacity: t.done ? 0.6 : 1 }}>
                    <div style={{ fontWeight: 500 }}>{t.text}</div>
                    <div className="row" style={{ gap: 6, marginTop: 3 }}>
                      {t.dueDate && <span className="badge warn">Hạn: {t.dueDate}</span>}
                      {t.linkedTask && (
                        <span className="badge ok">[{t.linkedTask.kind.toUpperCase()}] {t.linkedTask.title.slice(0, 40)}</span>
                      )}
                      <span className="badge date">{formatDateBadge(t.createdAt)}</span>
                    </div>
                  </div>
                  <button className="sm danger" onClick={() => persistTodos(todos.filter((x) => x.id !== t.id))}>Xóa</button>
                </div>
              ))}
              {todos.length === 0 && <div className="muted">Chưa có to-do nào.</div>}
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>Note / Ghi Chú Cá Nhân</div>
              <span className="badge">{notes.length} ghi chú</span>
            </div>
            <input
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
              placeholder="Tiêu đề ghi chú..."
              style={{ marginBottom: 8 }}
            />
            <textarea
              rows={4}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Nội dung ghi chú, checklist, kịch bản test..."
              style={{ marginBottom: 8 }}
            />
            <div className="row" style={{ marginBottom: 8 }}>
              <button type="button" className="sm" onClick={() => { setPickerFor("note"); setPickerQ(""); }}>
                + Gán Task
              </button>
              <button type="button" className="primary sm" onClick={addNote}>Lưu Note</button>
            </div>
            {noteLinked && (
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="badge ok">Gắn: [{noteLinked.kind.toUpperCase()}] {noteLinked.title.slice(0, 48)}</span>
                <button className="sm" onClick={() => setNoteLinked(null)}>Bỏ</button>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 7, background: "var(--panel-alt)" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{n.title}</strong>
                    <div className="row">
                      <span className="badge date">{formatDateBadge(n.updatedAt)}</span>
                      <button className="sm danger" onClick={() => persistNotes(notes.filter((x) => x.id !== n.id))}>Xóa</button>
                    </div>
                  </div>
                  {n.linkedTask && (
                    <div style={{ marginTop: 4 }}>
                      <span className="badge ok">[{n.linkedTask.kind.toUpperCase()}] {n.linkedTask.title.slice(0, 55)}</span>
                    </div>
                  )}
                  <div style={{ whiteSpace: "pre-wrap", marginTop: 6, fontSize: 12.5 }}>{n.content}</div>
                </div>
              ))}
              {notes.length === 0 && <div className="muted">Chưa có ghi chú nào.</div>}
            </div>
          </div>
        </div>
      )}

      {/* Modal chọn Task gắn cho To-do hoặc Note */}
      {pickerFor && (
        <div className="modal-backdrop" onClick={() => setPickerFor(null)}>
          <div className="modal-box" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>Chọn Task để gắn</strong>
              <button className="sm" onClick={() => setPickerFor(null)}>Đóng</button>
            </div>
            <div className="modal-body">
              <input value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="Tìm tên task..." style={{ marginBottom: 10 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {pickerMatches.map((t) => (
                  <button
                    key={t.uid}
                    type="button"
                    style={{ justifyContent: "flex-start", textAlign: "left", padding: "8px 10px" }}
                    onClick={() => {
                      const picked = { kind: t.kind, title: t.title, url: t.url };
                      if (pickerFor === "todo") setTodoLinked(picked);
                      else setNoteLinked(picked);
                      setPickerFor(null);
                    }}
                  >
                    <span className={`badge ${t.kind === "bug" ? "bad" : t.kind === "release" ? "ai" : "ok"}`}>{t.kind.toUpperCase()}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Popup danh sách task của thẻ KPI vừa nhấn */}
      {kpiModal && (
        <div className="modal-backdrop" onClick={() => setKpiModal(null)} role="dialog" aria-modal="true" aria-label={kpiModal.title}>
          <div className="modal-box" style={{ maxWidth: 760, maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong style={{ fontSize: 15 }}>{kpiModal.title}</strong>
              <button className="sm" onClick={() => setKpiModal(null)}>✕</button>
            </div>
            <div className="modal-body">
              {kpiModal.items.length === 0 ? (
                <div className="muted" style={{ textAlign: "center", padding: 24 }}>Không có task nào trong nhóm này.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {kpiModal.items.map((t) => (
                    <div
                      key={t.uid}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 12px",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        background: "var(--panel)",
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                          <span className={`badge ${t.kind === "bug" ? "bad" : t.kind === "release" ? "ai" : "ok"}`}>
                            {t.kind === "release" ? "RELEASE" : t.kind.toUpperCase()}
                          </span>
                          <span className="badge ok">{t.is_assignee ? "Tôi thực hiện" : "Tôi duyệt"}</span>
                          <span className="badge">{t.status_label}</span>
                          {isDueTodayTask(t) && <span className="due-today-pill">🔥 Hạn hôm nay</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => { setKpiModal(null); setSelected(toDrawer(t)); }}
                          style={{
                            border: 0,
                            background: "transparent",
                            padding: 0,
                            textAlign: "left",
                            fontWeight: 600,
                            color: "var(--brand)",
                            cursor: "pointer",
                          }}
                        >
                          {t.title}
                        </button>
                        {t.missing_fields.length > 0 && (
                          <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 3 }}>
                            Thiếu: {t.missing_fields.join(", ")}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div className="muted" style={{ marginBottom: 6 }}>
                          {t.plan_end_at ? `Hạn: ${formatDateBadge(t.plan_end_at)}` : `Tạo: ${formatDateBadge(t.created_at)}`}
                        </div>
                        {t.url && (
                          <a className="btn sm" href={t.url} target="_blank" rel="noopener noreferrer">
                            Mở task
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
