import { expect, type Page } from "@playwright/test";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
export const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";

export const USERS = {
  owner: "owner@example.com",
  salesManager: "sales.manager@example.com",
  broker: "broker@example.com",
  propertyManager: "property.manager@example.com",
  landlord: "landlord@example.com",
  tenant: "tenant@example.com",
} as const;

/** Starts each test in English so assertions can use English text. */
export async function useEnglish(page: Page) {
  await page.context().addCookies([{ name: "locale", value: "en", url: BASE_URL }]);
}

export async function signIn(page: Page, email: string) {
  await useEnglish(page);
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Signing in applies the account's language; switch back to English for the assertions.
  await useEnglish(page);
}

/** Error messages shown by the app (Next's empty route announcer also has role=alert, so match the class). */
export const errorAlerts = (page: Page) => page.locator(".alert.error");

/** Fails the test on uncaught page errors and on failed API calls other than expected ones. */
export function watchErrors(page: Page, allow: RegExp[] = []) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("/api/") && res.status() >= 500 && !allow.some((a) => a.test(url))) problems.push(`${res.status()} ${url}`);
  });
  return {
    check() {
      expect(problems, problems.join("\n")).toEqual([]);
    },
  };
}

/** The page must not scroll sideways at phone width. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page is wider than the screen").toBeLessThanOrEqual(1);
}
