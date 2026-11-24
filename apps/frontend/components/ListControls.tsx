"use client";

import type { ReactNode } from "react";

export function FilterToolbar({
  q,
  onQ,
  placeholder,
  sort,
  onSort,
  sortOptions,
  filtersOpen,
  onToggleFilters,
  activeFilterCount,
}: {
  q: string;
  onQ: (v: string) => void;
  placeholder: string;
  sort: string;
  onSort: (v: string) => void;
  sortOptions: { value: string; label: string }[];
  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="bh-toolbar">
      <input
        className="grow"
        value={q}
        onChange={(e) => onQ(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <div className="bh-sort-wrap" title="Sắp xếp danh sách">
        <span className="bh-icon-label" aria-hidden="true">⇅</span>
        <select value={sort} onChange={(e) => onSort(e.target.value)} aria-label="Sắp xếp">
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className={`bh-filter-btn${filtersOpen || activeFilterCount > 0 ? " is-active" : ""}`}
        onClick={onToggleFilters}
        title="Mở / ẩn bộ lọc chi tiết"
        aria-expanded={filtersOpen}
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="M3 5h14l-5.5 6.2v4.3l-3-1.5v-2.8L3 5z" strokeLinejoin="round" />
        </svg>
        <span>Bộ lọc</span>
        {activeFilterCount > 0 && <span className="bh-filter-badge">{activeFilterCount}</span>}
      </button>
    </div>
  );
}

export function FilterPanel({
  open,
  onClear,
  activeCount,
  children,
}: {
  open: boolean;
  onClear: () => void;
  activeCount: number;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="bh-filter-panel">
      <div className="bh-filter-panel-head">
        <strong>Bộ lọc</strong>
        <button type="button" className="sm" onClick={onClear} disabled={activeCount === 0}>
          Xóa bộ lọc
        </button>
      </div>
      <div className="bh-filter-grid">{children}</div>
    </div>
  );
}

export function NumberedPagination({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("...");
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  return (
    <div className="bh-pagination">
      <span className="muted">
        Trang {page} / {totalPages} ({total.toLocaleString("vi-VN")} mục)
      </span>
      <div className="bh-page-nav">
        <button
          type="button"
          className="bh-page-btn"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Trang trước"
        >
          ‹
        </button>
        {pages.map((p, idx) =>
          p === "..." ? (
            <span key={`d-${idx}`} className="bh-page-dots">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`bh-page-btn${p === page ? " active" : ""}`}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          className="bh-page-btn"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Trang sau"
        >
          ›
        </button>
      </div>
    </div>
  );
}
