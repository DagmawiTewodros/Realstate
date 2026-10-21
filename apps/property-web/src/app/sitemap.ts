import type { MetadataRoute } from "next";
import { publicGet, siteUrl } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const data = await publicGet<{ units: Array<{ id: string; updatedAt: string }> }>("/public/sitemap", 300).catch(() => ({ units: [] }));
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/listings`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/contact`, changeFrequency: "monthly", priority: 0.3 },
    ...(data?.units ?? []).map((u) => ({ url: `${base}/listings/${u.id}`, lastModified: new Date(u.updatedAt), changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
