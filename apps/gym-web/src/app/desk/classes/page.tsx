"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { addDays, addisDateString } from "@platform/shared";
import { Alert, Badge, Button, Card, DataList, LocalDate, Loading, PageHeader, SelectField, TextField } from "@platform/ui";
import { api, qs, useApi } from "@/lib/api";
import { int, text, useAction } from "@/lib/forms";
import { isManager, useSession } from "@/lib/session";
import type { ClassSession } from "@/lib/types";
import { Roster } from "@/components/Roster";

interface Template {
  id: string;
  name: string;
  trainerId: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  capacity: number;
  isActive: boolean;
}

/** The class timetable, a week at a time. Open a class to see and manage its bookings. */
export default function ClassesPage() {
  const t = useTranslations("classes");
  const c = useTranslations("common");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const manager = isManager(user);
  const [from, setFrom] = useState(() => addisDateString(new Date()));
  const sessions = useApi<{ items: ClassSession[] }>(`/sessions${qs({ from, days: 7 })}`);
  const templates = useApi<{ items: Template[] }>(manager ? "/class-templates" : null);
  const trainers = useApi<{ items: Array<{ trainer: { id: string }; user: { id: string; name: string; isActive: boolean } }> }>(user ? "/trainers" : null);
  const [open, setOpen] = useState<string | null>(null);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const action = useAction();
  const myTrainer = trainers.data?.items.find((x) => x.user.id === user?.id)?.trainer.id;

  const byDay = new Map<string, ClassSession[]>();
  for (const s of sessions.data?.items ?? []) {
    const day = addisDateString(new Date(s.startsAt));
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const timeOf = (iso: string) => new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(11, 16);
  const trainerName = (id: string) => trainers.data?.items.find((x) => x.trainer.id === id)?.user.name ?? "-";

  const addTemplate = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api("/class-templates", {
        method: "POST",
        json: {
          name: text(f, "name") ?? "",
          trainerId: text(f, "trainerId"),
          weekday: int(f, "weekday") ?? 1,
          startTime: text(f, "startTime") ?? "",
          durationMinutes: int(f, "durationMinutes") ?? 60,
          capacity: int(f, "capacity") ?? 10,
        },
      }),
    );
    if (ok) {
      setAddingTemplate(false);
      await Promise.all([templates.reload(), sessions.reload()]);
    }
  };

  const toggleTemplate = async (tpl: Template) => {
    if (await action.run(() => api(`/class-templates/${tpl.id}`, { method: "PATCH", json: { isActive: !tpl.isActive } }))) await templates.reload();
  };

  return (
    <div className="stack">
      <PageHeader title={t("title")} />
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Button variant="secondary" size="small" onClick={() => setFrom(addDays(from, -7))}>
          ← {t("previousWeek")}
        </Button>
        <Button variant="secondary" size="small" onClick={() => setFrom(addisDateString(new Date()))}>
          {t("thisWeek")}
        </Button>
        <Button variant="secondary" size="small" onClick={() => setFrom(addDays(from, 7))}>
          {t("nextWeek")} →
        </Button>
      </div>
      {sessions.error ? <Alert kind="error">{sessions.error.message}</Alert> : null}
      {sessions.loading && !sessions.data ? <Loading label={c("loading")} /> : null}
      {days.map((day) => {
        const list = byDay.get(day) ?? [];
        return (
          <section key={day} className="card stack" style={{ gap: 8 }} aria-label={day}>
            <h2 style={{ fontSize: "1rem", margin: 0 }}>
              <LocalDate value={day} locale={locale} />
            </h2>
            {list.length === 0 ? <p className="small muted">{t("noClasses")}</p> : null}
            {list.map((s) => {
              const isOpen = open === s.id;
              const mine = s.trainerId === myTrainer;
              const canSeeRoster = user?.role !== "TRAINER" || mine;
              return (
                <div key={s.id} className="stack" style={{ gap: 6, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <div className="spread">
                    <span>
                      <strong>{timeOf(s.startsAt)}</strong> {s.name} <span className="small muted">· {s.trainerName}</span>
                    </span>
                    <span className="row" style={{ gap: 4 }}>
                      {s.status === "CANCELLED" ? (
                        <Badge tone="danger">{t("cancelled")}</Badge>
                      ) : (
                        <Badge tone={s.spotsLeft ? "ok" : "warn"}>{s.spotsLeft ? t("spotsLeft", { count: s.spotsLeft }) : t("full")}</Badge>
                      )}
                      {canSeeRoster ? (
                        <button type="button" className="btn secondary small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                          {isOpen ? c("close") : t("bookings")}
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {s.cancelReason ? <span className="small muted">{s.cancelReason}</span> : null}
                  {isOpen ? <Roster sessionId={s.id} canMark={manager || mine} onChange={() => void sessions.reload()} /> : null}
                </div>
              );
            })}
          </section>
        );
      })}

      {manager ? (
        <Card title={t("templates")}>
          <div className="stack">
            <p className="small muted">{t("templatesHint")}</p>
            {templates.data?.items.length ? (
              <DataList
                rows={templates.data.items}
                rowKey={(tpl) => tpl.id}
                columns={[
                  { key: "name", label: c("name"), render: (tpl) => tpl.name },
                  { key: "when", label: t("when"), render: (tpl) => `${t(`weekday.${tpl.weekday}`)} ${tpl.startTime}` },
                  { key: "trainer", label: t("trainer"), render: (tpl) => trainerName(tpl.trainerId) },
                  { key: "capacity", label: t("capacity"), render: (tpl) => tpl.capacity },
                  {
                    key: "active",
                    label: c("status"),
                    render: (tpl) => (
                      <button type="button" className="btn secondary small" onClick={() => void toggleTemplate(tpl)}>
                        {tpl.isActive ? t("pause") : t("resume")}
                      </button>
                    ),
                  },
                ]}
              />
            ) : null}
            {addingTemplate ? (
              <form className="stack" onSubmit={(ev) => void addTemplate(ev)} noValidate>
                <div className="grid cols-2">
                  <TextField label={c("name")} name="name" required error={action.fieldErrors.name} />
                  <SelectField label={t("trainer")} name="trainerId" options={(trainers.data?.items ?? []).filter((x) => x.user.isActive).map((x) => ({ value: x.trainer.id, label: x.user.name }))} />
                  <SelectField label={t("day")} name="weekday" defaultValue="1" options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: String(d), label: t(`weekday.${d}`) }))} />
                  <TextField label={t("startTime")} name="startTime" type="time" required defaultValue="07:00" error={action.fieldErrors.startTime} />
                  <TextField label={t("duration")} name="durationMinutes" type="number" min={15} max={300} defaultValue={60} />
                  <TextField label={t("capacity")} name="capacity" type="number" min={1} max={500} defaultValue={12} />
                </div>
                {trainers.data && trainers.data.items.length === 0 ? <Alert kind="warn">{t("needTrainer")}</Alert> : null}
                <div className="row">
                  <Button type="submit" disabled={action.busy}>
                    {c("save")}
                  </Button>
                  <Button variant="secondary" onClick={() => setAddingTemplate(false)}>
                    {c("cancel")}
                  </Button>
                </div>
              </form>
            ) : (
              <div>
                <Button variant="secondary" onClick={() => setAddingTemplate(true)}>
                  {t("addTemplate")}
                </Button>
              </div>
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
