import { eq } from "drizzle-orm";
import { addisInstant } from "@platform/shared";
import { ConsentService, messageLog, outboxEvents, renderTemplate, templatePlaceholders } from "@platform/nest-common";
import { checkins } from "../src/db/schema";
import { GymScheduler } from "../src/automation/scheduler";
import { GYM_TEMPLATES } from "../src/templates";
import { createTestApp, type Agent, type TestApp } from "./harness";
import { makeMember, makePlan, relogin, sell } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const run = () => t.app.get(GymScheduler).run();

async function consentedMember(agent: Agent, planId: string, extra: Record<string, unknown> = {}) {
  const m = await makeMember(agent, { telegramChatId: `chat-${Math.random()}`, ...extra });
  await agent.post(`/members/${m.id}/consent`).send({ channel: "TELEGRAM", granted: true }).expect(201);
  const sold = await sell(agent, m.id, planId);
  return { member: m, membership: sold.membership };
}

async function eventCount(name: string) {
  return (await t.db.select().from(outboxEvents).where(eq(outboxEvents.name, name))).length;
}

describe("Task 25: reminders", () => {
  it("fires each reminder once per member per threshold, however often the scheduler runs", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent, { name: "Monthly" });
    const { member } = await consentedMember(manager.agent, plan.id, { birthDate: "1990-10-23" });
    // Birthday tomorrow (23 Oct)
    t.clock.set(addisInstant("2026-10-23", 9));
    await run();
    await run();
    expect(await eventCount("member.birthday.v1")).toBe(1);
    // Inactive: no visit since the membership started on 22 Oct; 14 days later is 5 Nov.
    t.clock.set(addisInstant("2026-11-04", 9));
    await run();
    expect(await eventCount("member.inactive.v1")).toBe(0);
    t.clock.set(addisInstant("2026-11-05", 9));
    await run();
    await run();
    t.clock.set(addisInstant("2026-11-06", 9));
    await run();
    expect(await eventCount("member.inactive.v1")).toBe(1);
    // Expiring: membership ends 21 Nov; 3 days before is 18 Nov.
    t.clock.set(addisInstant("2026-11-17", 9));
    await run();
    expect(await eventCount("membership.expiring.v1")).toBe(0);
    t.clock.set(addisInstant("2026-11-18", 9));
    await run();
    t.clock.set(addisInstant("2026-11-19", 9));
    await run();
    expect(await eventCount("membership.expiring.v1")).toBe(1);
    // Expired: the day after 21 Nov.
    t.clock.set(addisInstant("2026-11-22", 9));
    await run();
    await run();
    t.clock.set(addisInstant("2026-11-23", 9));
    await run();
    expect(await eventCount("membership.expired.v1")).toBe(1);
    // Every event becomes exactly one Telegram message, even if dispatch runs twice.
    await t.dispatch();
    await t.dispatch();
    const subjects = t.telegram.sent.filter((s) => s.to.id === member.id).map((s) => s.message.subject);
    expect(subjects).toHaveLength(4);
    expect(subjects.some((s) => s.includes("21 Nov 2026"))).toBe(true);
  });

  it("sends nothing without consent or after opt-out, and logs the blocked attempt", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent);
    const noConsent = await makeMember(manager.agent, { telegramChatId: "chat-a" });
    await sell(manager.agent, noConsent.id, plan.id);
    const optedOut = await consentedMember(manager.agent, plan.id);
    await t.http().post(`/optout/${t.app.get(ConsentService).optOutToken(optedOut.member.id)}`).expect(200);
    t.clock.set(addisInstant("2026-11-19", 9));
    await run();
    await t.dispatch();
    expect(t.telegram.sent).toHaveLength(0);
    // Each member gets two reminders on 19 Nov (membership ending, and no visit for 28 days); all are blocked.
    const logs = await t.db.select().from(messageLog);
    expect(logs).toHaveLength(4);
    expect(logs.every((l) => l.status === "BLOCKED_NO_CONSENT")).toBe(true);
    expect(new Set(logs.map((l) => l.subjectId))).toEqual(new Set([noConsent.id, optedOut.member.id]));
  });

  it("holds messages during quiet hours and sends them at 07:00", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent);
    await consentedMember(manager.agent, plan.id);
    t.clock.set(addisInstant("2026-11-19", 21, 30));
    await run();
    await t.dispatch();
    expect(t.telegram.sent).toHaveLength(0);
    const held = await t.db.select().from(messageLog);
    expect(held.length).toBe(2);
    expect(held.every((h) => h.status === "DEFERRED_QUIET_HOURS")).toBe(true);
    expect(held[0].sendAfter!.toISOString()).toBe(addisInstant("2026-11-20", 7).toISOString());
    t.clock.set(addisInstant("2026-11-20", 6, 59));
    await run();
    expect(t.telegram.sent).toHaveLength(0);
    t.clock.set(addisInstant("2026-11-20", 7, 5));
    await run();
    expect(t.telegram.sent).toHaveLength(2);
  });

  it("stops events for a reminder type that is switched off", async () => {
    const owner = await t.as("OWNER");
    await owner.agent.put("/settings/reminders").send({ enabled: { "membership.expiring": false }, inactiveDays: 14, expiringDays: 3 }).expect(200);
    const plan = await makePlan(owner.agent);
    await consentedMember(owner.agent, plan.id);
    t.clock.set(addisInstant("2026-11-19", 9));
    await run();
    expect(await eventCount("membership.expiring.v1")).toBe(0);
    const manager = await t.as("GYM_MANAGER");
    await manager.agent.get("/settings/reminders").expect(403);
  });

  it("tells booked members when a class is cancelled", async () => {
    const manager = await t.as("GYM_MANAGER");
    const trainerUser = await t.createUser("TRAINER");
    const trainer = (await manager.agent.post("/trainers").send({ userId: trainerUser.id }).expect(201)).body.trainer;
    await manager.agent.post("/class-templates").send({ name: "Spin", trainerId: trainer.id, weekday: 4, startTime: "18:00", durationMinutes: 60, capacity: 5 }).expect(201);
    const sessions = (await manager.agent.get("/sessions").expect(200)).body.items;
    const plan = await makePlan(manager.agent);
    const { member } = await consentedMember(manager.agent, plan.id);
    await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: member.id }).expect(201);
    await manager.agent.post(`/sessions/${sessions[0].id}/cancel`).send({ reason: "Trainer sick" }).expect(200);
    await t.dispatch();
    expect(t.telegram.sent).toHaveLength(1);
    expect(t.telegram.sent[0].message.subject).toContain("Spin");
  });
});

