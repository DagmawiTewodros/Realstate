import { eq } from "drizzle-orm";
import { addisInstant } from "@platform/shared";
import { messageLog, outboxEvents, renderTemplate, templatePlaceholders } from "@platform/nest-common";
import { offerNotifications, savedSearches } from "../src/db/schema";
import { ReminderScheduler } from "../src/automation/scheduler";
import { PROPERTY_TEMPLATES } from "../src/automation/templates";
import { createTestApp, type Agent, type TestApp } from "./harness";
import { makeProject, makeUnit } from "./fixtures";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const scheduler = () => t.app.get(ReminderScheduler);
const eventCount = async (name: string) => (await t.db.select().from(outboxEvents).where(eq(outboxEvents.name, name))).length;

async function customerWithConsent(agent: Agent, name: string, phone: string, chatId: string | null, locale: "am" | "en" = "en") {
  const c = (await agent.post("/customers").send({ name, phone, telegramChatId: chatId, locale }).expect(201)).body.customer;
  if (chatId) await agent.post(`/customers/${c.id}/consent`).send({ channel: "TELEGRAM", granted: true }).expect(201);
  return c as { id: string };
}

describe("Task 19: reminder workflows", () => {
  it("templates exist in both languages and render with the data the rules send", () => {
    for (const key of Object.keys(PROPERTY_TEMPLATES)) {
      expect(Object.keys(PROPERTY_TEMPLATES[key]).sort()).toEqual(["am", "en"]);
      const data = Object.fromEntries(templatePlaceholders(PROPERTY_TEMPLATES, key).map((p) => [p, "x"]));
      for (const locale of ["am", "en"] as const) expect(renderTemplate(PROPERTY_TEMPLATES, key, locale, data).text.length).toBeGreaterThan(5);
    }
  });

  it("books a viewing, confirms it, and reminds the customer and broker the day before, once", async () => {
    const { agent: broker, user } = await t.as("BROKER", { telegramChatId: "2002" });
    const c = await customerWithConsent(broker, "Viewer", "0917000001", "3003");
    const lead = (await broker.post("/leads").send({ source: "PHONE", customerId: c.id }).expect(201)).body.lead;
    const when = addisInstant("2026-10-24", 10, 30);
    await broker.post(`/leads/${lead.id}/viewings`).send({ scheduledAt: when.toISOString() }).expect(201);
    await t.dispatch();
    const toCustomer = t.telegram.sent.filter((m) => m.to.telegramChatId === "3003");
    expect(toCustomer.map((m) => m.message.subject)).toEqual(["Your viewing is booked"]);
    expect(toCustomer[0].message.text).toContain("To stop these messages");
    // Staff messages carry no opt-out line.
    expect(t.telegram.sent.find((m) => m.to.telegramChatId === "2002")!.message.text).not.toContain("To stop these messages");

    // 22 Oct: not yet. 23 Oct: the day before.
    expect((await scheduler().run()).viewingReminders).toBe(0);
    t.clock.set(addisInstant("2026-10-23", 9));
    expect((await scheduler().run()).viewingReminders).toBe(1);
    expect((await scheduler().run()).viewingReminders).toBe(0);
    await t.dispatch();
    const reminders = t.telegram.sent.filter((m) => m.message.subject.includes("Reminder") || m.message.subject.includes("Viewing tomorrow"));
    expect(reminders.map((m) => m.to.telegramChatId).sort()).toEqual(["2002", "3003"]);
    expect(user.id).toBeTruthy();
  });

  it("sends rent due and overdue reminders once per threshold, with a fake clock in Addis time", async () => {
    const { agent: pm } = await t.as("PROPERTY_MANAGER", { telegramChatId: "4004" });
    const { agent: sm } = await t.as("SALES_MANAGER");
    const project = await makeProject(sm);
    const unit = await makeUnit(sm, project.id, { purpose: "RENT" });
    const tenant = await customerWithConsent(sm, "Renter", "0917000002", "5005");
    const lease = (await pm.post("/leases").send({ unitId: unit.id, tenantId: tenant.id, startDate: "2026-11-01", endDate: "2027-04-30", rentMinor: 2_500_000 }).expect(201)).body.lease;
    await pm.post(`/leases/${lease.id}/activate`).expect(200);

    t.clock.set(addisInstant("2026-10-29", 9)); // 3 days before 1 Nov
    let r = await scheduler().run();
    expect(r.rentDueSoon).toBe(1);
    expect((await scheduler().run()).rentDueSoon).toBe(0);
    t.clock.set(addisInstant("2026-11-02", 9)); // day 1 overdue
    r = await scheduler().run();
    expect(r.rentOverdue).toBe(1);
    expect((await scheduler().run()).rentOverdue).toBe(0);
    t.clock.set(addisInstant("2026-11-08", 9)); // day 7 overdue
    expect((await scheduler().run()).rentOverdue).toBe(1);
    expect(await eventCount("rent.due_soon.v1")).toBe(1);
    expect(await eventCount("rent.overdue.v1")).toBe(2);
    await t.dispatch();
    const toTenant = t.telegram.sent.filter((m) => m.to.telegramChatId === "5005").map((m) => m.message.subject);
    expect(toTenant).toEqual(["Rent due on 22 Tikimt 2019 (1 Nov 2026)", "Rent overdue", "Rent overdue"]);
    expect(t.telegram.sent.filter((m) => m.to.telegramChatId === "4004")).toHaveLength(2);
  });

  it("holds customer messages during quiet hours and sends them at 07:00", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const c = await customerWithConsent(agent, "Night", "0917000003", "6006");
    t.clock.set(addisInstant("2026-10-22", 21, 30));
    const res = await t
      .http()
      .post("/internal/messages/send")
      .set("x-internal-secret", "test-internal-secret-123")
      .send({ recipient: { kind: "subject", id: c.id }, templateKey: "customer.rent_due_soon", data: { amount: "1", unit: "A", dueDate: "x" } })
      .expect(200);
    expect(res.body.status).toBe("DEFERRED_QUIET_HOURS");
    expect(t.telegram.sent).toHaveLength(0);
    t.clock.set(addisInstant("2026-10-23", 6, 59));
    expect((await scheduler().run()).deferredSent).toBe(0);
    t.clock.set(addisInstant("2026-10-23", 7, 0));
    expect((await scheduler().run()).deferredSent).toBe(1);
    expect(t.telegram.sent).toHaveLength(1);
  });

  it("does not message a customer who opted out and logs it", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const c = await customerWithConsent(agent, "Gone", "0917000004", "7007");
    await agent.post(`/customers/${c.id}/consent`).send({ channel: "TELEGRAM", granted: false }).expect(201);
    const lead = (await agent.post("/leads").send({ source: "PHONE", customerId: c.id }).expect(201)).body.lead;
    await agent.post(`/leads/${lead.id}/viewings`).send({ scheduledAt: addisInstant("2026-10-25", 10).toISOString() }).expect(201);
    await t.dispatch();
    expect(t.telegram.sent.filter((m) => m.to.telegramChatId === "7007")).toHaveLength(0);
    const logs = await t.db.select().from(messageLog).where(eq(messageLog.subjectId, c.id));
    expect(logs.map((l) => l.status)).toEqual(["BLOCKED_NO_CONSENT"]);
  });

  it("nudges the broker about overdue follow-ups, then the managers a day later", async () => {
    await t.createUser("SALES_MANAGER", { telegramChatId: "8008" });
    const { agent: broker } = await t.as("BROKER", { telegramChatId: "9009" });
    const lead = (await broker.post("/leads").send({ source: "PHONE", customer: { name: "Slow", phone: "0917000005" }, nextStepAt: addisInstant("2026-10-22", 8).toISOString(), nextStepNote: "Call back" }).expect(201)).body.lead;
    await broker.post(`/leads/${lead.id}/activities`).send({ type: "CALL" }).expect(201);
    expect((await scheduler().run()).followUps).toBe(1);
    expect((await scheduler().run()).followUps).toBe(0);
    t.clock.set(addisInstant("2026-10-23", 9));
    expect((await scheduler().run()).followUps).toBe(1);
    await t.dispatch();
    expect(t.telegram.sent.filter((m) => m.to.telegramChatId === "9009" && m.message.subject.startsWith("Follow-up overdue"))).toHaveLength(1);
    expect(t.telegram.sent.filter((m) => m.to.telegramChatId === "8008").map((m) => m.message.subject)).toContain("Follow-up overdue: Slow");
  });

  it("stops a reminder type when the owner switches it off", async () => {
    const { agent: owner } = await t.as("OWNER");
    await owner.put("/settings/reminders").send({ enabled: { "lead.followup_overdue": false } }).expect(200);
    const { agent: broker } = await t.as("BROKER");
    await broker.post("/leads").send({ source: "PHONE", customer: { name: "Off", phone: "0917000006" }, nextStepAt: addisInstant("2026-10-22", 8).toISOString() }).expect(201);
    expect((await scheduler().run()).followUps).toBe(0);
    expect(await eventCount("lead.followup_overdue.v1")).toBe(0);
  });
});

