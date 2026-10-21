"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { UNIT_PURPOSES, UNIT_TYPES } from "@platform/shared";
import { Alert, Button, SelectField, TextArea, TextField } from "@platform/ui";
import { useApi } from "@/lib/api";
import { birr, decimal, int, minorToInput, text, useAction } from "@/lib/forms";
import { useSession } from "@/lib/session";

export interface UnitRecord {
  id: string;
  projectId: string;
  buildingId: string | null;
  landlordId: string | null;
  code: string;
  type: string;
  purpose: string;
  bedrooms: number | null;
  areaSqm: number | null;
  floor: number | null;
  priceMinor: number;
  status: string;
  description: string | null;
  internalNotes: string | null;
  isPublished: boolean;
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
  area: string;
}

/** Create or edit a unit. The project cannot change after creation (codes are unique per project). */
export function UnitForm({ unit, onSave }: { unit?: UnitRecord; onSave: (body: Record<string, unknown>) => Promise<unknown> }) {
  const t = useTranslations("units");
  const c = useTranslations("common");
  const e = useTranslations("enums");
  const { user } = useSession();
  const [projectId, setProjectId] = useState(unit?.projectId ?? "");
  const projects = useApi<{ items: Project[] }>("/projects");
  const project = useApi<{ buildings: Array<{ id: string; name: string }> }>(projectId ? `/projects/${projectId}` : null);
  const canSeeLandlords = user && user.role !== "BROKER";
  const landlords = useApi<{ items: Array<{ id: string; name: string }> }>(canSeeLandlords ? "/landlords" : null);
  const { busy, error, fieldErrors, run, setError } = useAction();

  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const priceMinor = birr(f, "price");
    if (priceMinor === null) return setError(t("priceInvalid"));
    const body: Record<string, unknown> = {
      buildingId: text(f, "buildingId"),
      code: text(f, "code") ?? "",
      type: f.get("type"),
      purpose: f.get("purpose"),
      bedrooms: int(f, "bedrooms"),
      areaSqm: decimal(f, "areaSqm"),
      floor: int(f, "floor"),
      priceMinor,
      description: text(f, "description"),
      internalNotes: text(f, "internalNotes"),
    };
    if (canSeeLandlords) body.landlordId = text(f, "landlordId");
    if (!unit) body.projectId = projectId;
    await run(() => onSave(body));
  }

  const err = (k: string) => fieldErrors[k] ?? null;

  return (
    <form className="stack" onSubmit={(ev) => void submit(ev)} noValidate>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {projects.data?.items.length === 0 ? <Alert kind="warn">{t("noProjects")}</Alert> : null}
      <div className="grid cols-2">
        <SelectField
          label={t("project")}
          name="projectId"
          value={projectId}
          disabled={Boolean(unit)}
          onChange={(ev) => setProjectId(ev.target.value)}
          error={err("projectId")}
          options={[{ value: "", label: c("none") }, ...(projects.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.name} · ${p.area}` }))]}
        />
        <SelectField
          label={t("building")}
          name="buildingId"
          defaultValue={unit?.buildingId ?? ""}
          key={projectId}
          options={[{ value: "", label: c("none") }, ...(project.data?.buildings ?? []).map((b) => ({ value: b.id, label: b.name }))]}
        />
        <TextField label={t("code")} name="code" defaultValue={unit?.code} required error={err("code")} />
        <SelectField label={t("type")} name="type" defaultValue={unit?.type ?? "APARTMENT"} options={UNIT_TYPES.map((v) => ({ value: v, label: e(`UNIT_TYPE.${v}`) }))} />
        <SelectField label={t("purpose")} name="purpose" defaultValue={unit?.purpose ?? "SALE"} options={UNIT_PURPOSES.map((v) => ({ value: v, label: e(`UNIT_PURPOSE.${v}`) }))} />
        <TextField label={t("price")} name="price" inputMode="decimal" defaultValue={minorToInput(unit?.priceMinor)} required hint={t("priceHint")} error={err("priceMinor")} />
        <TextField label={t("bedrooms")} name="bedrooms" type="number" min={0} inputMode="numeric" defaultValue={unit?.bedrooms ?? ""} error={err("bedrooms")} />
        <TextField label={t("areaSqm")} name="areaSqm" type="number" min={0} step="0.01" inputMode="decimal" defaultValue={unit?.areaSqm ?? ""} error={err("areaSqm")} />
        <TextField label={t("floor")} name="floor" type="number" inputMode="numeric" defaultValue={unit?.floor ?? ""} error={err("floor")} />
        {canSeeLandlords ? (
          <SelectField
            label={t("landlord")}
            name="landlordId"
            defaultValue={unit?.landlordId ?? ""}
            options={[{ value: "", label: c("none") }, ...(landlords.data?.items ?? []).map((l) => ({ value: l.id, label: l.name }))]}
          />
        ) : null}
      </div>
      <TextArea label={t("description")} name="description" defaultValue={unit?.description ?? ""} rows={4} hint={t("descriptionHint")} />
      <TextArea label={t("internalNotes")} name="internalNotes" defaultValue={unit?.internalNotes ?? ""} rows={2} hint={t("internalHint")} />
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? c("saving") : c("save")}
        </Button>
      </div>
    </form>
  );
}
