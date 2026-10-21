"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addisDateString } from "@platform/shared";
import { Alert, Badge, Card, DataList, LocalDate, Loading, Money, PageHeader } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";
import { useAction } from "@/lib/forms";
import { bookingTone, membershipTone } from "@/lib/tones";
import type { ClassSession, GymPayment } from "@/lib/types";

interface Me {
  member: { id: string; name: string };
  membership: {
    status: "ACTIVE" | "FROZEN" | "EXPIRED" | "CANCELLED" | "NONE";
    planName: string | null;
    endDate: string | null;
    daysLeft: number | null;
    freeze: { startDate: string; endDate: string } | null;
    next: { planName: string; startDate: string; endDate: string } | null;
  };
}
interface MyBooking {
  id: string;
  status: string;
  session: { id: string; name: string; startsAt: string; status: string };
}

/** The member app: membership, the QR code to show at the desk, classes to book, and receipts. */
export default function MemberHome() {
  const t = useTranslations("me");
  const m = useTranslations("members");
  const cl = useTranslations("classes");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const me = useApi<Me>("/me");
  const sessions = useApi<{ items: ClassSession[] }>(`/sessions${qs({ from: addisDateString(new Date()), days: 7 })}`);
  const bookings = useApi<{ items: MyBooking[] }>("/me/bookings");
  const payments = useApi<{ items: GymPayment[] }>("/me/payments");
  const visits = useApi<{ items: Array<{ id: string; at: string; result: string }> }>("/me/checkins");
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  if (me.error) return <Alert kind="error">{me.error.message}</Alert>;
  if (!me.data) return <Loading label={c("loading")} />;
  const ms = me.data.membership;
  const now = Date.now();
  const booked = new Map((bookings.data?.items ?? []).filter((b) => b.status === "BOOKED").map((b) => [b.session.id, b.id]));
  const upcoming = (bookings.data?.items ?? []).filter((b) => new Date(b.session.startsAt).getTime() > now - 3600_000);
  const canBook = ms.status === "ACTIVE";
  const timeOf = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(11, 16);

  const book = async (sessionId: string) => {
    if (await action.run(() => api("/bookings", { method: "POST", json: { sessionId } }))) {
      setNotice(cl("booked"));
      await Promise.all([bookings.reload(), sessions.reload()]);
    }
  };
  const cancel = async (bookingId: string) => {
    if (await action.run(() => api(`/bookings/${bookingId}/cancel`, { method: "POST", json: {} }))) {
      setNotice(cl("bookingCancelled"));
      await Promise.all([bookings.reload(), sessions.reload()]);
    }
  };

  return (
    <div className="stack">
      <PageHeader title={t("hello", { name: me.data.member.name })} />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <div className="grid cols-2">
        <Card title={t("membership")}>
          <div className="stack" style={{ gap: 6 }}>
            <span>
              <Badge tone={membershipTone(ms.status)}>{m(`state.${ms.status}`)}</Badge> {ms.planName ?? ""}
            </span>
            {ms.endDate ? (
              <span>
                {m("until")} <LocalDate value={ms.endDate} locale={locale} />
                {ms.daysLeft !== null ? ` · ${m("daysLeft", { count: ms.daysLeft })}` : ""}
              </span>
            ) : null}
            {ms.freeze ? (
              <Alert kind="warn">
                {m("frozenUntil")} <LocalDate value={ms.freeze.endDate} locale={locale} />
              </Alert>
            ) : null}
            {ms.next ? (
              <span className="small">
                {m("nextMembership")}: {ms.next.planName} · <LocalDate value={ms.next.startDate} locale={locale} />
              </span>
            ) : null}
            {ms.status === "EXPIRED" || ms.status === "NONE" ? <p className="small">{t("renewAtDesk")}</p> : null}
          </div>
        </Card>
        <Card title={t("qrTitle")}>
          <div className="qr-box">
            <img src="/api/me/qr.svg" alt={t("qrAlt")} width={280} height={280} style={{ width: "100%", maxWidth: 280, height: "auto" }} />
          </div>
          <p className="small muted" style={{ textAlign: "center" }}>
            {t("qrHint")}
          </p>
        </Card>
      </div>

      <Card title={t("myBookings")}>
        {upcoming.length ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
            {upcoming.map((b) => (
              <li key={b.id} className="spread">
                <span>
                  <LocalDate value={b.session.startsAt} locale={locale} withTime /> · {b.session.name}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <Badge tone={bookingTone(b.status)}>{cl(`booking.${b.status}`)}</Badge>
                  {b.status === "BOOKED" && new Date(b.session.startsAt).getTime() - now > 2 * 3600_000 ? (
                    <button type="button" className="btn secondary small" onClick={() => void cancel(b.id)} disabled={action.busy}>
                      {c("cancel")}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t("noBookings")}</p>
        )}
      </Card>

      <Card title={t("classes")}>
        {!canBook ? <p className="small muted">{t("needActive")}</p> : null}
        {sessions.data?.items.filter((s) => s.status === "SCHEDULED").length ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
            {sessions.data.items
              .filter((s) => s.status === "SCHEDULED")
              .map((s) => (
                <li key={s.id} className="spread">
                  <span>
                    <LocalDate value={s.startsAt} locale={locale} /> {timeOf(s.startsAt)} · <strong>{s.name}</strong> <span className="small muted">· {s.trainerName}</span>
                  </span>
                  {booked.has(s.id) ? (
                    <Badge tone="brand">{cl("booking.BOOKED")}</Badge>
                  ) : s.spotsLeft ? (
                    <button type="button" className="btn small" onClick={() => void book(s.id)} disabled={!canBook || action.busy}>
                      {t("book")}
                    </button>
                  ) : (
                    <Badge tone="warn">{cl("full")}</Badge>
                  )}
                </li>
              ))}
          </ul>
        ) : (
          <p className="muted small">{cl("noClasses")}</p>
        )}
      </Card>

      <div className="grid cols-2">
        <Card title={t("payments")}>
          {payments.data?.items.length ? (
            <DataList
              rows={payments.data.items}
              rowKey={(p) => p.id}
              columns={[
                { key: "date", label: c("date"), render: (p) => <LocalDate value={p.paidAt} locale={locale} /> },
                { key: "amount", label: c("amount"), render: (p) => <Money minor={p.amountMinor} locale={locale} /> },
                {
                  key: "receipt",
                  label: m("receipt"),
                  render: (p) =>
                    p.status === "VOIDED" ? (
                      <Badge tone="danger">{e("PAYMENT_STATUS.VOIDED")}</Badge>
                    ) : (
                      <a className="btn secondary small" href={`/api/me/payments/${p.id}/receipt.pdf`} target="_blank" rel="noopener">
                        {p.receiptNumber}
                      </a>
                    ),
                },
              ]}
            />
          ) : (
            <p className="muted small">{c("none")}</p>
          )}
        </Card>
        <Card title={t("visits")}>
          {visits.data?.items.filter((v) => v.result === "ALLOWED").length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
              {visits.data.items
                .filter((v) => v.result === "ALLOWED")
                .slice(0, 10)
                .map((v) => (
                  <li key={v.id} className="small">
                    <LocalDate value={v.at} locale={locale} withTime />
                  </li>
                ))}
            </ul>
          ) : (
            <p className="muted small">{m("noVisits")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
