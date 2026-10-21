"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Badge, Button, Card, Checkbox, DataList, Loading, Money, PageHeader, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import { unitTone } from "@/lib/tones";
import type { Project } from "../page";

interface UnitRow {
  id: string;
  code: string;
  status: string;
  type: string;
  priceMinor: number;
  building: { name: string } | null;
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("projects");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const detail = useApi<{ project: Project; buildings: Array<{ id: string; name: string }> }>(`/projects/${id}`);
  const unitList = useApi<{ items: UnitRow[]; total: number }>(`/units?projectId=${id}&pageSize=200`);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = user?.role === "OWNER" || user?.role === "SALES_MANAGER";

  if (detail.error) return <Alert kind="error">{detail.error.status === 404 ? c("notFound") : detail.error.message}</Alert>;
  if (!detail.data) return <Loading label={c("loading")} />;
  const { project, buildings } = detail.data;

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api(`/projects/${id}`, {
        method: "PATCH",
        json: { name: text(f, "name") ?? undefined, area: text(f, "area") ?? undefined, description: text(f, "description"), isPublished: f.get("isPublished") === "on" },
      }),
    );
    if (ok) {
      setEditing(false);
      setNotice(c("saved"));
      await detail.reload();
    }
  };

  const addBuilding = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const name = text(new FormData(form), "name");
    if (!name) return;
    if (await action.run(() => api("/buildings", { method: "POST", json: { projectId: id, name } }))) {
      form.reset();
      await detail.reload();
    }
  };

  const renameBuilding = async (ev: FormEvent<HTMLFormElement>, buildingId: string) => {
    ev.preventDefault();
    const name = text(new FormData(ev.currentTarget), "name");
    if (!name) return;
    if (await action.run(() => api(`/buildings/${buildingId}`, { method: "PATCH", json: { name } }))) {
      setRenaming(null);
      await detail.reload();
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title={project.name}
        subtitle={
          <>
            {project.area} · {project.isPublished ? <Badge tone="ok">{t("published")}</Badge> : <Badge>{t("hidden")}</Badge>}
          </>
        }
        actions={
          <Link className="btn" href="/staff/units/new">
            {t("addUnit")}
          </Link>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <div className="grid cols-2">
        <Card title={t("details")}>
          {editing ? (
            <form className="stack" onSubmit={(ev) => void save(ev)} noValidate>
              <TextField label={c("name")} name="name" defaultValue={project.name} error={action.fieldErrors.name} />
              <TextField label={t("area")} name="area" defaultValue={project.area} error={action.fieldErrors.area} />
              <TextArea label={t("description")} name="description" defaultValue={project.description ?? ""} rows={4} />
              <Checkbox label={t("showOnWebsite")} name="isPublished" defaultChecked={project.isPublished} />
              <div className="row">
                <Button type="submit" disabled={action.busy}>
                  {c("save")}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  {c("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <p style={{ whiteSpace: "pre-line" }}>{project.description || <span className="muted">{t("noDescription")}</span>}</p>
              {canManage ? (
                <div>
                  <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
                    {c("edit")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>
        <Card title={t("buildings")}>
          <div className="stack">
            {buildings.length ? (
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
                {buildings.map((b) => (
                  <li key={b.id}>
                    {renaming === b.id ? (
                      <form className="row" onSubmit={(ev) => void renameBuilding(ev, b.id)} style={{ alignItems: "flex-end" }}>
                        <TextField label={c("name")} name="name" defaultValue={b.name} />
                        <Button type="submit" size="small" disabled={action.busy}>
                          {c("save")}
                        </Button>
                      </form>
                    ) : (
                      <span className="spread">
                        {b.name}
                        {canManage ? (
                          <button type="button" className="btn secondary small" onClick={() => setRenaming(b.id)}>
                            {c("edit")}
                          </button>
                        ) : null}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t("noBuildings")}</p>
            )}
            {canManage ? (
              <form className="row" onSubmit={(ev) => void addBuilding(ev)} style={{ alignItems: "flex-end" }}>
                <TextField label={t("newBuilding")} name="name" />
                <Button type="submit" variant="secondary" disabled={action.busy}>
                  {c("add")}
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      </div>
      <Card title={t("unitsTitle", { count: unitList.data?.total ?? 0 })}>
        {unitList.data?.items.length ? (
          <DataList
            rows={unitList.data.items}
            rowKey={(u) => u.id}
            columns={[
              { key: "code", label: t("code"), render: (u) => <Link href={`/staff/units/${u.id}`}>{u.code}</Link> },
              { key: "building", label: t("building"), render: (u) => u.building?.name ?? "-" },
              { key: "type", label: t("type"), render: (u) => e(`UNIT_TYPE.${u.type}`) },
              { key: "price", label: t("price"), render: (u) => <Money minor={u.priceMinor} locale={locale} /> },
              { key: "status", label: c("status"), render: (u) => <Badge tone={unitTone(u.status)}>{e(`UNIT_STATUS.${u.status}`)}</Badge> },
            ]}
          />
        ) : (
          <p className="muted">{c("none")}</p>
        )}
      </Card>
    </div>
  );
}
