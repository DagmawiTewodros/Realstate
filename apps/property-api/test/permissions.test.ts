import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectRoutes, type RouteInfo } from "@platform/nest-common";
import { PROPERTY_ROLES } from "@platform/shared";
import { createTestApp, type Agent, type TestApp } from "./harness";

/**
 * Role matrix (task 13). permissions.json is the expected-access table, also rendered to docs/PERMISSIONS.md.
 * The test fails when a route is added, removed or changes access without updating the table.
 * Regenerate after an intended change with: UPDATE_PERMISSIONS=1 pnpm test -- permissions
 */
const TABLE = join(__dirname, "..", "permissions.json");
const DOC = join(__dirname, "..", "..", "..", "docs", "PERMISSIONS-property.md");

let t: TestApp;
let agents: Record<string, Agent>;
beforeAll(async () => {
  t = await createTestApp();
  await t.reset();
  agents = {};
  for (const role of PROPERTY_ROLES) agents[role] = (await t.as(role)).agent;
});
afterAll(() => t.close());

const key = (r: RouteInfo) => `${r.method} ${r.path}`;

function render(routes: RouteInfo[]): string {
  const roles = PROPERTY_ROLES;
  const lines = [
    "# Property API permissions",
    "",
    "Generated from the code by `apps/property-api/test/permissions.test.ts`. Do not edit by hand.",
    "",
    "Legend: ✓ allowed, blank denied (403). Public = no sign-in. Internal = n8n shared secret. Any = any signed-in user.",
    "",
    `| Method | Path | Access | ${roles.join(" | ")} |`,
    `| --- | --- | --- | ${roles.map(() => "---").join(" | ")} |`,
  ];
  for (const r of routes) {
    const cells = roles.map((role) => (r.access === "public" || r.access === "any" || r.roles.includes(role) ? "✓" : ""));
    const access = { public: "Public", internal: "Internal", any: "Any", roles: "Roles", none: "NONE" }[r.access];
    lines.push(`| ${r.method} | \`${r.path}\` | ${access} | ${r.access === "internal" ? roles.map(() => "").join(" | ") : cells.join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

describe("Task 13: permission matrix", () => {
  it("matches the committed table, and every route declares its access", () => {
    const routes = collectRoutes(t.app);
    expect(routes.filter((r) => r.access === "none").map(key)).toEqual([]);
    if (process.env.UPDATE_PERMISSIONS === "1") {
      writeFileSync(TABLE, `${JSON.stringify(routes, null, 2)}\n`);
      writeFileSync(DOC, render(routes));
    }
    const expected = JSON.parse(readFileSync(TABLE, "utf8")) as RouteInfo[];
    expect(routes.map((r) => `${key(r)} ${r.access} ${r.roles.join(",")}`)).toEqual(expected.map((r) => `${key(r)} ${r.access} ${r.roles.join(",")}`));
  });

  it("enforces the table for every route and every role", async () => {
    const routes = collectRoutes(t.app);
    const id = "00000000-0000-4000-8000-000000000000";
    const problems: string[] = [];
    for (const r of routes) {
      if (r.access === "public") continue;
      const path = r.path.replace(/:landlordId|:id/g, id).replace(":month", "2026-01").replace(":kind", "units").replace(":token", "x");
      const call = (agent: Agent | null) => {
        const target = agent ?? t.http();
        const m = r.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
        return target[m](path).send({});
      };
      const anon = await call(null);
      if (anon.status !== 401) problems.push(`${key(r)} anonymous got ${anon.status}`);
      if (r.access === "internal") continue;
      for (const role of PROPERTY_ROLES) {
        const res = await call(agents[role]);
        const allowed = r.access === "any" || r.roles.includes(role);
        // The role guard answers 403 with code FORBIDDEN. Other 403 codes are business rules (for example a
        // portal login without a linked record) and mean the guard let the call through.
        const deniedByGuard = res.status === 403 && res.body?.code === "FORBIDDEN";
        if (allowed && (res.status === 401 || deniedByGuard)) problems.push(`${key(r)} ${role} should be allowed, got ${res.status} ${res.body?.code}`);
        if (!allowed && !deniedByGuard) problems.push(`${key(r)} ${role} should be denied by the guard, got ${res.status} ${res.body?.code}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
