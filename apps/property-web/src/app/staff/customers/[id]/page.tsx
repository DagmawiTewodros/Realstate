"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CHANNELS, ENABLED_CHANNELS, UNIT_PURPOSES, UNIT_TYPES, formatMoney } from "@platform/shared";
import { Alert, Badge, Button, Card, Checkbox, DataList, LocalDate, Loading, PageHeader, SelectField, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { birr, int, text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import type { Customer } from "../page";
import type { LeadRow } from "../../page";

interface SavedSearch {
  id: string;
  purpose: string | null;
  type: string | null;
  area: string | null;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  bedrooms: number | null;
  isActive: boolean;
}

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("customers");
  const l = useTranslations("leads");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const detail = useApi<{ customer: Customer; consent: Record<string, boolean> }>(`/customers/${id}`);
  const leads = useApi<{ items: LeadRow[] }>(user?.role === "PROPERTY_MANAGER" ? null : `/leads?customerId=${id}&pageSize=50`);
  const saved = useApi<{ items: SavedSearch[] }>(user?.role === "PROPERTY_MANAGER" ? null : `/saved-searches?customerId=${id}`);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingSearch, setAddingSearch] = useState(false);

  if (detail.error) return <Alert kind="error">{detail.error.status === 404 ? c("notFound") : detail.error.message}</Alert>;
  if (!detail.data) return <Loading label={c("loading")} />;
  const { customer, consent } = detail.data;
  const isOwner = user?.role === "OWNER";
  const canSell = user?.role !== "PROPERTY_MANAGER";

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ warnings: unknown[] }>(`/customers/${id}`, {
        method: "PATCH",
        json: { name: text(f, "name") ?? undefined, phone: text(f, "phone"), email: text(f, "email"), telegramChatId: text(f, "telegramChatId"), locale: f.get("locale") },
      }),
    );
    if (res) {
      setEditing(false);
      setNotice(res.warnings.length ? t("duplicateWarning") : c("saved"));
      await detail.reload();
    }
  };

  const setConsent = async (channel: string, granted: boolean) => {
    const ok = await action.run(() => api(`/customers/${id}/consent`, { method: "POST", json: { channel, granted, note: t("consentNote") } }));
    if (ok) await detail.reload();
  };

  const addSearch = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api("/saved-searches", {
        method: "POST",
        json: {
          customerId: id,
          purpose: text(f, "purpose"),
          type: text(f, "type"),
          area: text(f, "area"),
          minPriceMinor: birr(f, "minPrice"),
          maxPriceMinor: birr(f, "maxPrice"),
          bedrooms: int(f, "bedrooms"),
        },
      }),
    );
    if (ok) {
      setAddingSearch(false);
      await saved.reload();
    }
  };

  const toggleSearch = async (s: SavedSearch) => {
    const ok = await action.run(() => api(`/saved-searches/${s.id}`, { method: "PATCH", json: { isActive: !s.isActive } }));
    if (ok) await saved.reload();
  };

  const exportData = async () => {
    const data = await action.run(() => api<unknown>(`/customers/${id}/export`));
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `customer-${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const anonymise = async () => {
    if (!window.confirm(t("anonymiseConfirm"))) return;
    const ok = await action.run(() => api(`/customers/${id}/anonymise`, { method: "POST" }));
    if (ok) {
      setNotice(t("anonymised"));
      await detail.reload();
    }
  };

  const describe = (s: SavedSearch) =>
    [
      s.purpose ? e(`UNIT_PURPOSE.${s.purpose}`) : null,
      s.type ? e(`UNIT_TYPE.${s.type}`) : null,
      s.area,
      s.bedrooms !== null ? l("bedroomsMin", { count: s.bedrooms }) : null,
      s.minPriceMinor !== null ? `≥ ${formatMoney(s.minPriceMinor, locale)}` : null,
      s.maxPriceMinor !== null ? `≤ ${formatMoney(s.maxPriceMinor, locale)}` : null,
    ]
      .filter(Boolean)
      .join(" · ") || c("all");

  return (
    <div className="stack">
      <PageHeader
        title={customer.name}
        subtitle={customer.anonymizedAt ? <Badge tone="warn">{t("anonymised")}</Badge> : null}
        actions={
          canSell && !customer.anonymizedAt ? (
            <Link className="btn" href={`/staff/leads/new?customerId=${id}&customerName=${encodeURIComponent(customer.name)}`}>
              {l("new")}
            </Link>
          ) : null
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <div className="grid cols-2">
        <Card title={t("contact")}>
          {editing ? (
            <form className="stack" onSubmit={(ev) => void save(ev)} noValidate>
              <TextField label={c("name")} name="name" defaultValue={customer.name} error={action.fieldErrors.name} />
              <TextField label={c("phone")} name="phone" type="tel" defaultValue={customer.phone ?? ""} error={action.fieldErrors.phone} />
              <TextField label={c("email")} name="email" type="email" defaultValue={customer.email ?? ""} error={action.fieldErrors.email} />
              <TextField label={t("telegramChatId")} name="telegramChatId" defaultValue={customer.telegramChatId ?? ""} hint={t("telegramHint")} />
              <SelectField
                label={c("language")}
                name="locale"
                defaultValue={customer.locale}
                options={[
                  { value: "am", label: c("amharic") },
                  { value: "en", label: c("english") },
                ]}
              />
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
              <dl className="facts">
                <dt>{c("phone")}</dt>
                <dd>{customer.phone ? <a href={`tel:${customer.phone}`}>{customer.phone}</a> : "-"}</dd>
                <dt>{c("email")}</dt>
                <dd>{customer.email ?? "-"}</dd>
                <dt>{t("telegramChatId")}</dt>
                <dd>{customer.telegramChatId ?? "-"}</dd>
                <dt>{c("language")}</dt>
                <dd>{customer.locale === "am" ? c("amharic") : c("english")}</dd>
                <dt>{t("created")}</dt>
                <dd>
                  <LocalDate value={customer.createdAt} locale={locale} />
                </dd>
              </dl>
              {!customer.anonymizedAt ? (
                <div>
                  <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
                    {c("edit")}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </Card>
        <Card title={t("consentTitle")}>
          <p className="small muted">{t("consentHelp")}</p>
          <div className="stack" style={{ gap: 4 }}>
            {CHANNELS.map((ch) => (
              <Checkbox
                key={ch}
                label={`${e(`CHANNEL.${ch}`)}${ENABLED_CHANNELS.includes(ch) ? "" : ` (${t("channelOff")})`}`}
                checked={Boolean(consent[ch])}
                disabled={action.busy || Boolean(customer.anonymizedAt)}
                onChange={(ev) => void setConsent(ch, ev.target.checked)}
              />
            ))}
          </div>
        </Card>
      </div>

      {canSell ? (
        <Card title={l("title")}>
          {leads.data?.items.length ? (
            <DataList
              rows={leads.data.items}
              rowKey={(r) => r.id}
              columns={[
                { key: "status", label: c("status"), render: (r) => <Link href={`/staff/leads/${r.id}`}>{e(`LEAD_STATUS.${r.status}`)}</Link> },
                { key: "source", label: l("source"), render: (r) => e(`LEAD_SOURCE.${r.source}`) },
                { key: "assignee", label: l("assignee"), render: (r) => r.assignee?.name ?? "-" },
                { key: "created", label: l("created"), render: (r) => <LocalDate value={r.createdAt} locale={locale} /> },
              ]}
            />
          ) : (
            <p className="muted">{c("none")}</p>
          )}
        </Card>
      ) : null}

      {canSell ? (
        <Card title={t("savedSearches")}>
          <div className="stack">
            <p className="small muted">{t("savedSearchHelp")}</p>
            {saved.data?.items.length ? (
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
                {saved.data.items.map((s) => (
                  <li key={s.id} className="spread">
                    <span>
                      {describe(s)} {s.isActive ? null : <Badge tone="warn">{t("paused")}</Badge>}
                    </span>
                    <button type="button" className="btn secondary small" onClick={() => void toggleSearch(s)}>
                      {s.isActive ? t("pause") : t("resume")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {addingSearch ? (
              <form className="stack" onSubmit={(ev) => void addSearch(ev)}>
                <div className="filters">
                  <SelectField label={l("purpose")} name="purpose" options={[{ value: "", label: c("all") }, ...UNIT_PURPOSES.map((p) => ({ value: p, label: e(`UNIT_PURPOSE.${p}`) }))]} />
                  <SelectField label={l("type")} name="type" options={[{ value: "", label: c("all") }, ...UNIT_TYPES.map((p) => ({ value: p, label: e(`UNIT_TYPE.${p}`) }))]} />
                  <TextField label={l("area")} name="area" />
                  <TextField label={l("bedrooms")} name="bedrooms" type="number" min={0} inputMode="numeric" />
                  <TextField label={l("minPrice")} name="minPrice" inputMode="decimal" />
                  <TextField label={l("maxPrice")} name="maxPrice" inputMode="decimal" />
                </div>
                <div className="row">
                  <Button type="submit" disabled={action.busy}>
                    {c("save")}
                  </Button>
                  <Button variant="secondary" onClick={() => setAddingSearch(false)}>
                    {c("cancel")}
                  </Button>
                </div>
              </form>
            ) : !customer.anonymizedAt ? (
              <div>
                <Button variant="secondary" size="small" onClick={() => setAddingSearch(true)}>
                  {t("addSavedSearch")}
                </Button>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {isOwner ? (
        <Card title={t("dataRequests")}>
          <p className="small muted">{t("dataRequestsHelp")}</p>
          <div className="row">
            <Button variant="secondary" onClick={() => void exportData()} disabled={action.busy}>
              {t("export")}
            </Button>
            {!customer.anonymizedAt ? (
              <Button variant="danger" onClick={() => void anonymise()} disabled={action.busy}>
                {t("anonymise")}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
