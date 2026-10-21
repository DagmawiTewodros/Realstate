import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/server-api";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/listings", "/about", "/contact"], disallow: ["/staff", "/portal", "/login", "/invite", "/optout", "/api"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
