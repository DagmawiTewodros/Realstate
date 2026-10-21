import { and, eq } from "drizzle-orm";
import { auditLog, outboxEvents } from "@platform/nest-common";
import { maintenanceRequests } from "../src/db/schema";
import { createTestApp, type Agent, type TestApp } from "./harness";
import { makeProject, makeUnit } from "./fixtures";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const tokenFrom = (link: string) => link.split("/invite/")[1];

async function world() {
  const { agent: pm } = await t.as("PROPERTY_MANAGER");
  const { agent: sm } = await t.as("SALES_MANAGER");
  const project = await makeProject(sm);
  const landlord = (await pm.post("/landlords").send({ name: "Owner Almaz", email: "almaz@example.com" }).expect(201)).body.landlord;
  const other = (await pm.post("/landlords").send({ name: "Owner Other", email: "other@example.com" }).expect(201)).body.landlord;
  const unit = await makeUnit(sm, project.id, { code: "L-1", purpose: "RENT", landlordId: landlord.id });
  const unit2 = await makeUnit(sm, project.id, { code: "L-2", purpose: "RENT", landlordId: other.id });
  const tenantA = (await sm.post("/customers").send({ name: "Tenant A", phone: "0916000001", email: "a@example.com" }).expect(201)).body.customer;
  const tenantB = (await sm.post("/customers").send({ name: "Tenant B", phone: "0916000002", email: "b@example.com" }).expect(201)).body.customer;
  const lease = async (unitId: string, tenantId: string) => {
    const l = (await pm.post("/leases").send({ unitId, tenantId, startDate: "2026-09-01", endDate: "2027-08-31", rentMinor: 3_000_000 }).expect(201)).body.lease;
    await pm.post(`/leases/${l.id}/activate`).expect(200);
    return l.id as string;
  };
  const leaseA = await lease(unit.id, tenantA.id);
  const leaseB = await lease(unit2.id, tenantB.id);
  const pay = async (leaseId: string, amount: number, paidAt: string) =>
    (await pm.post(`/leases/${leaseId}/payments`).field("amountMinor", String(amount)).field("method", "CASH").field("paidAt", paidAt).expect(201)).body.payment;
  const payA1 = await pay(leaseA, 3_000_000, "2026-09-03");
  await pay(leaseA, 1_000_000, "2026-10-05");
  const payB = await pay(leaseB, 3_000_000, "2026-09-04");
  const repair = async (unitId: string, cost: number, paidByLandlord: boolean) => {
    const r = (await pm.post("/maintenance").send({ unitId, title: `Repair ${cost}` }).expect(201)).body.request;
    await pm.post(`/maintenance/${r.id}/assign`).send({ assignedToName: "Fixer" }).expect(201);
    await pm.patch(`/maintenance/${r.id}/status`).send({ status: "IN_PROGRESS" }).expect(200);
    await pm.patch(`/maintenance/${r.id}/status`).send({ status: "DONE", costMinor: cost, paidByLandlord }).expect(200);
  };
  await repair(unit.id, 250_000, true);
  await repair(unit.id, 99_000, false);
  await repair(unit2.id, 77_000, true);
  return { pm, landlord, other, unit, tenantA, tenantB, leaseA, leaseB, payA1, payB, pay };
}

async function accept(link: string, password = "portal-password-1"): Promise<Agent> {
  const agent = t.agent();
  await agent.post("/auth/accept-invitation").send({ token: tokenFrom(link), password }).expect(200);
  return agent;
}

describe("Task 17: owner statements", () => {
  it("matches hand-calculated October figures for the landlord", async () => {
    const w = await world();
    t.clock.set(new Date("2026-11-05T06:00:00Z"));
    const { agent: pm } = await t.as("PROPERTY_MANAGER");
    const s = await pm.get(`/landlords/${w.landlord.id}/statements/2026-10`).expect(200);
    expect(s.body.preview).toBe(false);
    expect(s.body.version).toBe(1);
    // Charged: October rent 3.0 M. Received: 1.0 M paid on 5 Oct. Arrears: 2.0 M left on October.
    // Maintenance: 250,000 paid by the owner (99,000 paid by the company is excluded). Net = 1.0 M - 250,000.
    expect(s.body.figures).toMatchObject({
      rentChargedMinor: 3_000_000,
      rentReceivedMinor: 1_000_000,
      arrearsMinor: 2_000_000,
      maintenanceCostMinor: 250_000,
      netMinor: 750_000,
    });
    expect(s.body.figures.leases).toHaveLength(1);
  });

  it("keeps a finished month unchanged until a manager re-issues it", async () => {
    const w = await world();
    t.clock.set(new Date("2026-11-05T06:00:00Z"));
    const { agent: pm } = await t.as("PROPERTY_MANAGER");
    await pm.get(`/landlords/${w.landlord.id}/statements/2026-10`).expect(200);
    await pm.post(`/leases/${w.leaseA}/payments`).field("amountMinor", "500000").field("method", "CASH").field("paidAt", "2026-10-20").expect(201);
    const again = await pm.get(`/landlords/${w.landlord.id}/statements/2026-10`).expect(200);
    expect(again.body.figures.rentReceivedMinor).toBe(1_000_000);
    const reissued = await pm.post(`/landlords/${w.landlord.id}/statements/2026-10/reissue`).expect(200);
    expect(reissued.body).toMatchObject({ version: 2, figures: { rentReceivedMinor: 1_500_000 } });
    const audit = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "statement.reissued"), eq(auditLog.entityId, w.landlord.id)));
    expect(audit).toHaveLength(1);
  });

  it("shows the current month as a preview that is not saved", async () => {
    const w = await world();
    const s = await w.pm.get(`/landlords/${w.landlord.id}/statements/2026-10`).expect(200);
    expect(s.body.preview).toBe(true);
    const list = await w.pm.get(`/landlords/${w.landlord.id}/statements`).expect(200);
    expect(list.body.items).toHaveLength(0);
  });
});

