import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { SiteSettings } from "@platform/shared";
import { publicGet } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("public"))("aboutTitle") };
}

export default async function AboutPage() {
  const t = await getTranslations("public");
  const locale = (await getLocale()) as "am" | "en";
  const site = await publicGet<SiteSettings>("/public/settings").catch(() => null);
  return (
    <article className="card stack">
      <h1>{t("aboutTitle")}</h1>
      <p style={{ whiteSpace: "pre-line" }}>{site?.about[locale] || site?.about.en || ""}</p>
    </article>
  );
}
