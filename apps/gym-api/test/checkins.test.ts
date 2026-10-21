import { eq } from "drizzle-orm";
import { addisInstant } from "@platform/shared";
import { auditLog } from "@platform/nest-common";
import { checkins } from "../src/db/schema";
import { QrService } from "../src/members/qr.service";
import { createTestApp, type Agent, type TestApp } from "./harness";
import { activeMember, makeMember, relogin } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const tokenFor = (memberId: string, version = 1) => t.app.get(QrService).token(memberId, version);

async function memberLogin(desk: Agent, memberId: string): Promise<Agent> {
  const invite = await desk.post(`/members/${memberId}/invite`).expect(201);
  const agent = t.agent();
  await agent.post("/auth/accept-invitation").send({ token: invite.body.link.split("/invite/")[1], password: "member-password-1" }).expect(200);
  return agent;
}

describe("Task 23: check-in results", () => {
  it("allows an active member by QR code and records the visit", async () => {
    const { member } = await activeMember(t);
    const desk = await t.as("FRONT_DESK");
    const res = await desk.agent.post("/checkins").send({ token: tokenFor(member.id) }).expect(200);
    expect(res.body).toMatchObject({ result: "ALLOWED", deniedReason: null, member: { id: member.id }, membership: { daysLeft: 31, endDate: "2026-11-21" } });
    const today = await desk.agent.get("/checkins/today").expect(200);
    expect(today.body.items.map((r: { member: { id: string } }) => r.member.id)).toEqual([member.id]);
  });

  it("denies expired, frozen and cancelled memberships with the right reason", async () => {
    const { manager, member, membership } = await activeMember(t);
    // Frozen
    await manager.agent.post(`/memberships/${membership.id}/freeze`).send({ startDate: "2026-10-22", endDate: "2026-10-25", reason: "Travel" }).expect(201);
    let res = await manager.agent.post("/checkins").send({ token: tokenFor(member.id) }).expect(200);
    expect(res.body).toMatchObject({ result: "DENIED", deniedReason: "FROZEN" });
    // Expired (after the extended end date 25 Nov)
    t.clock.set(addisInstant("2026-11-26", 9));
    const desk = await relogin(t, manager.user);
    res = await desk.post("/checkins").send({ token: tokenFor(member.id) }).expect(200);
    expect(res.body).toMatchObject({ result: "DENIED", deniedReason: "EXPIRED" });
    // Cancelled
    const other = await activeMemberToday(desk);
    await desk.post(`/memberships/${other.membershipId}/cancel`).send({ reason: "Requested" }).expect(200);
    res = await desk.post("/checkins").send({ memberId: other.memberId }).expect(200);
    expect(res.body).toMatchObject({ result: "DENIED", deniedReason: "CANCELLED" });
    // No membership at all
    const none = await makeMember(desk);
    res = await desk.post("/checkins").send({ memberId: none.id }).expect(200);
    expect(res.body).toMatchObject({ result: "DENIED", deniedReason: "NO_MEMBERSHIP" });
    // Inactive member
    await desk.patch(`/members/${none.id}`).send({ status: "INACTIVE" }).expect(200);
    res = await desk.post("/checkins").send({ memberId: none.id }).expect(200);
    expect(res.body.deniedReason).toBe("INACTIVE_MEMBER");
  });

  async function activeMemberToday(agent: Agent) {
    const plan = (await agent.post("/plans").send({ name: "M2", durationMonths: 1, priceMinor: 1000 }).expect(201)).body.plan;
    const m = await makeMember(agent);
    const sold = await agent.post(`/members/${m.id}/memberships`).send({ planId: plan.id, payment: { amountMinor: 1000, method: "CASH" } }).expect(201);
    return { memberId: m.id, membershipId: sold.body.membership.id as string };
  }

  it("denies a tampered code and an old-version code as unknown", async () => {
    const { manager, member } = await activeMember(t);
    const good = tokenFor(member.id);
    const tampered = `${good.slice(0, -2)}${good.endsWith("A") ? "B" : "A"}x`;
    let res = await manager.agent.post("/checkins").send({ token: tampered }).expect(200);
    expect(res.body).toMatchObject({ result: "DENIED", deniedReason: "UNKNOWN_CODE", member: null });
    const forged = `${Buffer.from(`${member.id}:1`).toString("base64url")}.${"x".repeat(32)}`;
    res = await manager.agent.post("/checkins").send({ token: forged }).expect(200);
    expect(res.body.deniedReason).toBe("UNKNOWN_CODE");
    await manager.agent.post(`/members/${member.id}/qr/regenerate`).expect(200);
    res = await manager.agent.post("/checkins").send({ token: good }).expect(200);
    expect(res.body.deniedReason).toBe("UNKNOWN_CODE");
    res = await manager.agent.post("/checkins").send({ token: tokenFor(member.id, 2) }).expect(200);
    expect(res.body.result).toBe("ALLOWED");
  });

  it("counts a second scan within 5 minutes as a duplicate, not a visit", async () => {
    const { manager, member } = await activeMember(t);
    await manager.agent.post("/checkins").send({ token: tokenFor(member.id) }).expect(200);
    t.clock.advance(4 * 60_000);
    const dup = await manager.agent.post("/checkins").send({ token: tokenFor(member.id) }).expect(200);
    expect(dup.body.result).toBe("DUPLICATE");
    const visits = await t.db.select().from(checkins).where(eq(checkins.result, "ALLOWED"));
    expect(visits).toHaveLength(1);
    t.clock.advance(2 * 60_000);
    const again = await manager.agent.post("/checkins").send({ token: tokenFor(member.id) }).expect(200);
    expect(again.body.result).toBe("ALLOWED");
  });

  it("records one visit when the same code is scanned twice at the same moment", async () => {
    const { manager, member } = await activeMember(t);
    const results = await Promise.all([0, 1, 2].map(() => manager.agent.post("/checkins").send({ token: tokenFor(member.id) })));
    expect(results.map((r) => r.body.result).sort()).toEqual(["ALLOWED", "DUPLICATE", "DUPLICATE"]);
  });
});

