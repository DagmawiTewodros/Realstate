"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "SALES_MANAGER" | "BROKER" | "PROPERTY_MANAGER" | "LANDLORD" | "TENANT";
  locale: "am" | "en";
  linkedEntityId: string | null;
}

interface SessionValue {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({ user: null, loading: true, refresh: async () => {}, logout: async () => {} });

export function setLocaleCookie(locale: "am" | "en") {
  document.cookie = `locale=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/** Loads the signed-in user once and sends them to the login page when the session ends. */
export function SessionProvider({ children, require }: { children: ReactNode; require?: SessionUser["role"][] }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: SessionUser }>("/auth/me");
      setUser(res.user);
    } catch (e) {
      setUser(null);
      if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
    const onExpired = () => router.replace("/login");
    window.addEventListener("session-expired", onExpired);
    return () => window.removeEventListener("session-expired", onExpired);
  }, [refresh, router]);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    setUser(null);
    router.replace("/login");
  }, [router]);

  if (!loading && user && require && !require.includes(user.role)) {
    // Signed in, but this area is for other roles: send them to their own home.
    const home = user.role === "LANDLORD" ? "/portal/landlord" : user.role === "TENANT" ? "/portal/tenant" : "/staff";
    if (typeof window !== "undefined") router.replace(home);
    return null;
  }

  return <SessionContext.Provider value={{ user, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

export function homeFor(role: SessionUser["role"]): string {
  if (role === "LANDLORD") return "/portal/landlord";
  if (role === "TENANT") return "/portal/tenant";
  return "/staff";
}
