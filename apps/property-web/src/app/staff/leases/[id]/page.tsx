"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BILLING_FREQUENCIES, DEPOSIT_STATUSES, PAYMENT_METHODS, addisDateString } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, LocalDate, Loading, Money, PageHeader, SelectField, Stat, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { birr, minorToInput, text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import { chargeTone, leaseTone } from "@/lib/tones";
import type { Charge, Lease, Payment } from "@/lib/types";

interface Detail {
  lease: Lease;
  unit: { id: string; code: string; status: string };
  tenant: { id: string; name: string; phone: string | null; email: string | null };
  landlord: { id: string; name: string } | null;
}
interface Ledger {
  charges: Charge[];
  payments: Payment[];
  entries: Array<{ date: string; kind: "CHARGE" | "PAYMENT"; id: string; description: string; debitMinor: number; creditMinor: number; status: string; balanceMinor: number }>;
  upcomingCharges: Charge[];
  balanceMinor: number;
  creditMinor: number;
  totalContractMinor: number;
}

type Panel = null | "edit" | "renew" | "terminate" | "void";

export default function LeasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("rentals");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const { user } = useSession();
  const canEdit = user?.role === "OWNER" || user?.role === "PROPERTY_MANAGER";
  const detail = useApi<Detail>(`/leases/${id}`);
  const ledger = useApi<Ledger>(canEdit ? `/leases/${id}/ledger` : null);
  const action = useAction();
  const [panel, setPanel] = useState<Panel>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ link: string; sent: string | null } | null>(null);

  if (detail.error) return <Alert kind="error">{detail.error.status === 404 ? c("notFound") : detail.error.message}</Alert>;
  if (!detail.data) return <Loading label={c("loading")} />;
  const { lease, unit, tenant, landlord } = detail.data;

  const refresh = async (message: string) => {
    setNotice(message);
    setPanel(null);
    setVoiding(null);
    await Promise.all([detail.reload(), ledger.reload()]);
  };

  const post = async (path: string, json?: unknown) => action.run(() => api(path, { method: "POST", json: json ?? {} }));

  const activate = async () => {
    if (!window.confirm(t("activateConfirm"))) return;
    if (await post(`/leases/${id}/activate`)) await refresh(t("activated"));
  };

  const end = async () => {
    if (!window.confirm(t("endConfirm"))) return;
    if (await post(`/leases/${id}/end`)) await refresh(t("ended"));
  };

  const terminate = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (await post(`/leases/${id}/terminate`, { reason: text(new FormData(ev.currentTarget), "reason") ?? "" })) await refresh(t("terminated"));
  };

  const renew = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const rentMinor = birr(f, "rent");
    const res = await action.run(() =>
      api<{ lease: { id: string } }>(`/leases/${id}/renew`, { method: "POST", json: { endDate: text(f, "endDate"), ...(rentMinor ? { rentMinor } : {}) } }),
    );
    if (res) router.push(`/staff/leases/${res.lease.id}`);
  };

  const saveEdit = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = { depositStatus: f.get("depositStatus"), notes: text(f, "notes") };
    if (lease.status === "DRAFT") {
      const rentMinor = birr(f, "rent");
      const depositMinor = birr(f, "deposit");
      if (rentMinor === null || depositMinor === null) return action.setError(t("rentInvalid"));
      Object.assign(body, { startDate: text(f, "startDate"), endDate: text(f, "endDate"), rentMinor, depositMinor, billingFrequency: f.get("billingFrequency") });
    }
    if (await action.run(() => api(`/leases/${id}`, { method: "PATCH", json: body }))) await refresh(c("saved"));
  };

  const recordPayment = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const amountMinor = birr(f, "amount");
    if (!amountMinor || amountMinor <= 0) return action.setError(t("amountInvalid"));
    const fd = new FormData();
    fd.append("amountMinor", String(amountMinor));
    fd.append("method", String(f.get("method")));
    fd.append("paidAt", String(f.get("paidAt")));
    if (text(f, "reference")) fd.append("reference", text(f, "reference")!);
    const slip = f.get("slip");
    if (slip instanceof File && slip.size > 0) fd.append("slip", slip);
    const res = await action.run(() => api<{ payment: Payment }>(`/leases/${id}/payments`, { method: "POST", body: fd }));
    if (res) {
      form.reset();
      await refresh(t("paymentRecorded", { number: res.payment.receiptNumber }));
    }
  };

  const voidPayment = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!voiding) return;
    if (await post(`/payments/${voiding.id}/void`, { reason: text(new FormData(ev.currentTarget), "reason") ?? "" })) await refresh(t("voided"));
  };

  const inviteTenant = async () => {
    const res = await action.run(() => api<{ link: string; sent: string | null }>(`/leases/${id}/invite-tenant`, { method: "POST" }));
    if (res) setInvite(res);
  };

  return (
    <div className="stack">
      <PageHeader
        title={`${unit.code} · ${tenant.name}`}
        subtitle={
          <>
            <Badge tone={leaseTone(lease.status)}>{e(`LEASE_STATUS.${lease.status}`)}</Badge> <LocalDate value={lease.startDate} locale={locale} /> →{" "}
            <LocalDate value={lease.endDate} locale={locale} />
          </>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}

      <div className="grid cols-2">
        <Card title={t("leaseDetails")}>
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
                  {" "}
                  · <a href={`tel:${tenant.phone}`}>{tenant.phone}</a>
                </>
              ) : null}
            </dd>
            <dt>{t("landlord")}</dt>
            <dd>{landlord ? <Link href={`/staff/landlords/${landlord.id}`}>{landlord.name}</Link> : "-"}</dd>
            <dt>{t("rent")}</dt>
            <dd>
              <Money minor={lease.rentMinor} locale={locale} /> · {e(`BILLING.${lease.billingFrequency}`)}
            </dd>
            <dt>{t("deposit")}</dt>
            <dd>
              <Money minor={lease.depositMinor} locale={locale} /> · {t(`depositStatus.${lease.depositStatus}`)}
            </dd>
            {lease.terminationReason ? (
              <>
                <dt>{t("terminationReason")}</dt>
                <dd>{lease.terminationReason}</dd>
              </>
            ) : null}
            {lease.previousLeaseId ? (
              <>
                <dt>{t("renewalOf")}</dt>
                <dd>
                  <Link href={`/staff/leases/${lease.previousLeaseId}`}>{t("previousLease")}</Link>
                </dd>
              </>
            ) : null}
          </dl>
          {lease.notes ? <p className="small" style={{ whiteSpace: "pre-line" }}>{lease.notes}</p> : null}
        </Card>

        {canEdit ? (
          <Card title={c("actions")}>
            <div className="stack">
              <div className="row">
                {lease.status === "DRAFT" ? (
                  <Button onClick={() => void activate()} disabled={action.busy}>
                    {t("activate")}
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => setPanel(panel === "edit" ? null : "edit")}>
                  {c("edit")}
                </Button>
                {lease.status === "ACTIVE" || lease.status === "ENDED" ? (
                  <Button variant="secondary" onClick={() => setPanel(panel === "renew" ? null : "renew")}>
                    {t("renew")}
                  </Button>
                ) : null}
                {lease.status === "ACTIVE" ? (
                  <>
                    <Button variant="secondary" onClick={() => void end()} disabled={action.busy}>
                      {t("end")}
                    </Button>
                    <Button variant="danger" onClick={() => setPanel(panel === "terminate" ? null : "terminate")}>
                      {t("terminate")}
                    </Button>
                  </>
                ) : null}
                {lease.status !== "DRAFT" ? (
                  <Button variant="secondary" onClick={() => void inviteTenant()} disabled={action.busy}>
                    {t("inviteTenant")}
                  </Button>
                ) : null}
              </div>
              {lease.status === "DRAFT" ? <p className="small muted">{t("draftHint")}</p> : null}
              {invite ? (
                <Alert kind="ok">
                  {invite.sent === "SENT" ? t("inviteSent") : t("inviteNotSent")}
                  <div style={{ wordBreak: "break-all", marginTop: 6 }}>
                    <code>{invite.link}</code>
                  </div>
                  <Button size="small" variant="secondary" onClick={() => void navigator.clipboard?.writeText(invite.link)}>
                    {t("copyLink")}
                  </Button>
                </Alert>
              ) : null}
              {panel === "terminate" ? (
                <form className="stack" onSubmit={(ev) => void terminate(ev)}>
                  <TextArea label={t("terminationReason")} name="reason" required rows={2} error={action.fieldErrors.reason} />
                  <Button type="submit" variant="danger" disabled={action.busy}>
                    {t("confirmTerminate")}
                  </Button>
                </form>
              ) : null}
              {panel === "renew" ? (
                <form className="stack" onSubmit={(ev) => void renew(ev)}>
                  <p className="small muted">{t("renewHint")}</p>
                  <TextField label={t("newEndDate")} name="endDate" type="date" required min={lease.endDate} />
                  <TextField label={t("newRent")} name="rent" inputMode="decimal" placeholder={minorToInput(lease.rentMinor)} hint={t("newRentHint")} />
                  <Button type="submit" disabled={action.busy}>
                    {t("createRenewal")}
                  </Button>
                </form>
              ) : null}
              {panel === "edit" ? (
                <form className="stack" onSubmit={(ev) => void saveEdit(ev)}>
                  {lease.status === "DRAFT" ? (
                    <div className="grid cols-2">
                      <TextField label={t("startDate")} name="startDate" type="date" defaultValue={lease.startDate} />
                      <TextField label={t("endDate")} name="endDate" type="date" defaultValue={lease.endDate} />
                      <TextField label={t("rentAmount")} name="rent" inputMode="decimal" defaultValue={minorToInput(lease.rentMinor)} />
                      <SelectField label={t("billing")} name="billingFrequency" defaultValue={lease.billingFrequency} options={BILLING_FREQUENCIES.map((b) => ({ value: b, label: e(`BILLING.${b}`) }))} />
                      <TextField label={t("deposit")} name="deposit" inputMode="decimal" defaultValue={minorToInput(lease.depositMinor)} />
                    </div>
                  ) : (
                    <p className="small muted">{t("termsLocked")}</p>
                  )}
                  <SelectField label={t("depositState")} name="depositStatus" defaultValue={lease.depositStatus} options={DEPOSIT_STATUSES.map((d) => ({ value: d, label: t(`depositStatus.${d}`) }))} />
                  <TextArea label={c("notes")} name="notes" defaultValue={lease.notes ?? ""} rows={2} />
                  <Button type="submit" disabled={action.busy}>
                    {c("save")}
                  </Button>
                </form>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>

      {canEdit && ledger.data ? (
        <>
          <div className="grid cols-3">
            <Stat label={t("balance")} value={<Money minor={ledger.data.balanceMinor} locale={locale} />} tone={ledger.data.balanceMinor > 0 ? "danger" : "ok"} />
            <Stat label={t("credit")} value={<Money minor={ledger.data.creditMinor} locale={locale} />} />
            <Stat label={t("contractTotal")} value={<Money minor={ledger.data.totalContractMinor} locale={locale} />} />
          </div>

          {lease.status === "ACTIVE" || lease.status === "ENDED" || lease.status === "TERMINATED" ? (
            <Card title={t("recordPayment")}>
              <form className="stack" onSubmit={(ev) => void recordPayment(ev)} noValidate>
                <div className="grid cols-2">
                  <TextField label={t("amount")} name="amount" inputMode="decimal" required />
                  <SelectField label={t("method")} name="method" defaultValue="BANK_TRANSFER" options={PAYMENT_METHODS.map((m) => ({ value: m, label: e(`PAYMENT_METHOD.${m}`) }))} />
                  <TextField label={t("paidOn")} name="paidAt" type="date" required defaultValue={addisDateString(new Date())} max={addisDateString(new Date())} />
                  <TextField label={t("reference")} name="reference" hint={t("referenceHint")} />
                </div>
                <div className="field">
                  <label htmlFor="slip">{t("slip")}</label>
                  <input id="slip" name="slip" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" />
                  <span className="hint">{t("slipHint")}</span>
                </div>
                <div>
                  <Button type="submit" disabled={action.busy}>
                    {action.busy ? c("saving") : t("savePayment")}
                  </Button>
                </div>
              </form>
            </Card>
          ) : null}

          <Card title={t("ledger")}>
            {ledger.data.entries.length ? (
              <DataList
                rows={ledger.data.entries}
                rowKey={(r) => `${r.kind}-${r.id}`}
                columns={[
                  { key: "date", label: c("date"), render: (r) => <LocalDate value={r.date} locale={locale} /> },
                  {
                    key: "what",
                    label: t("entry"),
                    render: (r) => {
                      if (r.kind === "CHARGE") {
                        const ch = ledger.data!.charges.find((x) => x.id === r.id);
                        return ch ? (
                          <span>
                            {t("rentFor")} <LocalDate value={ch.periodStart} locale={locale} /> – <LocalDate value={ch.periodEnd} locale={locale} />
                          </span>
                        ) : (
                          t("rentFor")
                        );
                      }
                      const p = ledger.data!.payments.find((x) => x.id === r.id);
                      return p ? `${t("payment")} ${p.receiptNumber} · ${e(`PAYMENT_METHOD.${p.method}`)}` : t("payment");
                    },
                  },
                  { key: "debit", label: t("charged"), render: (r) => (r.debitMinor ? <Money minor={r.debitMinor} locale={locale} /> : "") },
                  { key: "credit", label: t("paid"), render: (r) => (r.kind === "PAYMENT" ? r.status === "VOIDED" ? <Badge tone="danger">{e("PAYMENT_STATUS.VOIDED")}</Badge> : <Money minor={r.creditMinor} locale={locale} /> : "") },
                  { key: "balance", label: t("balance"), render: (r) => <Money minor={r.balanceMinor} locale={locale} /> },
                ]}
              />
            ) : (
              <p className="muted">{lease.status === "DRAFT" ? t("noScheduleYet") : c("none")}</p>
            )}
          </Card>

          <Card title={t("payments")}>
            <div className="stack">
              {ledger.data.payments.length ? (
                <DataList
                  rows={[...ledger.data.payments].reverse()}
                  rowKey={(p) => p.id}
                  columns={[
                    { key: "number", label: t("receiptNumber"), render: (p) => p.receiptNumber },
                    { key: "date", label: t("paidOn"), render: (p) => <LocalDate value={p.paidAt} locale={locale} /> },
                    { key: "amount", label: t("amount"), render: (p) => <Money minor={p.amountMinor} locale={locale} /> },
                    { key: "method", label: t("method"), render: (p) => `${e(`PAYMENT_METHOD.${p.method}`)}${p.reference ? ` · ${p.reference}` : ""}` },
                    {
                      key: "status",
                      label: c("status"),
                      render: (p) => (p.status === "VOIDED" ? <span title={p.voidReason ?? ""}><Badge tone="danger">{e("PAYMENT_STATUS.VOIDED")}</Badge></span> : <Badge tone="ok">{e("PAYMENT_STATUS.VALID")}</Badge>),
                    },
                    {
                      key: "actions",
                      label: c("actions"),
                      render: (p) => (
                        <span className="row" style={{ gap: 4 }}>
                          <a className="btn secondary small" href={`/api/payments/${p.id}/receipt.pdf`} target="_blank" rel="noopener">
                            {t("receipt")}
                          </a>
                          {p.slipKey ? (
                            <a className="btn secondary small" href={`/api/payments/${p.id}/slip`} target="_blank" rel="noopener">
                              {t("slipShort")}
                            </a>
                          ) : null}
                          {p.status === "VALID" ? (
                            <button type="button" className="btn danger small" onClick={() => setVoiding(p)}>
                              {t("void")}
                            </button>
                          ) : null}
                        </span>
                      ),
                    },
                  ]}
                />
              ) : (
                <p className="muted">{c("none")}</p>
              )}
              {voiding ? (
                <form className="stack card" onSubmit={(ev) => void voidPayment(ev)}>
                  <strong>{t("voidTitle", { number: voiding.receiptNumber })}</strong>
                  <p className="small muted">{t("voidHint")}</p>
                  <TextArea label={t("voidReason")} name="reason" required rows={2} error={action.fieldErrors.reason} />
                  <div className="row">
                    <Button type="submit" variant="danger" disabled={action.busy}>
                      {t("confirmVoid")}
                    </Button>
                    <Button variant="secondary" onClick={() => setVoiding(null)}>
                      {c("cancel")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          </Card>

          {ledger.data.upcomingCharges.length ? (
            <Card title={t("upcoming")}>
              <DataList
                rows={ledger.data.upcomingCharges.slice(0, 12)}
                rowKey={(ch) => ch.id}
                columns={[
                  { key: "due", label: t("dueDate"), render: (ch) => <LocalDate value={ch.dueDate} locale={locale} /> },
                  { key: "amount", label: t("amount"), render: (ch) => <Money minor={ch.amountMinor} locale={locale} /> },
                  { key: "paid", label: t("paid"), render: (ch) => <Money minor={ch.paidMinor} locale={locale} /> },
                  { key: "status", label: c("status"), render: (ch) => <Badge tone={chargeTone(ch.status)}>{e(`CHARGE_STATUS.${ch.status}`)}</Badge> },
                ]}
              />
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
