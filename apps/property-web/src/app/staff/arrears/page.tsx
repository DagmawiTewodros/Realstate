"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@platform/shared";
import { Alert, Badge, DataList, EmptyState, LocalDate, Loading, PageHeader } from "@platform/ui";
import { useApi } from "@/lib/api";

interface Row {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  unitCode: string;
  dueMinor: number;
  oldestDue: string;
  daysOverdue: number;
}

/** Tenants with unpaid rent past its due date, oldest first. */
export default function ArrearsPage() {
  const t = useTranslations("rentals");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const { data, error, loading } = useApi<{ items: Row[] }>("/arrears");
  const total = data?.items.reduce((a, r) => a + r.dueMinor, 0) ?? 0;

  return (
    <div className="stack">
      <PageHeader title={t("arrears")} subtitle={data ? t("arrearsTotal", { amount: formatMoney(total, locale), count: data.items.length }) : null} />
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={t("noArrears")} /> : null}
      {data && data.items.length ? (
        <DataList
          caption={t("arrears")}
          rows={data.items}
          rowKey={(r) => r.leaseId}
          columns={[
            { key: "tenant", label: t("tenant"), render: (r) => <Link href={`/staff/leases/${r.leaseId}`}>{r.tenantName}</Link> },
            { key: "unit", label: t("unit"), render: (r) => r.unitCode },
            { key: "due", label: t("owed"), render: (r) => <strong>{formatMoney(r.dueMinor, locale)}</strong> },
            { key: "since", label: t("oldestDue"), render: (r) => <LocalDate value={r.oldestDue} locale={locale} /> },
            { key: "days", label: t("daysOverdue"), render: (r) => <Badge tone={r.daysOverdue > 30 ? "danger" : "warn"}>{t("days", { count: r.daysOverdue })}</Badge> },
          ]}
        />
      ) : null}
    </div>
  );
}
