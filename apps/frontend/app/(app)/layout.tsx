"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, waitJob } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";
import { HelpModal } from "@/components/HelpModal";
import { QaPetWidget, type HwNotiItem, type PetPulse } from "@/components/QaPetWidget";
import { formatDateBadge, getTheme, setTheme } from "@/lib/ui-prefs";

const NAV_GROUPS = [
  {
    title: "Không gian làm việc",
    items: [
      { href: "/overview", label: "Tổng quan", tip: "Tổng quan số liệu, To-do list và ghi chú cá nhân" },
      { href: "/lookup", label: "Tra cứu Rule", tip: "Tra cứu rule nguyên văn theo Module, chức năng/luồng ứng dụng và Bug cũ đã hoàn thành" },
      { href: "/sources", label: "Quản lý nguồn rule", tip: "Nạp và quản lý tài liệu BA (.docx), Figma (kèm hình ảnh), Wiki theo Module" },
    ],
  },
  {
    title: "Theo dõi công việc",
    items: [
      { href: "/bugs", label: "Danh sách Bug", tip: "Danh sách Bug theo dự án và module, đồng bộ từ Haraworks" },
      { href: "/functions", label: "Task Function", tip: "Danh sách Task Function của các dự án kèm mô tả chi tiết" },
      { href: "/builds", label: "Theo dõi Build", tip: "Danh sách các đợt Build/Release theo dự án" },
    ],
  },
  {
    title: "Kiểm thử tự động",
    items: [
      { href: "/environments", label: "Môi trường & Tài khoản", tip: "Quản lý môi trường Staging và tài khoản test" },
      { href: "/automation", label: "Tác vụ tự động", tip: "Quản lý kịch bản Playwright, thêm/sửa/xóa và chạy kiểm thử" },
      { href: "/flows", label: "Ghi luồng", tip: "Nạp bản ghi thao tác từ trình duyệt để sinh kịch bản kiểm thử" },
      { href: "/runners", label: "Runner", tip: "Quản lý Host Runner và Docker Runner" },
    ],
  },
  {
    title: "Hệ thống",
    items: [
      { href: "/settings", label: "Cài đặt", tip: "Tài khoản, màu dự án/module, tích hợp Haraworks/Figma/AI, người dùng QC và nhật ký" },
    ],
  },
];

