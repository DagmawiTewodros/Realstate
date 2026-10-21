"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@platform/shared";
import { Alert, DataList, LocalDate, Stat } from "@platform/ui";
import type { Statement } from "@/lib/types";

/** One month's owner statement: totals, then rent per lease and maintenance paid by the owner. */
export function StatementView({ statement }: { statement: Statement }) {
  const t = useTranslations("statements");
  const locale = useLocale() as "am" | "en";
  const f = statement.figures;
  const money = (v: number) => formatMoney(v, locale);
  return (
    <div className="stack">
      {statement.preview ? <Alert kind="warn">{t("preview")}</Alert> : <p className="small muted">{t("issued", { version: statement.version })} <LocalDate value={statement.issuedAt} locale={locale} withTime /></p>}
      <div className="grid cols-4">
        <Stat label={t("charged")} value={money(f.rentChargedMinor)} />
        <Stat label={t("received")} value={money(f.rentReceivedMinor)} tone="ok" />
        <Stat label={t("maintenance")} value={money(f.maintenanceCostMinor)} />
        <Stat label={t("net")} value={money(f.netMinor)} />
      </div>
      <p className="small">
        {t("arrears")}: <strong>{money(f.arrearsMinor)}</strong>
      </p>
      {f.leases.length ? (
        <DataList
          caption={t("byLease")}
          rows={f.leases}
          rowKey={(l) => l.leaseId}
          columns={[
            { key: "unit", label: t("unit"), render: (l) => l.unitCode },
            { key: "tenant", label: t("tenant"), render: (l) => l.tenantName },
            { key: "charged", label: t("charged"), render: (l) => money(l.chargedMinor) },
            { key: "received", label: t("received"), render: (l) => money(l.receivedMinor) },
            { key: "arrears", label: t("arrears"), render: (l) => money(l.arrearsMinor) },
          ]}
        />
      ) : null}
      {f.maintenance.length ? (
        <DataList
          caption={t("maintenance")}
          rows={f.maintenance}
          rowKey={(m) => m.requestId}
          columns={[
            { key: "unit", label: t("unit"), render: (m) => m.unitCode },
            { key: "title", label: t("repair"), render: (m) => m.title },
            { key: "cost", label: t("cost"), render: (m) => money(m.costMinor) },
            { key: "closed", label: t("closed"), render: (m) => <LocalDate value={m.closedAt} locale={locale} /> },
          ]}
        />
      ) : null}
    </div>
  );
}

/** "YYYY-MM" for the month before the given Addis date string. */
export function previousMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
