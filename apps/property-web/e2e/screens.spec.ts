import { expect, test } from "@playwright/test";
import { USERS, errorAlerts, expectNoHorizontalScroll, signIn, watchErrors } from "./helpers";

/** Every screen opens for the roles that use it, without errors and without sideways scrolling at 360 px. */
const SCREENS: Array<{ role: keyof typeof USERS; paths: string[] }> = [
  {
    role: "owner",
    paths: [
      "/staff/dashboard",
      "/staff/pipeline",
      "/staff/leads",
      "/staff/leads/new",
      "/staff/customers",
      "/staff/units",
      "/staff/units/new",
      "/staff/projects",
      "/staff/leases",
      "/staff/leases/new",
      "/staff/landlords",
      "/staff/maintenance",
      "/staff/arrears",
      "/staff/imports",
      "/staff/users",
      "/staff/messages",
      "/staff/settings",
      "/staff/account",
    ],
  },
  { role: "broker", paths: ["/staff", "/staff/pipeline", "/staff/leads", "/staff/customers", "/staff/units"] },
  { role: "salesManager", paths: ["/staff", "/staff/dashboard", "/staff/leases", "/staff/landlords"] },
  { role: "propertyManager", paths: ["/staff/dashboard", "/staff/leases", "/staff/maintenance", "/staff/arrears", "/staff/customers"] },
  { role: "landlord", paths: ["/portal/landlord", "/portal/account"] },
  { role: "tenant", paths: ["/portal/tenant", "/portal/account"] },
];

for (const { role, paths } of SCREENS) {
  test(`${role}: screens open on a phone`, async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS[role]);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("h1").first(), path).toBeVisible();
      await expect(errorAlerts(page), `${path} shows an error`).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    }
    errors.check();
  });
}

test("detail pages open from their lists", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, USERS.owner);
  // Leases are covered by rentals.spec.ts, which creates its own.
  for (const list of ["/staff/leads", "/staff/customers", "/staff/units", "/staff/projects", "/staff/landlords"]) {
    await page.goto(list);
    const link = page.locator("table.datalist tbody a").first();
    await expect(link, `${list} has rows`).toBeVisible();
    await link.click();
    await page.waitForURL(new RegExp(`${list}/[0-9a-f-]{36}$`));
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(errorAlerts(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  }
  errors.check();
});
