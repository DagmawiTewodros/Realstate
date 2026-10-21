"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { GYM_REMINDER_TYPES, type GymSettings } from "@platform/shared";
import { Alert, Button, Card, Checkbox, Loading, PageHeader, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { int, useAction } from "@/lib/forms";

/** Owner settings for automatic member messages. */
export default function GymSettingsPage() {
  const t = useTranslations("settings");
  const c = useTranslations("common");
  const { data, error, reload } = useApi<{ settings: GymSettings }>("/settings/reminders");
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const [ran, setRan] = useState<Record<string, unknown> | null>(null);

  async function save(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body = {
      enabled: Object.fromEntries(GYM_REMINDER_TYPES.map((k) => [k, f.get(`enabled.${k}`) === "on"])),
      inactiveDays: int(f, "inactiveDays") ?? 14,
      expiringDays: int(f, "expiringDays") ?? 3,
    };
    if (await action.run(() => api("/settings/reminders", { method: "PUT", json: body }))) {
      setNotice(c("saved"));
      await reload();
    }
  }

  const runNow = async () => {
    const res = await action.run(() => api<Record<string, unknown>>("/jobs/run", { method: "POST" }));
    if (res) setRan(res);
  };

  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (!data) return <Loading label={c("loading")} />;
  const s = data.settings;

  return (
    <div className="stack">
      <PageHeader title={t("title")} />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <Card title={t("reminders")}>
        <form className="stack" onSubmit={(ev) => void save(ev)} noValidate>
          <p className="small muted">{t("remindersHint")}</p>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 4 }}>
            <legend className="label">{t("which")}</legend>
            {GYM_REMINDER_TYPES.map((k) => (
              <Checkbox key={k} label={t(`type.${k.replace(".", "_")}`)} name={`enabled.${k}`} defaultChecked={s.enabled[k] !== false} />
            ))}
          </fieldset>
          <div className="grid cols-2">
            <TextField label={t("expiringDays")} name="expiringDays" type="number" min={1} max={30} defaultValue={s.expiringDays} />
            <TextField label={t("inactiveDays")} name="inactiveDays" type="number" min={3} max={120} defaultValue={s.inactiveDays} />
          </div>
          <div className="row">
            <Button type="submit" disabled={action.busy}>
              {c("save")}
            </Button>
            <Button variant="secondary" onClick={() => void runNow()} disabled={action.busy}>
              {t("runNow")}
            </Button>
          </div>
          {ran ? (
            <Alert kind="ok">
              {t("ranNow")} <code className="small">{JSON.stringify(ran)}</code>
            </Alert>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
