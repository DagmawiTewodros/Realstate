"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LEASE_STATUSES } from "@platform/shared";
import { Alert, Badge, DataList, EmptyState, LocalDate, Loading, Money, PageHeader, SelectField } from "@platform/ui";
import { qs, useApi } from "@/lib/api";
import { RENTAL_WRITERS, useSession } from "@/lib/session";
import { leaseTone } from "@/lib/tones";

export interface Lease {
  id: string;
  unitId: string;
  tenantId: string;
  landlordId: string | null;
  startDate: string;
  endDate: string;
  rentMinor: number;
  billingFrequency: string;
  depositMinor: number;
  depositStatus: string;
  status: string;
  terminationReason: string | null;
  notes: string | null;
  creditMinor: number;
  previousLeaseId: string | null;
  activatedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export type LeaseRow = Lease & { unit: { id: string; code: string }; tenant: { id: string; name: string }; landlord: { id: string; name: string } | null };

export default function LeasesPage() {
  const t = useTranslations("leases");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const [status, setStatus] = useState("ACTIVE");
  const [expiring, setExpiring] = useState("");
  const { data, error, loading } = useApi<{ items: LeaseRow[] }>(`/leases${qs({ status: expiring ? undefined : status, expiringDays: expiring })}`);
  const canWrite = Boolean(user && RENTAL_WRITERS.includes(user.role));

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          canWrite ? (
            <Link className="btn" href="/staff/leases/new">
              {t("new")}
            </Link>
          ) : null
        }
      />
      <form className="filters card" role="search" onSubmit={(ev) => ev.preventDefault()}>
        <SelectField
          label={c("status")}
          value={status}
          disabled={Boolean(expiring)}
          onChange={(ev) => setStatus(ev.target.value)}
          options={[{ value: "", label: c("all") }, ...LEASE_STATUSES.map((s) => ({ value: s, label: e(`LEASE_STATUS.${s}`) }))]}
        />
        <SelectField
          label={t("expiring")}
          value={expiring}
          onChange={(ev) => setExpiring(ev.target.value)}
          options={[
            { value: "", label: c("all") },
            { value: "30", label: t("withinDays", { days: 30 }) },
            { value: "60", label: t("withinDays", { days: 60 }) },
            { value: "90", label: t("withinDays", { days: 90 }) },
          ]}
        />
      </form>
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={c("noResults")} /> : null}
      {data && data.items.length ? (
        <>
          <p className="small muted">{t("count", { count: data.items.length })}</p>
          <DataList
            caption={t("title")}
            rows={data.items}
            rowKey={(l) => l.id}
            columns={[
              {
                key: "unit",
                label: t("unit"),
                render: (l) => (
                  <Link href={`/staff/leases/${l.id}`}>
                    <strong>{l.unit.code}</strong>
                  </Link>
                ),
              },
              { key: "tenant", label: t("tenant"), render: (l) => l.tenant.name },
              { key: "landlord", label: t("landlord"), render: (l) => l.landlord?.name ?? "-" },
              {
                key: "term",
                label: t("term"),
                render: (l) => (
                  <span className="small">
                    <LocalDate value={l.startDate} locale={locale} /> – <LocalDate value={l.endDate} locale={locale} />
                  </span>
                ),
              },
              {
                key: "rent",
                label: t("rent"),
                render: (l) => (
                  <span>
                    <Money minor={l.rentMinor} locale={locale} /> <span className="small muted">{e(`BILLING.${l.billingFrequency}`)}</span>
                  </span>
                ),
              },
              { key: "status", label: c("status"), render: (l) => <Badge tone={leaseTone(l.status)}>{e(`LEASE_STATUS.${l.status}`)}</Badge> },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}
