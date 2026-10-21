import { createServer, type IncomingMessage, type Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { addisInstant } from "@platform/shared";
import { messageLog, outboxEvents, OutboxService, verifyWebhook, OutboxDispatcher, type Database } from "@platform/nest-common";
import { activities, leads, units } from "../src/db/schema";
import { createTestApp, type TestApp } from "./harness";
import { jpeg, makeProject, makeUnit } from "./fixtures";

describe("Task 11: owner dashboard", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => t.reset());

  /** 20 leads with known timings, created directly so every figure is predictable. */
  async function seed(db: Database, brokers: string[], customerId: string) {
    const day = (d: number, h: number, m = 0) => addisInstant(`2026-10-${String(d).padStart(2, "0")}`, h, m);
    const rows: Array<typeof leads.$inferInsert> = [];
    for (let i = 0; i < 20; i += 1) {
      const createdAt = day(1 + (i % 10), 9);
      const contactMinutes = i < 8 ? 30 : i < 14 ? 120 : null; // 8 fast, 6 slow, 6 never
      rows.push({
        customerId,
        source: i % 2 === 0 ? "WEBSITE" : "PHONE",
        status: i < 4 ? "SIGNED" : i < 7 ? "LOST" : "INQUIRY",
        lostReason: i >= 4 && i < 7 ? "x" : null,
        assignedToId: brokers[i % 2],
        createdAt,
        firstContactAt: contactMinutes === null ? null : new Date(createdAt.getTime() + contactMinutes * 60_000),
        closedAt: i < 7 ? day(15, 12) : null,
        nextStepAt: i >= 7 && i < 10 ? day(20, 9) : null,
      });
    }
    const inserted = await db.insert(leads).values(rows).returning({ id: leads.id });
    // System activities never count as contact.
    await db.insert(activities).values(inserted.map((l) => ({ leadId: l.id, type: "NOTE", isSystem: true, occurredAt: day(1, 9, 1) })));
  }

  it("matches a known data set exactly", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const b1 = await t.createUser("BROKER", { name: "Alem" });
    const b2 = await t.createUser("BROKER", { name: "Bekele" });
    const c = await agent.post("/customers").send({ name: "Seed", phone: "0911999999" }).expect(201);
    await seed(t.db, [b1.id, b2.id], c.body.customer.id);
    const r = await agent.get("/reports/leads?from=2026-10-01&to=2026-10-31").expect(200);
    expect(r.body).toMatchObject({ total: 20, signed: 4, contacted: 14, notContacted: 6, byStatus: { SIGNED: 4, LOST: 3, INQUIRY: 13 }, bySource: { WEBSITE: 10, PHONE: 10 } });
    expect(r.body.conversionRate).toBeCloseTo(0.2);
    expect(r.body.avgMinutesToFirstContact).toBeCloseTo((8 * 30 + 6 * 120) / 14, 1);
    expect(r.body.medianMinutesToFirstContact).toBe(30);
    const b = await agent.get("/reports/brokers?from=2026-10-01&to=2026-10-31").expect(200);
    expect(b.body.items).toEqual([
      { brokerId: b1.id, name: "Alem", assigned: 10, contactedWithinHour: 4, overdueFollowUps: 1, signed: 2 }, // overdue: lead 8
      { brokerId: b2.id, name: "Bekele", assigned: 10, contactedWithinHour: 4, overdueFollowUps: 2, signed: 2 }, // overdue: leads 7 and 9
    ]);
  });

  it("lists listings that need attention", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const p = await makeProject(agent);
    const withPhoto = await makeUnit(agent, p.id, { code: "P-1" });
    await makeUnit(agent, p.id, { code: "P-2" });
    await agent.post(`/units/${withPhoto.id}/photos`).attach("file", await jpeg(), "a.jpg").expect(201);
    await t.db.update(units).set({ updatedAt: new Date("2026-08-01T00:00:00Z"), statusChangedAt: new Date("2026-08-01T00:00:00Z") }).where(eq(units.code, "P-2"));
    const res = await agent.get("/reports/listings").expect(200);
    expect(res.body.byStatus).toEqual({ AVAILABLE: 2 });
    expect(res.body.withoutPhotos.map((u: { code: string }) => u.code)).toEqual(["P-2"]);
    expect(res.body.notUpdatedIn30Days.map((u: { code: string }) => u.code)).toEqual(["P-2"]);
    expect(res.body.daysOnMarket[0]).toMatchObject({ code: "P-2", days: 82 });
  });

  it("is closed to brokers and exports CSV with a BOM", async () => {
    const { agent: broker } = await t.as("BROKER");
    for (const path of ["/reports/leads", "/reports/brokers", "/reports/listings"]) await broker.get(path).expect(403);
    const { agent } = await t.as("OWNER");
    await t.createUser("BROKER", { name: "ብሩክ" });
    const csv = await agent.get("/reports/brokers?format=csv").expect(200);
    expect(csv.text.startsWith("﻿")).toBe(true);
    expect(csv.text).toContain("ብሩክ");
  });

  it("answers in under two seconds with 5,000 leads and 2,000 units", async () => {
    const { agent } = await t.as("OWNER");
    const c = await agent.post("/customers").send({ name: "Bulk", phone: "0911888888" }).expect(201);
    const p = await makeProject(agent);
    const broker = await t.createUser("BROKER");
    await t.db.execute(sql`INSERT INTO units (project_id, code, type, purpose, price_minor)
      SELECT ${p.id}::uuid, 'U-' || g, 'APARTMENT', 'SALE', 100000 FROM generate_series(1, 2000) g`);
    await t.db.execute(sql`INSERT INTO leads (customer_id, source, status, assigned_to_id, created_at, first_contact_at)
      SELECT ${c.body.customer.id}::uuid, 'PHONE', 'INQUIRY', ${broker.id}::uuid, now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval + interval '20 minutes'
      FROM generate_series(1, 5000) g`);
    const started = Date.now();
    await Promise.all([agent.get("/reports/leads").expect(200), agent.get("/reports/brokers").expect(200), agent.get("/reports/listings").expect(200)]);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("Task 12: events and webhook outbox", () => {
  let server: Server;
  let received: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
  let failNext = 0;
  let url = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        if (failNext > 0) {
          failNext -= 1;
          res.statusCode = 500;
          res.end("no");
          return;
        }
        received.push({ headers: req.headers, body });
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    url = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  describe("in n8n mode", () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({ AUTOMATION_MODE: "n8n", N8N_WEBHOOK_URL: url });
    });
    afterAll(() => t.close());
    beforeEach(async () => {
      await t.reset();
      received = [];
      failNext = 0;
    });

    it("signs each webhook so the receiver can verify it", async () => {
      const { agent } = await t.as("SALES_MANAGER");
      await agent.post("/leads").send({ source: "PHONE", customer: { name: "W", phone: "0914000001" } }).expect(201);
      expect(await t.dispatch()).toBe(1);
      expect(received).toHaveLength(1);
      const h = received[0].headers;
      expect(h["x-event-name"]).toBe("lead.created.v1");
      expect(verifyWebhook("test-webhook-secret-123", String(h["x-timestamp"]), received[0].body, String(h["x-signature"]), t.clock.now().getTime())).toBe(true);
      const body = JSON.parse(received[0].body);
      expect(Object.keys(body.payload).sort()).toEqual(["assignedToId", "customerId", "leadId", "source"]);
      expect(received[0].body).not.toContain("0914000001");
    });

    it("retries with backoff and marks the event FAILED after 8 attempts", async () => {
      const { agent } = await t.as("SALES_MANAGER");
      await agent.post("/leads").send({ source: "PHONE", customer: { name: "R", phone: "0914000002" } }).expect(201);
      failNext = 100;
      let previousNext = 0;
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        expect(await t.dispatch()).toBe(0);
        const [e] = await t.db.select().from(outboxEvents);
        expect(e.attempts).toBe(attempt);
        if (attempt < 8) {
          expect(e.status).toBe("PENDING");
          const wait = e.nextAttemptAt.getTime() - t.clock.now().getTime();
          expect(wait).toBeGreaterThan(previousNext);
          previousNext = wait;
          // Nothing happens before the backoff time.
          expect(await t.dispatch()).toBe(0);
          t.clock.set(e.nextAttemptAt);
        } else {
          expect(e.status).toBe("FAILED");
        }
      }
    });

    it("never delivers an event twice when two dispatchers run at once", async () => {
      const { agent } = await t.as("SALES_MANAGER");
      for (let i = 0; i < 12; i += 1) await agent.post("/leads").send({ source: "PHONE", customer: { name: `C${i}`, phone: `09140001${String(i).padStart(2, "0")}` } }).expect(201);
      const dispatcher = t.app.get(OutboxDispatcher);
      const [a, b] = await Promise.all([dispatcher.dispatchOnce(), dispatcher.dispatchOnce()]);
      expect(a + b).toBe(12);
      expect(received).toHaveLength(12);
      expect(new Set(received.map((r) => r.headers["x-event-id"])).size).toBe(12);
    });
  });

  describe("transactions and messaging", () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp();
    });
    afterAll(() => t.close());
    beforeEach(() => t.reset());

    it("leaves no event when the transaction rolls back", async () => {
      const outbox = t.app.get(OutboxService);
      await expect(
        t.db.transaction(async (tx) => {
          await outbox.emit(tx as never, "lead.created.v1", { leadId: "x" });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await t.db.select().from(outboxEvents)).toHaveLength(0);
    });

    it("refuses to message a customer without consent and logs BLOCKED_NO_CONSENT", async () => {
      const { agent } = await t.as("SALES_MANAGER");
      const c = await agent.post("/customers").send({ name: "Q", phone: "0914000099", telegramChatId: "555" }).expect(201);
      const res = await t
        .http()
        .post("/internal/messages/send")
        .set("x-internal-secret", "test-internal-secret-123")
        .send({ recipient: { kind: "subject", id: c.body.customer.id }, templateKey: "customer.rent_due_soon", data: { amount: "1", unit: "A", dueDate: "x" } })
        .expect(200);
      expect(res.body.status).toBe("BLOCKED_NO_CONSENT");
      expect(t.telegram.sent).toHaveLength(0);
      const [log] = await t.db.select().from(messageLog).where(eq(messageLog.subjectId, c.body.customer.id));
      expect(log.status).toBe("BLOCKED_NO_CONSENT");
    });

    it("protects the internal endpoint with the shared secret", async () => {
      await t.http().post("/internal/messages/send").send({}).expect(401);
      await t.http().post("/internal/messages/send").set("x-internal-secret", "wrong-secret-value-123").send({}).expect(401);
    });

    it("sends staff a Telegram message when a lead is created (direct mode, end to end)", async () => {
      await t.createUser("SALES_MANAGER", { telegramChatId: "1001", name: "Mesfin" });
      const { agent } = await t.as("BROKER");
      await agent.post("/leads").send({ source: "WALK_IN", customer: { name: "Hana", phone: "0914000100" } }).expect(201);
      await t.dispatch();
      expect(t.telegram.sent.map((m) => m.to.telegramChatId)).toEqual(["1001"]);
      expect(t.telegram.sent[0].message.subject).toContain("Hana");
      // Retrying the same event never sends twice.
      await t.db.update(outboxEvents).set({ status: "PENDING" });
      await t.dispatch();
      expect(t.telegram.sent).toHaveLength(1);
    });

    it("lets an n8n workflow hand an event back for its standard messages, once", async () => {
      await t.createUser("SALES_MANAGER", { telegramChatId: "2002", name: "Selam" });
      const { agent } = await t.as("BROKER");
      await agent.post("/leads").send({ source: "WALK_IN", customer: { name: "Kidus", phone: "0914000101" } }).expect(201);
      const [event] = await t.db.select().from(outboxEvents).where(eq(outboxEvents.name, "lead.created.v1"));
      const call = (id: string, secret = "test-internal-secret-123") => t.http().post("/internal/events/messages").set("x-internal-secret", secret).send({ id });
      await call(event.id, "wrong-secret-value-123").expect(401);
      await call("00000000-0000-4000-8000-000000000000").expect(404);
      await call(event.id).expect(200, { handled: true });
      await call(event.id).expect(200);
      expect(t.telegram.sent.map((m) => m.to.telegramChatId)).toEqual(["2002"]);
    });
  });
});
