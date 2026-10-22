"use client";

import Link from "next/link";
import { use, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MAINTENANCE_MOVES, type MaintenanceStatus } from "@platform/shared";
import { Alert, Badge, Button, Card, Checkbox, LocalDate, Loading, Money, PageHeader, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { birr, text, useAction } from "@/lib/forms";
import { maintenanceTone, priorityTone } from "@/lib/tones";
import type { MaintenanceRequest } from "../page";

interface Detail {
  request: MaintenanceRequest;
  unit: { id: string; code: string };
  comments: Array<{ id: string; text: string; createdAt: string; by: { id: string; name: string } | null }>;
  photos: Array<{ id: string; createdAt: string }>;
}

export default function MaintenanceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("maintenance");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { data, error, reload } = useApi<Detail>(`/maintenance/${id}`);
  const action = useAction();
  const [panel, setPanel] = useState<null | "assign" | "done">(null);
  const [notice, setNotice] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  if (error) return <Alert kind="error">{error.status === 404 ? c("notFound") : error.message}</Alert>;
  if (!data) return <Loading label={c("loading")} />;
  const { request, unit, comments, photos } = data;
  const closed = request.status === "DONE" || request.status === "CANCELLED";
  // Moving to ASSIGNED happens through the assign form; DONE asks for the cost first.
  const moves = MAINTENANCE_MOVES[request.status as MaintenanceStatus].filter((s) => s !== "ASSIGNED" && s !== "DONE");
  const canFinish = MAINTENANCE_MOVES[request.status as MaintenanceStatus].includes("DONE");

  const done = async (message: string) => {
    setPanel(null);
    setNotice(message);
    await reload();
  };

  const assign = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const ok = await action.run(() =>
      api(`/maintenance/${id}/assign`, { method: "POST", json: { assignedToName: text(f, "assignedToName") ?? "", assignedToPhone: text(f, "assignedToPhone") } }),
    );
    if (ok) await done(t("assigned"));
  };

  const move = async (status: string) => {
    if (status === "CANCELLED" && !window.confirm(t("cancelConfirm"))) return;
    if (await action.run(() => api(`/maintenance/${id}/status`, { method: "PATCH", json: { status } }))) await done(c("saved"));
  };

  const finish = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const costMinor = birr(f, "cost");
    if (costMinor === null) return action.setError(t("costInvalid"));
    const ok = await action.run(() =>
      api(`/maintenance/${id}/status`, { method: "PATCH", json: { status: "DONE", costMinor, paidByLandlord: f.get("paidByLandlord") === "on" } }),
    );
    if (ok) await done(t("finished"));
  };

  const comment = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const body = text(new FormData(form), "text");
    if (!body) return;
    if (await action.run(() => api(`/maintenance/${id}/comments`, { method: "POST", json: { text: body } }))) {
      form.reset();
      await reload();
    }
  };

  const upload = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const files = photoInput.current?.files;
    if (!files?.length) return;
    const form = ev.currentTarget;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      if (!(await action.run(() => api(`/maintenance/${id}/photos`, { method: "POST", body: fd })))) return;
    }
    form.reset();
    await done(t("photosAdded"));
  };

  return (
    <div className="stack">
      <PageHeader
        title={request.title}
        subtitle={
          <span className="row">
            <Badge tone={maintenanceTone(request.status)}>{e(`MAINTENANCE_STATUS.${request.status}`)}</Badge>
            <Badge tone={priorityTone(request.priority)}>{e(`PRIORITY.${request.priority}`)}</Badge>
          </span>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}

      <div className="grid cols-2">
        <Card title={t("details")}>
          <div className="stack">
            <dl className="facts">
              <dt>{t("unit")}</dt>
              <dd>
                <Link href={`/staff/units/${unit.id}`}>{unit.code}</Link>
              </dd>
              {request.leaseId ? (
                <>
                  <dt>{t("lease")}</dt>
                  <dd>
                    <Link href={`/staff/leases/${request.leaseId}`}>{t("openLease")}</Link>
                  </dd>
                </>
              ) : null}
              <dt>{t("reportedBy")}</dt>
              <dd>
                {request.reportedByCustomerId ? <Link href={`/staff/customers/${request.reportedByCustomerId}`}>{t("tenant")}</Link> : t("staff")}
                {" · "}
                <LocalDate value={request.createdAt} locale={locale} withTime />
              </dd>
              <dt>{t("description")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{request.description ?? "-"}</dd>
              <dt>{t("assignee")}</dt>
              <dd>
                {request.assignedToName ?? "-"}
                {request.assignedToPhone ? (
                  <>
                    {" · "}
                    <a href={`tel:${request.assignedToPhone}`}>{request.assignedToPhone}</a>
                  </>
                ) : null}
              </dd>
              {request.status === "DONE" ? (
                <>
                  <dt>{t("cost")}</dt>
                  <dd>
                    <Money minor={request.costMinor} locale={locale} /> · {request.paidByLandlord ? t("paidByOwner") : t("paidByCompany")}
                  </dd>
                </>
              ) : null}
              {request.closedAt ? (
                <>
                  <dt>{t("closed")}</dt>
                  <dd>
                    <LocalDate value={request.closedAt} locale={locale} withTime />
                  </dd>
                </>
              ) : null}
            </dl>
            {!closed ? (
              <div className="row">
                <Button variant="secondary" size="small" onClick={() => setPanel("assign")}>
                  {request.assignedToName ? t("reassign") : t("assign")}
                </Button>
                {moves.map((s) => (
                  <Button key={s} variant={s === "CANCELLED" ? "danger" : "secondary"} size="small" onClick={() => void move(s)} disabled={action.busy}>
                    {t(`moveTo.${s}`)}
                  </Button>
                ))}
                {canFinish ? (
                  <Button size="small" onClick={() => setPanel("done")}>
                    {t("moveTo.DONE")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </Card>

        {panel === "assign" ? (
          <Card title={t("assign")}>
            <form className="stack" onSubmit={(ev) => void assign(ev)} noValidate>
              <TextField label={t("assigneeName")} name="assignedToName" required defaultValue={request.assignedToName ?? ""} error={action.fieldErrors.assignedToName} />
              <TextField label={t("assigneePhone")} name="assignedToPhone" type="tel" inputMode="tel" defaultValue={request.assignedToPhone ?? ""} error={action.fieldErrors.assignedToPhone} />
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

        {panel === "done" ? (
          <Card title={t("moveTo.DONE")}>
            <form className="stack" onSubmit={(ev) => void finish(ev)} noValidate>
              <TextField label={t("costBirr")} name="cost" inputMode="decimal" required hint={t("costHint")} error={action.fieldErrors.costMinor} />
              <Checkbox label={t("paidByOwnerCheck")} name="paidByLandlord" defaultChecked={request.paidByLandlord} />
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
      </div>

      <Card title={t("photos")}>
        <div className="stack">
          {photos.length ? (
            <div className="thumbs">
              {photos.map((p, i) => (
                <figure key={p.id}>
                  <a href={`/api/files/maintenance-photos/${p.id}`} target="_blank" rel="noopener">
                    <img src={`/api/files/maintenance-photos/${p.id}`} alt={`${request.title} ${i + 1}`} width={320} height={240} loading="lazy" />
                  </a>
                </figure>
              ))}
            </div>
          ) : (
            <p className="muted">{t("noPhotos")}</p>
          )}
          <form className="row" onSubmit={(ev) => void upload(ev)}>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple aria-label={t("choosePhotos")} />
            <Button type="submit" variant="secondary" size="small" disabled={action.busy}>
              {t("addPhotos")}
            </Button>
          </form>
        </div>
      </Card>

      <Card title={t("comments")}>
        <div className="stack">
          {comments.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8 }}>
              {comments.map((cm) => (
                <li key={cm.id}>
                  <div className="small muted">
                    {cm.by?.name ?? t("tenant")} · <LocalDate value={cm.createdAt} locale={locale} withTime />
                  </div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{cm.text}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{t("noComments")}</p>
          )}
          <form className="stack" onSubmit={(ev) => void comment(ev)}>
            <TextArea label={t("addComment")} name="text" rows={2} />
            <div>
              <Button type="submit" variant="secondary" size="small" disabled={action.busy}>
                {t("postComment")}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
