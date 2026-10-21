"use client";

import { use, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CHANNELS, ENABLED_CHANNELS, PAYMENT_METHODS, addisDateString, formatMoney } from "@platform/shared";
import { Alert, Badge, Button, Card, Checkbox, DataList, LocalDate, Loading, Money, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { birr, minorToInput, text, useAction } from "@/lib/forms";
import { isDesk, isManager, useSession } from "@/lib/session";
import { membershipTone } from "@/lib/tones";
import type { GymPayment, Member, Membership, MembershipState, Plan } from "@/lib/types";

interface Detail {
  member: Member;
  membership: MembershipState;
  consent?: Record<string, boolean>;
  trainers: Array<{ trainerId: string; name: string }>;
}
interface History {
  memberships: Array<Membership & { freezes: Array<{ id: string; startDate: string; endDate: string; reason: string; endedEarlyAt?: string | null }> }>;
  payments: GymPayment[];
}
type Panel = null | "edit" | "sell" | "freeze" | "cancel";

export default function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("members");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const desk = isDesk(user);
  const manager = isManager(user);
  const detail = useApi<Detail>(`/members/${id}`);
  const history = useApi<History>(desk ? `/members/${id}/memberships` : null);
  const plans = useApi<{ items: Plan[] }>(desk ? "/plans" : null);
  const visits = useApi<{ items: Array<{ id: string; at: string; method: string; result: string; deniedReason: string | null; override: boolean }> }>(`/members/${id}/checkins`);
  const trainers = useApi<{ items: Array<{ trainer: { id: string }; user: { name: string; isActive: boolean } }> }>(manager ? "/trainers" : null);
  const action = useAction();
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planId, setPlanId] = useState("");
  const [complimentary, setComplimentary] = useState(false);
  const [voiding, setVoiding] = useState<GymPayment | null>(null);
  const [invite, setInvite] = useState<{ link: string; delivery: string } | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [photoVersion, setPhotoVersion] = useState(0);

  if (detail.error) return <Alert kind="error">{detail.error.status === 404 ? c("notFound") : detail.error.message}</Alert>;
  if (!detail.data) return <Loading label={c("loading")} />;
  const { member, membership: state, consent } = detail.data;
  const current = state.membership;
  const plan = plans.data?.items.find((p) => p.id === planId);

  const done = async (message: string) => {
    setNotice(message);
    setPanel(null);
    setVoiding(null);
    await Promise.all([detail.reload(), history.reload(), visits.reload()]);
  };

  const save = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const res = await action.run(() =>
      api<{ warnings: unknown[] }>(`/members/${id}`, {
        method: "PATCH",
        json: {
          name: text(f, "name") ?? undefined,
          phone: text(f, "phone"),
          email: text(f, "email"),
          locale: f.get("locale"),
          birthDate: text(f, "birthDate"),
          emergencyContactName: text(f, "emergencyContactName"),
          emergencyContactPhone: text(f, "emergencyContactPhone"),
          telegramChatId: text(f, "telegramChatId"),
          status: f.get("status"),
        },
      }),
    );
    if (res) await done(res.warnings.length ? t("duplicateWarning") : c("saved"));
  };

  const sell = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = { planId };
    if (text(f, "startDate")) body.startDate = text(f, "startDate");
    if (complimentary) body.complimentaryReason = text(f, "reason") ?? "";
    else {
      const amountMinor = birr(f, "amount");
      if (!amountMinor) return action.setError(t("amountInvalid"));
      body.payment = { amountMinor, method: f.get("method"), reference: text(f, "reference") };
    }
    const res = await action.run(() => api<{ membership: Membership; payment: GymPayment | null }>(`/members/${id}/memberships`, { method: "POST", json: body }));
    if (res) await done(res.payment ? t("soldWithReceipt", { number: res.payment.receiptNumber }) : t("sold"));
  };

  const freeze = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!current) return;
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api(`/memberships/${current.id}/freeze`, { method: "POST", json: { startDate: text(f, "startDate"), endDate: text(f, "endDate"), reason: text(f, "reason") ?? "" } }),
    );
    if (ok) await done(t("frozen"));
  };

  const endFreeze = async (freezeId: string) => {
    if (await action.run(() => api(`/freezes/${freezeId}/end`, { method: "POST" }))) await done(t("freezeEnded"));
  };

  const cancel = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!current) return;
    const ok = await action.run(() => api(`/memberships/${current.id}/cancel`, { method: "POST", json: { reason: text(new FormData(ev.currentTarget), "reason") ?? "" } }));
    if (ok) await done(t("cancelled"));
  };

  const voidPayment = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    if (!voiding) return;
    const ok = await action.run(() => api(`/payments/${voiding.id}/void`, { method: "POST", json: { reason: text(new FormData(ev.currentTarget), "reason") ?? "" } }));
    if (ok) await done(t("voided"));
  };

  const setConsent = async (channel: string, granted: boolean) => {
    if (await action.run(() => api(`/members/${id}/consent`, { method: "POST", json: { channel, granted, note: t("consentNote") } }))) await detail.reload();
  };

  const uploadPhoto = async () => {
    const file = photoInput.current?.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    if (await action.run(() => api(`/members/${id}/photo`, { method: "POST", body: fd }))) {
      setPhotoVersion((v) => v + 1);
      await detail.reload();
    }
  };

  const regenerateQr = async () => {
    if (!window.confirm(t("newQrConfirm"))) return;
    if (await action.run(() => api(`/members/${id}/qr/regenerate`, { method: "POST" }))) setNotice(t("newQrDone"));
  };

  const sendInvite = async () => {
    const res = await action.run(() => api<{ link: string; delivery: string }>(`/members/${id}/invite`, { method: "POST" }));
    if (res) setInvite(res);
  };

  const assign = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const trainerId = text(new FormData(ev.currentTarget), "trainerId");
    if (!trainerId) return;
    if (await action.run(() => api("/trainer-assignments", { method: "POST", json: { trainerId, memberId: id } }))) await done(c("saved"));
  };

  const unassign = async (trainerId: string) => {
    if (await action.run(() => api("/trainer-assignments", { method: "DELETE", json: { trainerId, memberId: id } }))) await done(c("saved"));
  };

  const exportData = async () => {
    const data = await action.run(() => api<unknown>(`/members/${id}/export`));
    if (!data) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `member-${id}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const anonymise = async () => {
    if (!window.confirm(t("anonymiseConfirm"))) return;
    if (await action.run(() => api(`/members/${id}/anonymise`, { method: "POST" }))) await done(t("anonymised"));
  };

  const currentFreeze = history.data?.memberships.find((m) => m.id === current?.id)?.freezes.find((f) => state.freeze && f.startDate === state.freeze.startDate);
  const today = addisDateString(new Date());

  return (
    <div className="stack">
      <PageHeader
        title={member.name}
        subtitle={
          <>
            <Badge tone={membershipTone(state.status)}>{t(`state.${state.status}`)}</Badge>{" "}
            {current ? (
              <span className="small">
                {current.planName} · {t("until")} <LocalDate value={current.endDate} locale={locale} />
                {state.daysLeft !== null ? ` · ${t("daysLeft", { count: state.daysLeft })}` : ""}
              </span>
            ) : null}
            {member.status === "INACTIVE" ? <Badge tone="danger">{t("inactive")}</Badge> : null}
          </>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}

      <div className="grid cols-2">
        <Card title={t("profile")}>
          <div className="stack">
            <div className="row" style={{ alignItems: "flex-start" }}>
              {member.photoKey ? (
                <img src={`/api/members/${id}/photo?v=${photoVersion}`} alt={member.name} width={96} height={96} style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div aria-hidden="true" style={{ width: 96, height: 96, borderRadius: "50%", background: "var(--border)" }} />
              )}
              <dl className="facts" style={{ flex: 1 }}>
                <dt>{c("phone")}</dt>
                <dd>{member.phone ? <a href={`tel:${member.phone}`}>{member.phone}</a> : "-"}</dd>
                <dt>{c("email")}</dt>
                <dd>{member.email ?? "-"}</dd>
                <dt>{t("joined")}</dt>
                <dd>
                  <LocalDate value={member.joinedAt} locale={locale} />
                </dd>
                <dt>{t("birthDate")}</dt>
                <dd>{member.birthDate ? <LocalDate value={member.birthDate} locale={locale} /> : "-"}</dd>
                <dt>{t("emergency")}</dt>
                <dd>{member.emergencyContactName ? `${member.emergencyContactName} ${member.emergencyContactPhone ?? ""}` : "-"}</dd>
              </dl>
            </div>
            {desk && !member.anonymizedAt ? (
              <>
                <div className="row" style={{ alignItems: "flex-end" }}>
                  <div className="field">
                    <label htmlFor="member-photo">{t("photo")}</label>
                    <input id="member-photo" ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" capture="user" />
                  </div>
                  <Button variant="secondary" size="small" onClick={() => void uploadPhoto()} disabled={action.busy}>
                    {t("uploadPhoto")}
                  </Button>
                </div>
                <div className="row">
                  <Button variant="secondary" size="small" onClick={() => setPanel(panel === "edit" ? null : "edit")}>
                    {c("edit")}
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => void regenerateQr()} disabled={action.busy}>
                    {t("newQr")}
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => void sendInvite()} disabled={action.busy || !member.email}>
                    {t("invite")}
                  </Button>
                </div>
                {!member.email ? <p className="small muted">{t("inviteNeedsEmail")}</p> : null}
                {invite ? (
                  <Alert kind="ok">
                    {invite.delivery === "SENT" ? t("inviteSent") : t("inviteNotSent")}
                    <div style={{ wordBreak: "break-all", marginTop: 6 }}>
                      <code>{invite.link}</code>
                    </div>
                  </Alert>
                ) : null}
              </>
            ) : null}
          </div>
        </Card>

        {desk ? (
          <Card title={t("membership")}>
            <div className="stack">
              {state.freeze ? (
                <Alert kind="warn">
                  {t("frozenUntil")} <LocalDate value={state.freeze.endDate} locale={locale} />
                </Alert>
              ) : null}
              {state.next ? (
                <p className="small">
                  {t("nextMembership")}: {state.next.planName} · <LocalDate value={state.next.startDate} locale={locale} /> → <LocalDate value={state.next.endDate} locale={locale} />
                </p>
              ) : null}
              <div className="row">
                <Button onClick={() => setPanel(panel === "sell" ? null : "sell")} disabled={Boolean(member.anonymizedAt)}>
                  {state.status === "ACTIVE" || state.status === "FROZEN" ? t("renew") : t("sell")}
                </Button>
                {manager && current && (state.status === "ACTIVE" || state.status === "FROZEN") ? (
                  <>
                    {state.status === "ACTIVE" ? (
                      <Button variant="secondary" onClick={() => setPanel(panel === "freeze" ? null : "freeze")}>
                        {t("freeze")}
                      </Button>
                    ) : null}
                    {currentFreeze ? (
                      <Button variant="secondary" onClick={() => void endFreeze(currentFreeze.id)} disabled={action.busy}>
                        {t("endFreeze")}
                      </Button>
                    ) : null}
                    <Button variant="danger" onClick={() => setPanel(panel === "cancel" ? null : "cancel")}>
                      {t("cancelMembership")}
                    </Button>
                  </>
                ) : null}
              </div>

              {panel === "sell" ? (
                <form className="stack" onSubmit={(ev) => void sell(ev)} noValidate>
                  <SelectField
                    label={t("plan")}
                    value={planId}
                    onChange={(ev) => setPlanId(ev.target.value)}
                    options={[
                      { value: "", label: "—" },
                      ...(plans.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${t("months", { count: p.durationMonths })} · ${formatMoney(p.priceMinor, locale)}` })),
                    ]}
                  />
                  <TextField label={t("startDate")} name="startDate" type="date" min={today} hint={t("startHint")} />
                  {manager ? <Checkbox label={t("complimentary")} checked={complimentary} onChange={(ev) => setComplimentary(ev.target.checked)} /> : null}
                  {complimentary ? (
                    <TextField label={t("complimentaryReason")} name="reason" required />
                  ) : (
                    <div className="grid cols-2">
                      <TextField label={t("amount")} name="amount" inputMode="decimal" key={planId} defaultValue={plan ? minorToInput(plan.priceMinor) : ""} required />
                      <SelectField label={t("method")} name="method" defaultValue="CASH" options={PAYMENT_METHODS.map((m) => ({ value: m, label: e(`PAYMENT_METHOD.${m}`) }))} />
                      <TextField label={t("reference")} name="reference" />
                    </div>
                  )}
                  <div>
                    <Button type="submit" disabled={!planId || action.busy}>
                      {action.busy ? c("saving") : t("confirmSale")}
                    </Button>
                  </div>
                </form>
              ) : null}

              {panel === "freeze" ? (
                <form className="stack" onSubmit={(ev) => void freeze(ev)}>
                  <p className="small muted">{t("freezeHint")}</p>
                  <div className="grid cols-2">
                    <TextField label={t("from")} name="startDate" type="date" required min={today} defaultValue={today} />
                    <TextField label={t("to")} name="endDate" type="date" required min={today} />
                  </div>
                  <TextField label={t("reason")} name="reason" required minLength={3} />
                  <div>
                    <Button type="submit" disabled={action.busy}>
                      {t("freeze")}
                    </Button>
                  </div>
                </form>
              ) : null}

              {panel === "cancel" ? (
                <form className="stack" onSubmit={(ev) => void cancel(ev)}>
                  <TextArea label={t("reason")} name="reason" required rows={2} />
                  <div>
                    <Button type="submit" variant="danger" disabled={action.busy}>
                      {t("confirmCancel")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>

      {panel === "edit" ? (
        <Card title={c("edit")}>
          <form className="stack" onSubmit={(ev) => void save(ev)} noValidate>
            <div className="grid cols-2">
              <TextField label={c("name")} name="name" defaultValue={member.name} error={action.fieldErrors.name} />
              <TextField label={c("phone")} name="phone" type="tel" defaultValue={member.phone ?? ""} error={action.fieldErrors.phone} />
              <TextField label={c("email")} name="email" type="email" defaultValue={member.email ?? ""} error={action.fieldErrors.email} />
              <SelectField
                label={c("language")}
                name="locale"
                defaultValue={member.locale}
                options={[
                  { value: "am", label: c("amharic") },
                  { value: "en", label: c("english") },
                ]}
              />
              <TextField label={t("birthDate")} name="birthDate" type="date" defaultValue={member.birthDate ?? ""} />
              <TextField label={t("emergencyName")} name="emergencyContactName" defaultValue={member.emergencyContactName ?? ""} />
              <TextField label={t("emergencyPhone")} name="emergencyContactPhone" type="tel" defaultValue={member.emergencyContactPhone ?? ""} error={action.fieldErrors.emergencyContactPhone} />
              <TextField label={t("telegram")} name="telegramChatId" defaultValue={member.telegramChatId ?? ""} />
              <SelectField
                label={c("status")}
                name="status"
                defaultValue={member.status}
                options={[
                  { value: "ACTIVE", label: t("active") },
                  { value: "INACTIVE", label: t("inactive") },
                ]}
              />
            </div>
            <div className="row">
              <Button type="submit" disabled={action.busy}>
                {c("save")}
              </Button>
              <Button variant="secondary" onClick={() => setPanel(null)}>
                {c("cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {desk && history.data ? (
        <Card title={t("history")}>
          <div className="stack">
            {history.data.memberships.length ? (
              <DataList
                rows={history.data.memberships}
                rowKey={(m) => m.id}
                columns={[
                  { key: "plan", label: t("plan"), render: (m) => m.planName },
                  {
                    key: "dates",
                    label: t("dates"),
                    render: (m) => (
                      <span>
                        <LocalDate value={m.startDate} locale={locale} /> → <LocalDate value={m.endDate} locale={locale} />
                      </span>
                    ),
                  },
                  { key: "price", label: t("price"), render: (m) => (m.complimentaryReason ? t("free") : <Money minor={m.priceMinor} locale={locale} />) },
                  {
                    key: "status",
                    label: c("status"),
                    render: (m) => (
                      <span>
                        {e(`MEMBERSHIP_STATUS.${m.status}`)}
                        {m.freezes.length ? ` · ${t("freezes", { count: m.freezes.length })}` : ""}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <p className="muted">{t("noMemberships")}</p>
            )}
            <h3>{t("payments")}</h3>
            {history.data.payments.length ? (
              <DataList
                rows={history.data.payments}
                rowKey={(p) => p.id}
                columns={[
                  { key: "date", label: c("date"), render: (p) => <LocalDate value={p.paidAt} locale={locale} /> },
                  { key: "amount", label: c("amount"), render: (p) => <Money minor={p.amountMinor} locale={locale} /> },
                  { key: "method", label: t("method"), render: (p) => `${e(`PAYMENT_METHOD.${p.method}`)}${p.reference ? ` · ${p.reference}` : ""}` },
                  {
                    key: "receipt",
                    label: t("receipt"),
                    render: (p) => (
                      <span className="row" style={{ gap: 4 }}>
                        <a className="btn secondary small" href={`/api/payments/${p.id}/receipt.pdf`} target="_blank" rel="noopener">
                          {p.receiptNumber}
                        </a>
                        {p.status === "VOIDED" ? (
                          <Badge tone="danger">{e("PAYMENT_STATUS.VOIDED")}</Badge>
                        ) : manager ? (
                          <button type="button" className="btn danger small" onClick={() => setVoiding(p)}>
                            {t("void")}
                          </button>
                        ) : null}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <p className="muted">{c("none")}</p>
            )}
            {voiding ? (
              <form className="stack card" onSubmit={(ev) => void voidPayment(ev)}>
                <strong>{t("voidTitle", { number: voiding.receiptNumber })}</strong>
                <TextField label={t("reason")} name="reason" required minLength={3} />
                <div className="row">
                  <Button type="submit" variant="danger" disabled={action.busy}>
                    {t("void")}
                  </Button>
                  <Button variant="secondary" onClick={() => setVoiding(null)}>
                    {c("cancel")}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="grid cols-2">
        <Card title={t("visits")}>
          {visits.data?.items.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
              {visits.data.items.slice(0, 20).map((v) => (
                <li key={v.id} className="spread small">
                  <LocalDate value={v.at} locale={locale} withTime />
                  <span>
                    {v.result === "ALLOWED" ? <Badge tone="ok">{t(`visit.${v.result}`)}</Badge> : <Badge tone="danger">{t(`visit.${v.result}`)}</Badge>}
                    {v.override ? ` ${t("overrideShort")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("noVisits")}</p>
          )}
        </Card>
        <Card title={t("trainers")}>
          <div className="stack">
            {detail.data.trainers.length ? (
              <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 4 }}>
                {detail.data.trainers.map((tr) => (
                  <li key={tr.trainerId} className="spread">
                    {tr.name}
                    {manager ? (
                      <button type="button" className="btn secondary small" onClick={() => void unassign(tr.trainerId)}>
                        {t("unassign")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t("noTrainer")}</p>
            )}
            {manager && trainers.data?.items.length ? (
              <form className="row" onSubmit={(ev) => void assign(ev)} style={{ alignItems: "flex-end" }}>
                <SelectField
                  label={t("assignTrainer")}
                  name="trainerId"
                  options={trainers.data.items.filter((x) => x.user.isActive).map((x) => ({ value: x.trainer.id, label: x.user.name }))}
                />
                <Button type="submit" variant="secondary" disabled={action.busy}>
                  {c("add")}
                </Button>
              </form>
            ) : null}
          </div>
        </Card>
      </div>

      {consent ? (
        <Card title={t("consentTitle")}>
          <p className="small muted">{t("consentHelp")}</p>
          <div className="stack" style={{ gap: 4 }}>
            {CHANNELS.map((ch) => (
              <Checkbox
                key={ch}
                label={`${e(`CHANNEL.${ch}`)}${ENABLED_CHANNELS.includes(ch) ? "" : ` (${t("channelOff")})`}`}
                checked={Boolean(consent[ch])}
                disabled={action.busy || Boolean(member.anonymizedAt) || !desk}
                onChange={(ev) => void setConsent(ch, ev.target.checked)}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {user?.role === "OWNER" ? (
        <Card title={t("dataRequests")}>
          <div className="row">
            <Button variant="secondary" onClick={() => void exportData()} disabled={action.busy}>
              {t("export")}
            </Button>
            {!member.anonymizedAt ? (
              <Button variant="danger" onClick={() => void anonymise()} disabled={action.busy}>
                {t("anonymise")}
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
