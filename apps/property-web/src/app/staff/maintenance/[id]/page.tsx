"use client";

import Link from "next/link";
import { use, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MAINTENANCE_MOVES, type MaintenanceStatus } from "@platform/shared";
import { Alert, Badge, Button, Card, Checkbox, LocalDate, Loading, Money, PageHeader, SelectField, TextArea, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { birr, text, useAction } from "@/lib/forms";
import { maintenanceTone, priorityTone } from "@/lib/tones";
import type { RepairRow } from "../page";

interface Detail {
  request: Omit<RepairRow, "unit">;
  unit: { id: string; code: string };
  comments: Array<{ id: string; text: string; createdAt: string; by: { id: string; name: string } | null }>;
  photos: Array<{ id: string }>;
}

export default function RepairPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("maintenance");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { data, error, reload } = useApi<Detail>(`/maintenance/${id}`);
  const action = useAction();
  const [target, setTarget] = useState<MaintenanceStatus | "">("");
  const [notice, setNotice] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  if (error) return <Alert kind="error">{error.status === 404 ? c("notFound") : error.message}</Alert>;
  if (!data) return <Loading label={c("loading")} />;
  const { request, unit, comments, photos } = data;
  const moves = MAINTENANCE_MOVES[request.status as MaintenanceStatus].filter((s) => s !== "ASSIGNED");
  const closed = request.status === "DONE" || request.status === "CANCELLED";

  const done = async (message: string) => {
    setNotice(message);
    setTarget("");
    await reload();
  };

  const assign = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    if (await action.run(() => api(`/maintenance/${id}/assign`, { method: "POST", json: { assignedToName: text(f, "name") ?? "", assignedToPhone: text(f, "phone") } }))) await done(t("assigned"));
  };

  const move = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const body: Record<string, unknown> = { status: target };
    if (target === "DONE") {
      const costMinor = birr(f, "cost");
      if (costMinor === null) return action.setError(t("costRequired"));
      body.costMinor = costMinor;
      body.paidByLandlord = f.get("paidByLandlord") === "on";
    }
    if (await action.run(() => api(`/maintenance/${id}/status`, { method: "PATCH", json: body }))) await done(t("statusChanged"));
  };

  const comment = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const value = text(new FormData(form), "text");
    if (!value) return;
    if (await action.run(() => api(`/maintenance/${id}/comments`, { method: "POST", json: { text: value } }))) {
      form.reset();
      await reload();
    }
  };

  const upload = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    for (const file of Array.from(photoInput.current?.files ?? [])) {
      const fd = new FormData();
      fd.append("file", file);
      if (!(await action.run(() => api(`/maintenance/${id}/photos`, { method: "POST", body: fd })))) return;
    }
    form.reset();
    await reload();
  };

  return (
    <div className="stack">
      <PageHeader
        title={request.title}
        subtitle={
          <>
            <Badge tone={maintenanceTone(request.status)}>{e(`MAINTENANCE_STATUS.${request.status}`)}</Badge>{" "}
            <Badge tone={priorityTone(request.priority)}>{e(`PRIORITY.${request.priority}`)}</Badge> · <Link href={`/staff/units/${unit.id}`}>{unit.code}</Link>
          </>
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}
      <div className="grid cols-2">
        <Card title={t("details")}>
          <dl className="facts">
            <dt>{t("reported")}</dt>
            <dd>
              <LocalDate value={request.createdAt} locale={locale} withTime />
            </dd>
            <dt>{t("assignedTo")}</dt>
            <dd>
              {request.assignedToName ?? "-"}
              {request.assignedToPhone ? (
                <>
                  {" "}
                  · <a href={`tel:${request.assignedToPhone}`}>{request.assignedToPhone}</a>
                </>
              ) : null}
            </dd>
            {request.status === "DONE" ? (
              <>
                <dt>{t("cost")}</dt>
                <dd>
                  <Money minor={request.costMinor} locale={locale} /> · {request.paidByLandlord ? t("paidByLandlord") : t("paidByCompany")}
                </dd>
                <dt>{t("closed")}</dt>
                <dd>
                  <LocalDate value={request.closedAt} locale={locale} />
                </dd>
              </>
            ) : null}
          </dl>
          {request.description ? <p style={{ whiteSpace: "pre-line" }}>{request.description}</p> : null}
        </Card>
        {!closed ? (
          <Card title={c("actions")}>
            <div className="stack">
              <form className="stack" onSubmit={(ev) => void assign(ev)}>
                <TextField label={t("technician")} name="name" defaultValue={request.assignedToName ?? ""} required />
                <TextField label={t("technicianPhone")} name="phone" type="tel" defaultValue={request.assignedToPhone ?? ""} error={action.fieldErrors.assignedToPhone} />
                <div>
                  <Button type="submit" variant="secondary" disabled={action.busy}>
                    {request.assignedToName ? t("reassign") : t("assign")}
                  </Button>
                </div>
              </form>
              {moves.length ? (
                <form className="stack" onSubmit={(ev) => void move(ev)}>
                  <SelectField
                    label={t("moveTo")}
                    value={target}
                    onChange={(ev) => setTarget(ev.target.value as MaintenanceStatus)}
                    options={[{ value: "", label: "—" }, ...moves.map((s) => ({ value: s, label: e(`MAINTENANCE_STATUS.${s}`) }))]}
                  />
                  {target === "DONE" ? (
                    <>
                      <TextField label={t("cost")} name="cost" inputMode="decimal" required hint={t("costHint")} />
                      <Checkbox label={t("paidByLandlordLabel")} name="paidByLandlord" defaultChecked />
                    </>
                  ) : null}
                  <div>
                    <Button type="submit" disabled={!target || action.busy}>
                      {c("save")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
      <Card title={t("photos")}>
        <div className="stack">
          {photos.length ? (
            <div className="thumbs">
              {photos.map((p, i) => (
                <a key={p.id} href={`/api/files/maintenance-photos/${p.id}`} target="_blank" rel="noopener">
                  <img src={`/api/files/maintenance-photos/${p.id}`} alt={`${request.title} ${i + 1}`} width={320} height={240} loading="lazy" />
                </a>
              ))}
            </div>
          ) : (
            <p className="muted">{c("none")}</p>
          )}
          <form className="row" onSubmit={(ev) => void upload(ev)} style={{ alignItems: "flex-end" }}>
            <div className="field">
              <label htmlFor="repair-photos">{t("addPhotos")}</label>
              <input id="repair-photos" ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple />
            </div>
            <Button type="submit" variant="secondary" disabled={action.busy}>
              {t("upload")}
            </Button>
          </form>
        </div>
      </Card>
      <Card title={t("comments")}>
        <div className="stack">
          {comments.length ? (
            <ol className="timeline">
              {comments.map((cm) => (
                <li key={cm.id}>
                  <div className="small muted">
                    {cm.by?.name ?? t("tenantName")} · <LocalDate value={cm.createdAt} locale={locale} withTime />
                  </div>
                  <p style={{ margin: 0, whiteSpace: "pre-line" }}>{cm.text}</p>
                </li>
              ))}
            </ol>
          ) : null}
          <form className="stack" onSubmit={(ev) => void comment(ev)}>
            <TextArea label={t("addComment")} name="text" rows={2} />
            <div>
              <Button type="submit" variant="secondary" disabled={action.busy}>
                {c("add")}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
