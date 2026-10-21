"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addisDateString } from "@platform/shared";
import { Alert, Badge, Button, Card, LocalDate, Loading, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";
import { int, text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import type { ClassSession } from "@/lib/types";
import { Roster } from "@/components/Roster";

interface Personal {
  session: { id: string; startsAt: string; durationMinutes: number; status: string; notes: string | null };
  member: { id: string; name: string };
}

/** Converts <input type="datetime-local"> (Addis Ababa time) to an ISO instant. */
function addisLocalToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) - 3 * 3600_000).toISOString();
}

/** A trainer's day: their classes with rosters, personal sessions, and assigned members. */
export default function TrainerPage() {
  const t = useTranslations("trainer");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const today = addisDateString(new Date());
  const schedule = useApi<{ classes: ClassSession[]; personal: Personal[] }>(`/trainers/me/schedule${qs({ from: today, days: 14 })}`);
  const mine = useApi<{ items: Array<{ id: string; name: string; phone: string | null }> }>("/trainers/me/members");
  const profile = useApi<{ items: Array<{ trainer: { id: string }; user: { id: string } }> }>("/trainers");
  const action = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const trainerId = profile.data?.items.find((x) => x.user.id === user?.id)?.trainer.id;

  const addPersonal = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const startsAt = addisLocalToIso(String(f.get("startsAt") ?? ""));
    if (!startsAt || !trainerId) return action.setError(t("pickTime"));
    const ok = await action.run(() =>
      api("/personal-sessions", { method: "POST", json: { trainerId, memberId: text(f, "memberId"), startsAt, durationMinutes: int(f, "durationMinutes") ?? 60, notes: text(f, "notes") } }),
    );
    if (ok) {
      form.reset();
      await schedule.reload();
    }
  };

  const setStatus = async (id: string, status: string) => {
    if (await action.run(() => api(`/personal-sessions/${id}`, { method: "PATCH", json: { status } }))) await schedule.reload();
  };

  if (profile.data && !trainerId) return <Alert kind="warn">{t("noProfile")}</Alert>;

  return (
    <div className="stack">
      <PageHeader title={t("title")} />
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      {schedule.error ? <Alert kind="error">{schedule.error.message}</Alert> : null}
      {!schedule.data ? <Loading label={c("loading")} /> : null}
      <Card title={t("classes")}>
        {schedule.data?.classes.length ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
            {schedule.data.classes.map((s) => (
              <li key={s.id} className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div className="spread">
                  <span>
                    <LocalDate value={s.startsAt} locale={locale} withTime /> · <strong>{s.name}</strong>
                  </span>
                  <span className="row" style={{ gap: 4 }}>
                    {s.status === "CANCELLED" ? <Badge tone="danger">{t("cancelled")}</Badge> : <Badge>{t("booked", { booked: s.booked, capacity: s.capacity })}</Badge>}
                    <button type="button" className="btn secondary small" onClick={() => setOpen(open === s.id ? null : s.id)}>
                      {open === s.id ? c("close") : t("roster")}
                    </button>
                  </span>
                </div>
                {open === s.id ? <Roster sessionId={s.id} canMark onChange={() => void schedule.reload()} /> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("noClasses")}</p>
        )}
      </Card>
      <Card title={t("personal")}>
        <div className="stack">
          {schedule.data?.personal.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
              {schedule.data.personal.map((p) => (
                <li key={p.session.id} className="spread">
                  <span>
                    <LocalDate value={p.session.startsAt} locale={locale} withTime /> · {p.member.name}
                  </span>
                  {p.session.status === "BOOKED" ? (
                    <span className="row" style={{ gap: 4 }}>
                      <button type="button" className="btn secondary small" onClick={() => void setStatus(p.session.id, "DONE")}>
                        {t("done")}
                      </button>
                      <button type="button" className="btn secondary small" onClick={() => void setStatus(p.session.id, "NO_SHOW")}>
                        {t("noShow")}
                      </button>
                      <button type="button" className="btn secondary small" onClick={() => void setStatus(p.session.id, "CANCELLED")}>
                        {c("cancel")}
                      </button>
                    </span>
                  ) : (
                    <Badge>{t(`personalStatus.${p.session.status}`)}</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{t("noPersonal")}</p>
          )}
          {mine.data?.items.length ? (
            <form className="stack" onSubmit={(ev) => void addPersonal(ev)}>
              <div className="grid cols-2">
                <SelectField label={t("member")} name="memberId" options={mine.data.items.map((m) => ({ value: m.id, label: m.name }))} />
                <TextField label={t("when")} name="startsAt" type="datetime-local" required />
                <TextField label={t("minutes")} name="durationMinutes" type="number" min={15} max={300} defaultValue={60} />
              </div>
              <TextArea label={c("notes")} name="notes" rows={2} />
              <div>
                <Button type="submit" disabled={action.busy}>
                  {t("addPersonal")}
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </Card>
      <Card title={t("myMembers")}>
        {mine.data?.items.length ? (
          <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
            {mine.data.items.map((m) => (
              <li key={m.id} className="spread">
                <Link href={`/desk/members/${m.id}`}>{m.name}</Link>
                {m.phone ? <a href={`tel:${m.phone}`}>{m.phone}</a> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t("noMembers")}</p>
        )}
      </Card>
    </div>
  );
}
