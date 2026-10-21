"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Loading } from "@platform/ui";
import { homeFor, useSession } from "@/lib/session";
import { LanguageSwitch } from "./LanguageSwitch";

/** Top bar for landlords and tenants: their home, account, language, and sign out. */
export function PortalShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const p = useTranslations("portal");
  const c = useTranslations("common");
  const { user, loading, logout } = useSession();
  const pathname = usePathname();
  if (loading || !user) {
    return (
      <main>
        <div className="container">
          <Loading label={c("loading")} />
        </div>
      </main>
    );
  }
  const home = homeFor(user.role);
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link href={home} className="brand">
            {t("portal")}
          </Link>
          <div className="row">
            <span className="small muted">{user.name}</span>
            <LanguageSwitch signedIn />
            <button type="button" className="btn secondary small" onClick={() => void logout()}>
              {t("signOut")}
            </button>
          </div>
          <nav className="nav" aria-label={t("portal")}>
            <Link href={home} aria-current={pathname === home ? "page" : undefined}>
              {p("home")}
            </Link>
            <Link href="/portal/account" aria-current={pathname === "/portal/account" ? "page" : undefined}>
              {p("account")}
            </Link>
          </nav>
        </div>
      </header>
      <main>
        <div className="container">{children}</div>
      </main>
    </>
  );
}
