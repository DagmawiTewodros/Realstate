import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/LoginForm";
import { LanguageSwitch } from "@/components/LanguageSwitch";

export default async function LoginPage() {
  const t = await getTranslations("auth");
  const a = await getTranslations("app");
  return (
    <main>
      <div className="container" style={{ maxWidth: 440 }}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <strong>{a("name")}</strong>
          <LanguageSwitch />
        </div>
        <section className="card stack">
          <h1>{t("title")}</h1>
          <Suspense>
            <LoginForm />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
