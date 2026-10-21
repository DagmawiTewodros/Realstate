"use client";

import { type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Card, DataList, Loading, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";

interface TrainerRow {
  trainer: { id: string; bio: string | null; phone: string | null };
  user: { id: string; name: string; isActive: boolean };
}

/** Trainer profiles (managers). A profile links a staff account with the TRAINER role to classes and members. */
export default function TrainersPage() {
  const t = useTranslations("trainers");
  const c = useTranslations("common");
  const list = useApi<{ items: TrainerRow[] }>("/trainers");
  const staff = useApi<{ items: Array<{ id: string; name: string; role: string }> }>("/staff");
  const action = useAction();
  const withProfile = new Set(list.data?.items.map((r) => r.user.id));
  const candidates = (staff.data?.items ?? []).filter((s) => s.role === "TRAINER" && !withProfile.has(s.id));

  async function create(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const ok = await action.run(() => api("/trainers", { method: "POST", json: { userId: text(f, "userId"), bio: text(f, "bio"), phone: text(f, "phone") } }));
    if (ok) {
      form.reset();
      await list.reload();
    }
  }

  return (
    <div className="stack">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {list.error ? <Alert kind="error">{list.error.message}</Alert> : null}
      {list.loading && !list.data ? <Loading label={c("loading")} /> : null}
      {list.data ? (
        <DataList
          caption={t("title")}
          rows={list.data.items}
          rowKey={(r) => r.trainer.id}
          columns={[
            { key: "name", label: c("name"), render: (r) => <strong>{r.user.name}</strong> },
            { key: "phone", label: c("phone"), render: (r) => r.trainer.phone ?? "-" },
            { key: "bio", label: t("bio"), render: (r) => <span className="small">{r.trainer.bio ?? ""}</span> },
            { key: "active", label: c("status"), render: (r) => (r.user.isActive ? <Badge tone="ok">{t("active")}</Badge> : <Badge>{t("inactive")}</Badge>) },
          ]}
        />
      ) : null}
      <Card title={t("new")}>
        {candidates.length ? (
          <form className="stack" onSubmit={(ev) => void create(ev)}>
            <SelectField label={t("account")} name="userId" options={candidates.map((s) => ({ value: s.id, label: s.name }))} />
            <TextField label={c("phone")} name="phone" type="tel" error={action.fieldErrors.phone} />
            <TextArea label={t("bio")} name="bio" rows={2} />
            <div>
              <Button type="submit" disabled={action.busy}>
                {c("save")}
              </Button>
            </div>
          </form>
        ) : (
          <p className="muted small">{t("noCandidates")}</p>
        )}
      </Card>
    </div>
  );
}
