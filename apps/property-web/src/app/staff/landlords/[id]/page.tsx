"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addisDateString } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, LocalDate, Loading, Money, PageHeader, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import { leaseTone, unitTone } from "@/lib/tones";
import type { Lease, Statement } from "@/lib/types";
import { StatementView, previousMonth } from "@/components/StatementView";
import type { Landlord } from "../page";

export default function LandlordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("landlords");
  const r = useTranslations("rentals");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const canEdit = user?.role === "OWNER" || user?.role === "PROPERTY_MANAGER";
  const detail = useApi<{ landlord: Landlord; units: Array<{ id: string; code: string; status: string }> }>(`/landlords/${id}`);
  const leases = useApi<{ items: Array<Lease & { unit: { code: string }; tenant: { name: string } }> }>(`/leases?landlordId=${id}`);
  const saved = useApi<{ items: Array<{ id: string; month: string; version: number; issuedAt: string; netMinor: number }> }>(canEdit ? `/landlords/${id}/statements` : null);
  const [month, setMonth] = useState(() => previousMonth(addisDateString(new Date())));
  const statement = useApi<Statement>(canEdit && /^\d{4}-\d{2}$/.test(month) ? `/landlords/${id}/statements/${month}` : null);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

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

  const invite = async () => {
    const res = await action.run(() => api<{ link: string }>(`/landlords/${id}/invite`, { method: "POST" }));
    if (res) setLink(res.link);
  };

  const reissue = async () => {
    if (!window.confirm(t("reissueConfirm"))) return;
    const ok = await action.run(() => api(`/landlords/${id}/statements/${month}/reissue`, { method: "POST" }));
    if (ok) {
      setNotice(t("reissued"));
      await Promise.all([statement.reload(), saved.reload()]);
    }
  };

  return (
    <div className="stack">
      <PageHeader title={landlord.name} subtitle={t("unitCount", { count: units.length })} />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <div className="grid cols-2">
        <Card title={t("contact")}>
          {editing ? (
            <form className="stack" onSubmit={(ev) => void save(ev)} noValidate>
              <TextField label={c("name")} name="name" defaultValue={landlord.name} />
              <TextField label={c("phone")} name="phone" type="tel" defaultValue={landlord.phone ?? ""} error={action.fieldErrors.phone} />
              <TextField label={c("email")} name="email" type="email" defaultValue={landlord.email ?? ""} error={action.fieldErrors.email} />
              <TextArea label={c("notes")} name="notes" defaultValue={landlord.notes ?? ""} rows={2} />
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
              </dl>
              {landlord.notes ? <p className="small" style={{ whiteSpace: "pre-line" }}>{landlord.notes}</p> : null}
              {canEdit ? (
                <div className="row">
                  <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
                    {c("edit")}
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => void invite()} disabled={action.busy}>
                    {t("invite")}
                  </Button>
                </div>
              ) : null}
              {link ? (
                <Alert kind="ok">
                  {t("inviteHint")}
                  <div style={{ wordBreak: "break-all", marginTop: 6 }}>
                    <code>{link}</code>
                  </div>
                  <Button size="small" variant="secondary" onClick={() => void navigator.clipboard?.writeText(link)}>
                    {r("copyLink")}
                  </Button>
                </Alert>
              ) : null}
            </div>
          )}
        </Card>
        <Card title={t("units")}>
          {units.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
              {units.map((u) => (
                <li key={u.id} className="spread">
                  <Link href={`/staff/units/${u.id}`}>{u.code}</Link>
                  <Badge tone={unitTone(u.status)}>{e(`UNIT_STATUS.${u.status}`)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t("noUnits")}</p>
          )}
        </Card>
      </div>
      <Card title={r("leases")}>
        {leases.data?.items.length ? (
          <DataList
            rows={leases.data.items}
            rowKey={(l) => l.id}
            columns={[
              { key: "unit", label: r("unit"), render: (l) => <Link href={`/staff/leases/${l.id}`}>{l.unit.code}</Link> },
              { key: "tenant", label: r("tenant"), render: (l) => l.tenant.name },
              { key: "end", label: r("endDate"), render: (l) => <LocalDate value={l.endDate} locale={locale} /> },
              { key: "rent", label: r("rent"), render: (l) => <Money minor={l.rentMinor} locale={locale} /> },
              { key: "status", label: c("status"), render: (l) => <Badge tone={leaseTone(l.status)}>{e(`LEASE_STATUS.${l.status}`)}</Badge> },
            ]}
          />
        ) : (
          <p className="muted">{c("none")}</p>
        )}
      </Card>
      {canEdit ? (
        <Card title={t("statements")}>
          <div className="stack">
            <div className="row" style={{ alignItems: "flex-end" }}>
              <TextField label={t("month")} type="month" value={month} max={addisDateString(new Date()).slice(0, 7)} onChange={(ev) => ev.target.value && setMonth(ev.target.value)} />
              <a className="btn secondary" href={`/api/landlords/${id}/statements/${month}/pdf`} target="_blank" rel="noopener">
                {t("pdf")}
              </a>
              {statement.data && !statement.data.preview ? (
                <Button variant="secondary" onClick={() => void reissue()} disabled={action.busy}>
                  {t("reissue")}
                </Button>
              ) : null}
            </div>
            {statement.error ? <Alert kind="error">{statement.error.message}</Alert> : null}
            {statement.data ? <StatementView statement={statement.data} /> : statement.loading ? <Loading label={c("loading")} /> : null}
            {saved.data?.items.length ? (
              <details>
                <summary>{t("issuedStatements")}</summary>
                <ul>
                  {saved.data.items.map((s) => (
                    <li key={s.id}>
                      <button type="button" className="btn secondary small" onClick={() => setMonth(s.month)}>
                        {s.month}
                      </button>{" "}
                      v{s.version} · <Money minor={Number(s.netMinor)} locale={locale} />
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
