"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type User } from "./api";

type AuthState = { user: User | null; loading: boolean; reload: () => Promise<void>; logout: () => Promise<void> };
const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth phải nằm trong <AuthProvider>");
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const reload = useCallback(async () => {
    try {
      setUser(await api<User>("/auth/me"));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.must_change_password && pathname !== "/account") router.replace("/account");
  }, [user, loading, pathname, router]);

  const logout = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
      router.replace("/login");
    }
  }, [router]);

  return <Ctx.Provider value={{ user, loading, reload, logout }}>{children}</Ctx.Provider>;
}
