import sharp from "sharp";
import type { Agent } from "./harness";

export async function jpeg(width = 32, height = 24): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
}

export async function png(): Promise<Buffer> {
  return sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
}

export async function makeProject(agent: Agent, name = "Sunrise Residences", area = "Bole") {
  const res = await agent.post("/projects").send({ name, area, isPublished: true }).expect(201);
  return res.body.project as { id: string; name: string; area: string };
}

export async function makeUnit(agent: Agent, projectId: string, overrides: Record<string, unknown> = {}) {
  const res = await agent
    .post("/units")
    .send({ projectId, code: `A-${Math.random().toString(36).slice(2, 7)}`, type: "APARTMENT", purpose: "SALE", bedrooms: 2, priceMinor: 1_500_000_000, ...overrides })
    .expect(201);
  return res.body.unit as { id: string; code: string; status: string; isPublished: boolean; priceMinor: number };
}

export async function publishedUnit(agent: Agent, projectId: string, overrides: Record<string, unknown> = {}) {
  const unit = await makeUnit(agent, projectId, overrides);
  await agent.post(`/units/${unit.id}/publish`).send({ isPublished: true }).expect(200);
  return unit;
}
