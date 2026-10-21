"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Card, DataList, Loading, PageHeader, SelectField, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  locale: "am" | "en";
  isActive: boolean;
  telegramChatId: string | null;
}

const STAFF_ROLES = ["OWNER", "SALES_MANAGER", "BROKER", "PROPERTY_MANAGER"] as const;

/** Staff accounts (owner only). Landlords and tenants get accounts by invitation instead. */
export default function UsersPage() {
  const t = useTranslations("users");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const { user: me } = useSession();
  const { data, error, loading, reload } = useApi<{ items: UserRow[] }>("/users");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  const roleOptions = STAFF_ROLES.map((r) => ({ value: r, label: e(`ROLE.${r}`) }));
  const langOptions = [
    { value: "am", label: c("amharic") },
    { value: "en", label: c("english") },
  ];

  async function create(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const ok = await action.run(() =>
      api("/users", {
        method: "POST",
        json: { name: text(f, "name") ?? "", email: text(f, "email") ?? "", role: f.get("role"), locale: f.get("locale"), password: String(f.get("password") ?? ""), telegramChatId: text(f, "telegramChatId") },
      }),
    );
    if (ok) {
      form.reset();
      setCreating(false);
      setNotice(t("created"));
      await reload();
    }
  }

  async function update(ev: FormEvent<HTMLFormElement>, id: string) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api(`/users/${id}`, { method: "PATCH", json: { name: text(f, "name") ?? undefined, role: f.get("role") ?? undefined, locale: f.get("locale"), telegramChatId: text(f, "telegramChatId") } }),
    );
    if (ok) {
      setEditing(null);
      setNotice(c("saved"));
      await reload();
    }
  }

  async function resetPassword(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (!resetting) return;
    const password = String(new FormData(ev.currentTarget).get("password") ?? "");
    if (await action.run(() => api(`/users/${resetting.id}/password`, { method: "POST", json: { password } }))) {
      setNotice(t("passwordSet", { name: resetting.name }));
      setResetting(null);
    }
  }

  async function setActive(u: UserRow, isActive: boolean) {
    if (!isActive && !window.confirm(t("deactivateConfirm", { name: u.name }))) return;
    if (await action.run(() => api(`/users/${u.id}`, { method: "PATCH", json: { isActive } }))) await reload();
  }

  const editingUser = data?.items.find((u) => u.id === editing);

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        subtitle={t("intro")}
        actions={
          <Button variant={creating ? "secondary" : "primary"} onClick={() => setCreating(!creating)}>
            {creating ? c("cancel") : t("new")}
          </Button>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {creating ? (
        <Card title={t("new")}>
          <form className="stack" onSubmit={(ev) => void create(ev)} noValidate autoComplete="off">
            <div className="grid cols-2">
              <TextField label={c("name")} name="name" required error={action.fieldErrors.name} />
              <TextField label={c("email")} name="email" type="email" required error={action.fieldErrors.email} />
              <SelectField label={t("role")} name="role" defaultValue="BROKER" options={roleOptions} />
              <SelectField label={c("language")} name="locale" defaultValue="am" options={langOptions} />
              <TextField label={t("tempPassword")} name="password" type="text" required minLength={10} error={action.fieldErrors.password} hint={t("tempPasswordHint")} />
              <TextField label={t("telegram")} name="telegramChatId" hint={t("telegramHint")} />
            </div>
            <div>
              <Button type="submit" disabled={action.busy}>
                {c("save")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {editingUser ? (
        <Card title={`${c("edit")}: ${editingUser.name}`}>
          <form className="stack" onSubmit={(ev) => void update(ev, editingUser.id)} noValidate>
            <div className="grid cols-2">
              <TextField label={c("name")} name="name" defaultValue={editingUser.name} />
              {STAFF_ROLES.includes(editingUser.role as (typeof STAFF_ROLES)[number]) && editingUser.id !== me?.id ? (
                <SelectField label={t("role")} name="role" defaultValue={editingUser.role} options={roleOptions} />
              ) : null}
              <SelectField label={c("language")} name="locale" defaultValue={editingUser.locale} options={langOptions} />
              <TextField label={t("telegram")} name="telegramChatId" defaultValue={editingUser.telegramChatId ?? ""} />
            </div>
            <div className="row">
              <Button type="submit" disabled={action.busy}>
                {c("save")}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                {c("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {resetting ? (
        <Card title={t("resetTitle", { name: resetting.name })}>
          <form className="stack" onSubmit={(ev) => void resetPassword(ev)} noValidate autoComplete="off">
            <p className="small muted">{t("resetHint")}</p>
            <TextField label={t("tempPassword")} name="password" type="text" required minLength={10} error={action.fieldErrors.password} />
            <div className="row">
              <Button type="submit" disabled={action.busy}>
                {c("save")}
              </Button>
              <Button variant="secondary" onClick={() => setResetting(null)}>
                {c("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data ? (
        <DataList
          caption={t("title")}
          rows={data.items}
          rowKey={(u) => u.id}
          columns={[
            { key: "name", label: c("name"), render: (u) => <strong>{u.name}</strong> },
            { key: "email", label: c("email"), render: (u) => u.email },
            { key: "role", label: t("role"), render: (u) => e(`ROLE.${u.role}`) },
            { key: "active", label: c("status"), render: (u) => (u.isActive ? <Badge tone="ok">{t("active")}</Badge> : <Badge tone="danger">{t("inactive")}</Badge>) },
            {
              key: "actions",
              label: c("actions"),
              render: (u) => (
                <span className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn secondary small" onClick={() => setEditing(u.id)}>
                    {c("edit")}
                  </button>
                  {u.id !== me?.id && STAFF_ROLES.includes(u.role as (typeof STAFF_ROLES)[number]) ? (
                    <button type="button" className="btn secondary small" onClick={() => setResetting(u)}>
                      {t("resetPassword")}
                    </button>
                  ) : null}
                  {u.id !== me?.id ? (
                    <button type="button" className={`btn small ${u.isActive ? "danger" : "secondary"}`} onClick={() => void setActive(u, !u.isActive)}>
                      {u.isActive ? t("deactivate") : t("reactivate")}
                    </button>
                  ) : null}
                </span>
              ),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
