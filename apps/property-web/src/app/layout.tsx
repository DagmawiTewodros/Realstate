import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "@fontsource/noto-sans-ethiopic/400.css";
import "@fontsource/noto-sans-ethiopic/700.css";
import "@fontsource/noto-sans/400.css";
import "@fontsource/noto-sans/700.css";
import "@platform/ui/src/styles.css";
import { publicGet, siteUrl } from "@/lib/server-api";
import type { SiteSettings } from "@platform/shared";

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as "am" | "en";
  const site = await publicGet<SiteSettings>("/public/settings").catch(() => null);
  const name = site?.companyName[locale] || site?.companyName.en || "Real estate";
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: name, template: `%s · ${name}` },
    description: locale === "am" ? "በአዲስ አበባ ለሽያጭና ለኪራይ ንብረቶች" : "Properties for sale and rent in Addis Ababa",
    openGraph: { siteName: name, type: "website" },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f6b55" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Addis_Ababa">
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
