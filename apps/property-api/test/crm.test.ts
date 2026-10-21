import { eq } from "drizzle-orm";
import { outboxEvents } from "@platform/nest-common";
import { createTestApp, type TestApp } from "./harness";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

async function eventNames() {
  const rows = await t.db.select({ name: outboxEvents.name }).from(outboxEvents);
  return rows.map((r) => r.name);
}

describe("Task 05: customers and consent", () => {
  it("normalizes phones and warns about duplicates without blocking", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const a = await agent.post("/customers").send({ name: "Abebe", phone: "0911 23 45 67" }).expect(201);
    expect(a.body.customer.phone).toBe("+251911234567");
    expect(a.body.warnings).toEqual([]);
    const b = await agent.post("/customers").send({ name: "Abebe B", phone: "+251911234567" }).expect(201);
    expect(b.body.warnings[0].code).toBe("POSSIBLE_DUPLICATE");
  });

  it("enforces consent per channel: none, granted, revoked", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const c = await agent.post("/customers").send({ name: "Sara", email: "sara@example.com" }).expect(201);
    const id = c.body.customer.id;
    let res = await agent.get(`/customers/${id}`).expect(200);
    expect(res.body.consent).toEqual({ TELEGRAM: false, EMAIL: false, SMS: false, WHATSAPP: false });
    res = await agent.post(`/customers/${id}/consent`).send({ channel: "EMAIL", granted: true }).expect(201);
    expect(res.body.consent.EMAIL).toBe(true);
    expect(res.body.consent.TELEGRAM).toBe(false);
    res = await agent.post(`/customers/${id}/consent`).send({ channel: "EMAIL", granted: false }).expect(201);
    expect(res.body.consent.EMAIL).toBe(false);
  });

  it("lets a broker see only customers they created or on their leads", async () => {
    const { agent: b1 } = await t.as("BROKER");
    const { agent: b2 } = await t.as("BROKER");
    const c = await b1.post("/customers").send({ name: "Mine", phone: "0911000001" }).expect(201);
    await b2.get(`/customers/${c.body.customer.id}`).expect(404);
    const list = await b2.get("/customers").expect(200);
    expect(list.body.total).toBe(0);
    await b1.get(`/customers/${c.body.customer.id}`).expect(200);
  });

  it("opt-out link revokes consent, reveals nothing, and rejects bad tokens", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const c = await agent.post("/customers").send({ name: "Opt", phone: "0911000002", telegramChatId: "123" }).expect(201);
    const id = c.body.customer.id;
    await agent.post(`/customers/${id}/consent`).send({ channel: "TELEGRAM", granted: true }).expect(201);
    const consent = t.app.get((await import("@platform/nest-common")).ConsentService);
    const token = consent.optOutToken(id);
    const check = await t.http().get(`/optout/${token}`).expect(200);
    expect(check.body).toEqual({ valid: true });
    await t.http().post(`/optout/${token}`).expect(200);
    const after = await agent.get(`/customers/${id}`).expect(200);
    expect(after.body.consent.TELEGRAM).toBe(false);
    await t.http().get(`/optout/${token.slice(0, -2)}xx`).expect(404);
    await t.http().post("/optout/not-a-token").expect(404);
  });

  it("exports and anonymises for the owner only, keeping counts", async () => {
    const { agent: manager } = await t.as("SALES_MANAGER");
    const c = await manager.post("/customers").send({ name: "Private Person", phone: "0911000003", email: "p@example.com" }).expect(201);
    const id = c.body.customer.id;
    await manager.get(`/customers/${id}/export`).expect(403);
    const { agent: owner } = await t.as("OWNER");
    const exp = await owner.get(`/customers/${id}/export`).expect(200);
    expect(exp.body.customer.name).toBe("Private Person");
    const anon = await owner.post(`/customers/${id}/anonymise`).expect(201);
    expect(anon.body.customer).toMatchObject({ phone: null, email: null, telegramChatId: null });
    expect(anon.body.customer.name).not.toContain("Private");
    const list = await owner.get("/customers").expect(200);
    expect(list.body.total).toBe(1);
  });
});

