"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";

const NAV = [
  { href: "/lookup", label: "Tra cứu theo mô tả bug" },
  { href: "/sources", label: "Nguồn tài liệu" },
  { href: "/approvals", label: "Duyệt" },
  { href: "/library", label: "Thư viện rule (cũ)" },
  { href: "/bugs", label: "Tra cứu bug" },
  { href: "/automation", label: "Tác vụ tự động" },
  { href: "/runners", label: "Runner" },
  { href: "/environments", label: "Môi trường & tài khoản" },
  { href: "/users", label: "Người dùng QC" },
  { href: "/audit", label: "Nhật ký" },
  { href: "/account", label: "Tài khoản của tôi" },
];

function Shell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  if (loading || !user) return <div className="center muted">Đang tải…</div>;
  return (
    <div className="shell">
      <nav className="side" aria-label="Điều hướng chính">
        <h1>QC Platform</h1>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={pathname.startsWith(n.href) ? "active" : ""}>
            {n.label}
          </Link>
        ))}
        <div className="who">
          {user.display_name} · QC
          <div>
            <button onClick={() => void logout()}>Đăng xuất</button>
          </div>
        </div>
      </nav>
      <main className="main">{children}</main>
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
