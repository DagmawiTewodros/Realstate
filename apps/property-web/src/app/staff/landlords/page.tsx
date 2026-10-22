"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, DataList, EmptyState, Loading, PageHeader, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { RENTAL_WRITERS, useSession } from "@/lib/session";

export interface Landlord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
}

export default function LandlordsPage() {
  const t = useTranslations("landlords");
  const c = useTranslations("common");
  const { user } = useSession();
  const canWrite = Boolean(user && RENTAL_WRITERS.includes(user.role));
  const { data, error, loading, reload } = useApi<{ items: Array<Landlord & { unitCount: number }> }>("/landlords");
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  const create = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const res = await action.run(() =>
      api<{ landlord: Landlord }>("/landlords", { method: "POST", json: { name: text(f, "name") ?? "", phone: text(f, "phone"), email: text(f, "email"), notes: text(f, "notes") } }),
    );
    if (res) {
      form.reset();
      setAdding(false);
      await reload();
    }
  };

  const q = query.trim().toLowerCase();
  const items = (data?.items ?? []).filter((l) => !q || [l.name, l.phone, l.email].some((v) => v?.toLowerCase().includes(q)));

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          canWrite && !adding ? (
            <Button onClick={() => setAdding(true)}>{t("new")}</Button>
          ) : null
        }
      />
      {adding ? (
        <Card title={t("new")}>
          <form className="stack" onSubmit={(ev) => void create(ev)} noValidate>
            {action.error ? <Alert kind="error">{action.error}</Alert> : null}
            <TextField label={c("name")} name="name" required autoComplete="off" error={action.fieldErrors.name} />
            <TextField label={c("phone")} name="phone" type="tel" inputMode="tel" autoComplete="off" error={action.fieldErrors.phone} />
            <TextField label={c("email")} name="email" type="email" autoComplete="off" error={action.fieldErrors.email} />
            <TextArea label={c("notes")} name="notes" rows={2} />
            <div className="row">
              <Button type="submit" disabled={action.busy}>
                {action.busy ? c("saving") : c("save")}
              </Button>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                {c("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <form className="filters card" role="search" onSubmit={(ev) => ev.preventDefault()}>
        <TextField label={c("search")} type="search" placeholder={t("searchPlaceholder")} value={query} onChange={(ev) => setQuery(ev.target.value)} />
      </form>
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && items.length === 0 ? <EmptyState title={c("noResults")} /> : null}
      {items.length ? (
        <DataList
          caption={t("title")}
          rows={items}
          rowKey={(l) => l.id}
          columns={[
            {
              key: "name",
              label: c("name"),
              render: (l) => (
                <Link href={`/staff/landlords/${l.id}`}>
                  <strong>{l.name}</strong>
                </Link>
              ),
            },
            { key: "phone", label: c("phone"), render: (l) => (l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : "-") },
            { key: "email", label: c("email"), render: (l) => l.email ?? "-" },
            { key: "units", label: t("units"), render: (l) => l.unitCount },
          ]}
        />
      ) : null}
    </div>
  );
}
