import { expect, test, type Page } from "@playwright/test";
import { USERS, errorAlerts, signIn, watchErrors } from "./helpers";

/** A 1x1 JPEG, so the photo upload can be tested without a fixture file. */
const PIXEL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

const run = Date.now().toString(36);

async function signOut(page: Page) {
  await page.context().clearCookies();
}

test.describe.serial("sales: listing to signed lead", () => {
  const unitCode = `E2E-${run}`;
  const visitor = { name: `Visitor ${run}`, phone: `09${String(Date.now()).slice(-8)}` };
  let unitUrl = "";

  test("a sales manager adds a unit with a photo and puts it on the website", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS.salesManager);
    await page.goto("/staff/units/new");
    await page.getByLabel("Project").selectOption({ label: "Sunrise Residences · Bole" });
    await page.getByLabel("Unit code").fill(unitCode);
    await page.getByLabel("For", { exact: true }).selectOption("RENT");
    await page.getByLabel("Price (birr)").fill("25000");
    await page.getByLabel("Bedrooms").fill("2");
    await page.getByLabel("Description").fill("End-to-end test flat");
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/staff\/units\/[0-9a-f-]{36}$/);
    unitUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1 })).toContainText(unitCode);

    await page.getByLabel("Add photos").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: PIXEL_JPEG });
    await page.getByRole("button", { name: "Upload" }).first().click();
    await expect(page.getByText("Photos added.")).toBeVisible();
    await expect(page.getByText("Cover photo")).toBeVisible();

    await page.getByRole("button", { name: "Put on website" }).click();
    await expect(page.getByText("The unit is on the website.")).toBeVisible();
    await expect(errorAlerts(page)).toHaveCount(0);
    errors.check();
  });

  test("a visitor finds the unit on the website and asks about it", async ({ page }) => {
    const errors = watchErrors(page);
    await page.context().addCookies([{ name: "locale", value: "en", url: "http://localhost:3000" }]);
    const id = unitUrl.split("/").pop()!;
    await page.goto(`/listings/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sunrise Residences");
    await page.getByLabel("Your name").fill(visitor.name);
    await page.getByLabel("Phone number").fill(visitor.phone);
    await page.getByLabel("Telegram").check();
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thank you. We will contact you soon.")).toBeVisible();
    errors.check();
  });

  test("the manager assigns the new lead and the broker takes it to signed", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS.salesManager);
    await page.goto("/staff/leads");
    await page.getByLabel("Search").fill(visitor.name);
    await page.getByRole("link", { name: visitor.name }).click();
    await page.waitForURL(/\/staff\/leads\/[0-9a-f-]{36}$/);
    const leadUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Website")).toBeVisible();
    await page.getByLabel("Assign to").selectOption({ label: "Broker" });
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await signOut(page);
    await signIn(page, USERS.broker);
    await page.goto(leadUrl);
    // Log the first call with a next step.
    await page.getByLabel("Notes").fill("Called, wants to see it on Saturday");
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText("Called, wants to see it on Saturday")).toBeVisible();

    await page.getByRole("button", { name: "Move to Viewing" }).click();
    await expect(page.getByText("Moved to Viewing.")).toBeVisible();
    await page.getByLabel("Viewing date and time").fill("2030-01-05T10:00");
    await page.getByRole("button", { name: "Book viewing" }).click();
    await expect(page.getByText("Viewing booked.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Done", exact: true }).click();

    await page.getByRole("button", { name: "Move to Offer" }).click();
    await expect(page.getByText("Moved to Offer.")).toBeVisible();
    await page.getByRole("button", { name: "Move to Signed" }).click();
    await expect(page.getByText("Moved to Signed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark lost" })).toHaveCount(0);
    await expect(errorAlerts(page)).toHaveCount(0);
    errors.check();
  });

  test("a broker cannot skip a step or mark an available unit sold", async ({ page }) => {
    await signIn(page, USERS.broker);
    await page.goto(unitUrl);
    await expect(page.getByLabel("Change status to").locator("option")).toHaveText(["Reserved"]);
  });

  test("marking a lead lost needs a reason", async ({ page }) => {
    await signIn(page, USERS.broker);
    await page.goto("/staff/leads/new");
    await page.getByLabel("Name").fill(`Lost ${run}`);
    await page.getByLabel("Phone").fill(`09${String(Date.now() + 7).slice(-8)}`);
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/staff\/leads\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Mark lost" }).click();
    await page.getByRole("button", { name: "Confirm lost" }).click();
    // The form is not sent without a reason (the API also rejects it; see crm.test.ts).
    expect(await page.getByLabel("Reason lost").evaluate((el) => (el as HTMLTextAreaElement).validity.valueMissing)).toBe(true);
    await expect(page.getByText("Moved to Lost.")).toHaveCount(0);
    await page.getByLabel("Reason lost").fill("Bought elsewhere");
    await page.getByRole("button", { name: "Confirm lost" }).click();
    await expect(page.getByText("Moved to Lost.")).toBeVisible();
  });
});

test("the public website opens in Amharic by default", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "am");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Find your next home in Addis Ababa");
});