describe("Task 20: saved searches and new-offer alerts", () => {
  async function setup() {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent, "Lakeside", "Bole Atlas");
    const a = await customerWithConsent(agent, "Want rent", "0918000001", "1101");
    const b = await customerWithConsent(agent, "Want rent too", "0918000002", "1102");
    const c = await customerWithConsent(agent, "Wants sale", "0918000003", "1103");
    await agent.post("/saved-searches").send({ customerId: a.id, purpose: "RENT", area: "bole", maxPriceMinor: 5_000_000 }).expect(201);
    await agent.post("/saved-searches").send({ customerId: a.id, purpose: "RENT", bedrooms: 2 }).expect(201);
    await agent.post("/saved-searches").send({ customerId: b.id, purpose: "RENT" }).expect(201);
    await agent.post("/saved-searches").send({ customerId: c.id, purpose: "SALE" }).expect(201);
    return { agent, project, a, b, c };
  }

  it("sends one message per matching customer and none to others", async () => {
    const s = await setup();
    const unit = await makeUnit(s.agent, s.project.id, { purpose: "RENT", priceMinor: 4_000_000, bedrooms: 3 });
    await s.agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
    await t.dispatch();
    const chats = t.telegram.sent.map((m) => m.to.telegramChatId).sort();
    expect(chats).toEqual(["1101", "1102"]);
    expect(t.telegram.sent[0].message.text).toContain("/listings/");
    expect(t.telegram.sent[0].message.text).toContain("/saved-search/remove/");
  });

  it("never notifies the same search twice for the same unit and event", async () => {
    const s = await setup();
    const unit = await makeUnit(s.agent, s.project.id, { purpose: "RENT", priceMinor: 4_000_000 });
    await s.agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
    await s.agent.post(`/units/${unit.id}/publish`).send({ isPublished: false }).expect(200);
    await s.agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
    await t.dispatch();
    await t.db.update(outboxEvents).set({ status: "PENDING" });
    await t.dispatch();
    expect(t.telegram.sent.filter((m) => m.to.telegramChatId === "1102")).toHaveLength(1);
  });

  it("emits a price drop only when the price goes down and notifies once", async () => {
    const s = await setup();
    // 9 M is above customer A's 5 M limit, and 1 bedroom is below A's 2-bedroom search: only B matches.
    const unit = await makeUnit(s.agent, s.project.id, { purpose: "RENT", priceMinor: 9_000_000, bedrooms: 1 });
    await s.agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
    await t.dispatch();
    expect(t.telegram.sent.map((m) => m.to.telegramChatId)).toEqual(["1102"]);
    await s.agent.patch(`/units/${unit.id}`).send({ priceMinor: 4_500_000 }).expect(200);
    await t.dispatch();
    expect(t.telegram.sent.filter((m) => m.message.subject.startsWith("Price drop")).map((m) => m.to.telegramChatId).sort()).toEqual(["1101", "1102"]);
  });

  it("caps offers at 3 per 7 days and sends the rest in one digest", async () => {
    const s = await setup();
    for (let day = 0; day < 5; day += 1) {
      t.clock.set(addisInstant(`2026-10-${22 + day}`, 10));
      const { agent } = await t.as("SALES_MANAGER");
      const unit = await makeUnit(agent, s.project.id, { purpose: "RENT", priceMinor: 9_000_000, bedrooms: 0, code: `CAP-${day}` });
      await agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
      await t.dispatch();
    }
    const toB = () => t.telegram.sent.filter((m) => m.to.telegramChatId === "1102");
    expect(toB()).toHaveLength(3);
    expect((await scheduler().run()).digests).toBe(0);
    t.clock.set(addisInstant("2026-10-29", 10, 1));
    expect((await scheduler().run()).digests).toBe(1);
    expect(toB()).toHaveLength(4);
    expect(toB()[3].message.subject).toBe("2 properties that match your search");
    const statuses = (await t.db.select().from(offerNotifications)).filter((o) => o.customerId === s.b.id).map((o) => o.status).sort();
    expect(statuses).toEqual(["DIGESTED", "DIGESTED", "SENT", "SENT", "SENT"]);
  });

  it("gives nothing to a customer without consent, and logs the attempt", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent);
    const quiet = (await agent.post("/customers").send({ name: "Quiet", phone: "0918000009", telegramChatId: "1109" }).expect(201)).body.customer;
    await agent.post("/saved-searches").send({ customerId: quiet.id, purpose: "RENT" }).expect(201);
    const unit = await makeUnit(agent, project.id, { purpose: "RENT" });
    await agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
    await t.dispatch();
    expect(t.telegram.sent).toHaveLength(0);
    const logs = await t.db.select().from(messageLog).where(eq(messageLog.subjectId, quiet.id));
    expect(logs.map((l) => l.status)).toEqual(["BLOCKED_NO_CONSENT"]);
    const [n] = await t.db.select().from(offerNotifications);
    expect(n.status).toBe("BLOCKED");
  });

  it("removes one saved search through its link without opting out of everything", async () => {
    const s = await setup();
    const unit = await makeUnit(s.agent, s.project.id, { purpose: "RENT", priceMinor: 4_000_000 });
    await s.agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
    await t.dispatch();
    const msg = t.telegram.sent.find((m) => m.to.telegramChatId === "1102")!;
    const token = /saved-search\/remove\/([\w.-]+)/.exec(msg.message.text)![1];
    await t.http().post(`/public/saved-searches/remove/${token}`).expect(200);
    const rows = await t.db.select().from(savedSearches).where(eq(savedSearches.customerId, s.b.id));
    expect(rows.every((r) => !r.isActive)).toBe(true);
    const consent = await s.agent.get(`/customers/${s.b.id}`).expect(200);
    expect(consent.body.consent.TELEGRAM).toBe(true);
    await t.http().post("/public/saved-searches/remove/bad.token").expect(404);
  });
});
