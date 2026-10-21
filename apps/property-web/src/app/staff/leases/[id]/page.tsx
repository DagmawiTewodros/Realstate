"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BILLING_FREQUENCIES, DEPOSIT_STATUSES, PAYMENT_METHODS, addisDateString, formatMoney } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, LocalDate, Loading, Money, PageHeader, SelectField, Stat, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { birr, minorToInput, text, useAction } from "@/lib/forms";
import { RENTAL_WRITERS, useSession } from "@/lib/session";
import { LandlordSelect } from "@/components/Pickers";
import { chargeTone, leaseTone } from "@/lib/tones";
import type { Lease } from "../page";

interface Detail {
  lease: Lease;
  unit: { id: string; code: string; status: string };
  tenant: { id: string; name: string; phone: string | null; email: string | null };
  landlord: { id: string; name: string } | null;
}

interface Charge {
  id: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountMinor: number;
  paidMinor: number;
  status: string;
}

interface Payment {
  id: string;
  amountMinor: number;
  paidAt: string;
  method: string;
  reference: string | null;
  receiptNumber: string;
  status: string;
  voidReason: string | null;
  unappliedMinor: number;
  slipKey: string | null;
}

interface Ledger {
  entries: Array<{ date: string; kind: "CHARGE" | "PAYMENT"; id: string; description: string; debitMinor: number; creditMinor: number; status: string; balanceMinor: number }>;
  charges: Charge[];
  upcomingCharges: Charge[];
  payments: Payment[];
  balanceMinor: number;
  creditMinor: number;
  totalContractMinor: number;
}

type Panel = null | "edit" | "terminate" | "renew" | "payment";

