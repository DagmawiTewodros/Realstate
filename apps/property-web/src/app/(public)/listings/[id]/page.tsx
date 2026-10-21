import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatMoney } from "@platform/shared";
import { publicGet } from "@/lib/server-api";
import { InquiryForm } from "@/components/InquiryForm";

export const dynamic = "force-dynamic";

interface Detail {
  unit: {
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
    projectDescription: string | null;
    area: string;
  };
  photos: Array<{ id: string; width: number | null; height: number | null; altText: string | null }>;
  documents: Array<{ id: string; name: string }>;
}

async function load(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return publicGet<Detail>(`/public/units/${id}`, 30);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const d = await load(id).catch(() => null);
  if (!d) return { title: "404" };
  const e = await getTranslations("enums");
  const locale = (await getLocale()) as "am" | "en";
  const title = `${e(`UNIT_TYPE.${d.unit.type}`)} · ${d.unit.projectName} · ${d.unit.area}`;
  const description = `${e(`UNIT_PURPOSE.${d.unit.purpose}`)} · ${formatMoney(d.unit.priceMinor, locale)}${d.unit.description ? ` · ${d.unit.description.slice(0, 120)}` : ""}`;
  return {
    title,
    description,
    alternates: { canonical: `/listings/${id}` },
    openGraph: { title, description, images: d.photos[0] ? [`/api/public/photos/${d.photos[0].id}?size=thumb`] : [] },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await load(id);
  if (!d) notFound();
  const t = await getTranslations("public");
  const e = await getTranslations("enums");
  const locale = (await getLocale()) as "am" | "en";
  const u = d.unit;
  const title = `${e(`UNIT_TYPE.${u.type}`)} · ${u.projectName}`;
  return (
    <article className="stack" style={{ gap: 20 }}>
      <header className="stack" style={{ gap: 4 }}>
        <span className="badge">{e(`UNIT_PURPOSE.${u.purpose}`)}</span>
        <h1>{title}</h1>
        <p className="muted">{u.area}</p>
        <p className="price" style={{ fontSize: "1.4rem" }}>
          {formatMoney(u.priceMinor, locale)}
          {u.purpose === "RENT" ? ` ${t("perMonth")}` : ""}
        </p>
      </header>
      {d.photos.length ? (
        <div className="gallery">
          {d.photos.map((p, i) => (
            <img
              key={p.id}
              src={`/api/public/photos/${p.id}?size=thumb`}
              alt={p.altText || t("photoOf", { name: title })}
              width={640}
              height={480}
              loading={i < 2 ? "eager" : "lazy"}
              decoding="async"
            />
          ))}
        </div>
      ) : null}
      <section className="card">
        <ul className="row" style={{ listStyle: "none", padding: 0, margin: 0, gap: 16 }}>
          {u.bedrooms !== null ? <li>{t("bedroomsShort", { count: u.bedrooms })}</li> : null}
          {u.areaSqm ? <li>{t("sqm", { value: u.areaSqm })}</li> : null}
          {u.floor !== null ? <li>{t("floor", { value: u.floor })}</li> : null}
          <li className="muted">#{u.code}</li>
        </ul>
        {u.description ? <p style={{ marginTop: 12, whiteSpace: "pre-line" }}>{u.description}</p> : null}
        {u.projectDescription ? <p className="muted">{u.projectDescription}</p> : null}
      </section>
      {d.documents.length ? (
        <section className="card">
          <h2>{t("documents")}</h2>
          <ul>
            {d.documents.map((doc) => (
              <li key={doc.id}>
                <a href={`/api/public/documents/${doc.id}`} target="_blank" rel="noopener">
                  {doc.name}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <InquiryForm unitId={u.id} />
    </article>
  );
}
