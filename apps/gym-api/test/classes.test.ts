import { eq } from "drizzle-orm";
import { addisInstant } from "@platform/shared";
import { bookings, classSessions } from "../src/db/schema";
import { ClassesService } from "../src/classes/classes.service";
import { createTestApp, type Agent, type TestApp } from "./harness";
import { makeMember, makePlan, relogin, sell } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

async function setup(capacity = 10, startTime = "18:00") {
  const manager = await t.as("GYM_MANAGER");
  const trainerLogin = await t.as("TRAINER");
  const trainer = (await manager.agent.post("/trainers").send({ userId: trainerLogin.user.id, bio: "Coach" }).expect(201)).body.trainer;
  // Thursday (weekday 4); 22 Oct 2026 is a Thursday.
  const template = (
    await manager.agent.post("/class-templates").send({ name: "Spin", trainerId: trainer.id, weekday: 4, startTime, durationMinutes: 60, capacity }).expect(201)
  ).body.template;
  const sessions = await manager.agent.get("/sessions?days=28").expect(200);
  const plan = await makePlan(manager.agent);
  return { manager, trainerLogin, trainer, template, sessions: sessions.body.items as Array<{ id: string; startsAt: string }>, plan };
}

async function memberWithMembership(agent: Agent, planId: string, extra: Record<string, unknown> = {}) {
  const m = await makeMember(agent);
  const sold = await sell(agent, m.id, planId, extra);
  return { member: m, membership: sold.membership };
}

describe("Task 24: sessions", () => {
  it("generates sessions for 4 weeks in Addis Ababa time without duplicates", async () => {
    const { sessions } = await setup();
    expect(sessions.map((s) => s.startsAt)).toEqual([
      addisInstant("2026-10-22", 18).toISOString(),
      addisInstant("2026-10-29", 18).toISOString(),
      addisInstant("2026-11-05", 18).toISOString(),
      addisInstant("2026-11-12", 18).toISOString(),
    ]);
    expect(sessions[0].startsAt).toBe("2026-10-22T15:00:00.000Z");
    const classes = t.app.get(ClassesService);
    expect(await classes.generateSessions()).toBe(0);
    expect(await t.db.select().from(classSessions)).toHaveLength(4);
    t.clock.set(addisInstant("2026-10-30", 9));
    // The window now runs 30 Oct to 26 Nov: two new Thursdays (19 and 26 Nov).
    expect(await classes.generateSessions()).toBe(2);
    expect(await classes.generateSessions()).toBe(0);
  });

  it("skips a start time that has already passed today", async () => {
    const { sessions } = await setup(10, "08:00");
    expect(sessions[0].startsAt).toBe(addisInstant("2026-10-29", 8).toISOString());
  });
});

