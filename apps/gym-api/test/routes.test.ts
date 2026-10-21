import { collectRoutes } from "@platform/nest-common";
import { createTestApp, type TestApp } from "./harness";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe("permissions", () => {
  it("every route declares who may call it, and only the expected routes are public", () => {
    const routes = collectRoutes(t.app);
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.filter((r) => r.access === "none")).toEqual([]);
    const open = routes.filter((r) => r.access === "public").map((r) => `${r.method} ${r.path}`);
    expect(open.sort()).toEqual(
      ["POST /auth/login", "POST /auth/logout", "POST /auth/accept-invitation", "GET /health", "GET /health/ready", "GET /optout/:token", "POST /optout/:token"].sort(),
    );
    // Revenue never reaches trainers or front desk.
    for (const r of routes.filter((x) => x.path.startsWith("/dashboard"))) expect(r.roles).toEqual(["GYM_MANAGER", "OWNER"]);
  });

  it("rejects calls without a session on staff and member endpoints", async () => {
    for (const path of ["/members", "/plans", "/checkins/today", "/sessions", "/me", "/dashboard/revenue", "/campaigns"]) {
      await t.http().get(path).expect(401);
    }
  });
});
