"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setLocaleCookie } from "@/lib/session";

/** Switches between Amharic and English. For signed-in users the choice is also saved on their account. */
export function LanguageSwitch({ signedIn = false }: { signedIn?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const next = locale === "am" ? "en" : "am";

  async function change() {
    setLocaleCookie(next);
    if (signedIn) await api("/auth/me", { method: "PATCH", json: { locale: next } }).catch(() => undefined);
    router.refresh();
  }

  return (
    <button type="button" className="btn secondary small" onClick={() => void change()} aria-label={t("language")} lang={next}>
      {next === "am" ? t("amharic") : t("english")}
    </button>
  );
}
