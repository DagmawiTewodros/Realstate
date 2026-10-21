import { expect, test } from "@playwright/test";
import { USERS, errorAlerts, signIn, watchErrors } from "./helpers";

const run = Date.now().toString(36);
const phone = `09${String(Date.now()).slice(-8)}`;

test.describe.serial("front desk: new member to first visit", () => {
  let memberUrl = "";
  const name = `Member ${run}`;
  const email = `m.${run}@example.com`;

  test.beforeEach(async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
  });

  test("the desk registers a member and sells a monthly membership", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS.desk);
    await page.goto("/desk/members");
    await page.getByRole("button", { name: "New member" }).click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Phone", { exact: true }).fill(phone);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/desk\/members\/[0-9a-f-]{36}$/);
    memberUrl = new URL(page.url()).pathname;
    await expect(page.getByText("No membership").first()).toBeVisible();

    // Not allowed in yet.
    await page.goto("/desk");
    await page.getByLabel("Name or phone").fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "DENIED");
    await expect(page.getByText("No membership")).toBeVisible();

    await page.goto(memberUrl);
    await page.getByRole("button", { name: "Sell membership" }).click();
    const monthly = await page.getByLabel("Plan").locator("option", { hasText: "Monthly" }).first().getAttribute("value");
    await page.getByLabel("Plan").selectOption(monthly!);
    await expect(page.getByLabel("Amount paid (birr)")).toHaveValue("1500");
    await page.getByLabel("Method").selectOption("TELEBIRR");
    await page.getByRole("button", { name: "Save and print receipt" }).click();
    await expect(page.getByText(/Membership saved\. Receipt G-\d{4}-\d{6}\./)).toBeVisible();
    await expect(page.getByText("Active").first()).toBeVisible();

    const receipt = page.getByRole("link", { name: /^G-\d{4}-\d{6}$/ }).first();
    const res = await page.request.get((await receipt.getAttribute("href"))!);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    await expect(errorAlerts(page)).toHaveCount(0);
    errors.check();
  });

  test("the member checks in, and a second scan is a repeat", async ({ page }) => {
    await signIn(page, USERS.desk);
    await page.goto("/desk");
    await page.getByLabel("Name or phone").fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "ALLOWED");
    await expect(page.getByText("Welcome in")).toBeVisible();
    await page.getByLabel("Name or phone").fill(name);
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", "DUPLICATE");
    await expect(page.getByRole("link", { name })).toBeVisible();
  });

  test("an unknown QR code is denied", async ({ page }) => {
    await signIn(page, USERS.desk);
    await page.goto("/desk");
    await page.getByLabel("QR code").fill("not-a-real-code-1234567890");
    await page.getByLabel("QR code").press("Enter");
    await expect(page.getByText("Unknown or old QR code")).toBeVisible();
  });

  test("a manager freezes a membership, and the member is then turned away", async ({ page }) => {
    await signIn(page, USERS.manager);
    // A separate member, so the 5-minute repeat-scan window from the test above does not apply.
    const other = `Freeze ${run}`;
    const created = await (await page.request.post("/api/members", { data: { name: other, phone: `09${String(Date.now() + 5).slice(-8)}` } })).json();
    const plans = await (await page.request.get("/api/plans")).json();
    const monthly = plans.items.find((p: { name: string }) => p.name === "Monthly");
    const sold = await page.request.post(`/api/members/${created.member.id}/memberships`, { data: { planId: monthly.id, payment: { amountMinor: monthly.priceMinor, method: "CASH" } } });
    expect(sold.status()).toBe(201);

    await page.goto(`/desk/members/${created.member.id}`);
    await page.getByRole("button", { name: "Freeze", exact: true }).click();
    const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const inAWeek = new Date(Date.now() + 3 * 3600_000 + 7 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("From").fill(today);
    await page.getByLabel("To", { exact: true }).fill(inAWeek);
    await page.getByLabel("Reason").fill("Travelling");
    await page.locator("form").getByRole("button", { name: "Freeze" }).click();
    await expect(page.getByText("Membership frozen.")).toBeVisible();
    await expect(page.getByText("Frozen until")).toBeVisible();

    await page.goto("/desk");
    await page.getByLabel("Name or phone").fill(other);
    await page.getByRole("button", { name: new RegExp(other) }).click();
    await expect(page.getByText("Membership is frozen")).toBeVisible();
    // A manager can let them in with a reason; it is recorded as an override.
    await page.getByLabel("Reason").fill("Freeze entered by mistake");
    await page.getByRole("button", { name: "Let in" }).click();
    await expect(page.getByText("Let in by a manager")).toBeVisible();

    await page.goto(`/desk/members/${created.member.id}`);
    await page.getByRole("button", { name: "End freeze now" }).click();
    await expect(page.getByText("Freeze ended.", { exact: false })).toBeVisible();
  });

  test("the member is invited to the app, sets a password and sees their QR code", async ({ page, browser }) => {
    await signIn(page, USERS.desk);
    await page.goto(memberUrl);
    await page.getByRole("button", { name: "Invite to the member app" }).click();
    const link = (await page.locator("code").first().textContent())!.trim();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);

    const memberContext = await browser.newContext({ baseURL: "http://localhost:3001", viewport: { width: 360, height: 760 } });
    const member = await memberContext.newPage();
    await memberContext.addCookies([{ name: "locale", value: "en", url: "http://localhost:3001" }]);
    await member.goto(new URL(link).pathname);
    await member.getByLabel("New password").fill("member-password-123");
    await member.getByRole("button", { name: "Open my account" }).click();
    await member.waitForURL(/\/me$/);
    await memberContext.addCookies([{ name: "locale", value: "en", url: "http://localhost:3001" }]);
    await member.reload();
    await expect(member.getByRole("heading", { name: `Hello, ${name}` })).toBeVisible();
    const qr = await member.request.get("/api/me/qr.svg");
    expect(qr.status()).toBe(200);
    expect(qr.headers()["content-type"]).toContain("image/svg+xml");

    // The QR token from the app checks the member in at the desk.
    const token = (await (await member.request.get("/api/me/qr")).json()).token as string;
    await page.goto("/desk");
    await page.getByLabel("QR code").fill(token);
    await page.getByLabel("QR code").press("Enter");
    await expect(page.locator("[data-result]")).toHaveAttribute("data-result", /ALLOWED|DUPLICATE/);
    await memberContext.close();
  });
});

test("a member books a class in the app and can cancel it", async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, USERS.member);
  const book = page.getByRole("button", { name: "Book", exact: true }).first();
  await expect(book).toBeVisible();
  await book.click();
  await expect(page.getByText("Booked.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "My bookings" })).toBeVisible();
  const myBooking = page.locator("section").filter({ hasText: "My bookings" }).locator("li").first();
  await expect(myBooking).toContainText("Booked");
  // Cancel again so the test can be run any number of times against the same data.
  await myBooking.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Booking cancelled.")).toBeVisible();
  errors.check();
});
