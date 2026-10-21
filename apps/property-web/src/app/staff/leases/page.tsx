"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LEASE_STATUSES } from "@platform/shared";
import { Alert, Badge, DataList, EmptyState, LocalDate, Loading, Money, PageHeader, SelectField } from "@platform/ui";
import { qs, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { leaseTone } from "@/lib/tones";
import type { Lease } from "@/lib/types";

type Row = Lease & { unit: { id: string; code: string }; tenant: { id: string; name: string }; landlord: { id: string; name: string } | null };

export default function LeasesPage() {
  const t = useTranslations("rentals");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const [status, setStatus] = useState("ACTIVE");
  const [expiring, setExpiring] = useState("");
  const { data, error, loading } = useApi<{ items: Row[] }>(`/leases${qs({ status: expiring ? undefined : status, expiringDays: expiring || undefined })}`);
  const canEdit = user?.role === "OWNER" || user?.role === "PROPERTY_MANAGER";

  return (
    <div className="stack">
      <PageHeader
        title={t("leases")}
        actions={
          canEdit ? (
            <Link className="btn" href="/staff/leases/new">
              {t("newLease")}
            </Link>
          ) : null
        }
      />
      <form className="filters card" onSubmit={(ev) => ev.preventDefault()}>
        <SelectField
          label={c("status")}
          value={status}
          disabled={Boolean(expiring)}
          onChange={(ev) => setStatus(ev.target.value)}
          options={[{ value: "", label: c("all") }, ...LEASE_STATUSES.map((s) => ({ value: s, label: e(`LEASE_STATUS.${s}`) }))]}
        />
        <SelectField
          label={t("endingWithin")}
          value={expiring}
          onChange={(ev) => setExpiring(ev.target.value)}
          options={[
            { value: "", label: c("all") },
            { value: "30", label: t("days", { count: 30 }) },
            { value: "60", label: t("days", { count: 60 }) },
            { value: "90", label: t("days", { count: 90 }) },
          ]}
        />
      </form>
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={c("noResults")} /> : null}
      {data && data.items.length ? (
        <DataList
          caption={t("leases")}
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
            {
              key: "term",
              label: t("term"),
              render: (l) => (
                <span>
                  <LocalDate value={l.startDate} locale={locale} /> → <LocalDate value={l.endDate} locale={locale} />
                </span>
              ),
            },
            { key: "rent", label: t("rent"), render: (l) => <span><Money minor={l.rentMinor} locale={locale} /> / {e(`BILLING.${l.billingFrequency}`)}</span> },
            { key: "status", label: c("status"), render: (l) => <Badge tone={leaseTone(l.status)}>{e(`LEASE_STATUS.${l.status}`)}</Badge> },
            { key: "landlord", label: t("landlord"), render: (l) => l.landlord?.name ?? "-" },
          ]}
        />
      ) : null}
    </div>
  );
}
