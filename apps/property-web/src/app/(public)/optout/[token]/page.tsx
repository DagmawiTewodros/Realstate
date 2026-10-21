import { getTranslations } from "next-intl/server";
import { TokenAction } from "@/components/TokenAction";

export const metadata = { robots: { index: false } };

export default async function OptOutPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("public");
  return (
    <section className="card stack">
      <h1>{t("optoutTitle")}</h1>
      <p>{t("optoutText")}</p>
      <TokenAction endpoint={`/optout/${encodeURIComponent(token)}`} button={t("optoutButton")} done={t("optoutDone")} invalid={t("optoutInvalid")} />
    </section>
  );
}
