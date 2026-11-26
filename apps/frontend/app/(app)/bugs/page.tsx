"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type BugItem } from "@/lib/api";
import { FilterPanel, FilterToolbar, NumberedPagination } from "@/components/ListControls";
import { TaskDrawer, TaskRowCard, type DrawerTask } from "@/components/TaskDrawer";

type Meta = {
  sources: Record<string, number>;
  modules: string[];
  projects: string[];
  assignees: string[];
  approvers: string[];
  classifications: string[];
  years: string[];
  status_labels: Record<string, string>;
};

const CLOSED_ST = new Set([4, 5, 10, 11]);
const PAGE_SIZE = 50;

export default function BugsPage() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("created");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // 9 bộ lọc giống bản cũ
  const [project, setProject] = useState("");
  const [moduleCode, setModuleCode] = useState("");
  const [status, setStatus] = useState("");
  const [closed, setClosed] = useState("");
  const [assignee, setAssignee] = useState("");
  const [approver, setApprover] = useState("");
  const [dateRange, setDateRange] = useState("");
  const [classification, setClassification] = useState("");
  const [year, setYear] = useState("");

  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState<Meta>({
    sources: {}, modules: [], projects: [], assignees: [], approvers: [], classifications: [], years: [], status_labels: {},
  });
  const [data, setData] = useState<{ total: number; items: BugItem[] }>({ total: 0, items: [] });
  const [loadErr, setLoadErr] = useState("");
  const [selected, setSelected] = useState<DrawerTask | null>(null);

  const activeFilters = [project, moduleCode, status, closed, assignee, approver, dateRange, classification, year].filter(Boolean).length;

  function clearFilters() {
    setProject(""); setModuleCode(""); setStatus(""); setClosed("");
    setAssignee(""); setApprover(""); setDateRange(""); setClassification(""); setYear("");
    setPage(1);
  }

  const loadMeta = useCallback(() => {
    api<Meta>("/bugs/meta").then(setMeta).catch((err) => setLoadErr(err instanceof Error ? err.message : "Không tải được danh mục lọc"));
  }, []);
  useEffect(loadMeta, [loadMeta]);

  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE), sort });
    if (q.trim()) p.set("q", q.trim());
    if (project) p.set("project", project);
    if (moduleCode) p.set("module", moduleCode);
    if (status !== "") p.set("status", status);
    if (closed) p.set("closed", closed);
    if (assignee) p.set("assignee", assignee);
    if (approver) p.set("approver", approver);
    if (dateRange) p.set("date_range", dateRange);
    if (classification) p.set("classification", classification);
    if (year) p.set("year", year);
    api<{ total: number; items: BugItem[] }>(`/bugs?${p.toString()}`)
      .then((res) => { setLoadErr(""); setData(res); })
      .catch((err) => setLoadErr(err instanceof Error ? err.message : "Không tải được danh sách Bug"));
  }, [q, sort, project, moduleCode, status, closed, assignee, approver, dateRange, classification, year, page]);

  useEffect(load, [load]);
  useEffect(() => {
    const onSynced = () => { load(); loadMeta(); };
    window.addEventListener("qc:synced", onSynced);
    return () => window.removeEventListener("qc:synced", onSynced);
  }, [load, loadMeta]);

  return (
    <div>
      <div className="page-head">
        <div className="row" style={{ gap: 10 }}>
          <h2>Tra Cứu Bug</h2>
          <span className="badge ok">{data.total.toLocaleString("vi-VN")} bug</span>
        </div>
      </div>
      {loadErr && <div className="err" role="alert" style={{ marginBottom: 10 }}>{loadErr} <button className="sm" onClick={load}>Thử lại</button></div>}

      <div className="card">
        <FilterToolbar
          q={q}
          onQ={(v) => { setQ(v); setPage(1); }}
          placeholder="Tìm trong tiêu đề bug..."
          sort={sort}
          onSort={(v) => { setSort(v); setPage(1); }}
          sortOptions={[
            { value: "created", label: "Mới nhất" },
            { value: "priority", label: "Độ ưu tiên" },
          ]}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((o) => !o)}
          activeFilterCount={activeFilters}
        />

        <FilterPanel open={filtersOpen} onClear={clearFilters} activeCount={activeFilters}>
          <div>
            <label>Dự án</label>
            <select value={project} onChange={(e) => { setProject(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(meta.projects || []).map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label>Module</label>
            <select value={moduleCode} onChange={(e) => { setModuleCode(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(meta.modules || []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>Trạng thái</label>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {Object.entries(meta.status_labels || {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label>Mở / đóng</label>
            <select value={closed} onChange={(e) => { setClosed(e.target.value); setPage(1); }}>
              <option value="">Đang mở và đã đóng</option>
              <option value="open">Đang mở</option>
              <option value="closed">Đã đóng</option>
            </select>
          </div>
          <div>
            <label>Người thực hiện</label>
            <select value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(meta.assignees || []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label>Người duyệt</label>
            <select value={approver} onChange={(e) => { setApprover(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(meta.approvers || []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label>Thời gian tạo</label>
            <select value={dateRange} onChange={(e) => { setDateRange(e.target.value); setPage(1); }}>
              <option value="">Mọi lúc</option>
              <option value="30d">Bug mới (30 ngày gần đây)</option>
              <option value="old">Bug cũ (trước đó)</option>
            </select>
          </div>
          <div>
            <label>Phân loại</label>
            <select value={classification} onChange={(e) => { setClassification(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(meta.classifications || []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Năm</label>
            <select value={year} onChange={(e) => { setYear(e.target.value); setPage(1); }}>
              <option value="">Tất cả</option>
              {(meta.years || []).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </FilterPanel>

        <div className="bh-list-head">
          <span>Module</span>
          <span />
          <span>Tên Bug</span>
          <span>Trạng thái</span>
          <span>Người duyệt</span>
          <span>Người thực hiện</span>
          <span className="bh-date">Ngày tạo</span>
        </div>

        <div className="bh-list">
          {data.items.map((b) => {
            const isClosed = b.status != null && CLOSED_ST.has(b.status);
            return (
              <TaskRowCard
                key={b.id}
                moduleCode={b.module_code}
                teamOrProject={b.project || b.source}
                priority={b.priority}
                priorityLabel={b.priority_label}
                title={b.title}
                statusCode={b.status}
                statusLabel={b.status_label || b.classification || "Bản lưu"}
                approver={b.approver}
                assignee={b.assignee}
                date={b.created_at_ext}
                closed={isClosed}
                onClick={() =>
                  setSelected({
                    kind: "bug",
                    externalId: b.external_id,
                    title: b.title,
                    moduleCode: b.module_code,
                    project: b.project || b.source,
                    statusLabel: b.status_label || b.classification,
                    priorityLabel: b.priority_label,
                    assignee: b.assignee,
                    approver: b.approver,
                    createdAt: b.created_at_ext,
                    closed: isClosed,
                    url: b.url,
                  })
                }
              />
            );
          })}
          {data.items.length === 0 && (
            <div className="muted" style={{ textAlign: "center", padding: 24 }}>Không có bug nào khớp bộ lọc.</div>
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
