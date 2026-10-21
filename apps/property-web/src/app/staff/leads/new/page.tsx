"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { LEAD_SOURCES } from "@platform/shared";
import { Alert, Button, Card, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import { CustomerPicker, StaffSelect, UnitPicker } from "@/components/Pickers";
import { addisLocalToIso } from "@/components/LogCall";

function NewLeadForm() {
  const t = useTranslations("leads");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useSession();
  const presetCustomer = params.get("customerId");
  const presetName = params.get("customerName");
  const [mode, setMode] = useState<"new" | "existing">(presetCustomer ? "existing" : "new");
  const { busy, error, fieldErrors, run } = useAction();

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const nextStepAt = addisLocalToIso(String(f.get("nextStepAt") ?? ""));
    const body = {
      source: f.get("source"),
      ...(mode === "existing"
        ? { customerId: text(f, "customerId") ?? undefined }
        : { customer: { name: text(f, "name") ?? "", phone: text(f, "phone"), email: text(f, "email"), locale: f.get("locale") } }),
      interestedUnitId: text(f, "interestedUnitId"),
      interestedUnitNote: text(f, "interestedUnitNote"),
      assignedToId: text(f, "assignedToId"),
      nextStepAt,
      nextStepNote: text(f, "nextStepNote"),
    };
    const res = await run(() => api<{ lead: { id: string } }>("/leads", { method: "POST", json: body }));
    if (res) router.push(`/staff/leads/${res.lead.id}`);
  }

  const err = (k: string) => fieldErrors[k] ?? null;

  return (
    <div className="stack">
      <PageHeader title={t("new")} />
      <form className="stack" onSubmit={(ev) => void submit(ev)} noValidate>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <Card title={t("customer")}>
          <div className="stack">
            <div className="row" role="radiogroup" aria-label={t("customer")}>
              <label className="check">
                <input type="radio" name="mode" checked={mode === "new"} onChange={() => setMode("new")} /> {t("newCustomer")}
              </label>
              <label className="check">
                <input type="radio" name="mode" checked={mode === "existing"} onChange={() => setMode("existing")} /> {t("existingCustomer")}
              </label>
            </div>
            {mode === "existing" ? (
              <>
                <CustomerPicker label={t("customer")} name="customerId" initial={presetCustomer ? { id: presetCustomer, name: presetName ?? "" } : null} />
                {err("customerId") ? <span className="error small">{err("customerId")}</span> : null}
              </>
            ) : (
              <>
                <TextField label={c("name")} name="name" required autoComplete="off" error={err("customer")} />
                <TextField label={c("phone")} name="phone" type="tel" inputMode="tel" autoComplete="off" hint={t("phoneOrEmail")} />
                <TextField label={c("email")} name="email" type="email" autoComplete="off" />
                <SelectField
                  label={c("language")}
                  name="locale"
                  defaultValue="am"
                  options={[
                    { value: "am", label: c("amharic") },
                    { value: "en", label: c("english") },
                  ]}
                />
              </>
            )}
          </div>
        </Card>
        <Card title={t("details")}>
          <div className="stack">
            <SelectField label={t("source")} name="source" defaultValue="PHONE" options={LEAD_SOURCES.map((s) => ({ value: s, label: e(`LEAD_SOURCE.${s}`) }))} />
            <UnitPicker label={t("interestedUnit")} name="interestedUnitId" />
            <TextArea label={t("interestedNote")} name="interestedUnitNote" rows={2} />
            {user && user.role !== "BROKER" ? <StaffSelect label={t("assignee")} name="assignedToId" roles={["BROKER", "SALES_MANAGER"]} allowEmpty /> : null}
            <TextField label={t("nextStep")} name="nextStepAt" type="datetime-local" />
            <TextField label={t("nextStepNote")} name="nextStepNote" />
          </div>
        </Card>
        <div className="row">
          <Button type="submit" disabled={busy}>
            {busy ? c("saving") : c("save")}
          </Button>
          <Button variant="secondary" onClick={() => router.back()}>
            {c("cancel")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewLeadPage() {
  return (
    <Suspense>
      <NewLeadForm />
    </Suspense>
  );
}
