import { eq } from "drizzle-orm";
import { addisInstant } from "@platform/shared";
import { auditLog, outboxEvents } from "@platform/nest-common";
import { memberships } from "../src/db/schema";
import { GymScheduler } from "../src/automation/scheduler";
import { createTestApp, type TestApp } from "./harness";
import { activeMember, makeMember, makePlan, relogin, sell } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("Task 22: plans", () => {
  it("lets managers create and update plans; desk can only read active plans", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent, { name: "Family", kind: "FAMILY", durationMonths: 3, priceMinor: 900000 });
    await manager.agent.patch(`/plans/${plan.id}`).send({ isActive: false }).expect(200);
    const desk = await t.as("FRONT_DESK");
    await desk.agent.post("/plans").send({ name: "X", durationMonths: 1, priceMinor: 1 }).expect(403);
    await desk.agent.patch(`/plans/${plan.id}`).send({ isActive: true }).expect(403);
    const active = await desk.agent.get("/plans").expect(200);
    expect(active.body.items).toHaveLength(0);
    const all = await desk.agent.get("/plans?all=true").expect(200);
    expect(all.body.items).toHaveLength(1);
    await t.as("TRAINER").then(({ agent }) => agent.get("/plans").expect(403));
  });
});

describe("Task 22: selling and renewing", () => {
  it("sells a membership with a payment and a receipt", async () => {
    const { membership, payment } = await activeMember(t);
    expect(membership).toMatchObject({ startDate: "2026-10-22", endDate: "2026-11-21", status: "ACTIVE" });
    expect(payment!.receiptNumber).toBe("G-2026-000001");
  });

  it("renewing before expiry continues from the old end date", async () => {
    const { manager, plan, member, membership } = await activeMember(t);
    t.clock.set(addisInstant("2026-11-15", 10));
    const renewed = await sell(await relogin(t, manager.user), member.id, plan.id);
    expect(renewed.membership.startDate).toBe("2026-11-22");
    expect(renewed.membership.endDate).toBe("2026-12-21");
    expect(membership.endDate).toBe("2026-11-21");
  });

  it("renewing after expiry starts today", async () => {
    const { manager, plan, member } = await activeMember(t);
    t.clock.set(addisInstant("2026-12-05", 10));
    const renewed = await sell(await relogin(t, manager.user), member.id, plan.id);
    expect(renewed.membership.startDate).toBe("2026-12-05");
    expect(renewed.membership.endDate).toBe("2027-01-04");
  });

  it("rejects selling without a payment or a complimentary reason, and both together", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent);
    const member = await makeMember(manager.agent);
    await manager.agent.post(`/members/${member.id}/memberships`).send({ planId: plan.id }).expect(400);
    await manager.agent
      .post(`/members/${member.id}/memberships`)
      .send({ planId: plan.id, payment: { amountMinor: 1, method: "CASH" }, complimentaryReason: "Staff" })
      .expect(400);
    const comp = await manager.agent.post(`/members/${member.id}/memberships`).send({ planId: plan.id, complimentaryReason: "Staff member" }).expect(201);
    expect(comp.body.payment).toBeNull();
    expect(comp.body.membership.complimentaryReason).toBe("Staff member");
  });

  it("lets only managers give complimentary memberships", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent);
    const desk = await t.as("FRONT_DESK");
    const member = await makeMember(desk.agent);
    await desk.agent.post(`/members/${member.id}/memberships`).send({ planId: plan.id, complimentaryReason: "Friend" }).expect(403);
    await sell(desk.agent, member.id, plan.id);
  });

  it("rejects an overlapping membership with a chosen start date", async () => {
    const { manager, plan, member } = await activeMember(t);
    const res = await manager.agent
      .post(`/members/${member.id}/memberships`)
      .send({ planId: plan.id, startDate: "2026-11-01", payment: { amountMinor: 1, method: "CASH" } })
      .expect(409);
    expect(res.body.code).toBe("MEMBERSHIP_OVERLAP");
  });

  it("gives unique, sequential receipt numbers under concurrent sales", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent);
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) ids.push((await makeMember(manager.agent)).id);
    const results = await Promise.all(ids.map((id) => sell(manager.agent, id, plan.id)));
    const numbers = results.map((r) => r.payment!.receiptNumber).sort();
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `G-2026-${String(i + 1).padStart(6, "0")}`));
  });

  it("produces a receipt PDF", async () => {
    const { manager, payment } = await activeMember(t);
    const res = await manager.agent.get(`/payments/${payment!.id}/receipt.pdf`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("Task 22: freezes and cancellation", () => {
  it("moves the end date by exactly the frozen days and shows FROZEN during the freeze", async () => {
    const { manager, member, membership } = await activeMember(t);
    const res = await manager.agent
      .post(`/memberships/${membership.id}/freeze`)
      .send({ startDate: "2026-10-25", endDate: "2026-11-03", reason: "Travel" })
      .expect(201);
    expect(res.body.membership.endDate).toBe("2026-12-01");
    t.clock.set(addisInstant("2026-10-26", 9));
    const during = await manager.agent.get(`/members/${member.id}`).expect(200);
    expect(during.body.membership.status).toBe("FROZEN");
    t.clock.set(addisInstant("2026-11-04", 9));
    const after = await (await relogin(t, manager.user)).get(`/members/${member.id}`).expect(200);
    expect(after.body.membership.status).toBe("ACTIVE");
    expect(after.body.membership.membership.endDate).toBe("2026-12-01");
  });

  it("rejects overlapping freezes", async () => {
    const { manager, membership } = await activeMember(t);
    await manager.agent.post(`/memberships/${membership.id}/freeze`).send({ startDate: "2026-10-25", endDate: "2026-10-30", reason: "Travel" }).expect(201);
    const res = await manager.agent.post(`/memberships/${membership.id}/freeze`).send({ startDate: "2026-10-30", endDate: "2026-11-02", reason: "Sick" }).expect(409);
    expect(res.body.code).toBe("FREEZE_OVERLAP");
  });

  it("ending a freeze early gives back the unused days", async () => {
    const { manager, membership } = await activeMember(t);
    const frozen = await manager.agent.post(`/memberships/${membership.id}/freeze`).send({ startDate: "2026-10-22", endDate: "2026-10-31", reason: "Injury" }).expect(201);
    expect(frozen.body.membership.endDate).toBe("2026-12-01");
    t.clock.set(addisInstant("2026-10-25", 9));
    const ended = await manager.agent.post(`/freezes/${frozen.body.freeze.id}/end`).expect(200);
    // Frozen 22 to 24 October only (3 days), so the end date is 21 Nov + 3 days.
    expect(ended.body.membership.endDate).toBe("2026-11-24");
    expect(ended.body.membership.status).toBe("ACTIVE");
  });

  it("cancels with a reason", async () => {
    const { manager, member, membership } = await activeMember(t);
    await manager.agent.post(`/memberships/${membership.id}/cancel`).send({}).expect(400);
    await manager.agent.post(`/memberships/${membership.id}/cancel`).send({ reason: "Moved away" }).expect(200);
    const res = await manager.agent.get(`/members/${member.id}`).expect(200);
    expect(res.body.membership.status).toBe("CANCELLED");
  });

  it("keeps freezes, voids and plan changes away from the front desk", async () => {
    const { membership, payment } = await activeMember(t);
    const desk = await t.as("FRONT_DESK");
    await desk.agent.post(`/memberships/${membership.id}/freeze`).send({ startDate: "2026-10-25", endDate: "2026-10-30", reason: "Travel" }).expect(403);
    await desk.agent.post(`/payments/${payment!.id}/void`).send({ reason: "Mistake" }).expect(403);
    await desk.agent.post(`/memberships/${membership.id}/cancel`).send({ reason: "Mistake" }).expect(403);
    const trainer = await t.as("TRAINER");
    await trainer.agent.post(`/payments/${payment!.id}/void`).send({ reason: "Mistake" }).expect(403);
  });
});

describe("Task 22: payments", () => {
  it("voids with a reason and an audit entry, never deletes", async () => {
    const { manager, payment } = await activeMember(t);
    await manager.agent.post(`/payments/${payment!.id}/void`).send({}).expect(400);
    const res = await manager.agent.post(`/payments/${payment!.id}/void`).send({ reason: "Entered twice" }).expect(200);
    expect(res.body.payment.status).toBe("VOIDED");
    await manager.agent.post(`/payments/${payment!.id}/void`).send({ reason: "Again" }).expect(409);
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, "payment.voided"));
    expect(audit).toHaveLength(1);
  });
});

describe("Task 22: lists and the daily job", () => {
  it("lists expiring and expired memberships", async () => {
    const { manager, member } = await activeMember(t);
    t.clock.set(addisInstant("2026-11-17", 9));
    const expiring = await (await relogin(t, manager.user)).get("/memberships/expiring?days=7").expect(200);
    expect(expiring.body.items.map((r: { member: { id: string } }) => r.member.id)).toEqual([member.id]);
    t.clock.set(addisInstant("2026-11-25", 9));
    const later = await relogin(t, manager.user);
    const none = await later.get("/memberships/expiring?days=7").expect(200);
    expect(none.body.items).toHaveLength(0);
    const expired = await later.get("/memberships/expired?sinceDays=30").expect(200);
    expect(expired.body.items.map((r: { member: { id: string } }) => r.member.id)).toEqual([member.id]);
  });

  it("gives the same state and no duplicate events when the daily job runs twice", async () => {
    const { membership } = await activeMember(t);
    t.clock.set(addisInstant("2026-11-23", 9));
    const scheduler = t.app.get(GymScheduler);
    const first = await scheduler.run();
    const stateAfterFirst = await t.db.select().from(memberships);
    const eventsAfterFirst = await t.db.select().from(outboxEvents);
    const second = await scheduler.run();
    expect(first.expiredStatuses).toBe(1);
    expect(second.expiredStatuses).toBe(0);
    expect(await t.db.select().from(memberships)).toEqual(stateAfterFirst);
    expect(await t.db.select().from(outboxEvents)).toHaveLength(eventsAfterFirst.length);
    const [row] = await t.db.select().from(memberships).where(eq(memberships.id, membership.id));
    expect(row.status).toBe("EXPIRED");
  });
});
