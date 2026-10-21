"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Button, Checkbox, SelectField, TextArea, TextField } from "@platform/ui";
import { api, ApiError } from "@/lib/api";

export function InquiryForm({ unitId }: { unitId: string }) {
  const t = useTranslations("inquiry");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [telegram, setTelegram] = useState(false);
  const [email, setEmail] = useState(false);
  const [notify, setNotify] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState("sending");
    setError(null);
    setFields({});
    const consentChannels = [telegram ? "TELEGRAM" : null, email ? "EMAIL" : null].filter(Boolean);
    try {
      await api("/public/inquiries", {
        method: "POST",
        json: {
          name: form.get("name"),
          phone: form.get("phone"),
          email: form.get("email") || null,
          message: form.get("message") || null,
          locale: form.get("locale"),
          unitId,
          consentChannels,
          notifySimilar: notify && consentChannels.length > 0,
          website: form.get("website") ?? "",
        },
      });
      setState("done");
    } catch (err) {
      setState("idle");
      if (err instanceof ApiError) {
        if (err.status === 429) setError(t("tooMany"));
        else if (err.code === "UNIT_NOT_AVAILABLE") setError(t("unavailable"));
        else if (err.code === "VALIDATION_FAILED") setFields(err.fieldErrors());
        else setError(c("error"));
      } else setError(c("offline"));
    }
  }

  if (state === "done") return <Alert kind="ok">{t("thanks")}</Alert>;

  return (
    <form className="card stack" onSubmit={(e) => void submit(e)} noValidate aria-labelledby="inquiry-title">
      <h2 id="inquiry-title">{t("title")}</h2>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <TextField label={t("name")} name="name" required autoComplete="name" error={fields.name ? c("required") : null} />
      <TextField label={t("phone")} name="phone" required type="tel" inputMode="tel" autoComplete="tel" error={fields.phone ?? null} />
      <TextField label={t("email")} name="email" type="email" autoComplete="email" error={fields.email ?? null} />
      <TextArea label={t("message")} name="message" maxLength={2000} />
      <SelectField
        label={t("language")}
        name="locale"
        defaultValue={locale}
        options={[
          { value: "am", label: c("amharic") },
          { value: "en", label: c("english") },
        ]}
      />
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>{t("consentTitle")}</legend>
        <Checkbox label={t("consentTelegram")} checked={telegram} onChange={(e) => setTelegram(e.target.checked)} />
        <Checkbox label={t("consentEmail")} checked={email} onChange={(e) => setEmail(e.target.checked)} />
      </fieldset>
      <Checkbox label={t("notifySimilar")} checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!telegram && !email} />
      {!telegram && !email ? <span className="muted small">{t("notifyHint")}</span> : null}
      {/* Honeypot: hidden from people, filled in by bots. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px" }}>
        <label htmlFor="website">Website</label>
        <input id="website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <Button type="submit" disabled={state === "sending"}>
        {state === "sending" ? t("sending") : t("submit")}
      </Button>
    </form>
  );
}
