"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addisDateString, formatMoney } from "@platform/shared";
import { Alert, Bars, Card, DataList, LocalDate, PageHeader, Stat, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { useAction } from "@/lib/forms";

interface Summary {
  activeMembers: number;
  expiringIn7Days: number;
  newMembersThisMonth: number;
}
interface Revenue {
  month: string;
  totalMinor: number;
  byPlan: Array<{ planId: string | null; planName: string; totalMinor: number; payments: number }>;
}
interface Attendance {
  days: Array<{ day: string; visits: number }>;
  hours: Array<{ hour: number; visits: number }>;
  weekdays: Array<{ weekday: number; visits: number }>;
  busiestHour: number | null;
  busiestWeekday: number | null;
}
interface AtRisk {
  inactiveDays: number;
  items: Array<{ memberId: string; name: string; phone: string | null; lastVisit: string | null; daysSince: number; membershipEnd: string }>;
}

/** Managers' overview: members, revenue by plan, when people come, and who has stopped coming. */
export default function GymDashboard() {
  const t = useTranslations("dashboard");
  const c = useTranslations("common");
  const w = useTranslations("classes");
  const locale = useLocale() as "am" | "en";
  const [month, setMonth] = useState(() => addisDateString(new Date()).slice(0, 7));
  const summary = useApi<Summary>("/dashboard/summary");
  const revenue = useApi<Revenue>(/^\d{4}-\d{2}$/.test(month) ? `/dashboard/revenue?month=${month}` : null);
  const attendance = useApi<Attendance>("/dashboard/attendance");
  const atRisk = useApi<AtRisk>("/dashboard/at-risk");
  const expiring = useApi<{ items: Array<{ membership: { id: string; endDate: string }; member: { id: string; name: string; phone: string | null }; planName: string }> }>("/memberships/expiring?days=7");
  const action = useAction();
  const [sent, setSent] = useState<Record<string, string>>({});
  const firstError = [summary, revenue, attendance, atRisk].find((x) => x.error)?.error;

  const remind = async (memberId: string) => {
    const res = await action.run(() => api<{ status: string }>(`/dashboard/at-risk/${memberId}/message`, { method: "POST" }));
    if (res) setSent((s) => ({ ...s, [memberId]: res.status }));
  };

  return (
    <div className="stack">
      <PageHeader title={t("title")} />
      {firstError ? <Alert kind="error">{firstError.message}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {summary.data ? (
        <div className="grid cols-3">
          <Stat label={t("activeMembers")} value={summary.data.activeMembers} />
          <Stat label={t("expiringSoon")} value={summary.data.expiringIn7Days} tone={summary.data.expiringIn7Days ? "danger" : undefined} />
          <Stat label={t("newThisMonth")} value={summary.data.newMembersThisMonth} tone="ok" />
        </div>
      ) : null}

      <div className="grid cols-2">
        <Card title={t("revenue")}>
          <div className="stack">
            <div className="row" style={{ alignItems: "flex-end" }}>
              <TextField label={t("month")} type="month" value={month} onChange={(ev) => ev.target.value && setMonth(ev.target.value)} />
              <a className="btn secondary small" href={`/api/dashboard/revenue.csv?month=${month}`}>
                {c("exportCsv")}
              </a>
            </div>
            {revenue.data ? (
              <>
                <p>
                  {t("total")}: <strong>{formatMoney(revenue.data.totalMinor, locale)}</strong>
                </p>
                <Bars items={revenue.data.byPlan.map((p) => ({ label: p.planId ? p.planName : t("other"), value: p.totalMinor }))} format={(v) => formatMoney(v, locale)} />
                {revenue.data.byPlan.length === 0 ? <p className="muted small">{c("none")}</p> : null}
              </>
            ) : null}
          </div>
        </Card>
        <Card title={t("expiringTitle")}>
          {expiring.data?.items.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
              {expiring.data.items.map((x) => (
                <li key={x.membership.id} className="spread small">
                  <Link href={`/desk/members/${x.member.id}`}>{x.member.name}</Link>
                  <span>
                    {x.planName} · <LocalDate value={x.membership.endDate} locale={locale} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{c("none")}</p>
          )}
        </Card>
      </div>

      {attendance.data ? (
        <div className="grid cols-2">
          <Card title={t("byHour")}>
            <p className="small muted">
              {attendance.data.busiestHour !== null ? t("busiestHour", { hour: `${String(attendance.data.busiestHour).padStart(2, "0")}:00` }) : t("noVisits")}
            </p>
            <Bars items={attendance.data.hours.filter((h) => h.hour >= 5 && h.hour <= 22).map((h) => ({ label: `${String(h.hour).padStart(2, "0")}:00`, value: h.visits }))} />
          </Card>
          <Card title={t("byWeekday")}>
            <p className="small muted">{attendance.data.busiestWeekday !== null ? t("busiestDay", { day: w(`weekday.${attendance.data.busiestWeekday}`) }) : t("noVisits")}</p>
            <Bars items={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ label: w(`weekday.${d}`), value: attendance.data!.weekdays[d]?.visits ?? 0 }))} />
            <p style={{ marginTop: 8 }}>
              <a className="btn secondary small" href="/api/dashboard/attendance.csv">
                {c("exportCsv")}
              </a>
            </p>
          </Card>
        </div>
      ) : null}

      {atRisk.data ? (
        <Card title={t("atRisk", { days: atRisk.data.inactiveDays })}>
          <div className="stack">
            <p className="small muted">{t("atRiskHint")}</p>
            {atRisk.data.items.length ? (
              <DataList
                rows={atRisk.data.items}
                rowKey={(r) => r.memberId}
                columns={[
                  { key: "name", label: c("name"), render: (r) => <Link href={`/desk/members/${r.memberId}`}>{r.name}</Link> },
                  { key: "phone", label: c("phone"), render: (r) => (r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : "-") },
                  { key: "last", label: t("lastVisit"), render: (r) => (r.lastVisit ? <LocalDate value={r.lastVisit} locale={locale} /> : t("never")) },
                  { key: "days", label: t("daysAway"), render: (r) => r.daysSince },
                  {
                    key: "act",
                    label: c("actions"),
                    render: (r) =>
                      sent[r.memberId] ? (
                        <span className="small">{t(`sendResult.${sent[r.memberId] === "SENT" ? "SENT" : sent[r.memberId] === "DEFERRED_QUIET_HOURS" ? "DEFERRED" : "BLOCKED"}`)}</span>
                      ) : (
                        <button type="button" className="btn secondary small" onClick={() => void remind(r.memberId)} disabled={action.busy}>
                          {t("sendMessage")}
                        </button>
                      ),
                  },
                ]}
              />
            ) : (
              <p className="muted">{t("nobodyAtRisk")}</p>
            )}
            <div>
              <a className="btn secondary small" href="/api/dashboard/at-risk.csv">
                {c("exportCsv")}
              </a>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
