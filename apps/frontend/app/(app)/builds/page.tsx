"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type BuildItem } from "@/lib/api";
import { FilterPanel, FilterToolbar, NumberedPagination } from "@/components/ListControls";
import { TaskDrawer, TaskRowCard, type DrawerTask } from "@/components/TaskDrawer";

const PAGE_SIZE = 50;

export default function BuildsPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("created");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // 6 bộ lọc giống bản cũ
  const [team, setTeam] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [closed, setClosed] = useState("");
  const [assignee, setAssignee] = useState("");
  const [year, setYear] = useState("");

  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    total: number;
    items: BuildItem[];
    teams: string[];
    modules: string[];
    assignees?: string[];
    statuses?: Record<string, string>;
    years?: string[];
  }>({ total: 0, items: [], teams: [], modules: [], assignees: [], statuses: {}, years: [] });
  const [selected, setSelected] = useState<DrawerTask | null>(null);

  const activeFilters = [team, kind, status, closed, assignee, year].filter(Boolean).length;

  function clearFilters() {
    setTeam(""); setKind(""); setStatus(""); setClosed(""); setAssignee(""); setYear("");
    setPage(1);
  }

  const [loadErr, setLoadErr] = useState("");
  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE), sort });
    if (q.trim()) p.set("q", q.trim());
    if (team) p.set("team", team);
    if (kind) p.set("kind", kind);
    if (status !== "") p.set("status", status);
    if (closed) p.set("closed", closed);
    if (assignee) p.set("assignee", assignee);
    if (year) p.set("year", year);
    api<typeof data>(`/sources/builds?${p.toString()}`)
      .then((res) => { setLoadErr(""); setData(res); })
      .catch((err) => setLoadErr(err instanceof Error ? err.message : "Không tải được Theo dõi Build"));
  }, [q, sort, team, kind, status, closed, assignee, year, page]);

  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener("qc:synced", load);
    return () => window.removeEventListener("qc:synced", load);
  }, [load]);

  return (
    <div>
      <div className="page-head">
        <div className="row" style={{ gap: 10 }}>
          <h2>Theo Dõi Build / Release</h2>
          <span className="badge ok">{data.total.toLocaleString("vi-VN")} đợt build</span>
        </div>
      </div>
      {loadErr && <div className="err" role="alert" style={{ marginBottom: 10 }}>{loadErr} <button className="sm" onClick={load}>Thử lại</button></div>}

      <div className="card">
        <FilterToolbar
          q={q}
          onQ={(v) => { setQ(v); setPage(1); }}
          placeholder="Tìm tên đợt build, mã build hoặc bug/function bên trong..."
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
            <label>Dự án</label>
            <select value={team} onChange={(e) => { setTeam(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {data.teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label>Loại Build</label>
            <select value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              <option value="app">Build App Mobile</option>
              <option value="function">Build Task Function</option>
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
            <label>Năm</label>
            <select value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(data.years || []).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </FilterPanel>

        <div className="bh-list-head">
          <span>Module</span>
          <span />
          <span>Tên đợt Build</span>
          <span>Trạng thái</span>
          <span>Người duyệt</span>
          <span>Người thực hiện</span>
          <span className="bh-date">Ngày tạo</span>
        </div>

        <div className="bh-list">
          {data.items.map((b) => (
            <TaskRowCard
              key={b.id}
              moduleCode={b.module}
              teamOrProject={b.source_team || b.project || b.team}
              priority={b.priority}
              priorityLabel={b.priority_label}
              title={b.title}
              statusCode={b.status_code}
              statusLabel={b.status || "Mới"}
              approver={b.approver}
              assignee={b.assignee}
              date={b.created_at}
              closed={b.closed}
              onClick={() =>
                setSelected({
                  kind: "build",
                  externalId: b.build_id,
                  title: b.title,
                  moduleCode: b.module,
                  project: b.project,
                  team: b.project || b.team,
                  sourceTeam: b.source_team,
                  sourceFunction: b.source_function,
                  kindLabel: b.kind_label,
                  statusLabel: b.status,
                  priorityLabel: b.priority_label,
                  assignee: b.assignee,
                  approver: b.approver,
                  createdAt: b.created_at,
                  updatedAt: b.updated_at,
                  closed: b.closed,
                  url: b.url,
                  fallbackDescription: b.note,
                })
              }
            />
          ))}
          {data.items.length === 0 && (
            <div className="muted" style={{ textAlign: "center", padding: 24 }}>
              Chưa có đợt build nào khớp bộ lọc. Bấm nút <strong>Đồng bộ</strong> trên thanh trên cùng để kéo từ Haraworks.
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
