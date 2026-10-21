import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { ConsentService } from "@platform/nest-common";
import { createTestApp, JPEG_BYTES, PASSWORD, type TestApp } from "./harness";
import { makeMember } from "./helpers";
import { TEST_DATABASE_URL } from "./env";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? tsFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

describe("Task 21: separate system", () => {
  it("never imports System A code or reads System A environment variables", () => {
    const files = tsFiles(join(__dirname, "..", "src"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect({ file, imports: /from\s+["'][^"']*property-api[^"']*["']|require\(["'][^"']*property-api/.test(text) }).toEqual({ file, imports: false });
      expect({ file, env: /PROPERTY_[A-Z_]+/.test(text) }).toEqual({ file, env: false });
    }
  });

  it("uses its own database, which has gym tables and no property tables", async () => {
    expect(TEST_DATABASE_URL).toContain("gym_test");
    const tables = await t.db.execute(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
    const names = (tables.rows as Array<{ tablename: string }>).map((r) => r.tablename);
    expect(names).toEqual(expect.arrayContaining(["members", "memberships", "checkins", "users", "consent_records"]));
    expect(names).not.toEqual(expect.arrayContaining(["customers"]));
    expect(names).not.toContain("leads");
  });

  it("creating a member does not touch System A's database", async () => {
    const admin = new Client({ connectionString: TEST_DATABASE_URL.replace(/\/[^/]+$/, "/postgres") });
    await admin.connect();
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'property_test'");
    await admin.end();
    let before: number | null = null;
    const property = exists.rowCount ? new Client({ connectionString: TEST_DATABASE_URL.replace(/\/[^/]+$/, "/property_test") }) : null;
    if (property) {
      await property.connect();
      const r = await property.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tablename = 'members'");
      expect(r.rows[0].n).toBe(0);
      const c = await property.query("SELECT count(*)::int AS n FROM pg_stat_user_tables");
      before = c.rows[0].n;
    }
    const { agent } = await t.as("FRONT_DESK");
    await makeMember(agent);
    if (property) {
      const c = await property.query("SELECT count(*)::int AS n FROM pg_stat_user_tables");
      expect(c.rows[0].n).toBe(before);
      await property.end();
    }
    const [{ n }] = (await t.db.execute(sql`SELECT count(*)::int AS n FROM members`)).rows as Array<{ n: number }>;
    expect(n).toBe(1);
  });

  it("uses its own session cookie name", async () => {
    const user = await t.createUser("FRONT_DESK");
    const res = await t.http().post("/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
    expect(String(res.headers["set-cookie"])).toContain("gym_session=");
  });
});

describe("Task 21: members", () => {
  it("normalizes phones and warns about duplicates without blocking", async () => {
    const { agent } = await t.as("FRONT_DESK");
    const a = await agent.post("/members").send({ name: "Abebe", phone: "0911 23 45 67" }).expect(201);
    expect(a.body.member.phone).toBe("+251911234567");
    expect(a.body.member.joinedAt).toBe("2026-10-22");
    const b = await agent.post("/members").send({ name: "Abebe 2", phone: "+251911234567" }).expect(201);
    expect(b.body.warnings[0].code).toBe("POSSIBLE_DUPLICATE");
    const list = await agent.get("/members?q=0911234567").expect(200);
    expect(list.body.total).toBe(2);
  });

  it("requires a phone or an email and validates input", async () => {
    const { agent } = await t.as("FRONT_DESK");
    await agent.post("/members").send({ name: "No contact" }).expect(400);
    await agent.post("/members").send({ name: "Bad", phone: "12" }).expect(400);
  });

  it("enforces consent per channel and the opt-out link, like System A", async () => {
    const { agent } = await t.as("FRONT_DESK");
    const m = await makeMember(agent, { telegramChatId: "555" });
    let res = await agent.get(`/members/${m.id}`).expect(200);
    expect(res.body.consent).toEqual({ TELEGRAM: false, EMAIL: false, SMS: false, WHATSAPP: false });
    res = await agent.post(`/members/${m.id}/consent`).send({ channel: "TELEGRAM", granted: true }).expect(201);
    expect(res.body.consent.TELEGRAM).toBe(true);
    const token = t.app.get(ConsentService).optOutToken(m.id);
    await t.http().get(`/optout/${token}`).expect(200, { valid: true });
    await t.http().post(`/optout/${token}`).expect(200);
    res = await agent.get(`/members/${m.id}`).expect(200);
    expect(res.body.consent.TELEGRAM).toBe(false);
    await t.http().get(`/optout/${token.slice(0, -3)}abc`).expect(404);
  });

  it("stores a photo after checking its type and size", async () => {
    const { agent } = await t.as("FRONT_DESK");
    const m = await makeMember(agent);
    await agent.post(`/members/${m.id}/photo`).attach("file", Buffer.from("%PDF-1.4 nope"), "x.pdf").expect(400);
    await agent.post(`/members/${m.id}/photo`).attach("file", Buffer.concat([JPEG_BYTES, Buffer.alloc(5 * 1024 * 1024)]), "big.jpg").expect(413);
    await agent.post(`/members/${m.id}/photo`).attach("file", JPEG_BYTES, "me.jpg").expect(201);
    const photo = await agent.get(`/members/${m.id}/photo`).expect(200);
    expect(photo.headers["content-type"]).toBe("image/jpeg");
  });

  it("exports and anonymises for the owner only", async () => {
    const desk = await t.as("FRONT_DESK");
    const m = await makeMember(desk.agent, { email: "private@example.com" });
    await desk.agent.get(`/members/${m.id}/export`).expect(403);
    await desk.agent.post(`/members/${m.id}/anonymise`).expect(403);
    const owner = await t.as("OWNER");
    const exp = await owner.agent.get(`/members/${m.id}/export`).expect(200);
    expect(exp.body.member.email).toBe("private@example.com");
    const anon = await owner.agent.post(`/members/${m.id}/anonymise`).expect(201);
    expect(anon.body.member).toMatchObject({ phone: null, email: null, telegramChatId: null });
    const list = await owner.agent.get("/members").expect(200);
    expect(list.body.total).toBe(1);
  });
});

describe("Task 21: roles", () => {
  it("lets desk roles manage members and keeps trainers off member lists", async () => {
    for (const role of ["OWNER", "GYM_MANAGER", "FRONT_DESK"]) {
      const { agent } = await t.as(role);
      await agent.get("/members").expect(200);
    }
    const trainer = await t.as("TRAINER");
    await trainer.agent.get("/members").expect(403);
    await trainer.agent.post("/members").send({ name: "X", phone: "0911999999" }).expect(403);
    const desk = await t.as("FRONT_DESK");
    const m = await makeMember(desk.agent);
    // Not assigned to this trainer, so it does not exist for them.
    await trainer.agent.get(`/members/${m.id}`).expect(404);
  });

  it("lets a member read only their own record", async () => {
    const desk = await t.as("FRONT_DESK");
    const mine = await makeMember(desk.agent, { email: "me@example.com" });
    const other = await makeMember(desk.agent);
    const invite = await desk.agent.post(`/members/${mine.id}/invite`).expect(201);
    expect(invite.body.link).toContain("/invite/");
    const token = invite.body.link.split("/invite/")[1];
    const memberAgent = t.agent();
    const accepted = await memberAgent.post("/auth/accept-invitation").send({ token, password: "member-password-1" }).expect(200);
    expect(accepted.body.user).toMatchObject({ role: "MEMBER", linkedEntityId: mine.id });
    const me = await memberAgent.get("/me").expect(200);
    expect(me.body.member.id).toBe(mine.id);
    await memberAgent.get("/members").expect(403);
    await memberAgent.get(`/members/${other.id}`).expect(403);
    await memberAgent.get(`/members/${mine.id}`).expect(403);
    await memberAgent.get(`/members/${other.id}/checkins`).expect(403);
    // Invitation links work once.
    await t.agent().post("/auth/accept-invitation").send({ token, password: "member-password-1" }).expect(400);
  });

  it("needs an email to invite a member", async () => {
    const desk = await t.as("FRONT_DESK");
    const m = await makeMember(desk.agent);
    const res = await desk.agent.post(`/members/${m.id}/invite`).expect(400);
    expect(res.body.code).toBe("EMAIL_REQUIRED");
  });

  it("lets only the owner manage staff users", async () => {
    const manager = await t.as("GYM_MANAGER");
    await manager.agent.get("/users").expect(403);
    const owner = await t.as("OWNER");
    await owner.agent
      .post("/users")
      .send({ name: "Desk 2", email: "desk2@test.local", role: "FRONT_DESK", locale: "am", password: "a-long-password" })
      .expect(201);
    await owner.agent.post("/users").send({ name: "M", email: "m@test.local", role: "MEMBER", locale: "am", password: "a-long-password" }).expect(400);
  });
});
