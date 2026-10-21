"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Alert, Button, Card, DataList, LocalDate, Loading, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import type { Plan } from "@/lib/types";

interface Campaign {
  id: string;
  title: string;
  recipientCount: number;
  sentCount: number;
  blockedCount: number;
  failedCount: number;
  deferredCount: number;
  cappedCount: number;
  createdAt: string;
}

/**
 * Announcements to members (managers). Only members who agreed to messages receive them, never more than
 * four marketing messages in 30 days, and never during quiet hours (they are sent in the morning instead).
 */
export default function CampaignsPage() {
  const t = useTranslations("campaigns");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const list = useApi<{ items: Campaign[] }>("/campaigns");
  const plans = useApi<{ items: Plan[] }>("/plans");
  const action = useAction();
  const [result, setResult] = useState<Campaign | null>(null);

  async function send(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    if (!window.confirm(t("confirm"))) return;
    const filter: Record<string, string> = { membershipStatus: String(f.get("status")) };
    if (text(f, "planId")) filter.planId = text(f, "planId")!;
    const res = await action.run(() =>
      api<{ campaign: Campaign }>("/campaigns", { method: "POST", json: { title: text(f, "title") ?? "", messageAm: text(f, "messageAm") ?? "", messageEn: text(f, "messageEn") ?? "", filter } }),
    );
    if (res) {
      setResult(res.campaign);
      form.reset();
      await list.reload();
    }
  }

  return (
    <div className="stack">
      <PageHeader title={t("title")} subtitle={t("intro")} />
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {result ? (
        <Alert kind="ok">
          {t("result", { sent: result.sentCount, deferred: result.deferredCount, blocked: result.blockedCount, capped: result.cappedCount, failed: result.failedCount })}
        </Alert>
      ) : null}
      <Card title={t("new")}>
        <form className="stack" onSubmit={(ev) => void send(ev)} noValidate>
          <TextField label={t("subject")} name="title" required error={action.fieldErrors.title} hint={t("subjectHint")} />
          <TextArea label={t("messageAm")} name="messageAm" rows={3} required maxLength={1000} error={action.fieldErrors.messageAm} />
          <TextArea label={t("messageEn")} name="messageEn" rows={3} required maxLength={1000} error={action.fieldErrors.messageEn} />
          <div className="grid cols-2">
            <SelectField
              label={t("who")}
              name="status"
              defaultValue="ACTIVE"
              options={[
                { value: "ACTIVE", label: t("whoActive") },
                { value: "EXPIRED", label: t("whoExpired") },
                { value: "ANY", label: t("whoAny") },
              ]}
            />
            <SelectField label={t("plan")} name="planId" options={[{ value: "", label: c("all") }, ...(plans.data?.items ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
          </div>
          <div>
            <Button type="submit" disabled={action.busy}>
              {action.busy ? t("sending") : t("send")}
            </Button>
          </div>
        </form>
      </Card>
      {list.error ? <Alert kind="error">{list.error.message}</Alert> : null}
      {list.loading && !list.data ? <Loading label={c("loading")} /> : null}
      {list.data?.items.length ? (
        <DataList
          caption={t("title")}
          rows={list.data.items}
          rowKey={(x) => x.id}
          columns={[
            { key: "date", label: c("date"), render: (x) => <LocalDate value={x.createdAt} locale={locale} withTime /> },
            { key: "title", label: t("subject"), render: (x) => x.title },
            { key: "to", label: t("recipients"), render: (x) => x.recipientCount },
            { key: "sent", label: t("sent"), render: (x) => x.sentCount + x.deferredCount },
            { key: "blocked", label: t("notSent"), render: (x) => x.blockedCount + x.cappedCount + x.failedCount },
          ]}
        />
      ) : null}
    </div>
  );
}