describe("Task 06: leads", () => {
  async function setup() {
    const manager = await t.as("SALES_MANAGER");
    const b1 = await t.as("BROKER");
    const b2 = await t.as("BROKER");
    return { manager, b1, b2 };
  }

  it("creates a lead with a new customer and emits lead.created.v1", async () => {
    const { manager } = await setup();
    const res = await manager.agent.post("/leads").send({ source: "PHONE", customer: { name: "Kebede", phone: "0912345678" } }).expect(201);
    expect(res.body.lead.status).toBe("INQUIRY");
    expect(await eventNames()).toEqual(["lead.created.v1"]);
  });

  it("emits lead.assigned.v1 when assigning, and only managers can assign", async () => {
    const { manager, b1 } = await setup();
    const lead = await manager.agent.post("/leads").send({ source: "PHONE", customer: { name: "K", phone: "0912345679" } }).expect(201);
    await b1.agent.post(`/leads/${lead.body.lead.id}/assign`).send({ assignedToId: b1.user.id }).expect(403);
    await manager.agent.post(`/leads/${lead.body.lead.id}/assign`).send({ assignedToId: b1.user.id }).expect(201);
    expect(await eventNames()).toEqual(["lead.created.v1", "lead.assigned.v1"]);
  });

  it("keeps brokers out of other brokers' leads", async () => {
    const { b1, b2 } = await setup();
    const lead = await b1.agent.post("/leads").send({ source: "WALK_IN", customer: { name: "L", phone: "0912000001" } }).expect(201);
    const id = lead.body.lead.id;
    await b2.agent.get(`/leads/${id}`).expect(404);
    await b2.agent.patch(`/leads/${id}`).send({ nextStepNote: "x" }).expect(404);
    await b2.agent.post(`/leads/${id}/status`).send({ status: "VIEWING" }).expect(404);
    await b2.agent.post(`/leads/${id}/activities`).send({ type: "CALL" }).expect(404);
    const list = await b2.agent.get("/leads").expect(200);
    expect(list.body.total).toBe(0);
    await b1.agent.get(`/leads/${id}`).expect(200);
  });

  it("rejects every illegal status move with 409 and a code", async () => {
    const { manager } = await setup();
    const lead = await manager.agent.post("/leads").send({ source: "PHONE", customer: { name: "M", phone: "0912000002" } }).expect(201);
    const id = lead.body.lead.id;
    for (const status of ["OFFER", "SIGNED", "INQUIRY"]) {
      const res = await manager.agent.post(`/leads/${id}/status`).send({ status }).expect(409);
      expect(["ILLEGAL_MOVE", "SAME_STATUS"]).toContain(res.body.code);
    }
    await manager.agent.post(`/leads/${id}/status`).send({ status: "VIEWING" }).expect(201);
    await manager.agent.post(`/leads/${id}/status`).send({ status: "SIGNED" }).expect(409);
    await manager.agent.post(`/leads/${id}/status`).send({ status: "OFFER" }).expect(201);
    await manager.agent.post(`/leads/${id}/status`).send({ status: "SIGNED" }).expect(201);
    const res = await manager.agent.post(`/leads/${id}/status`).send({ status: "LOST", lostReason: "x" }).expect(409);
    expect(res.body.code).toBe("ILLEGAL_MOVE");
  });

  it("lets only managers move a lead back, and LOST needs a reason", async () => {
    const { b1, manager } = await setup();
    const lead = await b1.agent.post("/leads").send({ source: "PHONE", customer: { name: "N", phone: "0912000003" } }).expect(201);
    const id = lead.body.lead.id;
    await b1.agent.post(`/leads/${id}/status`).send({ status: "VIEWING" }).expect(201);
    const back = await b1.agent.post(`/leads/${id}/status`).send({ status: "INQUIRY" }).expect(409);
    expect(back.body.code).toBe("MANAGER_ONLY");
    await manager.agent.post(`/leads/${id}/status`).send({ status: "INQUIRY" }).expect(201);
    await b1.agent.post(`/leads/${id}/status`).send({ status: "LOST" }).expect(400);
    await b1.agent.post(`/leads/${id}/status`).send({ status: "LOST", lostReason: "Bought elsewhere" }).expect(201);
  });

  it("returns only open leads past their next step as overdue", async () => {
    const { b1 } = await setup();
    const now = t.clock.now().getTime();
    const mk = async (phone: string, nextStepAt: Date | null) =>
      (await b1.agent.post("/leads").send({ source: "PHONE", customer: { name: phone, phone }, nextStepAt }).expect(201)).body.lead.id as string;
    const past = await mk("0913000001", new Date(now - 3600_000));
    await mk("0913000002", new Date(now + 3600_000));
    const closed = await mk("0913000003", new Date(now - 3600_000));
    await b1.agent.post(`/leads/${closed}/status`).send({ status: "LOST", lostReason: "No answer" }).expect(201);
    const res = await b1.agent.get("/leads/overdue").expect(200);
    expect(res.body.items.map((l: { id: string }) => l.id)).toEqual([past]);
  });

  it("filters the lead list by customer and by overdue=false correctly", async () => {
    const { b1 } = await setup();
    const now = t.clock.now().getTime();
    const a = await b1.agent.post("/leads").send({ source: "PHONE", customer: { name: "A", phone: "0913100001" }, nextStepAt: new Date(now - 3600_000) }).expect(201);
    await b1.agent.post("/leads").send({ source: "PHONE", customer: { name: "B", phone: "0913100002" } }).expect(201);
    const byCustomer = await b1.agent.get(`/leads?customerId=${a.body.lead.customerId}`).expect(200);
    expect(byCustomer.body.items.map((l: { id: string }) => l.id)).toEqual([a.body.lead.id]);
    const notOverdue = await b1.agent.get("/leads?overdue=false").expect(200);
    expect(notOverdue.body.total).toBe(2);
    const overdue = await b1.agent.get("/leads?overdue=true").expect(200);
    expect(overdue.body.total).toBe(1);
  });

  it("logging a call sets first contact and the next step", async () => {
    const { b1 } = await setup();
    const lead = await b1.agent.post("/leads").send({ source: "PHONE", customer: { name: "O", phone: "0912000004" } }).expect(201);
    const id = lead.body.lead.id;
    const next = new Date(t.clock.now().getTime() + 86_400_000).toISOString();
    await b1.agent.post(`/leads/${id}/activities`).send({ type: "CALL", notes: "Interested", nextStepAt: next, nextStepNote: "Book viewing" }).expect(201);
    const detail = await b1.agent.get(`/leads/${id}`).expect(200);
    expect(detail.body.lead.firstContactAt).not.toBeNull();
    expect(detail.body.lead.nextStepAt).toBe(next);
    expect(detail.body.activities[0].type).toBe("CALL");
  });

  it("writes the change and its event in the same transaction", async () => {
    const { manager } = await setup();
    // Assigning to a non-broker fails, so nothing (not even the event) is written.
    const lead = await manager.agent.post("/leads").send({ source: "PHONE", customer: { name: "P", phone: "0912000005" } }).expect(201);
    const owner = await t.createUser("OWNER");
    await manager.agent.post(`/leads/${lead.body.lead.id}/assign`).send({ assignedToId: owner.id }).expect(400);
    const rows = await t.db.select().from(outboxEvents).where(eq(outboxEvents.name, "lead.assigned.v1"));
    expect(rows).toHaveLength(0);
  });
});
