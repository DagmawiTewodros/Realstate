import { expect, test } from "@playwright/test";
import { USERS, errorAlerts, signIn, watchErrors } from "./helpers";

const run = Date.now().toString(36);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test.describe.serial("rentals: lease, rent, receipt, repair, portals", () => {
  const unitCode = `R-${run}`;
  let leaseUrl = "";

  test.beforeEach(async ({ page }) => {
    // Confirmation dialogs (activate, end) are accepted.
    page.on("dialog", (d) => void d.accept());
  });

  test("a property manager creates a unit for the demo landlord and leases it", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS.propertyManager);
    await page.goto("/staff/units/new");
    await page.getByLabel("Project").selectOption({ label: "Garden View · CMC" });
    await page.getByLabel("Unit code").fill(unitCode);
    await page.getByLabel("Type").selectOption("SHOP");
    await page.getByLabel("For", { exact: true }).selectOption("RENT");
    await page.getByLabel("Price (birr)").fill("12000");
    await page.getByLabel("Landlord").selectOption({ label: "Demo Owner" });
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/\/staff\/units\/[0-9a-f-]{36}$/);

    await page.goto("/staff/leases/new");
    await page.getByLabel("Unit").fill(unitCode);
    await page.getByRole("button", { name: new RegExp(unitCode) }).click();
    await page.getByLabel("Tenant").fill("Demo Tenant");
    await page.getByRole("button", { name: /Demo Tenant/ }).first().click();
    await page.getByLabel("Start date").fill(day(-40));
    await page.getByLabel("End date").fill(day(320));
    await page.getByLabel("Rent per period (birr)").fill("12000");
    await page.getByLabel("Deposit (birr)").fill("24000");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/staff\/leases\/[0-9a-f-]{36}$/);
    leaseUrl = new URL(page.url()).pathname;
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("The lease is active and the rent schedule was created.")).toBeVisible();
    // Two monthly charges are already due (40 days in), so 24,000 birr is owed.
    await expect(page.locator(".stat").filter({ hasText: "Balance owed" })).toContainText("24,000.00");
    await expect(errorAlerts(page)).toHaveCount(0);
    errors.check();
  });

  test("the overdue rent shows in arrears", async ({ page }) => {
    await signIn(page, USERS.propertyManager);
    await page.goto("/staff/arrears");
    await expect(page.getByRole("cell", { name: unitCode })).toBeVisible();
  });

  test("recording a payment issues a receipt and lowers the balance", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS.propertyManager);
    await page.goto(leaseUrl);
    await page.getByLabel("Amount (birr)").fill("18000");
    await page.getByLabel("Method").selectOption("TELEBIRR");
    await page.getByLabel("Reference").fill(`TB${run}`);
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page.getByText(/Payment saved\. Receipt /)).toBeVisible();
    await expect(page.locator(".stat").filter({ hasText: "Balance owed" })).toContainText("6,000.00");

    const receipt = page.getByRole("link", { name: "Receipt" }).first();
    const href = await receipt.getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    errors.check();
  });

  test("voiding the payment restores the balance", async ({ page }) => {
    await signIn(page, USERS.propertyManager);
    await page.goto(leaseUrl);
    await page.getByRole("button", { name: "Void" }).first().click();
    await page.getByLabel("Reason").fill("Entered twice");
    await page.getByRole("button", { name: "Void payment" }).click();
    await expect(page.getByText("The payment was voided.")).toBeVisible();
    await expect(page.locator(".stat").filter({ hasText: "Balance owed" })).toContainText("24,000.00");
    // Pay again so the portals have a valid receipt.
    await page.getByLabel("Amount (birr)").fill("12000");
    await page.getByRole("button", { name: "Save payment" }).click();
    await expect(page.locator(".stat").filter({ hasText: "Balance owed" })).toContainText("12,000.00");
  });

  test("the tenant sees the lease and receipt and reports a repair", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS.tenant);
    await expect(page).toHaveURL(/\/portal\/tenant$/);
    await expect(page.getByRole("heading", { name: `Lease for ${unitCode}` })).toBeVisible();
    await page.getByRole("button", { name: "Report a repair" }).click();
    await page.getByLabel("What needs fixing?").fill(`Door lock ${run}`);
    await page.getByLabel("How urgent?").selectOption("URGENT");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Thank you. The property manager has been told.")).toBeVisible();
    await expect(page.getByText(`Door lock ${run}`)).toBeVisible();
    errors.check();
  });

  test("the property manager fixes the repair and records the cost", async ({ page }) => {
    await signIn(page, USERS.propertyManager);
    await page.goto("/staff/maintenance");
    await page.getByRole("link", { name: `Door lock ${run}` }).click();
    await page.getByLabel("Technician name").fill("Tesfaye");
    await page.getByLabel("Technician phone").fill("0911223344");
    await page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(page.getByText("Technician assigned.")).toBeVisible();
    await page.getByLabel("Change status to").selectOption("IN_PROGRESS");
    await page.getByRole("button", { name: "Save" }).last().click();
    await expect(page.getByText("Status changed.")).toBeVisible();
    await page.getByLabel("Change status to").selectOption("DONE");
    await page.getByLabel("Cost (birr)").fill("850");
    await page.getByRole("button", { name: "Save" }).last().click();
    await expect(page.getByText("paid by the landlord")).toBeVisible();
  });

  test("the landlord sees the unit, tenant and repair", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, USERS.landlord);
    await expect(page).toHaveURL(/\/portal\/landlord$/);
    await expect(page.getByText(unitCode).first()).toBeVisible();
    await expect(page.getByText(`Door lock ${run}`)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Monthly statements" })).toBeVisible();
    errors.check();
  });

  test("portal users cannot open staff screens or each other's portal", async ({ page }) => {
    await signIn(page, USERS.tenant);
    await page.goto("/staff/leases");
    await expect(page).toHaveURL(/\/portal\/tenant$/);
    await page.goto("/portal/landlord");
    await expect(page).toHaveURL(/\/portal\/tenant$/);
    const res = await page.request.get("/api/leases");
    expect(res.status()).toBe(403);
  });
});
