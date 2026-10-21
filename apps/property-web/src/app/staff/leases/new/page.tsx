"use client";

import { Suspense, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { BILLING_FREQUENCIES, addDays, addMonths, addisDateString } from "@platform/shared";
import { Alert, Button, Card, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api } from "@/lib/api";
import { birr, text, useAction } from "@/lib/forms";
import { CustomerPicker, LandlordSelect, UnitPicker } from "@/components/Pickers";

function NewLeaseForm() {
  const t = useTranslations("leases");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const router = useRouter();
  const params = useSearchParams();
  const { busy, error, fieldErrors, run, setError } = useAction();
  const today = addisDateString(new Date());
  const unitId = params.get("unitId");
  const tenantId = params.get("tenantId");

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const rentMinor = birr(f, "rent");
    const depositMinor = birr(f, "deposit");
    if (rentMinor === null || rentMinor <= 0) return setError(t("rentInvalid"));
    const body = {
      unitId: text(f, "unitId"),
      tenantId: text(f, "tenantId"),
      landlordId: text(f, "landlordId"),
      startDate: text(f, "startDate"),
      endDate: text(f, "endDate"),
      rentMinor,
      billingFrequency: f.get("billingFrequency"),
      depositMinor: depositMinor ?? 0,
      notes: text(f, "notes"),
    };
    const res = await run(() => api<{ lease: { id: string } }>("/leases", { method: "POST", json: body }));
    if (res) router.push(`/staff/leases/${res.lease.id}`);
  }

  const err = (k: string) => fieldErrors[k] ?? null;

  return (
    <div className="stack">
      <PageHeader title={t("new")} subtitle={<span className="small muted">{t("newHint")}</span>} />
      <form className="stack" onSubmit={(ev) => void submit(ev)} noValidate>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Card title={t("parties")}>
          <div className="stack">
            <UnitPicker label={t("unit")} name="unitId" initial={unitId ? { id: unitId, code: params.get("unitCode") ?? "" } : null} />
            {err("unitId") ? <span className="error small">{err("unitId")}</span> : null}
            <CustomerPicker label={t("tenant")} name="tenantId" initial={tenantId ? { id: tenantId, name: params.get("tenantName") ?? "" } : null} />
            {err("tenantId") ? <span className="error small">{err("tenantId")}</span> : null}
            <LandlordSelect label={t("landlord")} name="landlordId" emptyLabel={t("unitLandlord")} />
          </div>
        </Card>
        <Card title={t("terms")}>
          <div className="stack">
            <div className="grid cols-2">
              <TextField label={t("startDate")} name="startDate" type="date" required defaultValue={today} error={err("startDate")} />
              <TextField label={t("endDate")} name="endDate" type="date" required defaultValue={addDays(addMonths(today, 12), -1)} error={err("endDate")} />
            </div>
            <div className="grid cols-2">
              <TextField label={t("rentBirr")} name="rent" inputMode="decimal" required error={err("rentMinor")} hint={t("rentHint")} />
              <SelectField label={t("billing")} name="billingFrequency" defaultValue="MONTHLY" options={BILLING_FREQUENCIES.map((b) => ({ value: b, label: e(`BILLING.${b}`) }))} />
            </div>
            <TextField label={t("depositBirr")} name="deposit" inputMode="decimal" error={err("depositMinor")} />
            <TextArea label={c("notes")} name="notes" rows={3} />
          </div>
        </Card>
        <div className="row">
          <Button type="submit" disabled={busy}>
            {busy ? c("saving") : t("saveDraft")}
          </Button>
          <Button variant="secondary" onClick={() => router.back()}>
            {c("cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewLeasePage() {
  return (
    <Suspense>
      <NewLeaseForm />
    </Suspense>
  );
}
