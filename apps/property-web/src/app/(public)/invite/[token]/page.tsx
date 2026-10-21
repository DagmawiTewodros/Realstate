import { getTranslations } from "next-intl/server";
import { AcceptInvitation } from "@/components/AcceptInvitation";

export const metadata = { robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  return (
    <section className="card stack" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1>{t("inviteTitle")}</h1>
      <p>{t("inviteIntro")}</p>
      <AcceptInvitation token={token} />
    </section>
  );
}
