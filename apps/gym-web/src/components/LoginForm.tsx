"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, TextField } from "@platform/ui";
import { api, ApiError } from "@/lib/api";
import { homeFor, setLocaleCookie, type SessionUser } from "@/lib/session";

export function LoginForm() {
  const t = useTranslations("auth");
  const c = useTranslations("common");
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = new FormData(ev.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: SessionUser }>("/auth/login", { method: "POST", json: { email: form.get("email"), password: form.get("password") } });
      setLocaleCookie(res.user.locale);
      const next = params.get("next");
      // Only same-site paths are followed, so a crafted link cannot send people elsewhere.
      router.replace(next && /^\/(?![\/\\])/.test(next) ? next : homeFor(res.user.role));
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) setError(err.status === 429 ? t("tooMany") : err.status === 401 || err.status === 400 ? t("invalid") : c("error"));
      else setError(c("offline"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(ev) => void submit(ev)}>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <TextField label={t("email")} name="email" type="email" required autoComplete="username" />
      <TextField label={t("password")} name="password" type="password" required autoComplete="current-password" />
      <Button type="submit" disabled={busy}>
        {t("submit")}
      </Button>
    </form>
  );
}
