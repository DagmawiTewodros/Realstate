"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { GymRole } from "@platform/shared";
import { api, ApiError } from "./api";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: GymRole;
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

/** Where each role starts: members get their own app, trainers their schedule, everyone else the desk. */
export function homeFor(role: GymRole): string {
  if (role === "MEMBER") return "/me";
  if (role === "TRAINER") return "/desk/trainer";
  if (role === "OWNER" || role === "GYM_MANAGER") return "/desk/dashboard";
  return "/desk";
}

/** Loads the signed-in user once and sends them to the login page when the session ends. */
export function SessionProvider({ children, require }: { children: ReactNode; require?: GymRole[] }) {
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

  const wrongArea = !loading && user && require && !require.includes(user.role);
  useEffect(() => {
    if (wrongArea && user) router.replace(homeFor(user.role));
  }, [wrongArea, user, router]);
  if (wrongArea) return null;

  return <SessionContext.Provider value={{ user, loading, refresh, logout }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}

export const isManager = (u: SessionUser | null) => u?.role === "OWNER" || u?.role === "GYM_MANAGER";
export const isDesk = (u: SessionUser | null) => isManager(u) || u?.role === "FRONT_DESK";
