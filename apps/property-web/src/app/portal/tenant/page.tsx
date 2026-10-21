"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PRIORITIES } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, EmptyState, LocalDate, Loading, Money, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { homeFor, useSession } from "@/lib/session";
import { chargeTone, leaseTone, maintenanceTone } from "@/lib/tones";

interface Overview {
  leases: Array<{ id: string; unitCode: string; startDate: string; endDate: string; rentMinor: number; billingFrequency: string; depositMinor: number; status: string; creditMinor: number }>;
  upcomingCharges: Array<{ id: string; leaseId: string; dueDate: string; amountMinor: number; paidMinor: number; status: string }>;
  payments: Array<{ id: string; receiptNumber: string; amountMinor: number; paidAt: string; method: string; status: string }>;
}
interface Repair {
  id: string;
  title: string;
  priority: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
}

/** Tenant portal: lease, what is due, receipts, and repair requests. Works on a phone. */
export default function TenantPortal() {
  const t = useTranslations("portal");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const { user } = useSession();
  const isTenant = user?.role === "TENANT";
  const overview = useApi<Overview>(isTenant ? "/portal/tenant/overview" : null);
  const repairs = useApi<{ items: Repair[] }>(isTenant ? "/portal/tenant/maintenance" : null);
  const action = useAction();
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const photos = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user && !isTenant) router.replace(homeFor(user.role));
  }, [user, isTenant, router]);

  if (!isTenant) return null;
  if (overview.error) return <Alert kind="error">{overview.error.message}</Alert>;
  if (!overview.data) return <Loading label={c("loading")} />;
  const { leases, upcomingCharges, payments } = overview.data;
  const active = leases.find((l) => l.status === "ACTIVE");

  async function report(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const res = await action.run(() =>
      api<{ request: { id: string } }>("/portal/tenant/maintenance", { method: "POST", json: { title: text(f, "title") ?? "", description: text(f, "description"), priority: f.get("priority") } }),
    );
    if (!res) return;
    for (const file of Array.from(photos.current?.files ?? [])) {
      const fd = new FormData();
      fd.append("file", file);
      await action.run(() => api(`/portal/tenant/maintenance/${res.request.id}/photos`, { method: "POST", body: fd }));
    }
    form.reset();
    setReporting(false);
    setNotice(t("repairSent"));
    await repairs.reload();
  }

  return (
    <div className="stack">
      <PageHeader title={t("tenantTitle", { name: user.name })} />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {leases.length === 0 ? <EmptyState title={t("noLease")} /> : null}
      {leases.map((l) => (
        <Card key={l.id} title={t("leaseFor", { unit: l.unitCode })}>
          <dl className="facts">
            <dt>{c("status")}</dt>
            <dd>
              <Badge tone={leaseTone(l.status)}>{e(`LEASE_STATUS.${l.status}`)}</Badge>
            </dd>
            <dt>{t("period")}</dt>
            <dd>
              <LocalDate value={l.startDate} locale={locale} /> → <LocalDate value={l.endDate} locale={locale} />
            </dd>
            <dt>{t("rent")}</dt>
            <dd>
              <Money minor={l.rentMinor} locale={locale} /> · {e(`BILLING.${l.billingFrequency}`)}
            </dd>
            <dt>{t("deposit")}</dt>
            <dd>
              <Money minor={l.depositMinor} locale={locale} />
            </dd>
            {l.creditMinor ? (
              <>
                <dt>{t("credit")}</dt>
                <dd>
                  <Money minor={l.creditMinor} locale={locale} />
                </dd>
              </>
            ) : null}
          </dl>
        </Card>
      ))}
      <Card title={t("toPay")}>
        {upcomingCharges.length ? (
          <DataList
            rows={upcomingCharges}
            rowKey={(ch) => ch.id}
            columns={[
              { key: "due", label: t("dueDate"), render: (ch) => <LocalDate value={ch.dueDate} locale={locale} /> },
              { key: "amount", label: c("amount"), render: (ch) => <Money minor={ch.amountMinor - ch.paidMinor} locale={locale} /> },
              { key: "status", label: c("status"), render: (ch) => <Badge tone={chargeTone(ch.status)}>{e(`CHARGE_STATUS.${ch.status}`)}</Badge> },
            ]}
          />
        ) : (
          <p className="muted">{t("nothingDue")}</p>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          {t("howToPay")}
        </p>
      </Card>
      <Card title={t("receipts")}>
        {payments.length ? (
          <DataList
            rows={payments}
            rowKey={(p) => p.id}
            columns={[
              { key: "date", label: c("date"), render: (p) => <LocalDate value={p.paidAt} locale={locale} /> },
              { key: "amount", label: c("amount"), render: (p) => <Money minor={p.amountMinor} locale={locale} /> },
              { key: "method", label: t("method"), render: (p) => e(`PAYMENT_METHOD.${p.method}`) },
              {
                key: "receipt",
                label: t("receipt"),
                render: (p) =>
                  p.status === "VOIDED" ? (
                    <Badge tone="danger">{e("PAYMENT_STATUS.VOIDED")}</Badge>
                  ) : (
                    <a className="btn secondary small" href={`/api/portal/tenant/payments/${p.id}/receipt.pdf`} target="_blank" rel="noopener">
                      {p.receiptNumber}
                    </a>
                  ),
              },
            ]}
          />
        ) : (
          <p className="muted">{c("none")}</p>
        )}
      </Card>
      <Card title={t("repairs")}>
        <div className="stack">
          {repairs.data?.items.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
              {repairs.data.items.map((r) => (
                <li key={r.id} className="spread">
                  <span>
                    {r.title}{" "}
                    <span className="small muted">
                      · <LocalDate value={r.createdAt} locale={locale} />
                    </span>
                  </span>
                  <Badge tone={maintenanceTone(r.status)}>{e(`MAINTENANCE_STATUS.${r.status}`)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("noRepairs")}</p>
          )}
          {active ? (
            reporting ? (
              <form className="stack" onSubmit={(ev) => void report(ev)} noValidate>
                <TextField label={t("repairWhat")} name="title" required error={action.fieldErrors.title} />
                <TextArea label={t("repairDetails")} name="description" rows={3} />
                <SelectField label={t("urgency")} name="priority" defaultValue="NORMAL" options={PRIORITIES.map((p) => ({ value: p, label: e(`PRIORITY.${p}`) }))} />
                <div className="field">
                  <label htmlFor="repair-photos">{t("photos")}</label>
                  <input id="repair-photos" ref={photos} type="file" accept="image/jpeg,image/png,image/webp" multiple />
                </div>
                <div className="row">
                  <Button type="submit" disabled={action.busy}>
                    {action.busy ? c("saving") : t("send")}
                  </Button>
                  <Button variant="secondary" onClick={() => setReporting(false)}>
                    {c("cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <div>
                <Button onClick={() => setReporting(true)}>{t("reportRepair")}</Button>
              </div>
            )
          ) : null}
        </div>
      </Card>
    </div>
  );
}
