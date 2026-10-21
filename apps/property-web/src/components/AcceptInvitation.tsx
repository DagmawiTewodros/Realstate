"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, Button, TextField } from "@platform/ui";
import { api, ApiError } from "@/lib/api";
import { homeFor, setLocaleCookie, type SessionUser } from "@/lib/session";

export function AcceptInvitation({ token }: { token: string }) {
  const t = useTranslations("auth");
  const c = useTranslations("common");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ user: SessionUser }>("/auth/accept-invitation", { method: "POST", json: { token, password: form.get("password") } });
      setLocaleCookie(res.user.locale);
      router.replace(homeFor(res.user.role));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError) {
        const map: Record<string, string> = { INVITATION_USED: t("inviteUsed"), INVITATION_EXPIRED: t("inviteExpired"), INVITATION_NOT_FOUND: t("inviteInvalid") };
        setError(map[err.code] ?? (err.code === "VALIDATION_FAILED" ? t("passwordHint") : c("error")));
      } else setError(c("offline"));
    }
  }

  return (
    <form className="stack" onSubmit={(e) => void submit(e)}>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <TextField label={t("newPassword")} name="password" type="password" minLength={10} required autoComplete="new-password" hint={t("passwordHint")} />
      <Button type="submit" disabled={busy}>
        {t("createAccount")}
      </Button>
    </form>
  );
}
