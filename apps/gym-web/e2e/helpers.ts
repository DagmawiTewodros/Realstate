import { expect, type Page } from "@playwright/test";

export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3001";
export const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-123";

export const USERS = {
  owner: "owner@gym.example",
  manager: "manager@gym.example",
  trainer: "trainer@gym.example",
  desk: "desk@gym.example",
  member: "member@gym.example",
} as const;

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
  await page.reload();
}

/** Error messages shown by the app (Next's empty route announcer also has role=alert, so match the class). */
export const errorAlerts = (page: Page) => page.locator(".alert.error");

export function watchErrors(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) problems.push(`${res.status()} ${res.url()}`);
  });
  return {
    check() {
      expect(problems, problems.join("\n")).toEqual([]);
    },
  };
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page is wider than the screen").toBeLessThanOrEqual(1);
}
