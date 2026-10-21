import { expect, test } from "@playwright/test";
import { USERS, errorAlerts, expectNoHorizontalScroll, signIn, watchErrors } from "./helpers";

const SCREENS: Array<{ role: keyof typeof USERS; home: string; paths: string[] }> = [
  {
    role: "owner",
    home: "/desk/dashboard",
    paths: ["/desk/dashboard", "/desk", "/desk/members", "/desk/classes", "/desk/plans", "/desk/trainers", "/desk/campaigns", "/desk/users", "/desk/messages", "/desk/settings", "/account"],
  },
  { role: "manager", home: "/desk/dashboard", paths: ["/desk/dashboard", "/desk", "/desk/members", "/desk/classes", "/desk/plans", "/desk/campaigns"] },
  { role: "desk", home: "/desk", paths: ["/desk", "/desk/members", "/desk/classes", "/account"] },
  { role: "trainer", home: "/desk/trainer", paths: ["/desk/trainer", "/desk/classes"] },
  { role: "member", home: "/me", paths: ["/me", "/account"] },
];

for (const { role, home, paths } of SCREENS) {
  test(`${role}: lands on ${home} and every screen opens on a phone`, async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS[role]);
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("h1").first(), path).toBeVisible();
      await expect(errorAlerts(page), `${path} shows an error`).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    }
    errors.check();
  });
}

test("members and staff cannot open each other's areas", async ({ page }) => {
  await signIn(page, USERS.member);
  await page.goto("/desk/members");
  await expect(page).toHaveURL(/\/me$/);
  expect((await page.request.get("/api/members")).status()).toBe(403);
  await page.context().clearCookies();
  await signIn(page, USERS.desk);
  await page.goto("/me");
  await expect(page).toHaveURL(/\/desk$/);
  expect((await page.request.get("/api/dashboard/summary")).status()).toBe(403);
});