describe("Task 23: overrides", () => {
  it("lets only a manager override, with a reason, and logs it", async () => {
    const manager = await t.as("GYM_MANAGER");
    const m = await makeMember(manager.agent);
    const desk = await t.as("FRONT_DESK");
    await desk.agent.post("/checkins").send({ memberId: m.id, overrideReason: "Forgot card" }).expect(403);
    await manager.agent.post("/checkins").send({ memberId: m.id, overrideReason: "" }).expect(400);
    await manager.agent.post("/checkins").send({ memberId: m.id, overrideReason: "  " }).expect(400);
    const res = await manager.agent.post("/checkins").send({ memberId: m.id, overrideReason: "Paying tomorrow" }).expect(200);
    expect(res.body).toMatchObject({ result: "ALLOWED", override: true, deniedReason: "NO_MEMBERSHIP" });
    const [row] = await t.db.select().from(checkins).where(eq(checkins.id, res.body.checkinId));
    expect(row).toMatchObject({ override: true, overrideReason: "Paying tomorrow" });
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.action, "checkin.override"));
    expect(audit).toHaveLength(1);
  });
});

describe("Task 23: member view", () => {
  it("shows a member only their own QR code and history", async () => {
    const { manager, member } = await activeMember(t);
    await manager.agent.patch(`/members/${member.id}`).send({ email: "own@example.com" }).expect(200);
    const other = await makeMember(manager.agent);
    await manager.agent.post("/checkins").send({ memberId: member.id }).expect(200);
    await manager.agent.post("/checkins").send({ memberId: other.id, overrideReason: "Guest pass" }).expect(200);
    const me = await memberLogin(manager.agent, member.id);
    const status = await me.get("/me").expect(200);
    expect(status.body.membership).toMatchObject({ status: "ACTIVE", endDate: "2026-11-21", daysLeft: 31 });
    const qr = await me.get("/me/qr").expect(200);
    expect(qr.body.token).toBe(tokenFor(member.id));
    const svg = await me.get("/me/qr.svg").expect(200);
    expect(svg.headers["content-type"]).toContain("image/svg+xml");
    expect(String(svg.text ?? svg.body)).toContain("<svg");
    const visits = await me.get("/me/checkins").expect(200);
    expect(visits.body.items.every((v: { memberId: string }) => v.memberId === member.id)).toBe(true);
    expect(visits.body.items).toHaveLength(1);
    await me.get(`/members/${other.id}/checkins`).expect(403);
    await me.post("/checkins").send({ memberId: member.id }).expect(403);
    await me.get("/checkins/today").expect(403);
  });

  it("lets a member download only their own receipts", async () => {
    const { manager, member, payment } = await activeMember(t);
    await manager.agent.patch(`/members/${member.id}`).send({ email: "receipt@example.com" }).expect(200);
    const other = await activeMember(t);
    const me = await memberLogin(manager.agent, member.id);
    await me.get(`/me/payments/${payment!.id}/receipt.pdf`).expect(200);
    await me.get(`/me/payments/${other.payment!.id}/receipt.pdf`).expect(404);
    await me.get(`/payments/${payment!.id}/receipt.pdf`).expect(403);
  });

  it("keeps trainers away from the check-in desk", async () => {
    const trainer = await t.as("TRAINER");
    await trainer.agent.post("/checkins").send({ token: "abcdefghijkl" }).expect(403);
    await trainer.agent.get("/checkins/today").expect(403);
  });
});
