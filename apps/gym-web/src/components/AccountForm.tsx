"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, PageHeader, TextField } from "@platform/ui";
import { api } from "@/lib/api";
import { useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";

/** The signed-in person's own account: change password. Language is switched from the top bar. */
export function AccountForm() {
  const t = useTranslations("account");
  const c = useTranslations("common");
  const { user } = useSession();
  const action = useAction();
  const [done, setDone] = useState(false);

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const newPassword = String(f.get("newPassword") ?? "");
    if (newPassword !== String(f.get("repeat") ?? "")) return action.setError(t("mismatch"));
    setDone(false);
    const ok = await action.run(() => api("/auth/change-password", { method: "POST", json: { currentPassword: String(f.get("currentPassword") ?? ""), newPassword } }));
    if (ok) {
      form.reset();
      setDone(true);
    }
  }

  return (
    <div className="stack">
      <PageHeader title={t("title")} />
      <Card>
        <dl className="facts">
          <dt>{c("name")}</dt>
          <dd>{user?.name}</dd>
          <dt>{c("email")}</dt>
          <dd>{user?.email}</dd>
        </dl>
      </Card>
      <Card title={t("changePassword")}>
        <form className="stack" onSubmit={(ev) => void submit(ev)} noValidate>
          {done ? <Alert kind="ok">{t("changed")}</Alert> : null}
          {action.error ? <Alert kind="error">{action.error}</Alert> : null}
          <TextField label={t("current")} name="currentPassword" type="password" autoComplete="current-password" required />
          <TextField label={t("new")} name="newPassword" type="password" autoComplete="new-password" required minLength={10} hint={t("hint")} error={action.fieldErrors.newPassword} />
          <TextField label={t("repeat")} name="repeat" type="password" autoComplete="new-password" required />
          <div>
            <Button type="submit" disabled={action.busy}>
              {c("save")}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