describe("Task 17: portals and invitations", () => {
  it("lets a landlord see only their own units, leases and statements", async () => {
    const w = await world();
    const inv = await w.pm.post(`/landlords/${w.landlord.id}/invite`).expect(201);
    const landlord = await accept(inv.body.link);
    const me = await landlord.get("/auth/me").expect(200);
    expect(me.body.user).toMatchObject({ role: "LANDLORD", linkedEntityId: w.landlord.id });
    const overview = await landlord.get("/portal/landlord/overview").expect(200);
    expect(overview.body.units.map((u: { code: string }) => u.code)).toEqual(["L-1"]);
    expect(overview.body.leases).toHaveLength(1);
    const maint = await landlord.get("/portal/landlord/maintenance").expect(200);
    expect(maint.body.items).toHaveLength(2);
    // Staff endpoints stay closed.
    await landlord.get(`/landlords/${w.other.id}/statements/2026-09`).expect(403);
    await landlord.get("/leases").expect(403);
  });

  it("lets a tenant see only their own lease and receipts", async () => {
    const w = await world();
    const inv = await w.pm.post(`/leases/${w.leaseA}/invite-tenant`).expect(201);
    expect(inv.body.sent).toBe("BLOCKED_NO_CONSENT");
    const tenant = await accept(inv.body.link);
    const overview = await tenant.get("/portal/tenant/overview").expect(200);
    expect(overview.body.leases.map((l: { id: string }) => l.id)).toEqual([w.leaseA]);
    expect(overview.body.payments).toHaveLength(2);
    await tenant.get(`/portal/tenant/payments/${w.payA1.id}/receipt.pdf`).expect(200);
    await tenant.get(`/portal/tenant/payments/${w.payB.id}/receipt.pdf`).expect(404);
    await tenant.get(`/payments/${w.payB.id}/receipt.pdf`).expect(403);
  });

  it("rejects used and expired invitation links with a clear message", async () => {
    const w = await world();
    const inv = await w.pm.post(`/leases/${w.leaseA}/invite-tenant`).expect(201);
    await accept(inv.body.link);
    const reuse = await t.http().post("/auth/accept-invitation").send({ token: tokenFrom(inv.body.link), password: "portal-password-1" }).expect(400);
    expect(reuse.body.code).toBe("INVITATION_USED");
    const inv2 = await w.pm.post(`/leases/${w.leaseB}/invite-tenant`).expect(201);
    t.clock.advance(8 * 86_400_000);
    const expired = await t.http().post("/auth/accept-invitation").send({ token: tokenFrom(inv2.body.link), password: "portal-password-1" }).expect(400);
    expect(expired.body.code).toBe("INVITATION_EXPIRED");
    await t.http().post("/auth/accept-invitation").send({ token: "x".repeat(40), password: "portal-password-1" }).expect(404);
  });

  it("needs an email to invite, and an email cannot be used twice", async () => {
    const w = await world();
    const noEmail = (await w.pm.post("/landlords").send({ name: "No Email" }).expect(201)).body.landlord;
    const res = await w.pm.post(`/landlords/${noEmail.id}/invite`).expect(400);
    expect(res.body.code).toBe("EMAIL_REQUIRED");
    const inv = await w.pm.post(`/landlords/${w.landlord.id}/invite`).expect(201);
    await accept(inv.body.link);
    await w.pm.post(`/landlords/${w.landlord.id}/invite`).expect(409);
  });

  it("puts a tenant's repair request in front of the property manager as NEW with an event", async () => {
    const w = await world();
    const inv = await w.pm.post(`/leases/${w.leaseA}/invite-tenant`).expect(201);
    const tenant = await accept(inv.body.link);
    const r = await tenant.post("/portal/tenant/maintenance").send({ title: "No hot water", priority: "URGENT" }).expect(201);
    const [row] = await t.db.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, r.body.request.id));
    expect(row).toMatchObject({ status: "NEW", unitId: w.unit.id, leaseId: w.leaseA, reportedByCustomerId: w.tenantA.id });
    const events = await t.db.select().from(outboxEvents).where(eq(outboxEvents.name, "maintenance.created.v1"));
    expect(events.some((e) => e.payload.requestId === r.body.request.id)).toBe(true);
    const list = await w.pm.get("/maintenance?status=NEW").expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(r.body.request.id);
  });
});

