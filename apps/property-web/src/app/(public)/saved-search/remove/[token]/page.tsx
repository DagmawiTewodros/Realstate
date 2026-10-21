import { getTranslations } from "next-intl/server";
import { TokenAction } from "@/components/TokenAction";

export const metadata = { robots: { index: false } };

export default async function RemoveSavedSearchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("public");
  return (
    <section className="card stack">
      <h1>{t("removeSearchTitle")}</h1>
      <TokenAction
        endpoint={`/public/saved-searches/remove/${encodeURIComponent(token)}`}
        button={t("removeSearchButton")}
        done={t("removeSearchDone")}
        invalid={t("optoutInvalid")}
      />
    </section>
  );
}
