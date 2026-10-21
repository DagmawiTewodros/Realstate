"use client";

import { type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BILLING_FREQUENCIES } from "@platform/shared";
import { Alert, Button, Card, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api } from "@/lib/api";
import { birr, text, useAction } from "@/lib/forms";
import { CustomerPicker, UnitPicker } from "@/components/Pickers";

/** A new lease starts as a draft; activating it marks the unit leased and creates the rent schedule. */
export default function NewLeasePage() {
  const t = useTranslations("rentals");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const router = useRouter();
  const { busy, error, fieldErrors, run, setError } = useAction();

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const rentMinor = birr(f, "rent");
    const depositMinor = birr(f, "deposit") ?? 0;
    if (!text(f, "unitId")) return setError(t("chooseUnit"));
    if (!text(f, "tenantId")) return setError(t("chooseTenant"));
    if (rentMinor === null) return setError(t("rentInvalid"));
    const res = await run(() =>
      api<{ lease: { id: string } }>("/leases", {
        method: "POST",
        json: {
          unitId: text(f, "unitId"),
          tenantId: text(f, "tenantId"),
          startDate: text(f, "startDate"),
          endDate: text(f, "endDate"),
          rentMinor,
          billingFrequency: f.get("billingFrequency"),
          depositMinor,
          notes: text(f, "notes"),
        },
      }),
    );
    if (res) router.push(`/staff/leases/${res.lease.id}`);
  }

  return (
    <div className="stack">
      <PageHeader title={t("newLease")} subtitle={t("newLeaseHint")} />
      <Card>
        <form className="stack" onSubmit={(ev) => void submit(ev)} noValidate>
          {error ? <Alert kind="error">{error}</Alert> : null}
          <UnitPicker label={t("unit")} name="unitId" />
          <CustomerPicker label={t("tenant")} name="tenantId" />
          <p className="small muted">{t("tenantHint")}</p>
          <div className="grid cols-2">
            <TextField label={t("startDate")} name="startDate" type="date" required error={fieldErrors.startDate} />
            <TextField label={t("endDate")} name="endDate" type="date" required error={fieldErrors.endDate} />
            <TextField label={t("rentAmount")} name="rent" inputMode="decimal" required error={fieldErrors.rentMinor} hint={t("rentHint")} />
            <SelectField label={t("billing")} name="billingFrequency" defaultValue="MONTHLY" options={BILLING_FREQUENCIES.map((b) => ({ value: b, label: e(`BILLING.${b}`) }))} />
            <TextField label={t("deposit")} name="deposit" inputMode="decimal" defaultValue="0" />
          </div>
          <TextArea label={c("notes")} name="notes" rows={2} />
          <div>
            <Button type="submit" disabled={busy}>
              {busy ? c("saving") : t("saveDraft")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
