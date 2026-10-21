import { expect, test } from "@playwright/test";
import { USERS, signIn, watchErrors } from "./helpers";

test("importing customers: check first, then import only valid rows", async ({ page }) => {
  page.on("dialog", (d) => void d.accept());
  const errors = watchErrors(page);
  const run = Date.now().toString().slice(-7);
  const csv = ["Full Name,Mobile,E-mail", `Import One ${run},0912${run.slice(-6)},`, `Import Two ${run},,two.${run}@example.com`, `No Contact ${run},,`].join("\n");
  await signIn(page, USERS.salesManager);
  await page.goto("/staff/imports");
  await page.getByLabel("What are you importing?").selectOption("customers");
  await page.getByLabel("File").setInputFiles({ name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Read file" }).click();
  await expect(page.getByText("3 rows found.")).toBeVisible();
  // Column names were matched automatically.
  await expect(page.getByLabel("Name *")).toHaveValue("Full Name");
  await expect(page.getByLabel("Phone")).toHaveValue("Mobile");

  await page.getByRole("button", { name: "Check (nothing is saved)" }).click();
  await expect(page.getByRole("heading", { name: "3. Check result" })).toBeVisible();
  await expect(page.locator(".stat").filter({ hasText: "New" })).toContainText("2");
  await expect(page.locator(".stat").filter({ hasText: "Errors" })).toContainText("1");

  await page.getByRole("button", { name: "Import 2 rows" }).click();
  await expect(page.getByRole("heading", { name: "Import finished" })).toBeVisible();

  await page.goto("/staff/customers");
  await page.getByLabel("Search").fill(`Import One ${run}`);
  await expect(page.getByRole("link", { name: `Import One ${run}` })).toBeVisible();
  errors.check();
});
