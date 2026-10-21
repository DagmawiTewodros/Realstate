"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PLAN_KINDS } from "@platform/shared";
import { Alert, Badge, Button, Card, Checkbox, DataList, Loading, Money, PageHeader, SelectField, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { birr, int, minorToInput, text, useAction } from "@/lib/forms";
import type { Plan } from "@/lib/types";

/** Membership plans (managers). Prices changes apply to new sales only; sold memberships keep their price. */
export default function PlansPage() {
  const t = useTranslations("plans");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const { data, error, loading, reload } = useApi<{ items: Plan[] }>("/plans?all=true");
  const action = useAction();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const plan = data?.items.find((p) => p.id === editing);

  async function save(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const priceMinor = birr(f, "price");
    if (priceMinor === null) return action.setError(t("priceInvalid"));
    const body = { name: text(f, "name") ?? "", kind: f.get("kind"), durationMonths: int(f, "durationMonths") ?? 1, priceMinor, isActive: f.get("isActive") === "on" };
    const ok = await action.run(() => (editing === "new" ? api("/plans", { method: "POST", json: body }) : api(`/plans/${editing}`, { method: "PATCH", json: body })));
    if (ok) {
      setEditing(null);
      setNotice(c("saved"));
      await reload();
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        subtitle={t("intro")}
        actions={
          <Button onClick={() => setEditing("new")} disabled={editing === "new"}>
            {t("new")}
          </Button>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {editing ? (
        <Card title={editing === "new" ? t("new") : `${c("edit")}: ${plan?.name ?? ""}`}>
          <form className="stack" onSubmit={(ev) => void save(ev)} noValidate key={editing}>
            {action.error ? <Alert kind="error">{action.error}</Alert> : null}
            <div className="grid cols-2">
              <TextField label={c("name")} name="name" defaultValue={plan?.name} required error={action.fieldErrors.name} />
              <SelectField label={t("kind")} name="kind" defaultValue={plan?.kind ?? "INDIVIDUAL"} options={PLAN_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))} />
              <TextField label={t("months")} name="durationMonths" type="number" min={1} max={36} defaultValue={plan?.durationMonths ?? 1} error={action.fieldErrors.durationMonths} />
              <TextField label={t("price")} name="price" inputMode="decimal" defaultValue={minorToInput(plan?.priceMinor)} required />
            </div>
            <Checkbox label={t("onSale")} name="isActive" defaultChecked={plan?.isActive ?? true} />
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
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data ? (
        <DataList
          caption={t("title")}
          rows={data.items}
          rowKey={(p) => p.id}
          columns={[
            { key: "name", label: c("name"), render: (p) => <strong>{p.name}</strong> },
            { key: "kind", label: t("kind"), render: (p) => t(`kinds.${p.kind}`) },
            { key: "months", label: t("months"), render: (p) => p.durationMonths },
            { key: "price", label: t("price"), render: (p) => <Money minor={p.priceMinor} locale={locale} /> },
            { key: "active", label: c("status"), render: (p) => (p.isActive ? <Badge tone="ok">{t("onSale")}</Badge> : <Badge>{t("offSale")}</Badge>) },
            {
              key: "edit",
              label: c("actions"),
              render: (p) => (
                <button type="button" className="btn secondary small" onClick={() => setEditing(p.id)}>
                  {c("edit")}
                </button>
              ),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