describe("Task 25: announcements", () => {
  it("enforces the cap of 4 per 30 days and reports blocked recipients", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent);
    const { member } = await consentedMember(manager.agent, plan.id);
    const noConsent = await makeMember(manager.agent, { telegramChatId: "chat-x" });
    await sell(manager.agent, noConsent.id, plan.id);
    const body = { title: "New class", messageAm: "አዲስ ክፍለ ጊዜ", messageEn: "New spin class on Fridays", filter: { membershipStatus: "ACTIVE" } };
    const results = [];
    for (let i = 0; i < 5; i += 1) results.push((await manager.agent.post("/campaigns").send(body).expect(201)).body.campaign);
    expect(results.slice(0, 4).every((c) => c.sentCount === 1 && c.blockedCount === 1 && c.cappedCount === 0)).toBe(true);
    expect(results[4]).toMatchObject({ recipientCount: 2, sentCount: 0, cappedCount: 1, blockedCount: 1 });
    expect(t.telegram.sent.filter((s) => s.to.id === member.id)).toHaveLength(4);
    expect(t.telegram.sent[0].message.text).toContain("ሰላም");
    // After 30 days the member can receive marketing again.
    t.clock.set(addisInstant("2026-11-21", 10));
    const again = await (await relogin(t, manager.user)).post("/campaigns").send(body).expect(201);
    expect(again.body.campaign.sentCount).toBe(1);
  });

  it("keeps announcements to managers", async () => {
    for (const role of ["FRONT_DESK", "TRAINER"]) {
      const { agent } = await t.as(role);
      await agent.post("/campaigns").send({ title: "Hi there", messageAm: "x", messageEn: "y" }).expect(403);
    }
  });
});

