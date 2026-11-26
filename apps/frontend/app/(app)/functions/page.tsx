"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type TaskFunctionItem } from "@/lib/api";
import { FilterPanel, FilterToolbar, NumberedPagination } from "@/components/ListControls";
import { TaskDrawer, TaskRowCard, type DrawerTask } from "@/components/TaskDrawer";

const PAGE_SIZE = 50;

export default function FunctionsPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("created");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // 6 bộ lọc giống bản cũ
  const [team, setTeam] = useState("");
  const [moduleCode, setModuleCode] = useState("");
  const [status, setStatus] = useState("");
  const [closed, setClosed] = useState("");
  const [assignee, setAssignee] = useState("");
  const [dateRange, setDateRange] = useState("");

  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    total: number;
    items: TaskFunctionItem[];
    teams: string[];
    modules: string[];
    assignees?: string[];
    statuses?: Record<string, string>;
  }>({ total: 0, items: [], teams: [], modules: [], assignees: [], statuses: {} });
  const [selected, setSelected] = useState<DrawerTask | null>(null);

  const activeFilters = [team, moduleCode, status, closed, assignee, dateRange].filter(Boolean).length;

  function clearFilters() {
    setTeam(""); setModuleCode(""); setStatus(""); setClosed(""); setAssignee(""); setDateRange("");
    setPage(1);
  }

  const [loadErr, setLoadErr] = useState("");
  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE), sort });
    if (q.trim()) p.set("q", q.trim());
    if (team) p.set("team", team);
    if (moduleCode) p.set("module", moduleCode);
    if (status !== "") p.set("status", status);
    if (closed) p.set("closed", closed);
    if (assignee) p.set("assignee", assignee);
    if (dateRange) p.set("date_range", dateRange);
    api<typeof data>(`/sources/task-functions?${p.toString()}`)
      .then((res) => { setLoadErr(""); setData(res); })
      .catch((err) => setLoadErr(err instanceof Error ? err.message : "Không tải được Task Function"));
  }, [q, sort, team, moduleCode, status, closed, assignee, dateRange, page]);

  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener("qc:synced", load);
    return () => window.removeEventListener("qc:synced", load);
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <div className="row" style={{ gap: 10 }}>
          <h2>Tra Cứu Task Function</h2>
          <span className="badge ok">{data.total.toLocaleString("vi-VN")} task Function</span>
        </div>
      </div>
      {loadErr && <div className="err" role="alert" style={{ marginBottom: 10 }}>{loadErr} <button className="sm" onClick={load}>Thử lại</button></div>}

      <div className="card">
        <FilterToolbar
          q={q}
          onQ={(v) => { setQ(v); setPage(1); }}
          placeholder="Tìm trong tiêu đề task Function..."
          sort={sort}
          onSort={(v) => { setSort(v); setPage(1); }}
          sortOptions={[
            { value: "created", label: "Mới nhất" },
            { value: "priority", label: "Độ ưu tiên" },
            { value: "updated", label: "Cập nhật gần nhất" },
          ]}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((o) => !o)}
          activeFilterCount={activeFilters}
        />

        <FilterPanel open={filtersOpen} onClear={clearFilters} activeCount={activeFilters}>
          <div>
            <label>Team / Dự án</label>
            <select value={team} onChange={(e) => { setTeam(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {data.teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label>Module</label>
            <select value={moduleCode} onChange={(e) => { setModuleCode(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {data.modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>Trạng thái</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {Object.entries(data.statuses || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label>Mở / đóng</label>
            <select value={closed} onChange={(e) => { setClosed(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              <option value="open">Đang mở</option>
              <option value="closed">Đã đóng</option>
            </select>
          </div>
          <div>
            <label>Người thực hiện</label>
            <select value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(data.assignees || []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label>Thời gian tạo</label>
            <select value={dateRange} onChange={(e) => { setDateRange(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              <option value="week">Tuần này</option>
              <option value="month">Tháng này</option>
              <option value="2026">Năm 2026</option>
              <option value="2025">Năm 2025</option>
              <option value="2024">Năm 2024</option>
            </select>
          </div>
        </FilterPanel>

        <div className="bh-list-head">
          <span>Module</span>
          <span />
          <span>Tên Task Function</span>
          <span>Trạng thái</span>
          <span>Người duyệt</span>
          <span>Người thực hiện</span>
          <span className="bh-date">Ngày tạo</span>
        </div>

        <div className="bh-list">
          {data.items.map((item) => (
            <TaskRowCard
              key={item.id}
              moduleCode={item.module}
              teamOrProject={item.team || item.project}
              priority={item.priority}
              priorityLabel={item.priority_label}
              title={item.title}
              statusCode={item.status}
              statusLabel={item.status_label || "Mới"}
              approver={item.approver}
              assignee={item.assignee}
              date={item.created_at}
              closed={item.closed}
              onClick={() =>
                setSelected({
                  kind: "function",
                  externalId: item.task_id,
                  title: item.title,
                  moduleCode: item.module,
                  team: item.team,
                  project: item.project,
                  statusLabel: item.status_label,
                  priorityLabel: item.priority_label,
                  assignee: item.assignee,
                  approver: item.approver,
                  createdAt: item.created_at,
                  updatedAt: item.updated_at,
                  closed: item.closed,
                  url: item.url,
                  fallbackDescription: item.description,
                })
              }
            />
          ))}
          {data.items.length === 0 && (
            <div className="muted" style={{ textAlign: "center", padding: 24 }}>
              Chưa có Task Function nào khớp bộ lọc. Bấm nút <strong>Đồng bộ</strong> trên thanh trên cùng để kéo từ Haraworks.
            </div>
          )}
        </div>

        <NumberedPagination
          page={page}
          total={data.total}
          pageSize={PAGE_SIZE}
          onPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); }}
        />
      </div>

      {selected && <TaskDrawer task={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
