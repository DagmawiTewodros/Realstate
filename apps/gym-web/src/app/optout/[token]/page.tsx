import { getTranslations } from "next-intl/server";
import { TokenAction } from "@/components/TokenAction";

export default async function OptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("optout");
  return (
    <main>
      <div className="container" style={{ maxWidth: 520 }}>
        <section className="card stack">
          <h1>{t("title")}</h1>
          <p>{t("text")}</p>
          <TokenAction endpoint={`/optout/${encodeURIComponent(token)}`} button={t("button")} done={t("done")} invalid={t("invalid")} />
        </section>
      </div>
    </main>
  );
}
