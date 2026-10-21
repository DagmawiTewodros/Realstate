import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import type { SiteSettings } from "@platform/shared";
import { publicGet } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("public"))("contactTitle") };
}

export default async function ContactPage() {
  const t = await getTranslations("public");
  const c = await getTranslations("common");
  const locale = (await getLocale()) as "am" | "en";
  const site = await publicGet<SiteSettings>("/public/settings").catch(() => null);
  return (
    <article className="card stack">
      <h1>{t("contactTitle")}</h1>
      {site?.phone ? (
        <p>
          <strong>{c("phone")}: </strong>
          <a href={`tel:${site.phone}`}>{site.phone}</a>
        </p>
      ) : null}
      {site?.email ? (
        <p>
          <strong>{c("email")}: </strong>
          <a href={`mailto:${site.email}`}>{site.email}</a>
        </p>
      ) : null}
      {site?.address[locale] ? (
        <p>
          <strong>{t("address")}: </strong>
          {site.address[locale]}
        </p>
      ) : null}
      {site?.openingHours[locale] ? (
        <p>
          <strong>{t("hours")}: </strong>
          {site.openingHours[locale]}
        </p>
      ) : null}
    </article>
  );
}
