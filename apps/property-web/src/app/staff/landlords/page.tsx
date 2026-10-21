"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Button, Card, DataList, EmptyState, Loading, PageHeader, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";

export interface Landlord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  unitCount?: number;
}

export default function LandlordsPage() {
  const t = useTranslations("landlords");
  const c = useTranslations("common");
  const router = useRouter();
  const { user } = useSession();
  const { data, error, loading } = useApi<{ items: Landlord[] }>("/landlords");
  const [creating, setCreating] = useState(false);
  const action = useAction();
  const canEdit = user?.role === "OWNER" || user?.role === "PROPERTY_MANAGER";

  async function create(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ landlord: Landlord }>("/landlords", { method: "POST", json: { name: text(f, "name") ?? "", phone: text(f, "phone"), email: text(f, "email"), notes: text(f, "notes") } }),
    );
    if (res) router.push(`/staff/landlords/${res.landlord.id}`);
  }

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          canEdit ? (
            <Button variant={creating ? "secondary" : "primary"} onClick={() => setCreating(!creating)}>
              {creating ? c("cancel") : t("new")}
            </Button>
          ) : null
        }
      />
      {creating ? (
        <Card title={t("new")}>
          <form className="stack" onSubmit={(ev) => void create(ev)} noValidate>
            {action.error ? <Alert kind="error">{action.error}</Alert> : null}
            <TextField label={c("name")} name="name" required error={action.fieldErrors.name} />
            <TextField label={c("phone")} name="phone" type="tel" error={action.fieldErrors.phone} />
            <TextField label={c("email")} name="email" type="email" error={action.fieldErrors.email} />
            <TextArea label={c("notes")} name="notes" rows={2} />
            <div>
              <Button type="submit" disabled={action.busy}>
                {c("save")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={t("empty")} /> : null}
      {data && data.items.length ? (
        <DataList
          caption={t("title")}
          rows={data.items}
          rowKey={(l) => l.id}
          columns={[
            { key: "name", label: c("name"), render: (l) => <Link href={`/staff/landlords/${l.id}`}>{l.name}</Link> },
            { key: "phone", label: c("phone"), render: (l) => l.phone ?? "-" },
            { key: "email", label: c("email"), render: (l) => l.email ?? "-" },
            { key: "units", label: t("units"), render: (l) => l.unitCount ?? 0 },
          ]}
        />
      ) : null}
    </div>
  );
}
