"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { addisDateString } from "@platform/shared";
import { Alert, Badge, EmptyState, LocalDate, Loading, PageHeader } from "@platform/ui";
import { useApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import { LogActivity } from "@/components/LogCall";

export interface LeadRow {
  id: string;
  status: string;
  source: string;
  nextStepAt: string | null;
  nextStepNote: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  assignee: { id: string; name: string } | null;
  interestedUnit: { id: string; code: string } | null;
  interestedUnitNote: string | null;
}

/** "My day": overdue follow-ups first, then today's, each with a call link and a quick log form. */
export default function MyDayPage() {
  const t = useTranslations("staff");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const router = useRouter();
  const { user } = useSession();
  // Owners and property managers start on the dashboard; only sales staff load leads here.
  const sales = user?.role === "SALES_MANAGER" || user?.role === "BROKER";
  const overdue = useApi<{ items: LeadRow[] }>(sales ? "/leads/overdue" : null);
  const open = useApi<{ items: LeadRow[] }>(sales ? "/leads?pageSize=200" : null);
  const [logging, setLogging] = useState<string | null>(null);

  useEffect(() => {
    if (user && !sales) router.replace("/staff/dashboard");
  }, [user, sales, router]);

  const today = useMemo(() => {
    const todayStr = addisDateString(new Date());
    const overdueIds = new Set(overdue.data?.items.map((l) => l.id));
    return (open.data?.items ?? []).filter(
      (l) => l.nextStepAt && !overdueIds.has(l.id) && addisDateString(new Date(l.nextStepAt)) === todayStr && !["SIGNED", "LOST"].includes(l.status),
    );
  }, [open.data, overdue.data]);

  const reload = () => {
    setLogging(null);
    void overdue.reload();
    void open.reload();
  };

  const renderLead = (l: LeadRow, late: boolean) => (
    <li key={l.id} className="card stack" style={{ gap: 8 }}>
      <div className="spread">
        <strong>{l.customer.name}</strong>
        <Badge tone={late ? "danger" : "warn"}>{late ? t("overdue") : t("dueToday")}</Badge>
      </div>
      <span className="small muted">
        {e(`LEAD_STATUS.${l.status}`)} · <LocalDate value={l.nextStepAt} locale={locale} withTime />
      </span>
      {l.nextStepNote ? <span>{l.nextStepNote}</span> : null}
      <div className="row">
        {l.customer.phone ? (
          <a className="btn small" href={`tel:${l.customer.phone}`}>
            {t("call")}
          </a>
        ) : null}
        <button type="button" className="btn secondary small" onClick={() => setLogging(logging === l.id ? null : l.id)}>
          {t("logCall")}
        </button>
        <Link className="btn secondary small" href={`/staff/leads/${l.id}`}>
          {c("open")}
        </Link>
      </div>
      {logging === l.id ? <LogActivity leadId={l.id} onDone={reload} /> : null}
    </li>
  );

  return (
    <div className="stack">
      <PageHeader
        title={t("myDayTitle")}
        actions={
          <Link className="btn" href="/staff/leads/new">
            {t("newLead")}
          </Link>
        }
      />
      {overdue.error || open.error ? <Alert kind="error">{c("error")}</Alert> : null}
      {overdue.loading && !overdue.data ? <Loading label={c("loading")} /> : null}
      <section className="stack">
        <h2>{t("overdue")}</h2>
        {overdue.data && overdue.data.items.length === 0 ? <EmptyState title={t("nothingOverdue")} /> : null}
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {overdue.data?.items.map((l) => renderLead(l, true))}
        </ul>
      </section>
      <section className="stack">
        <h2>{t("dueToday")}</h2>
        {open.data && today.length === 0 ? <EmptyState title={t("nothingToday")} /> : null}
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {today.map((l) => renderLead(l, false))}
        </ul>
      </section>
    </div>
  );
}
