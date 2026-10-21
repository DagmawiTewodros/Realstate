"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { UNIT_PURPOSES, UNIT_STATUSES, UNIT_TYPES } from "@platform/shared";
import { Alert, Badge, DataList, EmptyState, Loading, Money, PageHeader, SelectField, TextField } from "@platform/ui";
import { qs, useApi } from "@/lib/api";
import { Pager } from "@/components/Pickers";
import type { UnitRecord } from "@/components/UnitForm";
import { unitTone } from "@/lib/tones";

type UnitRow = UnitRecord & { project: { id: string; name: string; area: string }; building: { id: string; name: string } | null; photoCount: number };

export default function UnitsPage() {
  const t = useTranslations("units");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const [filters, setFilters] = useState({ q: "", status: "", type: "", purpose: "", sort: "newest" });
  const [page, setPage] = useState(1);
  const { data, error, loading } = useApi<{ items: UnitRow[]; page: number; pageSize: number; total: number }>(`/units${qs({ ...filters, page, pageSize: 25 })}`);
  const set = (k: keyof typeof filters, v: string) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  const all = { value: "", label: c("all") };

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          <Link className="btn" href="/staff/units/new">
            {t("new")}
          </Link>
        }
      />
      <form className="filters card" role="search" onSubmit={(ev) => ev.preventDefault()}>
        <TextField label={c("search")} type="search" placeholder={t("searchUnit")} value={filters.q} onChange={(ev) => set("q", ev.target.value)} />
        <SelectField label={c("status")} value={filters.status} onChange={(ev) => set("status", ev.target.value)} options={[all, ...UNIT_STATUSES.map((s) => ({ value: s, label: e(`UNIT_STATUS.${s}`) }))]} />
        <SelectField label={t("type")} value={filters.type} onChange={(ev) => set("type", ev.target.value)} options={[all, ...UNIT_TYPES.map((s) => ({ value: s, label: e(`UNIT_TYPE.${s}`) }))]} />
        <SelectField label={t("purpose")} value={filters.purpose} onChange={(ev) => set("purpose", ev.target.value)} options={[all, ...UNIT_PURPOSES.map((s) => ({ value: s, label: e(`UNIT_PURPOSE.${s}`) }))]} />
        <SelectField
          label={t("sort")}
          value={filters.sort}
          onChange={(ev) => set("sort", ev.target.value)}
          options={[
            { value: "newest", label: t("sortNewest") },
            { value: "price_asc", label: t("sortPriceAsc") },
            { value: "price_desc", label: t("sortPriceDesc") },
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
            rowKey={(u) => u.id}
            columns={[
              {
                key: "code",
                label: t("code"),
                render: (u) => (
                  <Link href={`/staff/units/${u.id}`}>
                    <strong>{u.code}</strong>
                  </Link>
                ),
              },
              { key: "project", label: t("project"), render: (u) => `${u.project.name}${u.building ? ` · ${u.building.name}` : ""}` },
              { key: "type", label: t("type"), render: (u) => `${e(`UNIT_TYPE.${u.type}`)} · ${e(`UNIT_PURPOSE.${u.purpose}`)}` },
              { key: "price", label: t("price"), render: (u) => <Money minor={u.priceMinor} locale={locale} /> },
              { key: "status", label: c("status"), render: (u) => <Badge tone={unitTone(u.status)}>{e(`UNIT_STATUS.${u.status}`)}</Badge> },
              {
                key: "web",
                label: t("website"),
                render: (u) => (
                  <span className="small">
                    {u.isPublished ? t("published") : t("notPublished")} · {t("photoCount", { count: u.photoCount })}
                  </span>
                ),
              },
            ]}
          />
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
