"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, Badge, Button, Card, Checkbox, DataList, EmptyState, Loading, PageHeader, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";

export interface Project {
  id: string;
  name: string;
  area: string;
  description: string | null;
  isPublished: boolean;
  unitCount?: number;
}

export default function ProjectsPage() {
  const t = useTranslations("projects");
  const c = useTranslations("common");
  const router = useRouter();
  const { user } = useSession();
  const { data, error, loading } = useApi<{ items: Project[] }>("/projects");
  const [creating, setCreating] = useState(false);
  const action = useAction();
  const canManage = user?.role === "OWNER" || user?.role === "SALES_MANAGER";

  async function create(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ project: Project }>("/projects", {
        method: "POST",
        json: { name: text(f, "name") ?? "", area: text(f, "area") ?? "", description: text(f, "description"), isPublished: f.get("isPublished") === "on" },
      }),
    );
    if (res) router.push(`/staff/projects/${res.project.id}`);
  }

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          canManage ? (
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
            <TextField label={t("area")} name="area" required error={action.fieldErrors.area} hint={t("areaHint")} />
            <TextArea label={t("description")} name="description" rows={3} />
            <Checkbox label={t("showOnWebsite")} name="isPublished" />
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
          rowKey={(p) => p.id}
          columns={[
            { key: "name", label: c("name"), render: (p) => <Link href={`/staff/projects/${p.id}`}>{p.name}</Link> },
            { key: "area", label: t("area"), render: (p) => p.area },
            { key: "units", label: t("units"), render: (p) => p.unitCount ?? 0 },
            { key: "web", label: t("website"), render: (p) => (p.isPublished ? <Badge tone="ok">{t("published")}</Badge> : <Badge>{t("hidden")}</Badge>) },
          ]}
        />
      ) : null}
    </div>
  );
}
