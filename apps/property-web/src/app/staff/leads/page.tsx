"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LEAD_SOURCES, LEAD_STATUSES } from "@platform/shared";
import { Alert, Badge, DataList, EmptyState, LocalDate, Loading, PageHeader, SelectField, TextField } from "@platform/ui";
import { qs, useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Pager, StaffSelect } from "@/components/Pickers";
import type { LeadRow } from "../page";

interface Paged {
  items: LeadRow[];
  page: number;
  pageSize: number;
  total: number;
}

export default function LeadsPage() {
  const t = useTranslations("leads");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const [filters, setFilters] = useState({ q: "", status: "", source: "", assignedToId: "", overdue: "" });
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<Paged>(`/leads${qs({ ...filters, page, pageSize: 25 })}`);
  const isBroker = user?.role === "BROKER";

  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          <Link className="btn" href="/staff/leads/new">
            {t("new")}
          </Link>
        }
      />
      <form className="filters card" role="search" onSubmit={(ev) => ev.preventDefault()}>
        <TextField label={c("search")} type="search" value={filters.q} onChange={(ev) => set("q", ev.target.value)} placeholder={t("searchPlaceholder")} />
        <SelectField
          label={c("status")}
          value={filters.status}
          onChange={(ev) => set("status", ev.target.value)}
          options={[{ value: "", label: c("all") }, ...LEAD_STATUSES.map((s) => ({ value: s, label: e(`LEAD_STATUS.${s}`) }))]}
        />
        <SelectField
          label={t("source")}
          value={filters.source}
          onChange={(ev) => set("source", ev.target.value)}
          options={[{ value: "", label: c("all") }, ...LEAD_SOURCES.map((s) => ({ value: s, label: e(`LEAD_SOURCE.${s}`) }))]}
        />
        {!isBroker ? (
          <StaffSelect label={t("assignee")} name="assignedToId" roles={["BROKER", "SALES_MANAGER"]} allowEmpty value={filters.assignedToId} onChange={(v) => set("assignedToId", v)} />
        ) : null}
        <SelectField
          label={t("followUp")}
          value={filters.overdue}
          onChange={(ev) => set("overdue", ev.target.value)}
          options={[
            { value: "", label: c("all") },
            { value: "true", label: t("overdueOnly") },
          ]}
        />
      </form>
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={c("noResults")} /> : null}
      {data && data.items.length ? (
        <>
          <p className="small muted">{t("count", { count: data.total })}</p>
          <DataList
            caption={t("title")}
            rows={data.items}
            rowKey={(l) => l.id}
            columns={[
              {
                key: "customer",
                label: t("customer"),
                render: (l) => (
                  <Link href={`/staff/leads/${l.id}`}>
                    <strong>{l.customer.name}</strong>
                  </Link>
                ),
              },
              { key: "phone", label: c("phone"), render: (l) => (l.customer.phone ? <a href={`tel:${l.customer.phone}`}>{l.customer.phone}</a> : "-") },
              { key: "status", label: c("status"), render: (l) => <Badge tone={l.status === "SIGNED" ? "ok" : l.status === "LOST" ? "danger" : "brand"}>{e(`LEAD_STATUS.${l.status}`)}</Badge> },
              { key: "source", label: t("source"), render: (l) => e(`LEAD_SOURCE.${l.source}`) },
              { key: "assignee", label: t("assignee"), render: (l) => l.assignee?.name ?? <span className="muted">{t("unassigned")}</span> },
              { key: "next", label: t("nextStep"), render: (l) => <LocalDate value={l.nextStepAt} locale={locale} withTime /> },
            ]}
          />
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
