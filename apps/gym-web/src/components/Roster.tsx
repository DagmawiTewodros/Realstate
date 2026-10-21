"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { BOOKING_STATUSES } from "@platform/shared";
import { Alert, Badge, Button, Checkbox, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { text, useAction } from "@/lib/forms";
import { isDesk, isManager, useSession } from "@/lib/session";
import { bookingTone } from "@/lib/tones";
import { MemberSearch } from "./Pickers";

interface RosterData {
  session: { id: string; status: string; capacity: number; startsAt: string };
  bookings: Array<{ id: string; status: string; member: { id: string; name: string; phone: string | null } }>;
}

/**
 * Who is booked on a class. Desk staff add or cancel bookings; the class trainer and managers mark attendance;
 * managers can cancel the whole class with a reason.
 */
export function Roster({ sessionId, canMark, onChange }: { sessionId: string; canMark: boolean; onChange?: () => void }) {
  const t = useTranslations("classes");
  const c = useTranslations("common");
  const { user } = useSession();
  const { data, error, reload } = useApi<RosterData>(`/sessions/${sessionId}/roster`);
  const action = useAction();
  const [present, setPresent] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const desk = isDesk(user);
  const manager = isManager(user);

  if (error) return <Alert kind="error">{error.message}</Alert>;
  if (!data) return <p className="muted small">{c("loading")}</p>;
  const active = data.bookings.filter((b) => b.status !== "CANCELLED");
  const isOpen = data.session.status === "SCHEDULED";
  const started = new Date(data.session.startsAt).getTime() <= Date.now();

  const refresh = async (message: string) => {
    setNotice(message);
    await reload();
    onChange?.();
  };

  const book = async (memberId: string) => {
    if (await action.run(() => api("/bookings", { method: "POST", json: { sessionId, memberId } }))) await refresh(t("booked"));
  };

  const cancelBooking = async (bookingId: string) => {
    const late = new Date(data.session.startsAt).getTime() - Date.now() < 2 * 3600_000;
    const reason = late ? window.prompt(t("lateCancelReason")) : null;
    if (late && !reason) return;
    if (await action.run(() => api(`/bookings/${bookingId}/cancel`, { method: "POST", json: { reason } }))) await refresh(t("bookingCancelled"));
  };

  const mark = async () => {
    if (await action.run(() => api(`/sessions/${sessionId}/attendance`, { method: "POST", json: { bookingIds: [...present] } }))) {
      setPresent(new Set());
      await refresh(t("attendanceSaved"));
    }
  };

  const cancelClass = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const reason = text(new FormData(ev.currentTarget), "reason");
    if (!reason) return;
    if (await action.run(() => api(`/sessions/${sessionId}/cancel`, { method: "POST", json: { reason } }))) {
      setCancelling(false);
      await refresh(t("classCancelled"));
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <p className="small muted">{t("bookedOf", { booked: active.length, capacity: data.session.capacity })}</p>
      {data.bookings.length ? (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
          {data.bookings.map((b) => (
            <li key={b.id} className="spread">
              {canMark && started && (b.status === "BOOKED" || b.status === "NO_SHOW") ? (
                <Checkbox
                  label={b.member.name}
                  checked={present.has(b.id)}
                  onChange={(ev) =>
                    setPresent((s) => {
                      const next = new Set(s);
                      if (ev.target.checked) next.add(b.id);
                      else next.delete(b.id);
                      return next;
                    })
                  }
                />
              ) : (
                <span>{b.member.name}</span>
              )}
              <span className="row" style={{ gap: 4 }}>
                <Badge tone={bookingTone(b.status)}>{t(`booking.${b.status as (typeof BOOKING_STATUSES)[number]}`)}</Badge>
                {desk && isOpen && b.status === "BOOKED" && !started ? (
                  <button type="button" className="btn secondary small" onClick={() => void cancelBooking(b.id)}>
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
      {canMark && started && present.size ? (
        <div>
          <Button size="small" onClick={() => void mark()} disabled={action.busy}>
            {t("markPresent", { count: present.size })}
          </Button>
        </div>
      ) : null}
      {desk && isOpen && !started ? <MemberSearch label={t("bookMember")} onPick={(m) => void book(m.id)} /> : null}
      {manager && isOpen && !started ? (
        cancelling ? (
          <form className="stack" onSubmit={(ev) => void cancelClass(ev)}>
            <TextField label={t("cancelReason")} name="reason" required />
            <div className="row">
              <Button type="submit" variant="danger" size="small" disabled={action.busy}>
                {t("cancelClass")}
              </Button>
              <Button variant="secondary" size="small" onClick={() => setCancelling(false)}>
                {c("back")}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button variant="danger" size="small" onClick={() => setCancelling(true)}>
              {t("cancelClass")}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
