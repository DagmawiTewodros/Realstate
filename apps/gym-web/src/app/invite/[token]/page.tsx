import { getTranslations } from "next-intl/server";
import { AcceptInvitation } from "@/components/AcceptInvitation";
import { LanguageSwitch } from "@/components/LanguageSwitch";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  return (
    <main>
      <div className="container" style={{ maxWidth: 480 }}>
        <div className="spread" style={{ marginBottom: 16, justifyContent: "flex-end" }}>
          <LanguageSwitch />
        </div>
        <section className="card stack">
          <h1>{t("inviteTitle")}</h1>
          <p>{t("inviteIntro")}</p>
          <AcceptInvitation token={token} />
        </section>
      </div>
    </main>
  );
}