describe("Task 24: bookings", () => {
  it("never goes over capacity under concurrent requests", async () => {
    const { manager, sessions, plan } = await setup(2);
    const members = [];
    for (let i = 0; i < 3; i += 1) members.push((await memberWithMembership(manager.agent, plan.id)).member);
    const results = await Promise.all(members.map((m) => manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: m.id })));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe("SESSION_FULL");
    const booked = await t.db.select().from(bookings).where(eq(bookings.sessionId, sessions[0].id));
    expect(booked).toHaveLength(2);
  });

  it("refuses members without an active membership on the class date", async () => {
    const { manager, sessions, plan } = await setup();
    const expired = await memberWithMembership(manager.agent, plan.id, { startDate: "2026-09-01" });
    let res = await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: expired.member.id }).expect(409);
    expect(res.body.code).toBe("NO_ACTIVE_MEMBERSHIP");
    const frozen = await memberWithMembership(manager.agent, plan.id);
    await manager.agent.post(`/memberships/${frozen.membership.id}/freeze`).send({ startDate: "2026-10-22", endDate: "2026-10-23", reason: "Sick" }).expect(201);
    res = await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: frozen.member.id }).expect(409);
    expect(res.body.code).toBe("NO_ACTIVE_MEMBERSHIP");
    // The same frozen member can book next week's class, after the freeze.
    await manager.agent.post("/bookings").send({ sessionId: sessions[1].id, memberId: frozen.member.id }).expect(201);
    const none = await makeMember(manager.agent);
    await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: none.id }).expect(409);
  });

  it("allows one booking per member per class", async () => {
    const { manager, sessions, plan } = await setup();
    const { member } = await memberWithMembership(manager.agent, plan.id);
    await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: member.id }).expect(201);
    const dup = await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: member.id }).expect(409);
    expect(dup.body.code).toBe("ALREADY_BOOKED");
  });

  it("enforces the 2-hour cancellation cutoff for members, with a manager exception", async () => {
    const { manager, sessions, plan } = await setup();
    const a = await memberWithMembership(manager.agent, plan.id, {});
    await manager.agent.patch(`/members/${a.member.id}`).send({ email: "a@example.com" }).expect(200);
    const invite = await manager.agent.post(`/members/${a.member.id}/invite`).expect(201);
    const member = t.agent();
    await member.post("/auth/accept-invitation").send({ token: invite.body.link.split("/invite/")[1], password: "member-password-1" }).expect(200);
    const early = (await member.post("/bookings").send({ sessionId: sessions[1].id }).expect(201)).body.booking;
    await member.post(`/bookings/${early.id}/cancel`).send({}).expect(200);
    const late = (await member.post("/bookings").send({ sessionId: sessions[0].id }).expect(201)).body.booking;
    t.clock.set(addisInstant("2026-10-22", 16, 30));
    const refused = await member.post(`/bookings/${late.id}/cancel`).send({}).expect(409);
    expect(refused.body.code).toBe("CANCELLATION_CUTOFF");
    const desk = await t.as("FRONT_DESK");
    await desk.agent.post(`/bookings/${late.id}/cancel`).send({ reason: "Asked by phone" }).expect(409);
    await manager.agent.post(`/bookings/${late.id}/cancel`).send({}).expect(400);
    await manager.agent.post(`/bookings/${late.id}/cancel`).send({ reason: "Doctor's note" }).expect(200);
  });

  it("lets a member book only for themselves", async () => {
    const { manager, sessions, plan } = await setup();
    const a = await memberWithMembership(manager.agent, plan.id);
    const b = await memberWithMembership(manager.agent, plan.id);
    await manager.agent.patch(`/members/${a.member.id}`).send({ email: "self@example.com" }).expect(200);
    const invite = await manager.agent.post(`/members/${a.member.id}/invite`).expect(201);
    const member = t.agent();
    await member.post("/auth/accept-invitation").send({ token: invite.body.link.split("/invite/")[1], password: "member-password-1" }).expect(200);
    const res = await member.post("/bookings").send({ sessionId: sessions[0].id, memberId: b.member.id }).expect(201);
    expect(res.body.booking.memberId).toBe(a.member.id);
    const otherBooking = (await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: b.member.id }).expect(201)).body.booking;
    await member.post(`/bookings/${otherBooking.id}/cancel`).send({}).expect(404);
    const timetable = await member.get("/sessions").expect(200);
    expect(timetable.body.items[0]).toMatchObject({ booked: 2, spotsLeft: 8 });
    const mine = await member.get("/me/bookings").expect(200);
    expect(mine.body.items).toHaveLength(1);
  });
});

