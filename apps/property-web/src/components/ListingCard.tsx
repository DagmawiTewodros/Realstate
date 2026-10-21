import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { formatMoney } from "@platform/shared";

export interface PublicUnit {
  id: string;
  code: string;
  type: string;
  purpose: string;
  bedrooms: number | null;
  areaSqm: number | null;
  floor: number | null;
  priceMinor: number;
  description: string | null;
  projectName: string;
  area: string;
  photoId: string | null;
}

export async function ListingCard({ unit, priority = false }: { unit: PublicUnit; priority?: boolean }) {
  const t = await getTranslations("public");
  const e = await getTranslations("enums");
  const locale = (await getLocale()) as "am" | "en";
  const title = `${e(`UNIT_TYPE.${unit.type}`)} · ${unit.projectName}`;
  return (
    <Link href={`/listings/${unit.id}`} className="card listing-card">
      {unit.photoId ? (
        // Plain img: photos come from the API proxy; width and height prevent layout shift.
        <img
          className="photo"
          src={`/api/public/photos/${unit.photoId}?size=thumb`}
          alt={t("photoOf", { name: title })}
          width={640}
          height={480}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
        />
      ) : (
        <div className="photo" aria-hidden="true" />
      )}
      <div className="body stack" style={{ gap: 4 }}>
        <span className="badge">{e(`UNIT_PURPOSE.${unit.purpose}`)}</span>
        <strong>{title}</strong>
        <span className="muted small">
          {unit.area}
          {unit.bedrooms ? ` · ${t("bedroomsShort", { count: unit.bedrooms })}` : ""}
          {unit.areaSqm ? ` · ${t("sqm", { value: unit.areaSqm })}` : ""}
        </span>
        <span className="price">
          {formatMoney(unit.priceMinor, locale)}
          {unit.purpose === "RENT" ? ` ${t("perMonth")}` : ""}
        </span>
      </div>
    </Link>
  );
}
