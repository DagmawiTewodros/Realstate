import "server-only";

const API_URL = process.env.PROPERTY_API_URL ?? "http://localhost:4000";

/** Server-side fetch for public pages (no cookies). Returns null on 404 so pages can show "not found". */
export async function publicGet<T>(path: string, revalidate = 60): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return (await res.json()) as T;
}

export function siteUrl(): string {
  return (process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
