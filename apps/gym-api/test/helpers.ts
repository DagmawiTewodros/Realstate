import { addisDateString } from "@platform/shared";
import { PASSWORD, type Agent, type TestApp } from "./harness";

let phoneCounter = 100000;

export function today(t: TestApp): string {
  return addisDateString(t.clock.now());
}

export async function makeMember(agent: Agent, overrides: Record<string, unknown> = {}) {
  phoneCounter += 1;
  const res = await agent
    .post("/members")
    .send({ name: `Member ${phoneCounter}`, phone: `0911${phoneCounter}`, ...overrides })
    .expect(201);
  return res.body.member as { id: string; name: string; email: string | null; qrVersion: number; locale: string };
}

export async function makePlan(agent: Agent, overrides: Record<string, unknown> = {}) {
  const res = await agent
    .post("/plans")
    .send({ name: "Monthly", durationMonths: 1, priceMinor: 150000, ...overrides })
    .expect(201);
  return res.body.plan as { id: string; name: string; durationMonths: number; priceMinor: number };
}

export async function sell(agent: Agent, memberId: string, planId: string, extra: Record<string, unknown> = {}) {
  const res = await agent
    .post(`/members/${memberId}/memberships`)
    .send({ planId, payment: { amountMinor: 150000, method: "CASH" }, ...extra })
    .expect(201);
  return res.body as {
    membership: { id: string; startDate: string; endDate: string; status: string };
    payment: { id: string; receiptNumber: string } | null;
  };
}

/** A manager, a member and a plan, with an active membership sold today. */
export async function activeMember(t: TestApp) {
  const manager = await t.as("GYM_MANAGER");
  const plan = await makePlan(manager.agent);
  const member = await makeMember(manager.agent);
  const sold = await sell(manager.agent, member.id, plan.id);
  return { manager, plan, member, membership: sold.membership, payment: sold.payment };
}

/** Signs the same user in again (needed after moving the fake clock past the 7-day session lifetime). */
export async function relogin(t: TestApp, user: { email: string }) {
  const agent = t.agent();
  await agent.post("/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
  return agent;
}
