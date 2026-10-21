"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { MAINTENANCE_STATUSES, PRIORITIES } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, EmptyState, LocalDate, Loading, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { maintenanceTone, priorityTone } from "@/lib/tones";
import { UnitPicker } from "@/components/Pickers";

export interface RepairRow {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  assignedToName: string | null;
  assignedToPhone: string | null;
  costMinor: number | null;
  paidByLandlord: boolean;
  createdAt: string;
  closedAt: string | null;
  unit: { id: string; code: string };
}

export default function MaintenancePage() {
  const t = useTranslations("maintenance");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const [filters, setFilters] = useState({ status: "", priority: "" });
  const [creating, setCreating] = useState(false);
  const { data, error, loading } = useApi<{ items: RepairRow[] }>(`/maintenance${qs(filters)}`);
  const action = useAction();
  const open = (data?.items ?? []).filter((r) => r.status !== "DONE" && r.status !== "CANCELLED");
  const shown = filters.status ? data?.items ?? [] : open;

  async function create(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    if (!text(f, "unitId")) return action.setError(t("chooseUnit"));
    const res = await action.run(() =>
      api<{ request: { id: string } }>("/maintenance", {
        method: "POST",
        json: { unitId: text(f, "unitId"), title: text(f, "title") ?? "", description: text(f, "description"), priority: f.get("priority") },
      }),
    );
    if (res) router.push(`/staff/maintenance/${res.request.id}`);
  }

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          <Button variant={creating ? "secondary" : "primary"} onClick={() => setCreating(!creating)}>
            {creating ? c("cancel") : t("new")}
          </Button>
        }
      />
      {creating ? (
        <Card title={t("new")}>
          <form className="stack" onSubmit={(ev) => void create(ev)} noValidate>
            {action.error ? <Alert kind="error">{action.error}</Alert> : null}
            <UnitPicker label={t("unit")} name="unitId" />
            <TextField label={t("what")} name="title" required error={action.fieldErrors.title} />
            <TextArea label={t("details")} name="description" rows={3} />
            <SelectField label={t("priority")} name="priority" defaultValue="NORMAL" options={PRIORITIES.map((p) => ({ value: p, label: e(`PRIORITY.${p}`) }))} />
            <div>
              <Button type="submit" disabled={action.busy}>
                {c("save")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <form className="filters card" onSubmit={(ev) => ev.preventDefault()}>
        <SelectField
          label={c("status")}
          value={filters.status}
          onChange={(ev) => setFilters((f) => ({ ...f, status: ev.target.value }))}
          options={[{ value: "", label: t("openOnly") }, ...MAINTENANCE_STATUSES.map((s) => ({ value: s, label: e(`MAINTENANCE_STATUS.${s}`) }))]}
        />
        <SelectField
          label={t("priority")}
          value={filters.priority}
          onChange={(ev) => setFilters((f) => ({ ...f, priority: ev.target.value }))}
          options={[{ value: "", label: c("all") }, ...PRIORITIES.map((p) => ({ value: p, label: e(`PRIORITY.${p}`) }))]}
        />
      </form>
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && shown.length === 0 ? <EmptyState title={t("none")} /> : null}
      {shown.length ? (
        <DataList
          caption={t("title")}
          rows={shown}
          rowKey={(r) => r.id}
          columns={[
            { key: "title", label: t("what"), render: (r) => <Link href={`/staff/maintenance/${r.id}`}>{r.title}</Link> },
            { key: "unit", label: t("unit"), render: (r) => r.unit.code },
            { key: "priority", label: t("priority"), render: (r) => <Badge tone={priorityTone(r.priority)}>{e(`PRIORITY.${r.priority}`)}</Badge> },
            { key: "status", label: c("status"), render: (r) => <Badge tone={maintenanceTone(r.status)}>{e(`MAINTENANCE_STATUS.${r.status}`)}</Badge> },
            { key: "who", label: t("assignedTo"), render: (r) => r.assignedToName ?? "-" },
            { key: "created", label: t("reported"), render: (r) => <LocalDate value={r.createdAt} locale={locale} /> },
          ]}
        />
      ) : null}
    </div>
  );
}
