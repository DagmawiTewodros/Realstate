import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALE_COOKIE = "locale";
export const DEFAULT_LOCALE = "am";

/** The language comes from a cookie (set by the language switch and on sign-in). Amharic is the default. */
export default getRequestConfig(async () => {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  const locale = value === "en" || value === "am" ? value : DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: "Africa/Addis_Ababa",
  };
});