function Shell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const [theme, setThemeState] = useState<"light" | "dark">("light");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newBugsCount, setNewBugsCount] = useState(0);
  const [latestBugAt, setLatestBugAt] = useState("");

  // Khung danh sách thông báo Haraworks khi bấm vào chuông
  const [notiOpen, setNotiOpen] = useState(false);
  const [notiItems, setNotiItems] = useState<HwNotiItem[]>([]);
  const [notiError, setNotiError] = useState("");
  const [bellBadgeCount, setBellBadgeCount] = useState(0);
  const [readNotiIds, setReadNotiIds] = useState<Set<string>>(() => new Set());
  const bellWrapRef = useRef<HTMLDivElement | null>(null);

  const currentNav = NAV_GROUPS.flatMap((g) => g.items).find((n) => pathname === n.href || pathname.startsWith(n.href + "/"));

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("qc_noti_read_ids") || "[]");
      if (Array.isArray(saved)) setReadNotiIds(new Set(saved.map(String)));
    } catch { /* ignore */ }
  }, []);

  // Đóng popover chuông khi click ra ngoài
  useEffect(() => {
    if (!notiOpen) return;
    const onDown = (e: MouseEvent) => {
      if (bellWrapRef.current && !bellWrapRef.current.contains(e.target as Node)) {
        setNotiOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [notiOpen]);

  // Khi người dùng vào menu Danh sách Bug -> đánh dấu đã xem để tắt dấu chấm đỏ
  const markBugsSeen = () => {
    setNewBugsCount(0);
    if (typeof window !== "undefined") {
      const ts = latestBugAt || new Date().toISOString();
      window.localStorage.setItem("qc_bugs_last_seen_at", ts);
    }
  };

  useEffect(() => {
    if (pathname === "/bugs" || pathname.startsWith("/bugs/")) {
      setNewBugsCount(0);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("qc_bugs_last_seen_at", latestBugAt || new Date().toISOString());
      }
    }
  }, [pathname, latestBugAt]);

  const handlePulseUpdate = useCallback(
    (data: PetPulse) => {
      setLatestBugAt(data.latest_bug_at);
      if (typeof window !== "undefined") {
        const since = window.localStorage.getItem("qc_bugs_last_seen_at") || "";
        if (!since && data.latest_bug_at) {
          window.localStorage.setItem("qc_bugs_last_seen_at", data.latest_bug_at);
          setNewBugsCount(0);
        } else if (pathname === "/bugs" || pathname.startsWith("/bugs/")) {
          setNewBugsCount(0);
        } else {
          setNewBugsCount(data.new_bugs_count);
        }
      }
      const items = data.notifications?.items || [];
      setNotiItems(items);
      setNotiError(data.notifications?.error || "");

      // Tính số thông báo mới cho dấu chấm đỏ góc chuông (dựa theo mốc lần cuối bấm mở chuông)
      if (typeof window !== "undefined") {
        const seenAt = window.localStorage.getItem("qc_noti_bell_seen_at") || "";
        if (notiOpen) {
          setBellBadgeCount(0);
        } else if (!seenAt) {
          setBellBadgeCount(items.filter((x) => !x.is_read).length);
        } else {
          const unseen = items.filter((x) => !x.is_read && x.created_at && x.created_at > seenAt).length;
          setBellBadgeCount(unseen);
        }
      }
    },
    [pathname, notiOpen]
  );

  function toggleBell() {
    setNotiOpen((prev) => {
      const next = !prev;
      if (next) {
        // Đã bấm vào chuông xem danh sách -> tắt ngay dấu chấm đỏ trên chuông
        setBellBadgeCount(0);
        if (typeof window !== "undefined") {
          const latestNotiAt = notiItems[0]?.created_at || new Date().toISOString();
          window.localStorage.setItem("qc_noti_bell_seen_at", latestNotiAt);
        }
      }
      return next;
    });
  }

  function openNotiItem(n: HwNotiItem) {
    if (n.id) {
      setReadNotiIds((prev) => {
        const next = new Set(prev);
        next.add(n.id);
        try {
          window.localStorage.setItem("qc_noti_read_ids", JSON.stringify(Array.from(next).slice(-400)));
        } catch { /* ignore */ }
        return next;
      });
    }
    if (n.link) {
      window.open(n.link, "_blank", "noopener,noreferrer");
    }
  }

  useEffect(() => {
    const t = getTheme();
    setThemeState(t);
    document.documentElement.dataset.theme = t;
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    setThemeState(next);
  }

  async function syncAll() {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const q = await api<{ job_id: string }>("/sources/sync-all", { method: "POST" });
      const j = await waitJob(q.job_id);
      if (j.status === "FAILED") {
        throw new ApiError(500, "SYNC_FAILED", String((j.result as { error?: { message?: string } })?.error?.message ?? "Đồng bộ thất bại"));
      }
      const r = (j.result || {}) as {
        bugs?: { created?: number; updated?: number };
        functions?: { created?: number; updated?: number };
        builds?: { created?: number; updated?: number };
      };
      const summary = `Bug +${r.bugs?.created ?? 0}/${r.bugs?.updated ?? 0} · Function +${r.functions?.created ?? 0}/${r.functions?.updated ?? 0} · Build +${r.builds?.created ?? 0}/${r.builds?.updated ?? 0}`;
      setSyncMsg({ ok: true, text: `Đã đồng bộ: ${summary}` });
      window.dispatchEvent(new CustomEvent("qc:synced"));
    } catch (e) {
      setSyncMsg({ ok: false, text: e instanceof ApiError ? e.message : "Chưa kết nối được Haraworks (kiểm tra Cookie trong Cài đặt → Tích hợp)" });
    } finally {
      setSyncing(false);
    }
  }

  if (loading || !user) return <div className="center muted">Đang tải…</div>;

  return (
    <div className="app-frame">
      <header className="topbar">
        <div className="brand-group">
          <span className="brand-title">QC Platform</span>
          {currentNav && <span className="muted">/ {currentNav.label}</span>}
        </div>
        <div className="topbar-right">
          {syncMsg && (
            <span className={`badge ${syncMsg.ok ? "ok" : "bad"}`} title={syncMsg.text}>
              {syncMsg.ok ? "Đã đồng bộ" : "Lỗi đồng bộ"}
            </span>
          )}
          <button className="sm" onClick={() => void syncAll()} disabled={syncing} title="Đồng bộ tất cả dữ liệu Bug, Task Function và Build từ Haraworks">
            {syncing ? "Đang đồng bộ…" : "⟳ Đồng bộ"}
          </button>
          <button className="sm" onClick={toggleTheme} title="Chuyển chế độ giao diện Sáng / Tối">
            {theme === "light" ? "Chế độ tối" : "Chế độ sáng"}
          </button>
          {/* Nút chuông SVG đẹp + chấm số nhỏ ở góc trên phải + khung danh sách thông báo */}
          <div ref={bellWrapRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="bell-icon-btn"
              onClick={toggleBell}
              title="Thông báo Haraworks"
              aria-label="Thông báo Haraworks"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {bellBadgeCount > 0 && (
                <span className="bell-corner-badge">{bellBadgeCount > 99 ? "99+" : bellBadgeCount}</span>
              )}
            </button>

            {notiOpen && (
              <div className="noti-popover" role="region" aria-label="Danh sách thông báo">
                <div className="noti-popover-head">
                  <strong>Thông báo</strong>
                  <span className="muted" style={{ fontSize: 11.5 }}>{notiItems.length} mục gần nhất</span>
                </div>
                {notiError && (
                  <div style={{ padding: "8px 12px" }}>
                    <div className="err" style={{ margin: 0, fontSize: 12 }}>{notiError}</div>
                  </div>
                )}
                <div className="noti-popover-list">
                  {notiItems.length === 0 ? (
                    <div className="muted" style={{ padding: 20, textAlign: "center" }}>
                      Chưa có thông báo nào.
                    </div>
                  ) : (
                    notiItems.map((n) => {
                      const isRead = n.is_read || readNotiIds.has(n.id);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          className={`noti-row${isRead ? " is-read" : " is-unread"}`}
                          onClick={() => openNotiItem(n)}
                        >
                          <div className="row" style={{ justifyContent: "space-between", gap: 6, width: "100%", marginBottom: 2 }}>
                            <span style={{ fontWeight: 600, fontSize: 12, color: "var(--brand)" }}>
                              {n.actor || n.module_name}
                            </span>
                            <span className="muted" style={{ fontSize: 11 }}>{formatDateBadge(n.created_at)}</span>
                          </div>
                          {n.title && <div style={{ fontWeight: isRead ? 500 : 600, fontSize: 13, lineHeight: 1.35 }}>{n.title}</div>}
                          {n.content && (
                            <div className="muted" style={{ fontSize: 12, lineHeight: 1.35, marginTop: 2 }}>
                              {n.content}
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <button
            className="sm"
            onClick={() => setHelpOpen(true)}
            title="Hướng dẫn sử dụng từng menu"
            aria-label="Hướng dẫn sử dụng"
            style={{ fontWeight: 700, minWidth: 30, justifyContent: "center" }}
          >
            ?
          </button>
          <span className="muted" style={{ padding: "0 4px" }}>{user.display_name}</span>
          <button className="sm" onClick={() => void logout()}>Đăng xuất</button>
        </div>
      </header>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
      <div className="shell">
        <nav className="side" aria-label="Điều hướng chính">
          {NAV_GROUPS.map((g) => (
            <div key={g.title}>
              <div className="side-section">{g.title}</div>
              {g.items.map((n) => {
                const showBugDot = n.href === "/bugs" && newBugsCount > 0;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    title={n.tip}
                    onClick={n.href === "/bugs" ? markBugsSeen : undefined}
                    className={pathname === n.href || pathname.startsWith(n.href + "/") ? "active" : ""}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
                  >
                    <span>{n.label}</span>
                    {showBugDot && (
                      <span className="nav-red-badge">{newBugsCount > 99 ? "99+" : newBugsCount}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <main className="main">{children}</main>
      </div>
      <QaPetWidget onPulseUpdate={handlePulseUpdate} />
    </div>
  );
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
