"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Badge, Button, Card, DataList, EmptyState, LocalDate, Loading, PageHeader, SelectField, TextField } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { Pager } from "@/components/Pickers";
import type { Member } from "@/lib/types";

export default function MembersPage() {
  const t = useTranslations("members");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const { data, error, loading } = useApi<{ items: Member[]; page: number; pageSize: number; total: number }>(`/members${qs({ q, page, pageSize: 25 })}`);
  const action = useAction();
  const [duplicate, setDuplicate] = useState<{ id: string; matches: Array<{ id: string; name: string }> } | null>(null);

  async function create(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ member: Member; warnings: Array<{ matches: Array<{ id: string; name: string }> }> }>("/members", {
        method: "POST",
        json: {
          name: text(f, "name") ?? "",
          phone: text(f, "phone"),
          email: text(f, "email"),
          locale: f.get("locale"),
          birthDate: text(f, "birthDate"),
          emergencyContactName: text(f, "emergencyContactName"),
          emergencyContactPhone: text(f, "emergencyContactPhone"),
        },
      }),
    );
    if (!res) return;
    if (res.warnings.length) setDuplicate({ id: res.member.id, matches: res.warnings[0].matches });
    else router.push(`/desk/members/${res.member.id}`);
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
            {duplicate ? (
              <Alert kind="warn">
                {t("duplicateWarning")}{" "}
                {duplicate.matches.map((m) => (
                  <Link key={m.id} href={`/desk/members/${m.id}`} style={{ marginRight: 8 }}>
                    {m.name}
                  </Link>
                ))}
                <div style={{ marginTop: 8 }}>
                  <Link className="btn small" href={`/desk/members/${duplicate.id}`}>
                    {t("openNew")}
                  </Link>
                </div>
              </Alert>
            ) : null}
            <div className="grid cols-2">
              <TextField label={c("name")} name="name" required error={action.fieldErrors.name} />
              <TextField label={c("phone")} name="phone" type="tel" inputMode="tel" error={action.fieldErrors.phone} hint={t("phoneOrEmail")} />
              <TextField label={c("email")} name="email" type="email" error={action.fieldErrors.email} hint={t("emailHint")} />
              <SelectField
                label={c("language")}
                name="locale"
                defaultValue="am"
                options={[
                  { value: "am", label: c("amharic") },
                  { value: "en", label: c("english") },
                ]}
              />
              <TextField label={t("birthDate")} name="birthDate" type="date" error={action.fieldErrors.birthDate} />
              <TextField label={t("emergencyName")} name="emergencyContactName" />
              <TextField label={t("emergencyPhone")} name="emergencyContactPhone" type="tel" error={action.fieldErrors.emergencyContactPhone} />
            </div>
            <div>
              <Button type="submit" disabled={action.busy}>
                {c("save")}
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
            rowKey={(m) => m.id}
            columns={[
              { key: "name", label: c("name"), render: (m) => <Link href={`/desk/members/${m.id}`}>{m.name}</Link> },
              { key: "phone", label: c("phone"), render: (m) => m.phone ?? "-" },
              { key: "joined", label: t("joined"), render: (m) => <LocalDate value={m.joinedAt} locale={locale} /> },
              { key: "status", label: c("status"), render: (m) => (m.status === "ACTIVE" ? <Badge tone="ok">{t("active")}</Badge> : <Badge>{t("inactive")}</Badge>) },
            ]}
          />
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