describe("Task 24: trainers", () => {
  it("shows a trainer only assigned members and their own classes", async () => {
    const { manager, trainerLogin, trainer, sessions, plan } = await setup();
    const other = await t.as("TRAINER");
    const otherTrainer = (await manager.agent.post("/trainers").send({ userId: other.user.id }).expect(201)).body.trainer;
    const otherTemplate = (
      await manager.agent.post("/class-templates").send({ name: "Yoga", trainerId: otherTrainer.id, weekday: 5, startTime: "07:00", durationMinutes: 45, capacity: 5 }).expect(201)
    ).body.template;
    const a = await memberWithMembership(manager.agent, plan.id);
    const b = await memberWithMembership(manager.agent, plan.id);
    await manager.agent.post("/trainer-assignments").send({ trainerId: trainer.id, memberId: a.member.id }).expect(201);
    const detail = await trainerLogin.agent.get(`/members/${a.member.id}`).expect(200);
    expect(detail.body.trainers).toEqual([{ trainerId: trainer.id, name: trainerLogin.user.name }]);
    await trainerLogin.agent.get(`/members/${b.member.id}`).expect(404);
    expect((await manager.agent.get(`/members/${b.member.id}`).expect(200)).body.trainers).toEqual([]);
    const mine = await trainerLogin.agent.get("/trainers/me/members").expect(200);
    expect(mine.body.items.map((m: { id: string }) => m.id)).toEqual([a.member.id]);
    const schedule = await trainerLogin.agent.get("/trainers/me/schedule?days=28").expect(200);
    expect(schedule.body.classes).toHaveLength(4);
    expect(schedule.body.classes.every((c: { templateId: string }) => c.templateId !== otherTemplate.id)).toBe(true);
    await trainerLogin.agent.get(`/sessions/${sessions[0].id}/roster`).expect(200);
    const otherSessions = await t.db.select().from(classSessions).where(eq(classSessions.templateId, otherTemplate.id));
    await trainerLogin.agent.get(`/sessions/${otherSessions[0].id}/roster`).expect(404);
    await trainerLogin.agent.post(`/sessions/${otherSessions[0].id}/attendance`).send({ bookingIds: [] }).expect(404);
  });

  it("marks attendance, and unmarked bookings become no-shows after the class", async () => {
    const { manager, trainerLogin, sessions, plan } = await setup();
    const a = await memberWithMembership(manager.agent, plan.id);
    const b = await memberWithMembership(manager.agent, plan.id);
    const ba = (await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: a.member.id }).expect(201)).body.booking;
    const bb = (await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: b.member.id }).expect(201)).body.booking;
    const res = await trainerLogin.agent.post(`/sessions/${sessions[0].id}/attendance`).send({ bookingIds: [ba.id] }).expect(200);
    expect(res.body.updated).toBe(1);
    t.clock.set(addisInstant("2026-10-22", 19, 30));
    const classes = t.app.get(ClassesService);
    expect(await classes.markNoShows()).toBe(1);
    expect(await classes.markNoShows()).toBe(0);
    const [rowB] = await t.db.select().from(bookings).where(eq(bookings.id, bb.id));
    const [rowA] = await t.db.select().from(bookings).where(eq(bookings.id, ba.id));
    expect(rowA.status).toBe("ATTENDED");
    expect(rowB.status).toBe("NO_SHOW");
  });

  it("cancelling a class cancels its bookings and emits an event", async () => {
    const { manager, sessions, plan } = await setup();
    const a = await memberWithMembership(manager.agent, plan.id);
    await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: a.member.id }).expect(201);
    await manager.agent.post(`/sessions/${sessions[0].id}/cancel`).send({ reason: "Trainer sick" }).expect(200);
    const rows = await t.db.select().from(bookings).where(eq(bookings.sessionId, sessions[0].id));
    expect(rows[0].status).toBe("CANCELLED");
    await manager.agent.post("/bookings").send({ sessionId: sessions[0].id, memberId: a.member.id }).expect(409);
  });

  it("lets trainers book personal sessions only for themselves", async () => {
    const { manager, trainerLogin, trainer, plan } = await setup();
    const other = await t.as("TRAINER");
    const otherTrainer = (await manager.agent.post("/trainers").send({ userId: other.user.id }).expect(201)).body.trainer;
    const a = await memberWithMembership(manager.agent, plan.id);
    const startsAt = addisInstant("2026-10-23", 10).toISOString();
    await trainerLogin.agent.post("/personal-sessions").send({ trainerId: trainer.id, memberId: a.member.id, startsAt, durationMinutes: 60 }).expect(201);
    await trainerLogin.agent.post("/personal-sessions").send({ trainerId: otherTrainer.id, memberId: a.member.id, startsAt, durationMinutes: 60 }).expect(403);
    const list = await trainerLogin.agent.get("/personal-sessions").expect(200);
    expect(list.body.items).toHaveLength(1);
    const otherList = await other.agent.get("/personal-sessions").expect(200);
    expect(otherList.body.items).toHaveLength(0);
  });

  it("keeps class setup to managers", async () => {
    const { trainer, sessions } = await setup();
    for (const role of ["FRONT_DESK", "TRAINER"]) {
      const { agent } = await t.as(role);
      await agent.post("/class-templates").send({ name: "X", trainerId: trainer.id, weekday: 1, startTime: "10:00", durationMinutes: 30, capacity: 3 }).expect(403);
      await agent.post(`/sessions/${sessions[0].id}/cancel`).send({ reason: "No" }).expect(403);
      await agent.post("/trainer-assignments").send({ trainerId: trainer.id, memberId: trainer.id }).expect(403);
    }
    const later = await relogin(t, (await t.as("OWNER")).user);
    await later.get("/sessions").expect(200);
  });
});
