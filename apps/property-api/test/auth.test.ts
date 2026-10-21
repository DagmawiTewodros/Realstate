import { eq } from "drizzle-orm";
import { users } from "@platform/nest-common";
import { createTestApp, PASSWORD, type TestApp } from "./harness";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe("Task 01/03: health, sign-in and roles", () => {
  it("answers the health check without sign-in", async () => {
    await t.http().get("/health").expect(200, { status: "ok" });
    const ready = await t.http().get("/health/ready").expect(200);
    expect(ready.body.database).toBe("ok");
  });

  it("sets an http-only cookie on login and returns the user", async () => {
    const user = await t.createUser("BROKER");
    const res = await t.http().post("/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: "BROKER" });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toContain("pp_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    const user = await t.createUser("BROKER");
    const wrong = await t.http().post("/auth/login").send({ email: user.email, password: "wrong-password-1" }).expect(401);
    const unknown = await t.http().post("/auth/login").send({ email: "nobody@test.local", password: "wrong-password-1" }).expect(401);
    expect(wrong.body.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.body.code).toBe(wrong.body.code);
    expect(unknown.body.message).toBe(wrong.body.message);
  });

  it("returns 429 after five failed logins in a minute", async () => {
    const user = await t.createUser("BROKER");
    for (let i = 0; i < 5; i += 1) await t.http().post("/auth/login").send({ email: user.email, password: "wrong-password-1" }).expect(401);
    await t.http().post("/auth/login").send({ email: user.email, password: PASSWORD }).expect(429);
  });

  it("requires sign-in for protected endpoints", async () => {
    const res = await t.http().get("/customers").expect(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("blocks a deactivated user and ends their existing session", async () => {
    const { agent, user } = await t.as("BROKER");
    await agent.get("/auth/me").expect(200);
    const { agent: owner } = await t.as("OWNER");
    await owner.patch(`/users/${user.id}`).send({ isActive: false }).expect(200);
    await agent.get("/auth/me").expect(401);
    await t.http().post("/auth/login").send({ email: user.email, password: PASSWORD }).expect(401);
  });

  it("lets only the owner manage users, and portal users only come from invitations", async () => {
    const { agent: broker } = await t.as("BROKER");
    await broker.get("/users").expect(403);
    const { agent: owner } = await t.as("OWNER");
    const created = await owner
      .post("/users")
      .send({ name: "New Broker", email: "new.broker@test.local", role: "BROKER", locale: "am", password: "a-long-password" })
      .expect(201);
    expect(created.body.user.role).toBe("BROKER");
    await owner.post("/users").send({ name: "X", email: "x@test.local", role: "TENANT", locale: "en", password: "a-long-password" }).expect(400);
    await owner.post("/users").send({ name: "Dup", email: "NEW.BROKER@test.local", role: "BROKER", locale: "en", password: "a-long-password" }).expect(409);
  });

  it("remembers the user's language", async () => {
    const { agent, user } = await t.as("BROKER");
    await agent.patch("/auth/me").send({ locale: "am" }).expect(200);
    const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
    expect(row.locale).toBe("am");
  });

  it("logs out", async () => {
    const { agent } = await t.as("BROKER");
    await agent.post("/auth/logout").expect(200);
    await agent.get("/auth/me").expect(401);
  });

  it("lets the owner set a temporary password, which ends the user's sessions", async () => {
    const { agent, user } = await t.as("BROKER");
    const { agent: owner } = await t.as("OWNER");
    await agent.post(`/users/${user.id}/password`).send({ password: "temporary-password-1" }).expect(403);
    await owner.post(`/users/${user.id}/password`).send({ password: "short" }).expect(400);
    await owner.post(`/users/${user.id}/password`).send({ password: "temporary-password-1" }).expect(200);
    await agent.get("/auth/me").expect(401);
    await t.http().post("/auth/login").send({ email: user.email, password: "temporary-password-1" }).expect(200);
    const tenant = await t.createUser("TENANT");
    await owner.post(`/users/${tenant.id}/password`).send({ password: "temporary-password-1" }).expect(400);
  });

  it("changes a password only with the current one", async () => {
    const { agent, user } = await t.as("BROKER");
    await agent.post("/auth/change-password").send({ currentPassword: "nope", newPassword: "another-long-password" }).expect(400);
    await agent.post("/auth/change-password").send({ currentPassword: PASSWORD, newPassword: "another-long-password" }).expect(200);
    await t.http().post("/auth/login").send({ email: user.email, password: "another-long-password" }).expect(200);
  });
});
