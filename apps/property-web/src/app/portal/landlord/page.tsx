"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { addisDateString } from "@platform/shared";
import { Alert, Badge, Card, DataList, LocalDate, Loading, Money, PageHeader, TextField } from "@platform/ui";
import { useApi } from "@/lib/api";
import { homeFor, useSession } from "@/lib/session";
import { leaseTone, maintenanceTone, unitTone } from "@/lib/tones";
import type { Statement } from "@/lib/types";
import { StatementView, previousMonth } from "@/components/StatementView";

interface Overview {
  units: Array<{ id: string; code: string; status: string; type: string }>;
  leases: Array<{ id: string; unitCode: string; tenantName: string; startDate: string; endDate: string; rentMinor: number; status: string }>;
}
interface Repair {
  id: string;
  unit: { code: string };
  title: string;
  priority: string;
  status: string;
  costMinor: number | null;
  createdAt: string;
}

/** Landlord portal: their units and tenants, repairs on their units, and monthly statements. Read only. */
export default function LandlordPortal() {
  const t = useTranslations("portal");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const { user } = useSession();
  const isLandlord = user?.role === "LANDLORD";
  const overview = useApi<Overview>(isLandlord ? "/portal/landlord/overview" : null);
  const repairs = useApi<{ items: Repair[] }>(isLandlord ? "/portal/landlord/maintenance" : null);
  const [month, setMonth] = useState(() => previousMonth(addisDateString(new Date())));
  const statement = useApi<Statement>(isLandlord && /^\d{4}-\d{2}$/.test(month) ? `/portal/landlord/statements/${month}` : null);

  useEffect(() => {
    if (user && !isLandlord) router.replace(homeFor(user.role));
  }, [user, isLandlord, router]);

  if (!isLandlord) return null;
  if (overview.error) return <Alert kind="error">{overview.error.message}</Alert>;
  if (!overview.data) return <Loading label={c("loading")} />;
  const { units, leases } = overview.data;

  return (
    <div className="stack">
      <PageHeader title={t("landlordTitle", { name: user.name })} />
      <div className="grid cols-2">
        <Card title={t("yourUnits")}>
          {units.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
              {units.map((u) => (
                <li key={u.id} className="spread">
                  <span>
                    {u.code} · {e(`UNIT_TYPE.${u.type}`)}
                  </span>
                  <Badge tone={unitTone(u.status)}>{e(`UNIT_STATUS.${u.status}`)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{c("none")}</p>
          )}
        </Card>
        <Card title={t("repairs")}>
          {repairs.data?.items.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
              {repairs.data.items.slice(0, 15).map((r) => (
                <li key={r.id} className="spread">
                  <span>
                    {r.unit.code} · {r.title}
                    {r.costMinor !== null ? (
                      <span className="small muted">
                        {" "}
                        · <Money minor={r.costMinor} locale={locale} />
                      </span>
                    ) : null}
                  </span>
                  <Badge tone={maintenanceTone(r.status)}>{e(`MAINTENANCE_STATUS.${r.status}`)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("noRepairs")}</p>
          )}
        </Card>
      </div>
      <Card title={t("tenants")}>
        {leases.length ? (
          <DataList
            rows={leases}
            rowKey={(l) => l.id}
            columns={[
              { key: "unit", label: t("unit"), render: (l) => l.unitCode },
              { key: "tenant", label: t("tenant"), render: (l) => l.tenantName },
              {
                key: "period",
                label: t("period"),
                render: (l) => (
                  <span>
                    <LocalDate value={l.startDate} locale={locale} /> → <LocalDate value={l.endDate} locale={locale} />
                  </span>
                ),
              },
              { key: "rent", label: t("rent"), render: (l) => <Money minor={l.rentMinor} locale={locale} /> },
              { key: "status", label: c("status"), render: (l) => <Badge tone={leaseTone(l.status)}>{e(`LEASE_STATUS.${l.status}`)}</Badge> },
            ]}
          />
        ) : (
          <p className="muted">{c("none")}</p>
        )}
      </Card>
      <Card title={t("statements")}>
        <div className="stack">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <TextField label={t("month")} type="month" value={month} max={addisDateString(new Date()).slice(0, 7)} onChange={(ev) => ev.target.value && setMonth(ev.target.value)} />
            <a className="btn secondary" href={`/api/portal/landlord/statements/${month}/pdf`} target="_blank" rel="noopener">
              {t("pdf")}
            </a>
          </div>
          {statement.error ? <Alert kind="error">{statement.error.message}</Alert> : null}
          {statement.data ? <StatementView statement={statement.data} /> : statement.loading ? <Loading label={c("loading")} /> : null}
        </div>
      </Card>
    </div>
  );
}
