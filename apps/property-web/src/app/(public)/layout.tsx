import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import type { SiteSettings } from "@platform/shared";
import { publicGet } from "@/lib/server-api";
import { LanguageSwitch } from "@/components/LanguageSwitch";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("nav");
  const locale = (await getLocale()) as "am" | "en";
  const site = await publicGet<SiteSettings>("/public/settings").catch(() => null);
  const name = site?.companyName[locale] || site?.companyName.en || "Real estate";
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link href="/" className="brand">
            {name}
          </Link>
          <nav className="nav" aria-label="Main">
            <Link href="/listings">{t("listings")}</Link>
            <Link href="/about">{t("about")}</Link>
            <Link href="/contact">{t("contact")}</Link>
            <Link href="/login">{t("signIn")}</Link>
          </nav>
          <LanguageSwitch />
        </div>
      </header>
      <main>
        <div className="container">{children}</div>
      </main>
      <footer className="site-footer">
        <div className="container stack">
          <strong>{name}</strong>
          {site?.phone ? <span>{site.phone}</span> : null}
          {site?.address[locale] ? <span>{site.address[locale]}</span> : null}
          {site?.socialLinks?.length ? (
            <span className="row">
              {site.socialLinks.map((l) => (
                <a key={l.url} href={l.url} rel="noopener noreferrer" target="_blank">
                  {l.label}
                </a>
              ))}
            </span>
          ) : null}
        </div>
      </footer>
    </>
  );
}
