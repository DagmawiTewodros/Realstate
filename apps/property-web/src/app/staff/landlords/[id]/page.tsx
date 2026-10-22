"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addMonths, addisDateString, formatMoney } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, LocalDate, Loading, Money, PageHeader, Stat, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { RENTAL_WRITERS, useSession } from "@/lib/session";
import { leaseTone, unitTone } from "@/lib/tones";
import type { Landlord } from "../page";
import type { LeaseRow } from "../../leases/page";

interface Figures {
  month: string;
  rentChargedMinor: number;
  rentReceivedMinor: number;
  arrearsMinor: number;
  maintenanceCostMinor: number;
  netMinor: number;
  leases: Array<{ leaseId: string; unitCode: string; tenantName: string; chargedMinor: number; receivedMinor: number; arrearsMinor: number }>;
  maintenance: Array<{ requestId: string; unitCode: string; title: string; costMinor: number; closedAt: string }>;
}

interface Statement {
  preview: boolean;
  figures: Figures;
  version: number;
  issuedAt: string;
}

/** The month before the current Addis Ababa month, as YYYY-MM. */
function lastMonth(): string {
  return addMonths(`${addisDateString(new Date()).slice(0, 7)}-01`, -1).slice(0, 7);
}

export default function LandlordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("landlords");
  const l = useTranslations("leases");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const canWrite = Boolean(user && RENTAL_WRITERS.includes(user.role));
  const detail = useApi<{ landlord: Landlord; units: Array<{ id: string; code: string; status: string }> }>(`/landlords/${id}`);
  const leases = useApi<{ items: LeaseRow[] }>(`/leases?landlordId=${id}`);
  const [month, setMonth] = useState(lastMonth);
  const statement = useApi<Statement>(canWrite && month ? `/landlords/${id}/statements/${month}` : null);
  const saved = useApi<{ items: Array<{ id: string; month: string; version: number; issuedAt: string; netMinor: number }> }>(canWrite ? `/landlords/${id}/statements` : null);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);

  if (detail.error) return <Alert kind="error">{detail.error.status === 404 ? c("notFound") : detail.error.message}</Alert>;
  if (!detail.data) return <Loading label={c("loading")} />;
  const { landlord, units } = detail.data;

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api(`/landlords/${id}`, { method: "PATCH", json: { name: text(f, "name") ?? undefined, phone: text(f, "phone"), email: text(f, "email"), notes: text(f, "notes") } }),
    );
    if (ok) {
      setEditing(false);
      setNotice(c("saved"));
      await detail.reload();
    }
  };

  const sendInvite = async () => {
    const res = await action.run(() => api<{ link: string }>(`/landlords/${id}/invite`, { method: "POST" }));
    if (res) setInvite(res.link);
  };

  const reissue = async () => {
    if (!window.confirm(t("reissueConfirm", { month }))) return;
    if (await action.run(() => api(`/landlords/${id}/statements/${month}/reissue`, { method: "POST" }))) {
      setNotice(t("reissued"));
      await Promise.all([statement.reload(), saved.reload()]);
    }
  };

  const fig = statement.data?.figures;

  return (
    <div className="stack">
      <PageHeader title={landlord.name} />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {invite ? (
        <Alert kind="info">
          {t("inviteShare")} <input readOnly aria-label={t("inviteLink")} value={invite} onFocus={(ev) => ev.currentTarget.select()} style={{ width: "100%" }} />
        </Alert>
      ) : null}

      <div className="grid cols-2">
        <Card title={t("contact")}>
          {editing ? (
            <form className="stack" onSubmit={(ev) => void save(ev)} noValidate>
              <TextField label={c("name")} name="name" defaultValue={landlord.name} error={action.fieldErrors.name} />
              <TextField label={c("phone")} name="phone" type="tel" defaultValue={landlord.phone ?? ""} error={action.fieldErrors.phone} />
              <TextField label={c("email")} name="email" type="email" defaultValue={landlord.email ?? ""} error={action.fieldErrors.email} />
              <TextArea label={c("notes")} name="notes" rows={3} defaultValue={landlord.notes ?? ""} />
              <div className="row">
                <Button type="submit" disabled={action.busy}>
                  {c("save")}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  {c("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <dl className="facts">
                <dt>{c("phone")}</dt>
                <dd>{landlord.phone ? <a href={`tel:${landlord.phone}`}>{landlord.phone}</a> : "-"}</dd>
                <dt>{c("email")}</dt>
                <dd>{landlord.email ?? "-"}</dd>
                <dt>{c("notes")}</dt>
                <dd>{landlord.notes ?? "-"}</dd>
              </dl>
              {canWrite ? (
                <div className="row">
                  <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
                    {c("edit")}
                  </Button>
                  {landlord.email ? (
                    <Button variant="secondary" size="small" onClick={() => void sendInvite()} disabled={action.busy}>
                      {t("invite")}
                    </Button>
                  ) : (
                    <span className="small muted">{t("inviteNeedsEmail")}</span>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card title={t("units")}>
          {units.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
              {units.map((u) => (
                <li key={u.id} className="spread">
                  <Link href={`/staff/units/${u.id}`}>{u.code}</Link>
                  <Badge tone={unitTone(u.status)}>{e(`UNIT_STATUS.${u.status}`)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("noUnits")}</p>
          )}
        </Card>
      </div>

      <Card title={l("title")}>
        {leases.data?.items.length ? (
          <DataList
            caption={l("title")}
            rows={leases.data.items}
            rowKey={(r) => r.id}
            columns={[
              { key: "unit", label: l("unit"), render: (r) => <Link href={`/staff/leases/${r.id}`}>{r.unit.code}</Link> },
              { key: "tenant", label: l("tenant"), render: (r) => r.tenant.name },
              {
                key: "term",
                label: l("term"),
                render: (r) => (
                  <span className="small">
                    <LocalDate value={r.startDate} locale={locale} /> – <LocalDate value={r.endDate} locale={locale} />
                  </span>
                ),
              },
              { key: "rent", label: l("rent"), render: (r) => <Money minor={r.rentMinor} locale={locale} /> },
              { key: "status", label: c("status"), render: (r) => <Badge tone={leaseTone(r.status)}>{e(`LEASE_STATUS.${r.status}`)}</Badge> },
            ]}
          />
        ) : (
          <p className="muted">{c("none")}</p>
        )}
      </Card>

      {canWrite ? (
        <Card title={t("statements")}>
          <div className="stack">
            <div className="row" style={{ alignItems: "flex-end" }}>
              <TextField label={t("month")} type="month" value={month} max={addisDateString(new Date()).slice(0, 7)} onChange={(ev) => setMonth(ev.target.value)} />
              {month && statement.data ? (
                <a className="btn secondary small" href={`/api/landlords/${id}/statements/${month}/pdf`} target="_blank" rel="noopener">
                  {t("pdf")}
                </a>
              ) : null}
              {statement.data && !statement.data.preview ? (
                <Button variant="secondary" size="small" onClick={() => void reissue()} disabled={action.busy}>
                  {t("reissue")}
                </Button>
              ) : null}
            </div>
            {statement.error ? <Alert kind="error">{statement.error.message}</Alert> : null}
            {statement.loading && !statement.data ? <Loading label={c("loading")} /> : null}
            {statement.data && fig ? (
              <>
                <p className="small muted">
                  {statement.data.preview ? t("preview") : t("issued", { version: statement.data.version })}{" "}
                  {!statement.data.preview ? <LocalDate value={statement.data.issuedAt} locale={locale} withTime /> : null}
                </p>
                <div className="grid cols-2">
                  <Stat label={t("charged")} value={formatMoney(fig.rentChargedMinor, locale)} />
                  <Stat label={t("received")} value={formatMoney(fig.rentReceivedMinor, locale)} />
                  <Stat label={t("arrears")} value={formatMoney(fig.arrearsMinor, locale)} tone={fig.arrearsMinor ? "danger" : undefined} />
                  <Stat label={t("repairs")} value={formatMoney(fig.maintenanceCostMinor, locale)} />
                  <Stat label={t("net")} value={formatMoney(fig.netMinor, locale)} tone={fig.netMinor < 0 ? "danger" : "ok"} />
                </div>
                {fig.leases.length ? (
                  <DataList
                    caption={t("byLease")}
                    rows={fig.leases}
                    rowKey={(r) => r.leaseId}
                    columns={[
                      { key: "unit", label: l("unit"), render: (r) => <Link href={`/staff/leases/${r.leaseId}`}>{r.unitCode}</Link> },
                      { key: "tenant", label: l("tenant"), render: (r) => r.tenantName },
                      { key: "charged", label: t("charged"), render: (r) => <Money minor={r.chargedMinor} locale={locale} /> },
                      { key: "received", label: t("received"), render: (r) => <Money minor={r.receivedMinor} locale={locale} /> },
                      { key: "arrears", label: t("arrears"), render: (r) => <Money minor={r.arrearsMinor} locale={locale} /> },
                    ]}
                  />
                ) : (
                  <p className="muted">{t("nothingThisMonth")}</p>
                )}
                {fig.maintenance.length ? (
                  <DataList
                    caption={t("repairs")}
                    rows={fig.maintenance}
                    rowKey={(r) => r.requestId}
                    columns={[
                      { key: "title", label: t("repair"), render: (r) => <Link href={`/staff/maintenance/${r.requestId}`}>{r.title}</Link> },
                      { key: "unit", label: l("unit"), render: (r) => r.unitCode },
                      { key: "closed", label: t("closed"), render: (r) => <LocalDate value={r.closedAt} locale={locale} /> },
                      { key: "cost", label: t("cost"), render: (r) => <Money minor={r.costMinor} locale={locale} /> },
                    ]}
                  />
                ) : null}
              </>
            ) : null}
            {saved.data?.items.length ? (
              <div className="stack" style={{ gap: 4 }}>
                <strong className="small">{t("issuedMonths")}</strong>
                <ul className="row" style={{ listStyle: "none", padding: 0, margin: 0, flexWrap: "wrap" }}>
                  {saved.data.items.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="btn secondary small" aria-pressed={s.month === month} onClick={() => setMonth(s.month)}>
                        {s.month} · {formatMoney(Number(s.netMinor), locale)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
