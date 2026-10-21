import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { publicGet } from "@/lib/server-api";
import { ListingCard, type PublicUnit } from "@/components/ListingCard";
import { SearchForm } from "@/components/SearchForm";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const t = await getTranslations("public");
  const featured = await publicGet<{ items: PublicUnit[] }>("/public/featured", 60).catch(() => ({ items: [] }));
  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="stack">
        <h1>{t("heroTitle")}</h1>
        <p className="muted">{t("heroText")}</p>
        <SearchForm />
      </section>
      <section className="stack">
        <div className="spread">
          <h2>{t("featured")}</h2>
          <Link href="/listings">{t("viewAll")}</Link>
        </div>
        <div className="grid cols-3">
          {featured?.items.map((u, i) => <ListingCard key={u.id} unit={u} priority={i < 2} />)}
        </div>
      </section>
    </div>
  );
}
