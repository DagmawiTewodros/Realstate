"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney } from "@platform/shared";
import { Alert, Badge, DataList, EmptyState, LocalDate, Loading, Money, PageHeader, Stat } from "@platform/ui";
import { useApi } from "@/lib/api";

interface ArrearsRow {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  unitCode: string;
  dueMinor: number;
  oldestDue: string;
  daysOverdue: number;
}

export default function ArrearsPage() {
  const t = useTranslations("arrears");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const { data, error, loading } = useApi<{ items: ArrearsRow[] }>("/arrears");
  const total = data?.items.reduce((a, r) => a + r.dueMinor, 0) ?? 0;

  return (
    <div className="stack">
      <PageHeader title={t("title")} subtitle={<span className="small muted">{t("help")}</span>} />
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={t("none")} /> : null}
      {data && data.items.length ? (
        <>
          <div className="grid cols-2">
            <Stat label={t("total")} value={formatMoney(total, locale)} tone="danger" />
            <Stat label={t("tenants")} value={data.items.length} />
          </div>
          <DataList
            caption={t("title")}
            rows={data.items}
            rowKey={(r) => r.leaseId}
            columns={[
              {
                key: "tenant",
                label: t("tenant"),
                render: (r) => (
                  <Link href={`/staff/leases/${r.leaseId}`}>
                    <strong>{r.tenantName}</strong>
                  </Link>
                ),
              },
              { key: "unit", label: t("unit"), render: (r) => r.unitCode },
              { key: "due", label: t("owed"), render: (r) => <Money minor={r.dueMinor} locale={locale} /> },
              { key: "oldest", label: t("oldestDue"), render: (r) => <LocalDate value={r.oldestDue} locale={locale} /> },
              {
                key: "days",
                label: t("daysOverdue"),
                render: (r) => <Badge tone={r.daysOverdue > 60 ? "danger" : r.daysOverdue > 30 ? "warn" : undefined}>{t("days", { count: r.daysOverdue })}</Badge>,
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}
