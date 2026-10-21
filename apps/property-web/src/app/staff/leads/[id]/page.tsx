"use client";

import Link from "next/link";
import { use, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CHANNELS, LEAD_FORWARD_MOVES, LEAD_STATUSES, VIEWING_STATUSES, canMoveLead, type LeadStatus } from "@platform/shared";
import { Alert, Badge, Button, Card, LocalDate, Loading, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { isoToAddisLocal, text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import { LogActivity, addisLocalToIso } from "@/components/LogCall";
import { StaffSelect, UnitPicker } from "@/components/Pickers";
import type { LeadRow } from "../../page";

interface Detail {
  lead: LeadRow & { lostReason: string | null; firstContactAt: string | null };
  activities: Array<{ id: string; type: string; notes: string | null; result: string | null; occurredAt: string; isSystem: boolean; createdBy: { id: string; name: string } | null }>;
  consent: Record<string, boolean>;
}

interface Viewing {
  id: string;
  scheduledAt: string;
  status: string;
  unitCode: string | null;
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("leads");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const detail = useApi<Detail>(`/leads/${id}`);
  const viewings = useApi<{ items: Viewing[] }>(`/leads/${id}/viewings`);
  const action = useAction();
  const [lostOpen, setLostOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (detail.error) return <Alert kind="error">{detail.error.status === 404 ? c("notFound") : detail.error.message}</Alert>;
  if (!detail.data) return <Loading label={c("loading")} />;
  const { lead, activities, consent } = detail.data;
  const isManager = user?.role === "OWNER" || user?.role === "SALES_MANAGER";
  const closed = lead.status === "SIGNED" || lead.status === "LOST";
  const forward = LEAD_FORWARD_MOVES[lead.status as LeadStatus].filter((s) => s !== "LOST");
  const backward = isManager
    ? LEAD_STATUSES.filter((s) => !LEAD_FORWARD_MOVES[lead.status as LeadStatus].includes(s) && canMoveLead(lead.status as LeadStatus, s, true).ok)
    : [];

  const reload = async (message?: string) => {
    setNotice(message ?? null);
    await Promise.all([detail.reload(), viewings.reload()]);
  };

  const move = async (status: LeadStatus, lostReason?: string) => {
    const ok = await action.run(() => api(`/leads/${id}/status`, { method: "POST", json: { status, lostReason } }));
    if (ok) {
      setLostOpen(false);
      await reload(t("statusChanged", { status: e(`LEAD_STATUS.${status}`) }));
    }
  };

  const markLost = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    await move("LOST", text(new FormData(ev.currentTarget), "lostReason") ?? "");
  };

  const assign = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const assignedToId = text(new FormData(ev.currentTarget), "assignedToId");
    if (!assignedToId) return;
    const ok = await action.run(() => api(`/leads/${id}/assign`, { method: "POST", json: { assignedToId } }));
    if (ok) await reload(c("saved"));
  };

  const saveDetails = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api(`/leads/${id}`, {
        method: "PATCH",
        json: {
          interestedUnitId: text(f, "interestedUnitId"),
          interestedUnitNote: text(f, "interestedUnitNote"),
          nextStepAt: addisLocalToIso(String(f.get("nextStepAt") ?? "")),
          nextStepNote: text(f, "nextStepNote"),
        },
      }),
    );
    if (ok) {
      setEditing(false);
      await reload(c("saved"));
    }
  };

  const book = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const scheduledAt = addisLocalToIso(String(f.get("scheduledAt") ?? ""));
    if (!scheduledAt) return action.setError(t("pickTime"));
    const form = ev.currentTarget;
    const ok = await action.run(() => api(`/leads/${id}/viewings`, { method: "POST", json: { scheduledAt, unitId: text(f, "unitId") ?? lead.interestedUnit?.id ?? null } }));
    if (ok) {
      form.reset();
      await reload(t("viewingBooked"));
    }
  };

  const setViewing = async (viewingId: string, status: string) => {
    const ok = await action.run(() => api(`/viewings/${viewingId}`, { method: "PATCH", json: { status } }));
    if (ok) await reload(c("saved"));
  };

  return (
    <div className="stack">
      <PageHeader
        title={lead.customer.name}
        subtitle={
          <>
            <Badge tone={lead.status === "SIGNED" ? "ok" : lead.status === "LOST" ? "danger" : "brand"}>{e(`LEAD_STATUS.${lead.status}`)}</Badge> · {e(`LEAD_SOURCE.${lead.source}`)}
          </>
        }
        actions={
          <>
            {lead.customer.phone ? (
              <a className="btn" href={`tel:${lead.customer.phone}`}>
                {t("call")}
              </a>
            ) : null}
            <Link className="btn secondary" href={`/staff/customers/${lead.customer.id}`}>
              {t("customerRecord")}
            </Link>
          </>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}

      <div className="grid cols-2">
        <Card title={t("details")}>
          {editing ? (
            <form className="stack" onSubmit={(ev) => void saveDetails(ev)}>
              <UnitPicker label={t("interestedUnit")} name="interestedUnitId" initial={lead.interestedUnit} />
              <TextArea label={t("interestedNote")} name="interestedUnitNote" defaultValue={lead.interestedUnitNote ?? ""} rows={2} />
              <TextField label={t("nextStep")} name="nextStepAt" type="datetime-local" defaultValue={isoToAddisLocal(lead.nextStepAt)} />
              <TextField label={t("nextStepNote")} name="nextStepNote" defaultValue={lead.nextStepNote ?? ""} />
              <div className="row">
                <Button type="submit" disabled={action.busy}>
                  {c("save")}
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  {c("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <dl className="facts">
                <dt>{c("phone")}</dt>
                <dd>{lead.customer.phone ?? "-"}</dd>
                <dt>{c("email")}</dt>
                <dd>{lead.customer.email ?? "-"}</dd>
                <dt>{t("assignee")}</dt>
                <dd>{lead.assignee?.name ?? t("unassigned")}</dd>
                <dt>{t("interestedUnit")}</dt>
                <dd>{lead.interestedUnit ? <Link href={`/staff/units/${lead.interestedUnit.id}`}>{lead.interestedUnit.code}</Link> : "-"}</dd>
                <dt>{t("interestedNote")}</dt>
                <dd>{lead.interestedUnitNote ?? "-"}</dd>
                <dt>{t("nextStep")}</dt>
                <dd>
                  <LocalDate value={lead.nextStepAt} locale={locale} withTime /> {lead.nextStepNote ? `· ${lead.nextStepNote}` : ""}
                </dd>
                <dt>{t("created")}</dt>
                <dd>
                  <LocalDate value={lead.createdAt} locale={locale} withTime />
                </dd>
                {lead.lostReason ? (
                  <>
                    <dt>{t("lostReason")}</dt>
                    <dd>{lead.lostReason}</dd>
                  </>
                ) : null}
                <dt>{t("consent")}</dt>
                <dd>
                  {CHANNELS.filter((ch) => consent[ch])
                    .map((ch) => e(`CHANNEL.${ch}`))
                    .join(", ") || t("noConsent")}
                </dd>
              </dl>
              <div>
                <Button variant="secondary" size="small" onClick={() => setEditing(true)}>
                  {c("edit")}
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card title={t("moveTitle")}>
          <div className="stack">
            {closed && !isManager ? <p className="muted">{t("closedHint")}</p> : null}
            <div className="row">
              {forward.map((s) => (
                <Button key={s} disabled={action.busy} onClick={() => void move(s)}>
                  {t("moveTo", { status: e(`LEAD_STATUS.${s}`) })}
                </Button>
              ))}
              {!closed ? (
                <Button variant="danger" disabled={action.busy} onClick={() => setLostOpen(!lostOpen)}>
                  {t("markLost")}
                </Button>
              ) : null}
            </div>
            {lostOpen ? (
              <form className="stack" onSubmit={(ev) => void markLost(ev)}>
                <TextArea label={t("lostReason")} name="lostReason" required rows={2} error={action.fieldErrors.lostReason} />
                <Button type="submit" variant="danger" disabled={action.busy}>
                  {t("confirmLost")}
                </Button>
              </form>
            ) : null}
            {backward.length ? (
              <form
                className="row"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const s = String(new FormData(ev.currentTarget).get("back")) as LeadStatus;
                  void move(s);
                }}
              >
                <SelectField label={t("moveBack")} name="back" options={backward.map((s) => ({ value: s, label: e(`LEAD_STATUS.${s}`) }))} />
                <Button type="submit" variant="secondary" disabled={action.busy}>
                  {c("save")}
                </Button>
              </form>
            ) : null}
            {isManager ? (
              <form className="stack" onSubmit={(ev) => void assign(ev)}>
                <StaffSelect label={t("assignTo")} name="assignedToId" roles={["BROKER", "SALES_MANAGER"]} defaultValue={lead.assignee?.id} />
                <div>
                  <Button type="submit" variant="secondary" disabled={action.busy}>
                    {t("assign")}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title={t("logActivity")}>
          <LogActivity leadId={id} onDone={() => void reload(c("saved"))} />
        </Card>
        <Card title={t("viewings")}>
          <div className="stack">
            {viewings.data?.items.length ? (
              <ul className="timeline">
                {viewings.data.items.map((v) => (
                  <li key={v.id} className="stack" style={{ gap: 4 }}>
                    <span>
                      <LocalDate value={v.scheduledAt} locale={locale} withTime /> {v.unitCode ? `· ${v.unitCode}` : ""}
                    </span>
                    <span className="row">
                      <Badge tone={v.status === "DONE" ? "ok" : v.status === "BOOKED" ? "brand" : "warn"}>{e(`VIEWING_STATUS.${v.status}`)}</Badge>
                      {v.status === "BOOKED"
                        ? VIEWING_STATUSES.filter((s) => s !== "BOOKED").map((s) => (
                            <button key={s} type="button" className="btn secondary small" onClick={() => void setViewing(v.id, s)}>
                              {e(`VIEWING_STATUS.${s}`)}
                            </button>
                          ))
                        : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t("noViewings")}</p>
            )}
            {!closed ? (
              <form className="stack" onSubmit={(ev) => void book(ev)}>
                <TextField label={t("viewingTime")} name="scheduledAt" type="datetime-local" required />
                <UnitPicker label={t("viewingUnit")} name="unitId" initial={lead.interestedUnit} />
                <div>
                  <Button type="submit" disabled={action.busy}>
                    {t("bookViewing")}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </Card>
      </div>

      <Card title={t("timeline")}>
        {activities.length ? (
          <ol className="timeline">
            {activities.map((a) => (
              <li key={a.id}>
                <div className="spread small">
                  <strong>{e(`ACTIVITY_TYPE.${a.type}`)}</strong>
                  <span className="muted">
                    <LocalDate value={a.occurredAt} locale={locale} withTime /> {a.createdBy ? `· ${a.createdBy.name}` : ""}
                  </span>
                </div>
                {a.notes ? <p style={{ margin: "4px 0 0", whiteSpace: "pre-line" }}>{a.notes}</p> : null}
                {a.result ? <p className="small muted">{a.result}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">{t("noActivity")}</p>
        )}
      </Card>
    </div>
  );
}
