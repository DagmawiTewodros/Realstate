"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, SelectField, TextArea, TextField } from "@platform/ui";
import { ACTIVITY_TYPES } from "@platform/shared";
import { api, ApiError } from "@/lib/api";

/** Converts a value from <input type="datetime-local"> (Addis local time) into an ISO instant. */
export function addisLocalToIso(value: string): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - 3 * 3600_000;
  return new Date(utc).toISOString();
}

/** Logs a call (or another activity) and sets the next step in one go. */
export function LogActivity({ leadId, onDone, defaultType = "CALL" }: { leadId: string; onDone: () => void; defaultType?: string }) {
  const t = useTranslations("staff");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const next = addisLocalToIso(String(f.get("nextStepAt") ?? ""));
      await api(`/leads/${leadId}/activities`, {
        method: "POST",
        json: {
          type: f.get("type"),
          notes: f.get("notes") || null,
          ...(next ? { nextStepAt: next, nextStepNote: f.get("nextStepNote") || null } : {}),
        },
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : c("offline"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(ev) => void submit(ev)}>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <SelectField label={t("activityType")} name="type" defaultValue={defaultType} options={ACTIVITY_TYPES.map((a) => ({ value: a, label: e(`ACTIVITY_TYPE.${a}`) }))} />
      <TextArea label={c("notes")} name="notes" />
      <TextField label={t("nextStepAt")} name="nextStepAt" type="datetime-local" />
      <TextField label={t("nextStepNote")} name="nextStepNote" />
      <Button type="submit" disabled={busy}>
        {busy ? c("saving") : c("save")}
      </Button>
    </form>
  );
}
