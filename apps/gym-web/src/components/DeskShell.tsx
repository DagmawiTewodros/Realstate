"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { GymRole } from "@platform/shared";
import { Loading } from "@platform/ui";
import { homeFor, useSession } from "@/lib/session";
import { LanguageSwitch } from "./LanguageSwitch";

/** Menu per role. Hidden items are still blocked by the API (see apps/gym-api/API.md). */
export const DESK_MENU: Array<{ href: string; key: string; roles: GymRole[] }> = [
  { href: "/desk/dashboard", key: "dashboard", roles: ["OWNER", "GYM_MANAGER"] },
  { href: "/desk", key: "checkin", roles: ["OWNER", "GYM_MANAGER", "FRONT_DESK"] },
  { href: "/desk/members", key: "members", roles: ["OWNER", "GYM_MANAGER", "FRONT_DESK"] },
  { href: "/desk/trainer", key: "mySchedule", roles: ["TRAINER"] },
  { href: "/desk/classes", key: "classes", roles: ["OWNER", "GYM_MANAGER", "FRONT_DESK", "TRAINER"] },
  { href: "/desk/plans", key: "plans", roles: ["OWNER", "GYM_MANAGER"] },
  { href: "/desk/trainers", key: "trainers", roles: ["OWNER", "GYM_MANAGER"] },
  { href: "/desk/campaigns", key: "campaigns", roles: ["OWNER", "GYM_MANAGER"] },
  { href: "/desk/users", key: "users", roles: ["OWNER"] },
  { href: "/desk/messages", key: "messages", roles: ["OWNER"] },
  { href: "/desk/settings", key: "settings", roles: ["OWNER"] },
];

export function DeskShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const a = useTranslations("app");
  const c = useTranslations("common");
  const e = useTranslations("enums");
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
  const items = DESK_MENU.filter((m) => m.roles.includes(user.role));
  const active = (href: string) => (href === "/desk" ? pathname === "/desk" : pathname.startsWith(href));
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link href={homeFor(user.role)} className="brand">
            {a("name")}
          </Link>
          <div className="row">
            <Link href="/account" className="small muted">
              {user.name} · {e(`ROLE.${user.role}`)}
            </Link>
            <LanguageSwitch signedIn />
            <button type="button" className="btn secondary small" onClick={() => void logout()}>
              {t("signOut")}
            </button>
          </div>
          <nav className="nav" aria-label={a("name")}>
            {items.map((m) => (
              <Link key={m.href} href={m.href} aria-current={active(m.href) ? "page" : undefined}>
                {t(m.key)}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main>
        <div className="container">{children}</div>
      </main>
    </>
  );
}

/** A simple top bar for members (and for the account page). */
export function MemberShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
  const a = useTranslations("app");
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
            {a("name")}
          </Link>
          <div className="row">
            <span className="small muted">{user.name}</span>
            <LanguageSwitch signedIn />
            <button type="button" className="btn secondary small" onClick={() => void logout()}>
              {t("signOut")}
            </button>
          </div>
          <nav className="nav" aria-label={a("name")}>
            <Link href={home} aria-current={pathname === home ? "page" : undefined}>
              {t("home")}
            </Link>
            <Link href="/account" aria-current={pathname === "/account" ? "page" : undefined}>
              {t("account")}
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
