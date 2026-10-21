import { eq } from "drizzle-orm";
import { leases, payments, rentCharges, units } from "../src/db/schema";
import { createTestApp, type Agent, type TestApp } from "./harness";
import { jpeg, makeProject, makeUnit } from "./fixtures";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

interface Ctx {
  pm: Agent;
  unitId: string;
  tenantId: string;
  landlordId: string;
}

async function setup(publish = true): Promise<Ctx> {
  const { agent: pm } = await t.as("PROPERTY_MANAGER");
  const { agent: sm } = await t.as("SALES_MANAGER");
  const project = await makeProject(sm);
  const landlord = await pm.post("/landlords").send({ name: "Owner One", email: "owner1@example.com" }).expect(201);
  const unit = await makeUnit(sm, project.id, { purpose: "RENT", priceMinor: 3_000_000, landlordId: landlord.body.landlord.id });
  if (publish) await sm.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
  const tenant = await sm.post("/customers").send({ name: "Tenant T", phone: "0915000001", email: "tenant@example.com" }).expect(201);
  return { pm, unitId: unit.id, tenantId: tenant.body.customer.id, landlordId: landlord.body.landlord.id };
}

async function activeLease(c: Ctx, overrides: Record<string, unknown> = {}) {
  const res = await c.pm
    .post("/leases")
    .send({ unitId: c.unitId, tenantId: c.tenantId, startDate: "2026-11-01", endDate: "2027-10-31", rentMinor: 3_000_000, depositMinor: 6_000_000, ...overrides })
    .expect(201);
  await c.pm.post(`/leases/${res.body.lease.id}/activate`).expect(200);
  return res.body.lease.id as string;
}

