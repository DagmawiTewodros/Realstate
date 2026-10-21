import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { parseBirrToMinor } from "@platform/shared";
import { publicGet } from "@/lib/server-api";
import { ListingCard, type PublicUnit } from "@/components/ListingCard";
import { SearchForm } from "@/components/SearchForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("nav");
  return { title: t("listings") };
}

type Search = Record<string, string | undefined>;

export default async function ListingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const t = await getTranslations("public");
  const c = await getTranslations("common");
  const page = Math.max(1, Number(sp.page) || 1);
  const params = new URLSearchParams();
  if (sp.purpose) params.set("purpose", sp.purpose);
  if (sp.type) params.set("type", sp.type);
  if (sp.area) params.set("area", sp.area);
  const min = sp.min ? parseBirrToMinor(sp.min) : null;
  const max = sp.max ? parseBirrToMinor(sp.max) : null;
  if (min !== null) params.set("minPriceMinor", String(min));
  if (max !== null) params.set("maxPriceMinor", String(max));
  if (sp.bedrooms) params.set("bedrooms", sp.bedrooms);
  if (sp.sort) params.set("sort", sp.sort);
  params.set("page", String(page));
  const result = await publicGet<{ items: PublicUnit[]; total: number; pageSize: number }>(`/public/units?${params}`, 30).catch(() => null);
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const link = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as Array<[string, string]>);
    q.set("page", String(p));
    return `/listings?${q}`;
  };
  return (
    <div className="stack" style={{ gap: 20 }}>
      <h1>{t("searchTitle")}</h1>
      <SearchForm values={sp} />
      <form action="/listings" method="get" className="row">
        {Object.entries(sp)
          .filter(([k, v]) => v && k !== "sort" && k !== "page")
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
        <label htmlFor="sort">{t("sort")}</label>
        <select id="sort" name="sort" defaultValue={sp.sort ?? "newest"} style={{ width: "auto" }}>
          <option value="newest">{t("sortNewest")}</option>
          <option value="price_asc">{t("sortPriceAsc")}</option>
          <option value="price_desc">{t("sortPriceDesc")}</option>
        </select>
        <button type="submit" className="btn secondary small">
          {c("filter")}
        </button>
      </form>
      {!result ? (
        <div className="alert error">{c("error")}</div>
      ) : result.items.length === 0 ? (
        <div className="card">{t("noResults")}</div>
      ) : (
        <>
          <p className="muted">{t("results", { count: result.total })}</p>
          <div className="grid cols-3">
            {result.items.map((u, i) => (
              <ListingCard key={u.id} unit={u} priority={i < 2} />
            ))}
          </div>
          <nav className="spread" aria-label="Pagination">
            {page > 1 ? <Link href={link(page - 1)}>{c("previous")}</Link> : <span />}
            <span className="muted small">{c("page", { page, pages })}</span>
            {page < pages ? <Link href={link(page + 1)}>{c("next")}</Link> : <span />}
          </nav>
        </>
      )}
    </div>
  );
}
