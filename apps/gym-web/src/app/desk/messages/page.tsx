"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MESSAGE_STATUSES } from "@platform/shared";
import { Alert, Badge, Card, DataList, EmptyState, LocalDate, Loading, PageHeader, SelectField } from "@platform/ui";
import { qs, useApi } from "@/lib/api";
import { messageTone } from "@/lib/tones";
import { Pager } from "@/components/Pickers";

interface MessageRow {
  id: string;
  channel: string | null;
  templateKey: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
  sendAfter: string | null;
}

/** Every message the system tried to send, and automation events that failed after all retries. */
export default function MessagesPage() {
  const t = useTranslations("messages");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const log = useApi<{ items: MessageRow[]; page: number; pageSize: number; total: number }>(`/messages${qs({ status, page, pageSize: 50 })}`);
  const failed = useApi<{ items: Array<{ id: string; name: string; attempts: number; lastError: string | null; createdAt: string }> }>("/messages/failed-events");

  return (
    <div className="stack">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      {failed.data?.items.length ? (
        <Card title={t("failedEvents")}>
          <Alert kind="warn">{t("failedHint")}</Alert>
          <DataList
            rows={failed.data.items}
            rowKey={(r) => r.id}
            columns={[
              { key: "name", label: t("event"), render: (r) => <code>{r.name}</code> },
              { key: "attempts", label: t("attempts"), render: (r) => r.attempts },
              { key: "error", label: t("error"), render: (r) => <span className="small">{r.lastError ?? "-"}</span> },
              { key: "at", label: c("date"), render: (r) => <LocalDate value={r.createdAt} locale={locale} withTime /> },
            ]}
          />
        </Card>
      ) : null}
      <form className="filters card" onSubmit={(ev) => ev.preventDefault()}>
        <SelectField
          label={c("status")}
          value={status}
          onChange={(ev) => {
            setStatus(ev.target.value);
            setPage(1);
          }}
          options={[{ value: "", label: c("all") }, ...MESSAGE_STATUSES.map((s) => ({ value: s, label: e(`MESSAGE_STATUS.${s}`) }))]}
        />
      </form>
      {log.error ? <Alert kind="error">{log.error.message}</Alert> : null}
      {log.loading && !log.data ? <Loading label={c("loading")} /> : null}
      {log.data && log.data.items.length === 0 ? <EmptyState title={c("noResults")} /> : null}
      {log.data && log.data.items.length ? (
        <>
          <DataList
            caption={t("title")}
            rows={log.data.items}
            rowKey={(m) => m.id}
            columns={[
              { key: "at", label: c("date"), render: (m) => <LocalDate value={m.createdAt} locale={locale} withTime /> },
              { key: "template", label: t("template"), render: (m) => <code>{m.templateKey}</code> },
              { key: "channel", label: t("channel"), render: (m) => (m.channel ? e(`CHANNEL.${m.channel}`) : "-") },
              { key: "status", label: c("status"), render: (m) => <Badge tone={messageTone(m.status)}>{e(`MESSAGE_STATUS.${m.status}`)}</Badge> },
              {
                key: "detail",
                label: t("detail"),
                render: (m) =>
                  m.error ? (
                    <span className="small">{m.error}</span>
                  ) : m.status === "DEFERRED_QUIET_HOURS" && m.sendAfter ? (
                    <span className="small">
                      {t("sendsAt")} <LocalDate value={m.sendAfter} locale={locale} withTime />
                    </span>
                  ) : (
                    ""
                  ),
              },
            ]}
          />
          <Pager page={log.data.page} pageSize={log.data.pageSize} total={log.data.total} onPage={setPage} />
        </>
      ) : null}
    </div>
  );
}