describe("Task 14: leases", () => {
  it("activating marks the unit LEASED and unpublishes it; ending makes it AVAILABLE and republishes it", async () => {
    const c = await setup();
    const leaseId = await activeLease(c);
    let [u] = await t.db.select().from(units).where(eq(units.id, c.unitId));
    expect(u).toMatchObject({ status: "LEASED", isPublished: false });
    await c.pm.post(`/leases/${leaseId}/end`).expect(200);
    [u] = await t.db.select().from(units).where(eq(units.id, c.unitId));
    expect(u).toMatchObject({ status: "AVAILABLE", isPublished: true });
  });

  it("rejects overlapping active leases, including concurrent activations", async () => {
    const c = await setup();
    await activeLease(c);
    const overlap = await c.pm.post("/leases").send({ unitId: c.unitId, tenantId: c.tenantId, startDate: "2027-06-01", endDate: "2028-05-31", rentMinor: 100 }).expect(201);
    const res = await c.pm.post(`/leases/${overlap.body.lease.id}/activate`).expect(409);
    expect(res.body.code).toBe("OVERLAP");

    const c2 = await setup(false);
    const a = await c2.pm.post("/leases").send({ unitId: c2.unitId, tenantId: c2.tenantId, startDate: "2026-11-01", endDate: "2027-04-30", rentMinor: 100 }).expect(201);
    const b = await c2.pm.post("/leases").send({ unitId: c2.unitId, tenantId: c2.tenantId, startDate: "2027-01-01", endDate: "2027-06-30", rentMinor: 100 }).expect(201);
    const results = await Promise.all([c2.pm.post(`/leases/${a.body.lease.id}/activate`), c2.pm.post(`/leases/${b.body.lease.id}/activate`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const active = await t.db.select().from(leases).where(eq(leases.unitId, c2.unitId));
    expect(active.filter((l) => l.status === "ACTIVE")).toHaveLength(1);
  });

  it("the database itself refuses overlapping active leases", async () => {
    const c = await setup();
    await activeLease(c);
    await expect(
      t.db.insert(leases).values({ unitId: c.unitId, tenantId: c.tenantId, startDate: "2027-01-01", endDate: "2027-12-31", rentMinor: 1, status: "ACTIVE" }),
    ).rejects.toThrow();
  });

  it("renewal creates a draft from the day after the old lease ends and leaves the old lease unchanged", async () => {
    const c = await setup();
    const leaseId = await activeLease(c);
    const renewal = await c.pm.post(`/leases/${leaseId}/renew`).send({ endDate: "2028-10-31", rentMinor: 3_300_000 }).expect(201);
    expect(renewal.body.lease).toMatchObject({ status: "DRAFT", startDate: "2027-11-01", endDate: "2028-10-31", rentMinor: 3_300_000, previousLeaseId: leaseId });
    const [old] = await t.db.select().from(leases).where(eq(leases.id, leaseId));
    expect(old).toMatchObject({ status: "ACTIVE", endDate: "2027-10-31", rentMinor: 3_000_000 });
  });

  it("lists exactly the leases ending within the window", async () => {
    const c = await setup();
    await activeLease(c, { startDate: "2026-01-01", endDate: "2026-12-15" });
    const res = await c.pm.get("/leases/expiring?days=60").expect(200);
    expect(res.body.items).toHaveLength(1);
    const none = await c.pm.get("/leases/expiring?days=30").expect(200);
    expect(none.body.items).toHaveLength(0);
  });

  it("closes lease endpoints to brokers", async () => {
    const { agent } = await t.as("BROKER");
    await agent.get("/leases").expect(403);
    await agent.post("/leases").send({}).expect(403);
    await agent.get("/landlords").expect(403);
  });
});

describe("Task 15: rent schedule and payments", () => {
  it("generates 12 monthly charges across the year boundary", async () => {
    const c = await setup();
    const leaseId = await activeLease(c);
    const charges = await t.db.select().from(rentCharges).where(eq(rentCharges.leaseId, leaseId));
    expect(charges).toHaveLength(12);
    expect(charges.map((ch) => ch.dueDate).sort()).toEqual([
      "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01",
      "2027-05-01", "2027-06-01", "2027-07-01", "2027-08-01", "2027-09-01", "2027-10-01",
    ]);
  });

  it("paying 1.5 months marks one charge paid and one partial; overpayment becomes credit", async () => {
    const c = await setup();
    const leaseId = await activeLease(c);
    const p = await c.pm.post(`/leases/${leaseId}/payments`).field("amountMinor", "4500000").field("method", "BANK_TRANSFER").field("paidAt", "2026-11-01").expect(201);
    expect(p.body.payment.receiptNumber).toBe("R-2026-000001");
    const ledger = await c.pm.get(`/leases/${leaseId}/ledger`).expect(200);
    const statuses = ledger.body.charges.map((ch: { status: string }) => ch.status);
    expect(statuses.slice(0, 3)).toEqual(["PAID", "PARTIAL", "DUE"]);
    // Nothing is due yet on 22 Oct, so the tenant is 4.5 M ahead; once November is due they are 1.5 M ahead.
    expect(ledger.body.balanceMinor).toBe(-4_500_000);
    expect(ledger.body.upcomingCharges).toHaveLength(12);
    t.clock.set(new Date("2026-11-15T06:00:00Z"));
    // Sessions last 7 days, so sign in again after moving the clock forward.
    const { agent: pmLater } = await t.as("PROPERTY_MANAGER");
    const mid = await pmLater.get(`/leases/${leaseId}/ledger`).expect(200);
    expect(mid.body.balanceMinor).toBe(-1_500_000);
    expect(mid.body.totalContractMinor).toBe(36_000_000);

    await pmLater.post(`/leases/${leaseId}/payments`).field("amountMinor", String(3_000_000 * 11)).field("method", "CASH").field("paidAt", "2026-11-02").expect(201);
    const after = await pmLater.get(`/leases/${leaseId}/ledger`).expect(200);
    expect(after.body.creditMinor).toBe(1_500_000);
    expect(after.body.charges.every((ch: { status: string }) => ch.status === "PAID")).toBe(true);
  });

  it("applies credit to the next lease's charges on renewal", async () => {
    const c = await setup();
    const leaseId = await activeLease(c, { startDate: "2026-11-01", endDate: "2026-12-31" });
    await c.pm.post(`/leases/${leaseId}/payments`).field("amountMinor", "7000000").field("method", "CASH").field("paidAt", "2026-11-01").expect(201);
    const renewal = await c.pm.post(`/leases/${leaseId}/renew`).send({ endDate: "2027-02-28" }).expect(201);
    await c.pm.post(`/leases/${leaseId}/end`).expect(200);
    await c.pm.post(`/leases/${renewal.body.lease.id}/activate`).expect(200);
    const ledger = await c.pm.get(`/leases/${renewal.body.lease.id}/ledger`).expect(200);
    expect(ledger.body.charges[0]).toMatchObject({ dueDate: "2027-01-01", paidMinor: 1_000_000, status: "PARTIAL" });
    expect(ledger.body.creditMinor).toBe(0);
  });

  it("voiding restores balances exactly and writes an audit entry; payments are never deleted", async () => {
    const c = await setup();
    const leaseId = await activeLease(c);
    const p = await c.pm.post(`/leases/${leaseId}/payments`).field("amountMinor", "4500000").field("method", "CASH").field("paidAt", "2026-11-01").expect(201);
    await c.pm.post(`/payments/${p.body.payment.id}/void`).send({ reason: "Wrong lease" }).expect(200);
    const ledger = await c.pm.get(`/leases/${leaseId}/ledger`).expect(200);
    expect(ledger.body.charges.every((ch: { paidMinor: number; status: string }) => ch.paidMinor === 0 && ch.status === "DUE")).toBe(true);
    expect(ledger.body.balanceMinor).toBe(0);
    expect(ledger.body.creditMinor).toBe(0);
    const [row] = await t.db.select().from(payments).where(eq(payments.id, p.body.payment.id));
    expect(row).toMatchObject({ status: "VOIDED", voidReason: "Wrong lease" });
    await c.pm.post(`/payments/${p.body.payment.id}/void`).send({ reason: "Again please" }).expect(409);
  });

  it("issues unique, sequential receipt numbers under concurrent payments", async () => {
    const c = await setup();
    const leaseId = await activeLease(c);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => c.pm.post(`/leases/${leaseId}/payments`).field("amountMinor", "1000").field("method", "CASH").field("paidAt", "2026-11-02").field("reference", `r${i}`)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.payment.receiptNumber).sort();
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `R-2026-${String(i + 1).padStart(6, "0")}`));
  });

  it("produces a receipt PDF and lists arrears", async () => {
    const c = await setup();
    const leaseId = await activeLease(c, { startDate: "2026-09-01", endDate: "2027-08-31" });
    const p = await c.pm.post(`/leases/${leaseId}/payments`).field("amountMinor", "3000000").field("method", "TELEBIRR").field("paidAt", "2026-09-03").attach("slip", await jpeg(), "slip.jpg").expect(201);
    const pdf = await c.pm.get(`/payments/${p.body.payment.id}/receipt.pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (d: Buffer) => chunks.push(d));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    await c.pm.get(`/payments/${p.body.payment.id}/slip`).expect(200);
    const arrears = await c.pm.get("/arrears").expect(200);
    expect(arrears.body.items).toEqual([expect.objectContaining({ leaseId, dueMinor: 3_000_000, daysOverdue: 21 })]);
  });

  it("marks overdue charges idempotently", async () => {
    const c = await setup();
    await activeLease(c, { startDate: "2026-09-01", endDate: "2027-08-31" });
    const scheduler = t.app.get((await import("../src/rentals/rent.service")).RentService);
    const first = await scheduler.markOverdue();
    const second = await scheduler.markOverdue();
    expect(first).toBe(0); // already OVERDUE when generated, since due dates were in the past
    expect(second).toBe(0);
    const overdue = await t.db.select().from(rentCharges).where(eq(rentCharges.status, "OVERDUE"));
    expect(overdue.map((o) => o.dueDate).sort()).toEqual(["2026-09-01", "2026-10-01"]);
    t.clock.set(new Date("2026-11-02T06:00:00Z"));
    expect(await scheduler.markOverdue()).toBe(1);
    expect(await scheduler.markOverdue()).toBe(0);
  });
});

describe("Task 16: maintenance", () => {
  it("enforces status moves, requires a cost to finish, and totals cost per unit", async () => {
    const c = await setup();
    const r = await c.pm.post("/maintenance").send({ unitId: c.unitId, title: "Leaking tap", priority: "URGENT" }).expect(201);
    const id = r.body.request.id;
    for (const status of ["IN_PROGRESS", "DONE"]) {
      const res = await c.pm.patch(`/maintenance/${id}/status`).send({ status, costMinor: 0 }).expect(409);
      expect(res.body.code).toBe("ILLEGAL_MOVE");
    }
    await c.pm.post(`/maintenance/${id}/assign`).send({ assignedToName: "Plumber Tesfaye", assignedToPhone: "0911223344" }).expect(201);
    await c.pm.patch(`/maintenance/${id}/status`).send({ status: "IN_PROGRESS" }).expect(200);
    await c.pm.patch(`/maintenance/${id}/status`).send({ status: "DONE" }).expect(400);
    await c.pm.patch(`/maintenance/${id}/status`).send({ status: "DONE", costMinor: 0 }).expect(200);
    await c.pm.patch(`/maintenance/${id}/status`).send({ status: "NEW" }).expect(409);

    const r2 = await c.pm.post("/maintenance").send({ unitId: c.unitId, title: "Broken window" }).expect(201);
    await c.pm.post(`/maintenance/${r2.body.request.id}/assign`).send({ assignedToName: "Glazier" }).expect(201);
    await c.pm.patch(`/maintenance/${r2.body.request.id}/status`).send({ status: "IN_PROGRESS" }).expect(200);
    await c.pm.patch(`/maintenance/${r2.body.request.id}/status`).send({ status: "DONE", costMinor: 250_000 }).expect(200);
    const cost = await c.pm.get(`/units/${c.unitId}/maintenance-cost?from=2026-10-01&to=2026-10-31`).expect(200);
    expect(cost.body).toMatchObject({ costMinor: 250_000, requests: 2 });
    const none = await c.pm.get(`/units/${c.unitId}/maintenance-cost?from=2026-09-01&to=2026-09-30`).expect(200);
    expect(none.body.costMinor).toBe(0);
  });

  it("supports comments and photos and is closed to brokers", async () => {
    const c = await setup();
    const r = await c.pm.post("/maintenance").send({ unitId: c.unitId, title: "Door lock" }).expect(201);
    await c.pm.post(`/maintenance/${r.body.request.id}/comments`).send({ text: "Tenant home after 5pm" }).expect(201);
    await c.pm.post(`/maintenance/${r.body.request.id}/photos`).attach("file", await jpeg(), "door.jpg").expect(201);
    const detail = await c.pm.get(`/maintenance/${r.body.request.id}`).expect(200);
    expect(detail.body.comments).toHaveLength(1);
    expect(detail.body.photos).toHaveLength(1);
    const { agent } = await t.as("BROKER");
    await agent.get("/maintenance").expect(403);
    await agent.get(`/maintenance/${r.body.request.id}`).expect(403);
  });
});
