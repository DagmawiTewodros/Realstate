"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { REMINDER_TYPES, type ReminderSettings, type SiteSettings } from "@platform/shared";
import { Alert, Button, Card, Checkbox, Loading, PageHeader, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { int, text, useAction } from "@/lib/forms";

/** Owner settings: company details shown on the website and receipts, and automatic reminders. */
export default function SettingsPage() {
  const t = useTranslations("settings");
  const c = useTranslations("common");
  const site = useApi<SiteSettings>("/settings/site");
  const reminders = useApi<ReminderSettings>("/settings/reminders");
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<Record<string, number> | null>(null);

  const saveSite = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const both = (name: string) => ({ am: text(f, `${name}.am`) ?? "", en: text(f, `${name}.en`) ?? "" });
    const links = (text(f, "socialLinks") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, ...rest] = line.split("|");
        return { label: label.trim(), url: rest.join("|").trim() };
      });
    const body = {
      companyName: both("companyName"),
      phone: text(f, "phone") ?? "",
      email: text(f, "email") ?? "",
      address: both("address"),
      openingHours: both("openingHours"),
      about: both("about"),
      socialLinks: links,
    };
    if (await action.run(() => api("/settings/site", { method: "PUT", json: body }))) {
      setNotice(c("saved"));
      await site.reload();
    }
  };

  const saveReminders = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const overdue = (text(f, "rentOverdueDays") ?? "")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isInteger(n));
    const body = {
      enabled: Object.fromEntries(REMINDER_TYPES.map((k) => [k, f.get(`enabled.${k}`) === "on"])),
      leadResponseHours: int(f, "leadResponseHours") ?? 1,
      rentDueSoonDays: int(f, "rentDueSoonDays") ?? 3,
      rentOverdueDays: overdue,
      leaseExpiringDays: int(f, "leaseExpiringDays") ?? 60,
    };
    if (await action.run(() => api("/settings/reminders", { method: "PUT", json: body }))) {
      setNotice(c("saved"));
      await reminders.reload();
    }
  };

  const runNow = async () => {
    const res = await action.run(() => api<Record<string, number>>("/automation/run", { method: "POST" }));
    if (res) setRunResult(res);
  };

  if (site.error || reminders.error) return <Alert kind="error">{(site.error ?? reminders.error)!.message}</Alert>;
  if (!site.data || !reminders.data) return <Loading label={c("loading")} />;
  const s = site.data;
  const r = reminders.data;

  return (
    <div className="stack">
      <PageHeader title={t("title")} />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <Card title={t("company")}>
        <form className="stack" onSubmit={(ev) => void saveSite(ev)} noValidate>
          <p className="small muted">{t("companyHint")}</p>
          <div className="grid cols-2">
            <TextField label={t("companyNameAm")} name="companyName.am" defaultValue={s.companyName.am} />
            <TextField label={t("companyNameEn")} name="companyName.en" defaultValue={s.companyName.en} />
            <TextField label={c("phone")} name="phone" defaultValue={s.phone} />
            <TextField label={c("email")} name="email" type="email" defaultValue={s.email} />
            <TextArea label={t("addressAm")} name="address.am" defaultValue={s.address.am} rows={2} />
            <TextArea label={t("addressEn")} name="address.en" defaultValue={s.address.en} rows={2} />
            <TextArea label={t("hoursAm")} name="openingHours.am" defaultValue={s.openingHours.am} rows={2} />
            <TextArea label={t("hoursEn")} name="openingHours.en" defaultValue={s.openingHours.en} rows={2} />
            <TextArea label={t("aboutAm")} name="about.am" defaultValue={s.about.am} rows={5} />
            <TextArea label={t("aboutEn")} name="about.en" defaultValue={s.about.en} rows={5} />
          </div>
          <TextArea
            label={t("socialLinks")}
            name="socialLinks"
            rows={3}
            hint={t("socialHint")}
            defaultValue={s.socialLinks.map((l) => `${l.label} | ${l.url}`).join("\n")}
            error={action.fieldErrors.socialLinks}
          />
          <div>
            <Button type="submit" disabled={action.busy}>
              {c("save")}
            </Button>
          </div>
        </form>
      </Card>
      <Card title={t("reminders")}>
        <form className="stack" onSubmit={(ev) => void saveReminders(ev)} noValidate>
          <p className="small muted">{t("remindersHint")}</p>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 4 }}>
            <legend className="label">{t("which")}</legend>
            {REMINDER_TYPES.map((k) => (
              <Checkbox key={k} label={t(`type.${k.replace(".", "_")}`)} name={`enabled.${k}`} defaultChecked={r.enabled[k] !== false} />
            ))}
          </fieldset>
          <div className="grid cols-2">
            <TextField label={t("leadResponseHours")} name="leadResponseHours" type="number" min={1} max={72} defaultValue={r.leadResponseHours} />
            <TextField label={t("rentDueSoonDays")} name="rentDueSoonDays" type="number" min={1} max={30} defaultValue={r.rentDueSoonDays} />
            <TextField label={t("rentOverdueDays")} name="rentOverdueDays" defaultValue={r.rentOverdueDays.join(", ")} hint={t("rentOverdueHint")} error={action.fieldErrors.rentOverdueDays} />
            <TextField label={t("leaseExpiringDays")} name="leaseExpiringDays" type="number" min={7} max={180} defaultValue={r.leaseExpiringDays} />
          </div>
          <div className="row">
            <Button type="submit" disabled={action.busy}>
              {c("save")}
            </Button>
            <Button variant="secondary" onClick={() => void runNow()} disabled={action.busy}>
              {t("runNow")}
            </Button>
          </div>
          {runResult ? (
            <Alert kind="ok">
              {t("ranNow")}{" "}
              {Object.entries(runResult)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")}
            </Alert>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
