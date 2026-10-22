"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MAINTENANCE_STATUSES, PRIORITIES } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, EmptyState, LocalDate, Loading, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { UnitPicker } from "@/components/Pickers";
import { maintenanceTone, priorityTone } from "@/lib/tones";

export interface MaintenanceRequest {
  id: string;
  unitId: string;
  leaseId: string | null;
  reportedByCustomerId: string | null;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assignedToName: string | null;
  assignedToPhone: string | null;
  costMinor: number | null;
  paidByLandlord: boolean;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

/** Open requests unless a status is chosen. */
const OPEN = "OPEN";

export default function MaintenancePage() {
  const t = useTranslations("maintenance");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const [status, setStatus] = useState(OPEN);
  const [priority, setPriority] = useState("");
  const { data, error, loading } = useApi<{ items: Array<MaintenanceRequest & { unit: { id: string; code: string } }> }>(
    `/maintenance${qs({ status: status === OPEN ? undefined : status, priority })}`,
  );
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const items = (data?.items ?? []).filter((r) => status !== OPEN || !["DONE", "CANCELLED"].includes(r.status));

  const create = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ request: { id: string } }>("/maintenance", {
        method: "POST",
        json: { unitId: text(f, "unitId"), title: text(f, "title") ?? "", description: text(f, "description"), priority: f.get("priority") },
      }),
    );
    if (res) router.push(`/staff/maintenance/${res.request.id}`);
  };

  return (
    <div className="stack">
      <PageHeader title={t("title")} actions={!adding ? <Button onClick={() => setAdding(true)}>{t("new")}</Button> : null} />
      {adding ? (
        <Card title={t("new")}>
          <form className="stack" onSubmit={(ev) => void create(ev)} noValidate>
            {action.error ? <Alert kind="error">{action.error}</Alert> : null}
            <UnitPicker label={t("unit")} name="unitId" />
            {action.fieldErrors.unitId ? <span className="error small">{action.fieldErrors.unitId}</span> : null}
            <TextField label={t("requestTitle")} name="title" required placeholder={t("titlePlaceholder")} error={action.fieldErrors.title} />
            <TextArea label={t("description")} name="description" rows={3} />
            <SelectField label={t("priority")} name="priority" defaultValue="NORMAL" options={PRIORITIES.map((p) => ({ value: p, label: e(`PRIORITY.${p}`) }))} />
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
        <SelectField
          label={c("status")}
          value={status}
          onChange={(ev) => setStatus(ev.target.value)}
          options={[{ value: OPEN, label: t("open") }, { value: "", label: c("all") }, ...MAINTENANCE_STATUSES.map((s) => ({ value: s, label: e(`MAINTENANCE_STATUS.${s}`) }))]}
        />
        <SelectField
          label={t("priority")}
          value={priority}
          onChange={(ev) => setPriority(ev.target.value)}
          options={[{ value: "", label: c("all") }, ...PRIORITIES.map((p) => ({ value: p, label: e(`PRIORITY.${p}`) }))]}
        />
      </form>
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && items.length === 0 ? <EmptyState title={c("noResults")} /> : null}
      {items.length ? (
        <DataList
          caption={t("title")}
          rows={items}
          rowKey={(r) => r.id}
          columns={[
            {
              key: "title",
              label: t("requestTitle"),
              render: (r) => (
                <Link href={`/staff/maintenance/${r.id}`}>
                  <strong>{r.title}</strong>
                </Link>
              ),
            },
            { key: "unit", label: t("unit"), render: (r) => r.unit.code },
            { key: "priority", label: t("priority"), render: (r) => <Badge tone={priorityTone(r.priority)}>{e(`PRIORITY.${r.priority}`)}</Badge> },
            { key: "status", label: c("status"), render: (r) => <Badge tone={maintenanceTone(r.status)}>{e(`MAINTENANCE_STATUS.${r.status}`)}</Badge> },
            { key: "assignee", label: t("assignee"), render: (r) => r.assignedToName ?? "-" },
            { key: "created", label: t("reported"), render: (r) => <LocalDate value={r.createdAt} locale={locale} /> },
          ]}
        />
      ) : null}
    </div>
  );
}
