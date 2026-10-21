"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LEAD_FORWARD_MOVES, LEAD_STATUSES, type LeadStatus } from "@platform/shared";
import { Alert, LocalDate, Loading, PageHeader } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { useAction } from "@/lib/forms";
import type { LeadRow } from "../page";

/**
 * The pipeline: one column per status. On phones the columns stack, so each status is a section.
 * Forward moves are one tap; LOST needs a reason, so it is done from the lead page.
 */
export default function PipelinePage() {
  const t = useTranslations("leads");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const columns = {
    INQUIRY: useApi<{ items: LeadRow[]; total: number }>("/leads?status=INQUIRY&pageSize=100"),
    VIEWING: useApi<{ items: LeadRow[]; total: number }>("/leads?status=VIEWING&pageSize=100"),
    OFFER: useApi<{ items: LeadRow[]; total: number }>("/leads?status=OFFER&pageSize=100"),
    SIGNED: useApi<{ items: LeadRow[]; total: number }>("/leads?status=SIGNED&pageSize=20"),
    LOST: useApi<{ items: LeadRow[]; total: number }>("/leads?status=LOST&pageSize=20"),
  } satisfies Record<LeadStatus, unknown>;
  const action = useAction();
  const [moving, setMoving] = useState<string | null>(null);

  const move = async (lead: LeadRow, to: LeadStatus) => {
    setMoving(lead.id);
    const ok = await action.run(() => api(`/leads/${lead.id}/status`, { method: "POST", json: { status: to } }));
    setMoving(null);
    if (ok) await Promise.all([columns[lead.status as LeadStatus].reload(), columns[to].reload()]);
  };

  return (
    <div className="stack">
      <PageHeader
        title={t("pipeline")}
        actions={
          <Link className="btn" href="/staff/leads/new">
            {t("new")}
          </Link>
        }
      />
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <div className="columns">
        {LEAD_STATUSES.map((status) => {
          const col = columns[status];
          return (
            <section key={status} className="card column-card" aria-labelledby={`col-${status}`}>
              <h2 id={`col-${status}`}>
                <span>{e(`LEAD_STATUS.${status}`)}</span>
                <span className="badge">{col.data?.total ?? "…"}</span>
              </h2>
              {col.error ? <Alert kind="error">{col.error.message}</Alert> : null}
              {col.loading && !col.data ? <Loading label={c("loading")} /> : null}
              {col.data?.items.length === 0 ? <p className="small muted">{c("none")}</p> : null}
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
                {col.data?.items.map((l) => (
                  <li key={l.id} className="card" style={{ padding: 10 }}>
                    <Link href={`/staff/leads/${l.id}`}>
                      <strong>{l.customer.name}</strong>
                    </Link>
                    <div className="small muted">
                      {l.assignee?.name ?? t("unassigned")}
                      {l.interestedUnit ? ` · ${l.interestedUnit.code}` : ""}
                    </div>
                    {l.nextStepAt ? (
                      <div className="small">
                        <LocalDate value={l.nextStepAt} locale={locale} withTime />
                      </div>
                    ) : null}
                    <div className="row" style={{ marginTop: 6 }}>
                      {LEAD_FORWARD_MOVES[status]
                        .filter((s) => s !== "LOST")
                        .map((s) => (
                          <button key={s} type="button" className="btn secondary small" disabled={moving === l.id} onClick={() => void move(l, s)}>
                            → {e(`LEAD_STATUS.${s}`)}
                          </button>
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
