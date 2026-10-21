"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues?: Array<{ path: Array<string | number>; message: string }>,
  ) {
    super(message);
  }

  /** Field errors from a VALIDATION_FAILED response, keyed by the first path segment. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const i of this.issues ?? []) {
      const key = String(i.path[0] ?? "");
      if (key && !out[key]) out[key] = i.message;
    }
    return out;
  }
}

async function parse(res: Response): Promise<unknown> {
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("application/json")) return res.json();
  return res.text();
}

/** Calls the API through the same-origin /api proxy, so the session cookie is sent automatically. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: json !== undefined ? { "content-type": "application/json", ...headers } : headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const body = await parse(res);
  if (!res.ok) {
    const b = (typeof body === "object" && body ? body : {}) as { code?: string; message?: string; issues?: ApiError["issues"] };
    if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
      window.dispatchEvent(new CustomEvent("session-expired"));
    }
    throw new ApiError(res.status, b.code ?? "ERROR", b.message ?? `Request failed (${res.status})`, b.issues);
  }
  return body as T;
}

/** Loads data for a screen, with loading and error state and a reload function. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++latest.current;
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (id === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (id === latest.current) setError(e instanceof ApiError ? e : new ApiError(0, "NETWORK", "Network error"));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
