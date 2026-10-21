"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Loading } from "@platform/ui";
import { useSession, type SessionUser } from "@/lib/session";
import { LanguageSwitch } from "./LanguageSwitch";

type Role = SessionUser["role"];

/** Menu items per role. Hidden items are still blocked by the API (see docs/PERMISSIONS-property.md). */
export const STAFF_MENU: Array<{ href: string; key: string; roles: Role[] }> = [
  { href: "/staff", key: "myDay", roles: ["SALES_MANAGER", "BROKER"] },
  { href: "/staff/dashboard", key: "dashboard", roles: ["OWNER", "SALES_MANAGER", "PROPERTY_MANAGER"] },
  { href: "/staff/pipeline", key: "pipeline", roles: ["OWNER", "SALES_MANAGER", "BROKER"] },
  { href: "/staff/leads", key: "leads", roles: ["OWNER", "SALES_MANAGER", "BROKER"] },
  { href: "/staff/customers", key: "customers", roles: ["OWNER", "SALES_MANAGER", "BROKER", "PROPERTY_MANAGER"] },
  { href: "/staff/units", key: "units", roles: ["OWNER", "SALES_MANAGER", "BROKER", "PROPERTY_MANAGER"] },
  { href: "/staff/projects", key: "projects", roles: ["OWNER", "SALES_MANAGER"] },
  { href: "/staff/leases", key: "rentals", roles: ["OWNER", "PROPERTY_MANAGER", "SALES_MANAGER"] },
  { href: "/staff/landlords", key: "landlords", roles: ["OWNER", "PROPERTY_MANAGER", "SALES_MANAGER"] },
  { href: "/staff/maintenance", key: "maintenance", roles: ["OWNER", "PROPERTY_MANAGER"] },
  { href: "/staff/arrears", key: "arrears", roles: ["OWNER", "PROPERTY_MANAGER"] },
  { href: "/staff/imports", key: "imports", roles: ["OWNER", "SALES_MANAGER", "PROPERTY_MANAGER"] },
  { href: "/staff/users", key: "users", roles: ["OWNER"] },
  { href: "/staff/messages", key: "messages", roles: ["OWNER"] },
  { href: "/staff/settings", key: "settings", roles: ["OWNER"] },
];

export function StaffShell({ children }: { children: ReactNode }) {
  const t = useTranslations("nav");
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

  const items = STAFF_MENU.filter((m) => m.roles.includes(user.role));
  const active = (href: string) => (href === "/staff" ? pathname === "/staff" : pathname.startsWith(href));

  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link href="/staff" className="brand">
            {t("staff")}
          </Link>
          <div className="row">
            <span className="small muted">
              {user.name} · {e(`ROLE.${user.role}`)}
            </span>
            <LanguageSwitch signedIn />
            <button type="button" className="btn secondary small" onClick={() => void logout()}>
              {t("signOut")}
            </button>
          </div>
          <nav className="nav" aria-label="Staff">
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