describe("Task 25: dashboard", () => {
  async function seedData() {
    const manager = await t.as("GYM_MANAGER");
    const monthly = await makePlan(manager.agent, { name: "Monthly", durationMonths: 1, priceMinor: 150000 });
    const quarterly = await makePlan(manager.agent, { name: "Quarterly", durationMonths: 3, priceMinor: 400000 });
    const m1 = await makeMember(manager.agent, { name: "Alem" });
    const m2 = await makeMember(manager.agent, { name: "Bethel" });
    const m3 = await makeMember(manager.agent, { name: "Chala" });
    await sell(manager.agent, m1.id, monthly.id, { payment: { amountMinor: 150000, method: "CASH" } });
    await sell(manager.agent, m2.id, quarterly.id, { payment: { amountMinor: 400000, method: "TELEBIRR" } });
    const p3 = await sell(manager.agent, m3.id, monthly.id, { payment: { amountMinor: 150000, method: "CASH" } });
    await manager.agent.post(`/payments/${p3.payment!.id}/void`).send({ reason: "Paid twice" }).expect(200);
    const rows = [
      { memberId: m1.id, at: addisInstant("2026-10-23", 7, 10), result: "ALLOWED" },
      { memberId: m1.id, at: addisInstant("2026-10-24", 7, 40), result: "ALLOWED" },
      { memberId: m2.id, at: addisInstant("2026-10-24", 18, 5), result: "ALLOWED" },
      { memberId: m2.id, at: addisInstant("2026-11-05", 18, 30), result: "ALLOWED" },
      { memberId: m3.id, at: addisInstant("2026-10-24", 7, 0), result: "DENIED", deniedReason: "EXPIRED" },
      { memberId: m1.id, at: addisInstant("2026-10-24", 7, 42), result: "DUPLICATE" },
    ];
    for (const r of rows) await t.db.insert(checkins).values({ method: "QR", ...r });
    return { manager, m1, m2, m3, monthly, quarterly };
  }

  it("matches a known data set: summary, revenue by plan, busiest hour, at-risk list", async () => {
    const { manager, m1, m3, monthly, quarterly } = await seedData();
    const summary = await manager.agent.get("/dashboard/summary").expect(200);
    expect(summary.body).toEqual({ activeMembers: 3, expiringIn7Days: 0, newMembersThisMonth: 3 });
    const revenue = await manager.agent.get("/dashboard/revenue").expect(200);
    expect(revenue.body).toEqual({
      month: "2026-10",
      currency: "ETB",
      totalMinor: 550000,
      byPlan: [
        { planId: quarterly.id, planName: "Quarterly", totalMinor: 400000, payments: 1 },
        { planId: monthly.id, planName: "Monthly", totalMinor: 150000, payments: 1 },
      ],
    });
    t.clock.set(addisInstant("2026-11-10", 9));
    const later = await relogin(t, manager.user);
    const attendance = await later.get("/dashboard/attendance").expect(200);
    expect(attendance.body.busiestHour).toBe(7);
    expect(attendance.body.hours[7].visits).toBe(2);
    expect(attendance.body.hours[18].visits).toBe(2);
    // 24 Oct 2026 is a Saturday (6): two visits that day.
    expect(attendance.body.busiestWeekday).toBe(6);
    expect(attendance.body.days.find((d: { day: string }) => d.day === "2026-10-24").visits).toBe(2);
    expect(attendance.body.days).toHaveLength(30);
    const risk = await later.get("/dashboard/at-risk").expect(200);
    expect(risk.body.items.map((r: { memberId: string; daysSince: number }) => [r.memberId, r.daysSince])).toEqual([
      [m3.id, 19],
      [m1.id, 17],
    ]);
    const lateSummary = await later.get("/dashboard/summary").expect(200);
    expect(lateSummary.body).toEqual({ activeMembers: 3, expiringIn7Days: 0, newMembersThisMonth: 0 });
    t.clock.set(addisInstant("2026-11-15", 9));
    const nov15 = await (await relogin(t, manager.user)).get("/dashboard/summary").expect(200);
    expect(nov15.body.expiringIn7Days).toBe(2);
  });

  it("exports CSV files with a byte order mark", async () => {
    const { manager } = await seedData();
    const csv = await manager.agent.get("/dashboard/revenue.csv").expect(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.startsWith("﻿")).toBe(true);
    expect(csv.text).toContain("Quarterly,1,\"4,000.00\"");
    const risk = await manager.agent.get("/dashboard/at-risk.csv").expect(200);
    expect(risk.text.startsWith("﻿Name,Phone")).toBe(true);
    await manager.agent.get("/dashboard/attendance.csv").expect(200);
  });

  it("sends a one-tap message to an at-risk member, checking consent", async () => {
    const manager = await t.as("GYM_MANAGER");
    const plan = await makePlan(manager.agent);
    const { member } = await consentedMember(manager.agent, plan.id);
    const noConsent = await makeMember(manager.agent, { telegramChatId: "c" });
    const ok = await manager.agent.post(`/dashboard/at-risk/${member.id}/message`).expect(200);
    expect(ok.body.status).toBe("SENT");
    const blocked = await manager.agent.post(`/dashboard/at-risk/${noConsent.id}/message`).expect(200);
    expect(blocked.body.status).toBe("BLOCKED_NO_CONSENT");
  });

  it("hides revenue and the dashboard from trainers and front desk", async () => {
    for (const role of ["TRAINER", "FRONT_DESK"]) {
      const { agent } = await t.as(role);
      await agent.get("/dashboard/revenue").expect(403);
      await agent.get("/dashboard/revenue.csv").expect(403);
      await agent.get("/dashboard/summary").expect(403);
    }
    const owner = await t.as("OWNER");
    await owner.agent.get("/dashboard/revenue").expect(200);
  });
});

