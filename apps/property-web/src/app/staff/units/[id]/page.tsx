"use client";

import Link from "next/link";
import { use, useRef, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { UNIT_STATUSES, addDays, addisDateString, canMoveUnit, type UnitStatus } from "@platform/shared";
import { Alert, Badge, Button, Card, Checkbox, Loading, Money, PageHeader, SelectField, TextField } from "@platform/ui";
import { api, useApi } from "@/lib/api";
import { useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";
import { unitTone } from "@/lib/tones";
import { UnitForm, type UnitRecord } from "@/components/UnitForm";

interface Photo {
  id: string;
  altText: string | null;
  sortOrder: number;
}
interface Doc {
  id: string;
  name: string;
  isPublic: boolean;
}
interface Detail {
  unit: UnitRecord;
  project: { id: string; name: string; area: string };
  building: { id: string; name: string } | null;
  landlord: { id: string; name: string } | null;
  photos: Photo[];
  documents: Doc[];
}

export default function UnitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations("units");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const locale = useLocale() as "am" | "en";
  const { user } = useSession();
  const { data, error, reload } = useApi<Detail>(`/units/${id}`);
  const rentals = user?.role === "OWNER" || user?.role === "PROPERTY_MANAGER";
  const yearAgo = addDays(addisDateString(new Date()), -365);
  const cost = useApi<{ costMinor: number; requests: number }>(rentals ? `/units/${id}/maintenance-cost?from=${yearAgo}&to=${addisDateString(new Date())}` : null);
  const action = useAction();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  if (error) return <Alert kind="error">{error.status === 404 ? c("notFound") : error.message}</Alert>;
  if (!data) return <Loading label={c("loading")} />;
  const { unit, project, building, landlord, photos, documents } = data;
  const isManager = user?.role === "OWNER" || user?.role === "SALES_MANAGER";
  const moves = UNIT_STATUSES.filter((s) => canMoveUnit(unit.status as UnitStatus, s, isManager).ok);

  const done = async (message: string) => {
    setNotice(message);
    await reload();
  };

  const setStatus = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const status = String(new FormData(ev.currentTarget).get("status"));
    if (await action.run(() => api(`/units/${id}/status`, { method: "POST", json: { status } }))) await done(t("statusChanged"));
  };

  const publish = async (isPublished: boolean) => {
    if (await action.run(() => api(`/units/${id}/publish`, { method: "POST", json: { isPublished } }))) await done(isPublished ? t("nowPublished") : t("nowHidden"));
  };

  const upload = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const files = photoInput.current?.files;
    if (!files?.length) return;
    const form = ev.currentTarget;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const ok = await action.run(() => api(`/units/${id}/photos`, { method: "POST", body: fd }));
      if (!ok) return;
    }
    form.reset();
    await done(t("photosAdded"));
  };

  const movePhoto = async (index: number, delta: number) => {
    const ids = photos.map((p) => p.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    if (await action.run(() => api(`/units/${id}/photos/order`, { method: "PATCH", json: { ids } }))) await reload();
  };

  const deletePhoto = async (photoId: string) => {
    if (!window.confirm(t("deletePhotoConfirm"))) return;
    if (await action.run(() => api(`/photos/${photoId}`, { method: "DELETE" }))) await reload();
  };

  const addDocument = async (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const f = new FormData(form);
    const fd = new FormData();
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) return;
    fd.append("file", file);
    fd.append("name", String(f.get("name") ?? "") || file.name);
    fd.append("isPublic", f.get("isPublic") ? "true" : "false");
    if (await action.run(() => api(`/units/${id}/documents`, { method: "POST", body: fd }))) {
      form.reset();
      await done(t("documentAdded"));
    }
  };

  const toggleDoc = async (d: Doc) => {
    if (await action.run(() => api(`/documents/${d.id}`, { method: "PATCH", json: { isPublic: !d.isPublic } }))) await reload();
  };

  const deleteDoc = async (d: Doc) => {
    if (!window.confirm(t("deleteDocumentConfirm", { name: d.name }))) return;
    if (await action.run(() => api(`/documents/${d.id}`, { method: "DELETE" }))) await reload();
  };

  return (
    <div className="stack">
      <PageHeader
        title={`${unit.code} · ${project.name}`}
        subtitle={
          <>
            <Badge tone={unitTone(unit.status)}>{e(`UNIT_STATUS.${unit.status}`)}</Badge> {e(`UNIT_TYPE.${unit.type}`)} · {e(`UNIT_PURPOSE.${unit.purpose}`)} ·{" "}
            <Money minor={unit.priceMinor} locale={locale} />
          </>
        }
        actions={
          unit.isPublished ? (
            <a className="btn secondary" href={`/listings/${unit.id}`} target="_blank" rel="noopener">
              {t("viewOnWebsite")}
            </a>
          ) : null
        }
      />
      {notice ? <Alert kind="ok">{notice}</Alert> : null}
      {action.error ? <Alert kind="error">{action.error}</Alert> : null}

      <div className="grid cols-2">
        <Card title={t("statusTitle")}>
          <div className="stack">
            {moves.length ? (
              <form className="row" onSubmit={(ev) => void setStatus(ev)} style={{ alignItems: "flex-end" }}>
                <SelectField label={t("changeStatus")} name="status" options={moves.map((s) => ({ value: s, label: e(`UNIT_STATUS.${s}`) }))} />
                <Button type="submit" disabled={action.busy}>
                  {c("save")}
                </Button>
              </form>
            ) : (
              <p className="muted small">{unit.status === "LEASED" ? t("leasedHint") : t("noMoves")}</p>
            )}
            {!isManager && unit.status === "AVAILABLE" ? <p className="small muted">{t("managerOnlyHint")}</p> : null}
            <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />
            <p>
              {unit.isPublished ? <Badge tone="ok">{t("published")}</Badge> : <Badge>{t("notPublished")}</Badge>}{" "}
              <span className="small muted">{unit.status !== "AVAILABLE" ? t("onlyAvailablePublished") : null}</span>
            </p>
            <div>
              {unit.isPublished ? (
                <Button variant="secondary" onClick={() => void publish(false)} disabled={action.busy}>
                  {t("hide")}
                </Button>
              ) : (
                <Button onClick={() => void publish(true)} disabled={action.busy || unit.status !== "AVAILABLE"}>
                  {t("publish")}
                </Button>
              )}
            </div>
            {photos.length === 0 && !unit.isPublished ? <Alert kind="warn">{t("noPhotosWarning")}</Alert> : null}
          </div>
        </Card>
        <Card title={t("details")}>
          <dl className="facts">
            <dt>{t("project")}</dt>
            <dd>
              <Link href={`/staff/projects/${project.id}`}>{project.name}</Link> · {project.area}
            </dd>
            <dt>{t("building")}</dt>
            <dd>{building?.name ?? "-"}</dd>
            <dt>{t("bedrooms")}</dt>
            <dd>{unit.bedrooms ?? "-"}</dd>
            <dt>{t("areaSqm")}</dt>
            <dd>{unit.areaSqm ?? "-"}</dd>
            <dt>{t("floor")}</dt>
            <dd>{unit.floor ?? "-"}</dd>
            <dt>{t("landlord")}</dt>
            <dd>{landlord ? rentals ? <Link href={`/staff/landlords/${landlord.id}`}>{landlord.name}</Link> : landlord.name : "-"}</dd>
            {rentals && cost.data ? (
              <>
                <dt>{t("maintenanceCost")}</dt>
                <dd>
                  <Money minor={cost.data.costMinor} locale={locale} /> ({t("requests", { count: cost.data.requests })})
                </dd>
              </>
            ) : null}
          </dl>
          {unit.internalNotes ? <p className="small" style={{ whiteSpace: "pre-line" }}>{unit.internalNotes}</p> : null}
          <div style={{ marginTop: 12 }}>
            <Button variant="secondary" size="small" onClick={() => setEditing(!editing)}>
              {editing ? c("cancel") : c("edit")}
            </Button>
          </div>
        </Card>
      </div>

      {editing ? (
        <Card title={c("edit")}>
          <UnitForm
            unit={unit}
            onSave={async (body) => {
              await api(`/units/${id}`, { method: "PATCH", json: body });
              setEditing(false);
              await done(c("saved"));
            }}
          />
        </Card>
      ) : null}

      <Card title={t("photos")}>
        <div className="stack">
          {photos.length ? (
            <div className="thumbs">
              {photos.map((p, i) => (
                <figure key={p.id}>
                  <img src={`/api/files/photos/${p.id}?size=thumb`} alt={p.altText ?? `${unit.code} ${i + 1}`} width={320} height={240} loading="lazy" />
                  <div className="row" style={{ gap: 4 }}>
                    <button type="button" className="btn secondary small" aria-label={t("moveEarlier")} disabled={i === 0 || action.busy} onClick={() => void movePhoto(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn secondary small" aria-label={t("moveLater")} disabled={i === photos.length - 1 || action.busy} onClick={() => void movePhoto(i, 1)}>
                      ↓
                    </button>
                    <button type="button" className="btn danger small" onClick={() => void deletePhoto(p.id)} disabled={action.busy}>
                      {c("delete")}
                    </button>
                  </div>
                  {i === 0 ? <figcaption className="small muted">{t("coverPhoto")}</figcaption> : null}
                </figure>
              ))}
            </div>
          ) : (
            <p className="muted">{t("noPhotos")}</p>
          )}
          <form className="stack" onSubmit={(ev) => void upload(ev)}>
            <div className="field">
              <label htmlFor="unit-photos">{t("addPhotos")}</label>
              <input id="unit-photos" ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" multiple />
              <span className="hint">{t("photoHint")}</span>
            </div>
            <div>
              <Button type="submit" disabled={action.busy}>
                {action.busy ? c("saving") : t("upload")}
              </Button>
            </div>
          </form>
        </div>
      </Card>

      <Card title={t("documents")}>
        <div className="stack">
          {documents.length ? (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
              {documents.map((d) => (
                <li key={d.id} className="spread">
                  <a href={`/api/files/documents/${d.id}`} target="_blank" rel="noopener">
                    {d.name}
                  </a>
                  <span className="row" style={{ gap: 4 }}>
                    <Badge tone={d.isPublic ? "ok" : undefined}>{d.isPublic ? t("public") : t("private")}</Badge>
                    <button type="button" className="btn secondary small" onClick={() => void toggleDoc(d)}>
                      {d.isPublic ? t("makePrivate") : t("makePublic")}
                    </button>
                    <button type="button" className="btn danger small" onClick={() => void deleteDoc(d)}>
                      {c("delete")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">{c("none")}</p>
          )}
          <form className="stack" onSubmit={(ev) => void addDocument(ev)}>
            <div className="field">
              <label htmlFor="unit-doc">{t("addDocument")}</label>
              <input id="unit-doc" name="file" type="file" accept="application/pdf,image/jpeg,image/png" required />
            </div>
            <TextField label={t("documentName")} name="name" />
            <Checkbox label={t("showOnWebsite")} name="isPublic" />
            <div>
              <Button type="submit" disabled={action.busy}>
                {t("upload")}
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </div>
  );
}
