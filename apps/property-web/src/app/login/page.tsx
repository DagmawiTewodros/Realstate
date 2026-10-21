import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/LoginForm";
import { LanguageSwitch } from "@/components/LanguageSwitch";

export const metadata = { robots: { index: false } };

export default async function LoginPage() {
  const t = await getTranslations("auth");
  const n = await getTranslations("nav");
  return (
    <main>
      <div className="container" style={{ maxWidth: 440 }}>
        <div className="spread" style={{ marginBottom: 16 }}>
          <Link href="/">{n("home")}</Link>
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