describe("Task 18: rental reports", () => {
  it("matches a known data set", async () => {
    const w = await world();
    t.clock.set(new Date("2026-11-05T06:00:00Z"));
    const { agent: owner } = await t.as("OWNER");
    const occ = await owner.get("/reports/occupancy").expect(200);
    expect(occ.body).toMatchObject({ managedUnits: 2, byStatus: { LEASED: 2 }, occupancyRate: 1 });
    // Sep: charged 6.0 M (two leases), collected 6.0 M. Oct: charged 6.0 M, collected 1.0 M. Nov: charged 6.0 M, collected 0.
    const rent = await owner.get("/reports/rent?from=2026-09-01&to=2026-11-30").expect(200);
    expect(rent.body.months).toEqual([
      { month: "2026-09", chargedMinor: 6_000_000, collectedMinor: 6_000_000, collectionRate: 1 },
      { month: "2026-10", chargedMinor: 6_000_000, collectedMinor: 1_000_000, collectionRate: 1 / 6 },
      { month: "2026-11", chargedMinor: 6_000_000, collectedMinor: 0, collectionRate: 0 },
    ]);
    const byOwner = await owner.get(`/reports/rent?from=2026-09-01&to=2026-11-30&landlordId=${w.landlord.id}`).expect(200);
    expect(byOwner.body.chargedMinor).toBe(9_000_000);
    // On 5 Nov: lease A owes 2.0 M from 1 Oct (35 days) and 3.0 M from 1 Nov (4 days); lease B owes 3.0 M from 1 Oct and 3.0 M from 1 Nov.
    const aging = await owner.get("/reports/arrears-aging").expect(200);
    expect(aging.body.buckets).toEqual([
      { label: "1-7", amountMinor: 6_000_000 },
      { label: "8-30", amountMinor: 0 },
      { label: "31-60", amountMinor: 5_000_000 },
      { label: "61+", amountMinor: 0 },
    ]);
    const maint = await owner.get("/reports/maintenance?from=2026-10-01&to=2026-10-31").expect(200);
    expect(maint.body.costByMonth).toEqual([{ month: "2026-10", costMinor: 426_000 }]);
    const expiring = await owner.get("/reports/leases-expiring").expect(200);
    expect(expiring.body).toMatchObject({ within30: 0, within60: 0, within90: 0 });
  });

  it("shows occupancy to sales managers but not money figures", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    await agent.get("/reports/occupancy").expect(200);
    await agent.get("/reports/rent").expect(403);
    await agent.get("/reports/arrears-aging").expect(403);
  });

  it("answers in under two seconds with 1,000 leases and 12,000 charges", async () => {
    const { agent } = await t.as("OWNER");
    const p = await makeProject(agent);
    const c = await agent.post("/customers").send({ name: "Bulk", phone: "0916999999" }).expect(201);
    const { sql } = await import("drizzle-orm");
    await t.db.execute(sql`INSERT INTO units (project_id, code, type, purpose, price_minor, status)
      SELECT ${p.id}::uuid, 'B-' || g, 'APARTMENT', 'RENT', 100000, 'LEASED' FROM generate_series(1, 1000) g`);
    await t.db.execute(sql`INSERT INTO leases (unit_id, tenant_id, start_date, end_date, rent_minor, status)
      SELECT u.id, ${c.body.customer.id}::uuid, '2026-01-01', '2026-12-31', 100000, 'ACTIVE' FROM units u WHERE u.code LIKE 'B-%'`);
    await t.db.execute(sql`INSERT INTO rent_charges (lease_id, period_start, period_end, due_date, amount_minor, paid_minor, status)
      SELECT l.id, make_date(2026, m, 1), make_date(2026, m, 1), make_date(2026, m, 1), 100000, CASE WHEN m < 10 THEN 100000 ELSE 0 END, CASE WHEN m < 10 THEN 'PAID' ELSE 'DUE' END
      FROM leases l, generate_series(1, 12) m`);
    const started = Date.now();
    await Promise.all(["/reports/occupancy", "/reports/rent?from=2026-01-01&to=2026-12-31", "/reports/arrears-aging", "/reports/leases-expiring", "/reports/maintenance"].map((u) => agent.get(u).expect(200)));
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