describe("Task 25: templates", () => {
  const sample: Record<string, Record<string, unknown>> = {
    "staff.alert": { message: "x" },
    "member.renewal_reminder": { plan: "Monthly", endDate: "21 Nov" },
    "member.expired": { plan: "Monthly", endDate: "21 Nov" },
    "member.we_miss_you": { days: 14 },
    "member.birthday": {},
    "member.announcement": { title: "T", messageAm: "ሀ", messageEn: "A" },
    "member.session_cancelled": { className: "Spin", when: "22 Oct 18:00" },
    "member.invitation": { link: "http://x/invite/abc", expires: "29 Oct" },
  };

  it("renders every template in Amharic and English with the data the rules pass", () => {
    expect(Object.keys(GYM_TEMPLATES).sort()).toEqual(Object.keys(sample).sort());
    for (const key of Object.keys(GYM_TEMPLATES)) {
      for (const locale of ["am", "en"] as const) {
        expect(GYM_TEMPLATES[key][locale]).toBeDefined();
        const out = renderTemplate(GYM_TEMPLATES, key, locale, { name: "Abebe", ...sample[key] });
        expect(out.text).not.toMatch(/\{\{/);
      }
      for (const placeholder of templatePlaceholders(GYM_TEMPLATES, key)) {
        expect(["name", ...Object.keys(sample[key])]).toContain(placeholder);
      }
    }
  });
});
