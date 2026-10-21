"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LEAD_SOURCES, LEAD_STATUSES, UNIT_STATUSES, addDays, addisDateString, formatMoney } from "@platform/shared";
import { Alert, Bars, Card, DataList, LocalDate, Money, PageHeader, Stat, TextField } from "@platform/ui";
import { qs, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";

interface LeadsReport {
  total: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  signed: number;
  conversionRate: number;
  notContacted: number;
  avgMinutesToFirstContact: number | null;
  medianMinutesToFirstContact: number | null;
}
interface BrokersReport {
  items: Array<{ brokerId: string; name: string; assigned: number; contactedWithinHour: number; overdueFollowUps: number; signed: number }>;
}
interface ListingsReport {
  byStatus: Record<string, number>;
  withoutPhotos: Array<{ id: string; code: string; project: string }>;
  notUpdatedIn30Days: Array<{ id: string; code: string; project: string }>;
  averageDaysOnMarket: number | null;
}
interface Occupancy {
  managedUnits: number;
  byStatus: Record<string, number>;
  occupancyRate: number;
  vacantUnits: Array<{ id: string; code: string; status: string; vacantDays: number }>;
}
interface RentReport {
  months: Array<{ month: string; chargedMinor: number; collectedMinor: number; collectionRate: number }>;
  chargedMinor: number;
  collectedMinor: number;
  collectionRate: number;
}
interface Aging {
  buckets: Array<{ label: string; amountMinor: number }>;
  totalMinor: number;
}
interface Expiring {
  within30: number;
  within60: number;
  within90: number;
  items: Array<{ leaseId: string; endDate: string; unitCode: string; tenantName: string }>;
}
interface MaintenanceReport {
  openByPriority: Record<string, number>;
  averageDaysToClose: number | null;
  costByUnit: Array<{ unitId: string; code: string; costMinor: number }>;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const today = addisDateString(new Date());
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });
  const role = user?.role;
  const sales = role === "OWNER" || role === "SALES_MANAGER";
  const rentals = role === "OWNER" || role === "PROPERTY_MANAGER";
  const occupancyAllowed = sales || rentals;
  const q = qs(range);

  const leads = useApi<LeadsReport>(sales ? `/reports/leads${q}` : null);
  const brokers = useApi<BrokersReport>(sales ? `/reports/brokers${q}` : null);
  const listings = useApi<ListingsReport>(sales ? `/reports/listings` : null);
  const occupancy = useApi<Occupancy>(occupancyAllowed ? "/reports/occupancy" : null);
  const rent = useApi<RentReport>(rentals ? `/reports/rent${qs({ from: addDays(today, -364), to: today })}` : null);
  const aging = useApi<Aging>(rentals ? "/reports/arrears-aging" : null);
  const expiring = useApi<Expiring>(rentals ? "/reports/leases-expiring" : null);
  const maintenance = useApi<MaintenanceReport>(rentals ? `/reports/maintenance${q}` : null);
  const anyError = [leads, brokers, listings, occupancy, rent, aging, expiring, maintenance].find((r) => r.error)?.error;
  const minutes = (m: number | null) => (m === null ? "-" : m < 120 ? t("minutes", { count: Math.round(m) }) : t("hours", { count: Math.round(m / 60) }));

  return (
    <div className="stack">
      <PageHeader title={t("title")} />
      {anyError ? <Alert kind="error">{anyError.message}</Alert> : null}
      {sales || rentals ? (
        <form className="filters card" onSubmit={(ev) => ev.preventDefault()}>
          <TextField label={c("from")} type="date" value={range.from} max={range.to} onChange={(ev) => ev.target.value && setRange((r) => ({ ...r, from: ev.target.value }))} />
          <TextField label={c("to")} type="date" value={range.to} min={range.from} onChange={(ev) => ev.target.value && setRange((r) => ({ ...r, to: ev.target.value }))} />
        </form>
      ) : null}

      {sales && leads.data ? (
        <section className="stack">
          <h2>{t("sales")}</h2>
          <div className="grid cols-4">
            <Stat label={t("newLeads")} value={leads.data.total} />
            <Stat label={t("signed")} value={leads.data.signed} tone="ok" />
            <Stat label={t("conversion")} value={pct(leads.data.conversionRate)} />
            <Stat label={t("notContacted")} value={leads.data.notContacted} tone={leads.data.notContacted ? "danger" : undefined} />
          </div>
          <div className="grid cols-2">
            <Card title={t("byStatus")}>
              <Bars items={LEAD_STATUSES.map((s) => ({ label: e(`LEAD_STATUS.${s}`), value: leads.data!.byStatus[s] ?? 0 }))} />
            </Card>
            <Card title={t("bySource")}>
              <Bars items={LEAD_SOURCES.filter((s) => leads.data!.bySource[s]).map((s) => ({ label: e(`LEAD_SOURCE.${s}`), value: leads.data!.bySource[s] }))} />
              {Object.keys(leads.data.bySource).length === 0 ? <p className="muted small">{c("none")}</p> : null}
            </Card>
          </div>
          <Card title={t("responseTime")}>
            <dl className="facts">
              <dt>{t("average")}</dt>
              <dd>{minutes(leads.data.avgMinutesToFirstContact)}</dd>
              <dt>{t("median")}</dt>
              <dd>{minutes(leads.data.medianMinutesToFirstContact)}</dd>
            </dl>
          </Card>
          {brokers.data ? (
            <Card title={t("brokers")}>
              <div className="stack">
                <DataList
                  rows={brokers.data.items}
                  rowKey={(b) => b.brokerId}
                  columns={[
                    { key: "name", label: c("name"), render: (b) => b.name },
                    { key: "assigned", label: t("assigned"), render: (b) => b.assigned },
                    { key: "fast", label: t("withinHour"), render: (b) => b.contactedWithinHour },
                    { key: "overdue", label: t("overdue"), render: (b) => (b.overdueFollowUps ? <strong style={{ color: "var(--danger)" }}>{b.overdueFollowUps}</strong> : 0) },
                    { key: "signed", label: t("signed"), render: (b) => b.signed },
                  ]}
                />
                <div>
                  <a className="btn secondary small" href={`/api/reports/brokers${qs({ ...range, format: "csv" })}`}>
                    {c("exportCsv")}
                  </a>
                </div>
              </div>
            </Card>
          ) : null}
          {listings.data ? (
            <Card title={t("listings")}>
              <div className="stack">
                <div className="grid cols-4">
                  {UNIT_STATUSES.map((s) => (
                    <Stat key={s} label={e(`UNIT_STATUS.${s}`)} value={listings.data!.byStatus[s] ?? 0} />
                  ))}
                </div>
                <p className="small">
                  {t("avgDaysOnMarket")}: <strong>{listings.data.averageDaysOnMarket ?? "-"}</strong>
                </p>
                {listings.data.withoutPhotos.length ? (
                  <p className="small">
                    {t("withoutPhotos", { count: listings.data.withoutPhotos.length })}:{" "}
                    {listings.data.withoutPhotos.slice(0, 15).map((u, i) => (
                      <span key={u.id}>
                        {i ? ", " : ""}
                        <Link href={`/staff/units/${u.id}`}>{`${u.project} ${u.code}`}</Link>
                      </span>
                    ))}
                  </p>
                ) : null}
                {listings.data.notUpdatedIn30Days.length ? <p className="small">{t("stale", { count: listings.data.notUpdatedIn30Days.length })}</p> : null}
                <div>
                  <a className="btn secondary small" href="/api/reports/listings?format=csv">
                    {c("exportCsv")}
                  </a>
                </div>
              </div>
            </Card>
          ) : null}
        </section>
      ) : null}

      {occupancyAllowed && occupancy.data ? (
        <section className="stack">
          <h2>{t("rentals")}</h2>
          <div className="grid cols-4">
            <Stat label={t("managedUnits")} value={occupancy.data.managedUnits} />
            <Stat label={t("occupancy")} value={pct(occupancy.data.occupancyRate)} />
            <Stat label={t("vacant")} value={occupancy.data.vacantUnits.length} />
            {rentals && aging.data ? <Stat label={t("arrears")} value={formatMoney(aging.data.totalMinor, locale)} tone={aging.data.totalMinor ? "danger" : "ok"} /> : null}
          </div>
          {occupancy.data.vacantUnits.length ? (
            <Card title={t("vacantUnits")}>
              <DataList
                rows={occupancy.data.vacantUnits.slice(0, 20)}
                rowKey={(u) => u.id}
                columns={[
                  { key: "code", label: t("unit"), render: (u) => <Link href={`/staff/units/${u.id}`}>{u.code}</Link> },
                  { key: "status", label: c("status"), render: (u) => e(`UNIT_STATUS.${u.status}`) },
                  { key: "days", label: t("vacantDays"), render: (u) => u.vacantDays },
                ]}
              />
            </Card>
          ) : null}
        </section>
      ) : null}

      {rentals ? (
        <div className="grid cols-2">
          {rent.data ? (
            <Card title={t("rentCollection")}>
              <div className="stack">
                <p className="small">
                  {t("collected")}: <strong>{formatMoney(rent.data.collectedMinor, locale)}</strong> / {formatMoney(rent.data.chargedMinor, locale)} ({pct(rent.data.collectionRate)})
                </p>
                <Bars items={rent.data.months.slice(-12).map((m) => ({ label: m.month, value: Math.round(m.collectionRate * 100) }))} format={(v) => `${v}%`} />
                <div>
                  <a className="btn secondary small" href={`/api/reports/rent${qs({ from: addDays(today, -364), to: today, format: "csv" })}`}>
                    {c("exportCsv")}
                  </a>
                </div>
              </div>
            </Card>
          ) : null}
          {aging.data ? (
            <Card title={t("arrearsAging")}>
              <Bars items={aging.data.buckets.map((b) => ({ label: t("days", { range: b.label }), value: b.amountMinor }))} format={(v) => formatMoney(v, locale)} />
              <p style={{ marginTop: 8 }}>
                <Link href="/staff/arrears">{t("openArrears")}</Link>
              </p>
            </Card>
          ) : null}
          {expiring.data ? (
            <Card title={t("expiring")}>
              <div className="stack">
                <div className="grid cols-3">
                  <Stat label={t("within", { days: 30 })} value={expiring.data.within30} />
                  <Stat label={t("within", { days: 60 })} value={expiring.data.within60} />
                  <Stat label={t("within", { days: 90 })} value={expiring.data.within90} />
                </div>
                <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
                  {expiring.data.items.slice(0, 10).map((l) => (
                    <li key={l.leaseId} className="spread small">
                      <Link href={`/staff/leases/${l.leaseId}`}>
                        {l.unitCode} · {l.tenantName}
                      </Link>
                      <LocalDate value={l.endDate} locale={locale} />
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ) : null}
          {maintenance.data ? (
            <Card title={t("maintenance")}>
              <div className="stack">
                <dl className="facts">
                  {(["URGENT", "NORMAL", "LOW"] as const).map((p) => (
                    <span key={p} style={{ display: "contents" }}>
                      <dt>{e(`PRIORITY.${p}`)}</dt>
                      <dd>{maintenance.data!.openByPriority[p] ?? 0}</dd>
                    </span>
                  ))}
                  <dt>{t("avgDaysToClose")}</dt>
                  <dd>{maintenance.data.averageDaysToClose ?? "-"}</dd>
                </dl>
                {maintenance.data.costByUnit.slice(0, 5).map((u) => (
                  <div key={u.unitId} className="spread small">
                    <Link href={`/staff/units/${u.unitId}`}>{u.code}</Link>
                    <Money minor={u.costMinor} locale={locale} />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