export default function LeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("leases");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const canWrite = Boolean(user && RENTAL_WRITERS.includes(user.role));
  const detail = useApi<Detail>(`/leases/${id}`);
  // The ledger is for property staff only; sales managers see the lease terms.
  const ledger = useApi<Ledger>(canWrite ? `/leases/${id}/ledger` : null);
  const action = useAction();
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ link: string; sent: string | null } | null>(null);
  const [allUpcoming, setAllUpcoming] = useState(false);

  if (detail.error) return <Alert kind="error">{detail.error.status === 404 ? c("notFound") : detail.error.message}</Alert>;
  if (!detail.data) return <Loading label={c("loading")} />;
  const { lease, unit, tenant, landlord } = detail.data;
  const isDraft = lease.status === "DRAFT";
  const isActive = lease.status === "ACTIVE";

  const done = async (message: string) => {
    setPanel(null);
    setNotice(message);
    await Promise.all([detail.reload(), ledger.reload()]);
  };

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = {
      landlordId: text(f, "landlordId"),
      depositStatus: f.get("depositStatus"),
      notes: text(f, "notes"),
    };
    if (isDraft) {
      const rentMinor = birr(f, "rent");
      if (rentMinor === null || rentMinor <= 0) return action.setError(t("rentInvalid"));
      Object.assign(body, {
        startDate: text(f, "startDate"),
        endDate: text(f, "endDate"),
        rentMinor,
        billingFrequency: f.get("billingFrequency"),
        depositMinor: birr(f, "deposit") ?? 0,
      });
    }
    if (await action.run(() => api(`/leases/${id}`, { method: "PATCH", json: body }))) await done(c("saved"));
  };

  const activate = async () => {
    if (!window.confirm(t("activateConfirm"))) return;
    if (await action.run(() => api(`/leases/${id}/activate`, { method: "POST" }))) await done(t("activated"));
  };

  const end = async () => {
    if (!window.confirm(t("endConfirm"))) return;
    if (await action.run(() => api(`/leases/${id}/end`, { method: "POST" }))) await done(t("ended"));
  };

  const terminate = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const reason = text(new FormData(ev.currentTarget), "reason") ?? "";
    if (await action.run(() => api(`/leases/${id}/terminate`, { method: "POST", json: { reason } }))) await done(t("terminated"));
  };

  const renew = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ lease: { id: string } }>(`/leases/${id}/renew`, { method: "POST", json: { endDate: text(f, "endDate"), rentMinor: birr(f, "rent") ?? undefined } }),
    );
    if (res) window.location.assign(`/staff/leases/${res.lease.id}`);
  };

  const inviteTenant = async () => {
    const res = await action.run(() => api<{ link: string; sent: string | null }>(`/leases/${id}/invite-tenant`, { method: "POST" }));
    if (res) setInvite(res);
  };

  const recordPayment = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const amountMinor = birr(f, "amount");
    if (amountMinor === null || amountMinor <= 0) return action.setError(t("amountInvalid"));
    const fd = new FormData();
    fd.append("amountMinor", String(amountMinor));
    fd.append("method", String(f.get("method")));
    fd.append("paidAt", String(f.get("paidAt")));
    const reference = text(f, "reference");
    if (reference) fd.append("reference", reference);
    const slip = f.get("slip");
    if (slip instanceof File && slip.size > 0) fd.append("slip", slip);
    const res = await action.run(() => api<{ payment: Payment }>(`/leases/${id}/payments`, { method: "POST", body: fd }));
    if (res) {
      form.reset();
      await done(t("paymentRecorded", { receipt: res.payment.receiptNumber }));
    }
  };

  const voidPayment = async (p: Payment) => {
    const reason = window.prompt(t("voidReason", { receipt: p.receiptNumber }));
    if (!reason) return;
    if (await action.run(() => api(`/payments/${p.id}/void`, { method: "POST", json: { reason } }))) await done(t("paymentVoided"));
  };

  return (
    <div className="stack">
      <PageHeader
        title={`${unit.code} · ${tenant.name}`}
        subtitle={<Badge tone={leaseTone(lease.status)}>{e(`LEASE_STATUS.${lease.status}`)}</Badge>}
        actions={
          canWrite ? (
            <div className="row">
              {isDraft ? (
                <Button onClick={() => void activate()} disabled={action.busy}>
                  {t("activate")}
                </Button>
              ) : null}
              {!isDraft ? (
                <Button onClick={() => setPanel("payment")} disabled={action.busy}>
                  {t("recordPayment")}
                </Button>
              ) : null}
              {isActive ? (
                <Button variant="secondary" onClick={() => setPanel("renew")}>
                  {t("renew")}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {invite ? (
        <Alert kind="info">
          {invite.sent === "SENT" ? t("inviteSent") : t("inviteShare")}{" "}
          <input readOnly aria-label={t("inviteLink")} value={invite.link} onFocus={(ev) => ev.currentTarget.select()} style={{ width: "100%" }} />
        </Alert>
      ) : null}

      {panel === "payment" ? (
        <Card title={t("recordPayment")}>
          <form className="stack" onSubmit={(ev) => void recordPayment(ev)} noValidate>
            <div className="grid cols-2">
              <TextField label={t("amountBirr")} name="amount" inputMode="decimal" required error={action.fieldErrors.amountMinor} />
              <TextField label={t("paidAt")} name="paidAt" type="date" required defaultValue={addisDateString(new Date())} error={action.fieldErrors.paidAt} />
            </div>
            <div className="grid cols-2">
              <SelectField label={t("method")} name="method" defaultValue="BANK_TRANSFER" options={PAYMENT_METHODS.map((m) => ({ value: m, label: e(`PAYMENT_METHOD.${m}`) }))} />
              <TextField label={t("reference")} name="reference" hint={t("referenceHint")} />
            </div>
            <TextField label={t("slip")} name="slip" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" hint={t("slipHint")} />
            <p className="small muted">{t("allocationHelp")}</p>
            <div className="row">
              <Button type="submit" disabled={action.busy}>
                {action.busy ? c("saving") : c("save")}
              </Button>
              <Button variant="secondary" onClick={() => setPanel(null)}>
                {c("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {panel === "renew" ? (
        <Card title={t("renew")}>
          <form className="stack" onSubmit={(ev) => void renew(ev)} noValidate>
            <p className="small muted">{t("renewHelp")}</p>
            <div className="grid cols-2">
              <TextField label={t("endDate")} name="endDate" type="date" required error={action.fieldErrors.endDate} />
              <TextField label={t("newRentBirr")} name="rent" inputMode="decimal" defaultValue={minorToInput(lease.rentMinor)} />
            </div>
            <div className="row">
              <Button type="submit" disabled={action.busy}>
                {t("createRenewal")}
              </Button>
              <Button variant="secondary" onClick={() => setPanel(null)}>
                {c("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="grid cols-2">
        <Card title={t("terms")}>
          {panel === "edit" ? (
            <form className="stack" onSubmit={(ev) => void save(ev)} noValidate>
              {isDraft ? (
                <>
                  <div className="grid cols-2">
                    <TextField label={t("startDate")} name="startDate" type="date" defaultValue={lease.startDate} error={action.fieldErrors.startDate} />
                    <TextField label={t("endDate")} name="endDate" type="date" defaultValue={lease.endDate} error={action.fieldErrors.endDate} />
                  </div>
                  <TextField label={t("rentBirr")} name="rent" inputMode="decimal" defaultValue={minorToInput(lease.rentMinor)} error={action.fieldErrors.rentMinor} />
                  <SelectField label={t("billing")} name="billingFrequency" defaultValue={lease.billingFrequency} options={BILLING_FREQUENCIES.map((b) => ({ value: b, label: e(`BILLING.${b}`) }))} />
                  <TextField label={t("depositBirr")} name="deposit" inputMode="decimal" defaultValue={minorToInput(lease.depositMinor)} />
                </>
              ) : (
                <p className="small muted">{t("termsLocked")}</p>
              )}
              <SelectField label={t("depositStatus")} name="depositStatus" defaultValue={lease.depositStatus} options={DEPOSIT_STATUSES.map((d) => ({ value: d, label: e(`DEPOSIT_STATUS.${d}`) }))} />
              <LandlordSelect label={t("landlord")} name="landlordId" defaultValue={lease.landlordId} />
              <TextArea label={c("notes")} name="notes" rows={3} defaultValue={lease.notes ?? ""} />
              <div className="row">
                <Button type="submit" disabled={action.busy}>
                  {c("save")}
                </Button>
                <Button variant="secondary" onClick={() => setPanel(null)}>
                  {c("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <dl className="facts">
                <dt>{t("unit")}</dt>
                <dd>
                  <Link href={`/staff/units/${unit.id}`}>{unit.code}</Link>
                </dd>
                <dt>{t("tenant")}</dt>
                <dd>
                  <Link href={`/staff/customers/${tenant.id}`}>{tenant.name}</Link>
                  {tenant.phone ? (
                    <>
                      {" · "}
                      <a href={`tel:${tenant.phone}`}>{tenant.phone}</a>
                    </>
                  ) : null}
                </dd>
                <dt>{t("landlord")}</dt>
                <dd>{landlord ? <Link href={`/staff/landlords/${landlord.id}`}>{landlord.name}</Link> : "-"}</dd>
                <dt>{t("term")}</dt>
                <dd>
                  <LocalDate value={lease.startDate} locale={locale} /> – <LocalDate value={lease.endDate} locale={locale} />
                </dd>
                <dt>{t("rent")}</dt>
                <dd>
                  <Money minor={lease.rentMinor} locale={locale} /> · {e(`BILLING.${lease.billingFrequency}`)}
                </dd>
                <dt>{t("deposit")}</dt>
                <dd>
                  <Money minor={lease.depositMinor} locale={locale} /> · {e(`DEPOSIT_STATUS.${lease.depositStatus}`)}
                </dd>
                {lease.previousLeaseId ? (
                  <>
                    <dt>{t("renews")}</dt>
                    <dd>
                      <Link href={`/staff/leases/${lease.previousLeaseId}`}>{t("previousLease")}</Link>
                    </dd>
                  </>
                ) : null}
                {lease.terminationReason ? (
                  <>
                    <dt>{t("terminationReason")}</dt>
                    <dd>{lease.terminationReason}</dd>
                  </>
                ) : null}
                <dt>{c("notes")}</dt>
                <dd>{lease.notes ?? "-"}</dd>
              </dl>
              {canWrite ? (
                <div className="row">
                  <Button variant="secondary" size="small" onClick={() => setPanel("edit")}>
                    {c("edit")}
                  </Button>
                  {!isDraft ? (
                    <Button variant="secondary" size="small" onClick={() => void inviteTenant()} disabled={action.busy}>
                      {t("inviteTenant")}
                    </Button>
                  ) : null}
                  {isActive ? (
                    <>
                      <Button variant="secondary" size="small" onClick={() => void end()} disabled={action.busy}>
                        {t("end")}
                      </Button>
                      <Button variant="danger" size="small" onClick={() => setPanel("terminate")}>
                        {t("terminate")}
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {panel === "terminate" ? (
                <form className="stack" onSubmit={(ev) => void terminate(ev)} noValidate>
                  <p className="small muted">{t("terminateHelp")}</p>
                  <TextArea label={t("terminationReason")} name="reason" rows={2} required error={action.fieldErrors.reason} />
                  <div className="row">
                    <Button type="submit" variant="danger" disabled={action.busy}>
                      {t("terminate")}
                    </Button>
                    <Button variant="secondary" onClick={() => setPanel(null)}>
                      {c("cancel")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          )}
        </Card>

        {canWrite && ledger.data && !isDraft ? (
          <Card title={t("balance")}>
            <div className="grid cols-2">
              <Stat label={ledger.data.balanceMinor > 0 ? t("owes") : t("paidAhead")} value={formatMoney(Math.abs(ledger.data.balanceMinor), locale)} tone={ledger.data.balanceMinor > 0 ? "danger" : "ok"} />
              <Stat label={t("credit")} value={formatMoney(ledger.data.creditMinor, locale)} />
              <Stat label={t("contractTotal")} value={formatMoney(ledger.data.totalContractMinor, locale)} />
            </div>
          </Card>
        ) : null}
      </div>

      {canWrite && isDraft ? <Alert kind="info">{t("draftHelp")}</Alert> : null}

      {canWrite && ledger.data && !isDraft ? (
        <>
          <Card title={t("ledger")}>
            {ledger.data.entries.length ? (
              <DataList
                caption={t("ledger")}
                rows={ledger.data.entries}
                rowKey={(r) => `${r.kind}-${r.id}`}
                columns={[
                  { key: "date", label: c("date"), render: (r) => <LocalDate value={r.date} locale={locale} /> },
                  {
                    key: "description",
                    label: t("description"),
                    render: (r) => {
                      const charge = r.kind === "CHARGE" ? ledger.data?.charges.find((ch) => ch.id === r.id) : undefined;
                      const payment = r.kind === "PAYMENT" ? ledger.data?.payments.find((p) => p.id === r.id) : undefined;
                      return (
                        <span>
                          {r.kind === "CHARGE" ? t("chargeLine") : t("paymentLine")}{" "}
                          <span className="small muted">
                            {charge ? (
                              <>
                                <LocalDate value={charge.periodStart} locale={locale} /> – <LocalDate value={charge.periodEnd} locale={locale} />
                              </>
                            ) : payment ? (
                              `${payment.receiptNumber} · ${e(`PAYMENT_METHOD.${payment.method}`)}`
                            ) : null}
                          </span>
                        </span>
                      );
                    },
                  },
                  { key: "debit", label: t("charged"), render: (r) => (r.debitMinor ? <Money minor={r.debitMinor} locale={locale} /> : "") },
                  { key: "credit", label: t("paid"), render: (r) => (r.creditMinor ? <Money minor={r.creditMinor} locale={locale} /> : "") },
                  { key: "balance", label: t("balance"), render: (r) => <Money minor={r.balanceMinor} locale={locale} /> },
                  {
                    key: "status",
                    label: c("status"),
                    render: (r) =>
                      r.kind === "CHARGE" ? (
                        <Badge tone={chargeTone(r.status)}>{e(`CHARGE_STATUS.${r.status}`)}</Badge>
                      ) : (
                        <Badge tone={r.status === "VALID" ? "ok" : undefined}>{e(`PAYMENT_STATUS.${r.status}`)}</Badge>
                      ),
                  },
                ]}
              />
            ) : (
              <p className="muted">{t("nothingDue")}</p>
            )}
          </Card>

          <Card title={t("payments")}>
            {ledger.data.payments.length ? (
              <DataList
                caption={t("payments")}
                rows={[...ledger.data.payments].reverse()}
                rowKey={(p) => p.id}
                columns={[
                  { key: "receipt", label: t("receipt"), render: (p) => <strong>{p.receiptNumber}</strong> },
                  { key: "date", label: t("paidAt"), render: (p) => <LocalDate value={p.paidAt} locale={locale} /> },
                  { key: "amount", label: c("amount"), render: (p) => <Money minor={p.amountMinor} locale={locale} /> },
                  { key: "method", label: t("method"), render: (p) => `${e(`PAYMENT_METHOD.${p.method}`)}${p.reference ? ` · ${p.reference}` : ""}` },
                  {
                    key: "status",
                    label: c("status"),
                    render: (p) => (
                      <span>
                        <Badge tone={p.status === "VALID" ? "ok" : undefined}>{e(`PAYMENT_STATUS.${p.status}`)}</Badge>
                        {p.voidReason ? <span className="small muted"> {p.voidReason}</span> : null}
                      </span>
                    ),
                  },
                  {
                    key: "actions",
                    label: c("actions"),
                    render: (p) => (
                      <span className="row">
                        <a className="btn secondary small" href={`/api/payments/${p.id}/receipt.pdf`} target="_blank" rel="noopener">
                          {t("receiptPdf")}
                        </a>
                        {p.slipKey ? (
                          <a className="btn secondary small" href={`/api/payments/${p.id}/slip`} target="_blank" rel="noopener">
                            {t("viewSlip")}
                          </a>
                        ) : null}
                        {p.status === "VALID" ? (
                          <button type="button" className="btn danger small" onClick={() => void voidPayment(p)} disabled={action.busy}>
                            {t("void")}
                          </button>
                        ) : null}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <p className="muted">{t("noPayments")}</p>
            )}
          </Card>

          {ledger.data.upcomingCharges.length ? (
            <Card title={t("upcoming")}>
              <DataList
                caption={t("upcoming")}
                rows={allUpcoming ? ledger.data.upcomingCharges : ledger.data.upcomingCharges.slice(0, 3)}
                rowKey={(r) => r.id}
                columns={[
                  { key: "due", label: t("dueDate"), render: (r) => <LocalDate value={r.dueDate} locale={locale} /> },
                  {
                    key: "period",
                    label: t("period"),
                    render: (r) => (
                      <span className="small">
                        <LocalDate value={r.periodStart} locale={locale} /> – <LocalDate value={r.periodEnd} locale={locale} />
                      </span>
                    ),
                  },
                  { key: "amount", label: c("amount"), render: (r) => <Money minor={r.amountMinor} locale={locale} /> },
                  { key: "paid", label: t("paid"), render: (r) => <Money minor={r.paidMinor} locale={locale} /> },
                  { key: "status", label: c("status"), render: (r) => <Badge tone={chargeTone(r.status)}>{e(`CHARGE_STATUS.${r.status}`)}</Badge> },
                ]}
              />
              {ledger.data.upcomingCharges.length > 3 ? (
                <Button variant="secondary" size="small" onClick={() => setAllUpcoming((v) => !v)}>
                  {allUpcoming ? t("showFewer") : t("showAll", { count: ledger.data.upcomingCharges.length })}
                </Button>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
