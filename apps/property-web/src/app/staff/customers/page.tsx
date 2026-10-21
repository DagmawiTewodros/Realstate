"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Button, Card, DataList, EmptyState, LocalDate, Loading, PageHeader, SelectField, TextField } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { Pager } from "@/components/Pickers";

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  telegramChatId: string | null;
  locale: "am" | "en";
  source: string;
  createdAt: string;
  anonymizedAt: string | null;
}

export default function CustomersPage() {
  const t = useTranslations("customers");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, error, loading } = useApi<{ items: Customer[]; page: number; pageSize: number; total: number }>(`/customers${qs({ q, page, pageSize: 25 })}`);
  const action = useAction();
  const [warning, setWarning] = useState<{ id: string; matches: Array<{ id: string; name: string }> } | null>(null);

  async function create(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ customer: Customer; warnings: Array<{ code: string; matches: Array<{ id: string; name: string }> }> }>("/customers", {
        method: "POST",
        json: { name: text(f, "name") ?? "", phone: text(f, "phone"), email: text(f, "email"), locale: f.get("locale"), source: "OTHER" },
      }),
    );
    if (!res) return;
    if (res.warnings.length) setWarning({ id: res.customer.id, matches: res.warnings[0].matches });
    else router.push(`/staff/customers/${res.customer.id}`);
  }

  return (
    <div className="stack">
      <PageHeader
        title={t("title")}
        actions={
          <Button onClick={() => setCreating(!creating)} variant={creating ? "secondary" : "primary"}>
            {creating ? c("cancel") : t("new")}
          </Button>
        }
      />
      {creating ? (
        <Card title={t("new")}>
          <form className="stack" onSubmit={(ev) => void create(ev)} noValidate>
            {action.error ? <Alert kind="error">{action.error}</Alert> : null}
            {warning ? (
              <Alert kind="warn">
                {t("duplicateWarning")}{" "}
                {warning.matches.map((m) => (
                  <Link key={m.id} href={`/staff/customers/${m.id}`} style={{ marginRight: 8 }}>
                    {m.name}
                  </Link>
                ))}
                <div style={{ marginTop: 8 }}>
                  <Link className="btn small" href={`/staff/customers/${warning.id}`}>
                    {t("openNew")}
                  </Link>
                </div>
              </Alert>
            ) : null}
            <TextField label={c("name")} name="name" required error={action.fieldErrors.name} />
            <TextField label={c("phone")} name="phone" type="tel" inputMode="tel" error={action.fieldErrors.phone} hint={t("phoneOrEmail")} />
            <TextField label={c("email")} name="email" type="email" error={action.fieldErrors.email} />
            <SelectField
              label={c("language")}
              name="locale"
              defaultValue="am"
              options={[
                { value: "am", label: c("amharic") },
                { value: "en", label: c("english") },
              ]}
            />
            <div>
              <Button type="submit" disabled={action.busy}>
                {action.busy ? c("saving") : c("save")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <div className="card">
        <TextField
          label={c("search")}
          type="search"
          placeholder={t("searchPlaceholder")}
          value={q}
          onChange={(ev) => {
            setQ(ev.target.value);
            setPage(1);
          }}
        />
      </div>
      {error ? <Alert kind="error">{error.message}</Alert> : null}
      {loading && !data ? <Loading label={c("loading")} /> : null}
      {data && data.items.length === 0 ? <EmptyState title={c("noResults")} /> : null}
      {data && data.items.length ? (
        <>
          <DataList
            caption={t("title")}
            rows={data.items}
            rowKey={(r) => r.id}
            columns={[
              { key: "name", label: c("name"), render: (r) => <Link href={`/staff/customers/${r.id}`}>{r.name}</Link> },
              { key: "phone", label: c("phone"), render: (r) => r.phone ?? "-" },
              { key: "email", label: c("email"), render: (r) => r.email ?? "-" },
              { key: "lang", label: c("language"), render: (r) => (r.locale === "am" ? c("amharic") : c("english")) },
              { key: "created", label: t("created"), render: (r) => <LocalDate value={r.createdAt} locale={locale} /> },
            ]}
          />
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
