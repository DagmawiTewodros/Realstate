import { eq } from "drizzle-orm";
import { outboxEvents } from "@platform/nest-common";
import { customers, leads, savedSearches, units } from "../src/db/schema";
import { createTestApp, type TestApp } from "./harness";
import { jpeg, makeProject, makeUnit, publishedUnit } from "./fixtures";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

const events = async () => (await t.db.select({ name: outboxEvents.name }).from(outboxEvents)).map((r) => r.name);

describe("Task 08: listings inventory", () => {
  it("stores the price in santim with ETB and enforces unique codes per project", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent);
    const unit = await makeUnit(agent, project.id, { code: "A-101", priceMinor: 3_850_000_000 });
    const detail = await agent.get(`/units/${unit.id}`).expect(200);
    expect(detail.body.unit).toMatchObject({ priceMinor: 3_850_000_000, currency: "ETB" });
    const dup = await agent.post("/units").send({ projectId: project.id, code: "A-101", type: "APARTMENT", purpose: "SALE", priceMinor: 1 }).expect(409);
    expect(dup.body.code).toBe("UNIT_CODE_TAKEN");
    const other = await makeProject(agent, "Other", "CMC");
    await makeUnit(agent, other.id, { code: "A-101" });
    expect(await events()).toContain("unit.created.v1");
  });

  it("enforces unit status moves; a broker cannot mark a unit sold", async () => {
    const { agent: manager } = await t.as("SALES_MANAGER");
    const { agent: broker } = await t.as("BROKER");
    const project = await makeProject(manager);
    const unit = await makeUnit(manager, project.id);
    const res = await broker.post(`/units/${unit.id}/status`).send({ status: "SOLD" }).expect(409);
    expect(res.body.code).toBe("MANAGER_ONLY");
    await broker.post(`/units/${unit.id}/status`).send({ status: "RESERVED" }).expect(200);
    await broker.post(`/units/${unit.id}/status`).send({ status: "SOLD" }).expect(200);
    const illegal = await manager.post(`/units/${unit.id}/status`).send({ status: "AVAILABLE" }).expect(409);
    expect(illegal.body.code).toBe("ILLEGAL_MOVE");
  });

  it("unpublishes a unit that leaves AVAILABLE and republishes it with unit.released.v1 when it returns", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent);
    const unit = await publishedUnit(agent, project.id);
    await agent.post(`/units/${unit.id}/status`).send({ status: "RESERVED" }).expect(200);
    let [row] = await t.db.select().from(units).where(eq(units.id, unit.id));
    expect(row.isPublished).toBe(false);
    await agent.post(`/units/${unit.id}/status`).send({ status: "AVAILABLE" }).expect(200);
    [row] = await t.db.select().from(units).where(eq(units.id, unit.id));
    expect(row.isPublished).toBe(true);
    expect(await events()).toEqual(expect.arrayContaining(["unit.published.v1", "unit.status_changed.v1", "unit.released.v1"]));
  });

  it("emits unit.price_dropped.v1 only when the price goes down", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent);
    const unit = await makeUnit(agent, project.id, { priceMinor: 1000 });
    await agent.patch(`/units/${unit.id}`).send({ priceMinor: 2000 }).expect(200);
    expect(await events()).not.toContain("unit.price_dropped.v1");
    await agent.patch(`/units/${unit.id}`).send({ priceMinor: 1500 }).expect(200);
    expect((await events()).filter((e) => e === "unit.price_dropped.v1")).toHaveLength(1);
  });

  it("rejects wrong file types and oversized photos before storage", async () => {
    const { agent } = await t.as("BROKER");
    const { agent: manager } = await t.as("SALES_MANAGER");
    const project = await makeProject(manager);
    const unit = await makeUnit(manager, project.id);
    const bad = await agent.post(`/units/${unit.id}/photos`).attach("file", Buffer.from("%PDF-1.4 not an image"), "fake.jpg").expect(400);
    expect(bad.body.code).toBe("INVALID_FILE_TYPE");
    const big = Buffer.concat([await jpeg(), Buffer.alloc(10 * 1024 * 1024 + 10)]);
    const tooBig = await agent.post(`/units/${unit.id}/photos`).attach("file", big, "big.jpg").expect(413);
    expect(tooBig.body.code).toBe("FILE_TOO_LARGE");
    const ok = await agent.post(`/units/${unit.id}/photos`).attach("file", await jpeg(1200, 800), "ok.jpg").expect(201);
    expect(ok.body.photo).toMatchObject({ width: 1200, height: 800, contentType: "image/jpeg" });
    const thumb = await agent.get(`/files/photos/${ok.body.photo.id}?size=thumb`).expect(200);
    expect(thumb.headers["content-type"]).toBe("image/webp");
  });

  it("keeps public endpoints to published, available units and public fields only", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent);
    const visible = await publishedUnit(agent, project.id, { code: "PUB-1", internalNotes: "owner wants cash" });
    const hidden = await makeUnit(agent, project.id, { code: "HID-1" });
    const reserved = await publishedUnit(agent, project.id, { code: "RES-1" });
    await agent.post(`/units/${reserved.id}/status`).send({ status: "RESERVED" }).expect(200);
    const sold = await publishedUnit(agent, project.id, { code: "SOLD-1" });
    await agent.post(`/units/${sold.id}/status`).send({ status: "SOLD" }).expect(200);
    const leased = await publishedUnit(agent, project.id, { code: "LEA-1", purpose: "RENT" });
    await agent.post(`/units/${leased.id}/status`).send({ status: "LEASED" }).expect(200);

    const list = await t.http().get("/public/units").expect(200);
    expect(list.body.items.map((u: { code: string }) => u.code)).toEqual(["PUB-1"]);
    expect(JSON.stringify(list.body)).not.toContain("internalNotes");
    expect(JSON.stringify(list.body)).not.toContain("owner wants cash");
    const detail = await t.http().get(`/public/units/${visible.id}`).expect(200);
    expect(detail.body.unit.internalNotes).toBeUndefined();
    expect(detail.body.unit.landlordId).toBeUndefined();
    for (const id of [hidden.id, reserved.id, sold.id, leased.id]) await t.http().get(`/public/units/${id}`).expect(404);
  });

  it("serves public documents only when marked public, and private ones only to staff", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent);
    const unit = await publishedUnit(agent, project.id);
    const pdf = Buffer.from("%PDF-1.4\n%fake but valid header\n");
    const priv = await agent.post(`/units/${unit.id}/documents`).field("name", "Title deed").field("isPublic", "false").attach("file", pdf, "deed.pdf").expect(201);
    const pub = await agent.post(`/units/${unit.id}/documents`).field("name", "Floor plan").field("isPublic", "true").attach("file", pdf, "plan.pdf").expect(201);
    await t.http().get(`/public/documents/${priv.body.document.id}`).expect(404);
    await t.http().get(`/public/documents/${pub.body.document.id}`).expect(200);
    const detail = await t.http().get(`/public/units/${unit.id}`).expect(200);
    expect(detail.body.documents.map((d: { name: string }) => d.name)).toEqual(["Floor plan"]);
    await agent.get(`/files/documents/${priv.body.document.id}`).expect(200);
    await t.http().get(`/files/documents/${priv.body.document.id}`).expect(401);
  });
});

describe("Task 09: spreadsheet import", () => {
  const csv = (rows: string[]) => Buffer.from(["Project,Area,Unit No,Type,For,Bedrooms,Price (ETB)", ...rows].join("\n"));
  const mapping = JSON.stringify({ project: "Project", area: "Area", code: "Unit No", type: "Type", purpose: "For", bedrooms: "Bedrooms", price: "Price (ETB)" });
  const file = csv([
    "Sunrise,Bole,A-1,Apartment,Sale,2,15000000",
    "Sunrise,Bole,A-2,Apartment,Sale,3,17500000.50",
    "Sunrise,Bole,A-3,Villa,Rent,4,90000",
    "Garden,CMC,G-1,Shop,Rent,0,45000",
    "Garden,CMC,G-2,Office,Sale,,8000000",
    "Garden,CMC,,Office,Sale,,8000000",
    "Garden,CMC,G-4,Castle,Sale,,8000000",
    "Garden,CMC,G-5,Office,Sale,,lots",
  ]);

  it("suggests a mapping from the column names", async () => {
    const { agent } = await t.as("PROPERTY_MANAGER");
    const res = await agent.post("/imports/units/preview").attach("file", file, "units.csv").expect(200);
    expect(res.body.rowCount).toBe(8);
    expect(res.body.suggestedMapping).toMatchObject({ project: "Project", code: "Unit No", price: "Price (ETB)", purpose: "For" });
  });

  it("dry run changes nothing and reports 5 valid and 3 invalid rows; commit applies only the valid ones", async () => {
    const { agent } = await t.as("OWNER");
    const dry = await agent.post("/imports/units/dry-run").field("mapping", mapping).attach("file", file, "units.csv").expect(200);
    expect(dry.body.summary).toEqual({ total: 8, created: 5, updated: 0, skipped: 0, errors: 3 });
    expect(await t.db.select().from(units)).toHaveLength(0);
    const commit = await agent.post("/imports/units/commit").field("mapping", mapping).attach("file", file, "units.csv").expect(200);
    expect(commit.body.summary).toMatchObject({ created: 5, errors: 3 });
    const rows = await t.db.select().from(units);
    expect(rows).toHaveLength(5);
    expect(rows.find((u) => u.code === "A-2")!.priceMinor).toBe(1_750_000_050);
    const again = await agent.post("/imports/units/commit").field("mapping", mapping).attach("file", file, "units.csv").expect(200);
    expect(again.body.summary).toMatchObject({ created: 0, updated: 5, errors: 3 });
    expect(await t.db.select().from(units)).toHaveLength(5);
  });

  it("downloads the report as CSV", async () => {
    const { agent } = await t.as("OWNER");
    const res = await agent.post("/imports/units/dry-run?format=csv").field("mapping", mapping).attach("file", file, "units.csv").expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.startsWith("﻿Row,Result,Key,Reason,Warning")).toBe(true);
  });

  it("rejects files over 5 MB and wrong types", async () => {
    const { agent } = await t.as("OWNER");
    const big = Buffer.alloc(5 * 1024 * 1024 + 100, "a");
    await agent.post("/imports/units/preview").attach("file", big, "big.csv").expect(413);
    await agent.post("/imports/units/preview").attach("file", await jpeg(), "photo.jpg").expect(400);
  });

  it("imports customers and leads with phone normalization and no duplicates on re-import", async () => {
    const { agent } = await t.as("SALES_MANAGER");
    const people = Buffer.from("Name,Phone,Email\nAbebe,0911 11 11 11,abebe@example.com\nBad,123,\nSara,+251922222222,\n");
    const m = JSON.stringify({ name: "Name", phone: "Phone", email: "Email" });
    const first = await agent.post("/imports/customers/commit").field("mapping", m).attach("file", people, "c.csv").expect(200);
    expect(first.body.summary).toMatchObject({ created: 2, errors: 1 });
    const second = await agent.post("/imports/leads/commit").field("mapping", m).attach("file", people, "l.csv").expect(200);
    expect(second.body.summary).toMatchObject({ created: 2, errors: 1 });
    const third = await agent.post("/imports/leads/commit").field("mapping", m).attach("file", people, "l.csv").expect(200);
    expect(third.body.summary).toMatchObject({ created: 0, updated: 2 });
    expect(await t.db.select().from(customers)).toHaveLength(2);
    expect(await t.db.select().from(leads)).toHaveLength(2);
    const [c] = await t.db.select().from(customers).where(eq(customers.name, "Abebe"));
    expect(c.phone).toBe("+251911111111");
  });

  it("allows only owner, sales manager and property manager to import", async () => {
    const { agent } = await t.as("BROKER");
    await agent.post("/imports/units/preview").attach("file", file, "units.csv").expect(403);
  });
});

describe("Task 10: public website inquiries", () => {
  async function listing() {
    const { agent } = await t.as("SALES_MANAGER");
    const project = await makeProject(agent);
    return publishedUnit(agent, project.id, { purpose: "RENT", type: "APARTMENT", priceMinor: 4_000_000, bedrooms: 2 });
  }

  it("creates exactly one lead per inquiry and reuses the customer for the same phone", async () => {
    const unit = await listing();
    await t.http().post("/public/inquiries").send({ name: "Visitor", phone: "0933 44 55 66", unitId: unit.id, message: "Is it available?" }).expect(201);
    await t.http().post("/public/inquiries").send({ name: "Visitor again", phone: "+251933445566", unitId: unit.id }).expect(201);
    expect(await t.db.select().from(customers)).toHaveLength(1);
    const allLeads = await t.db.select().from(leads);
    expect(allLeads).toHaveLength(2);
    expect(allLeads.every((l) => l.source === "WEBSITE" && l.interestedUnitId === unit.id)).toBe(true);
    expect((await events()).filter((e) => e === "lead.created.v1")).toHaveLength(2);
  });

  it("records consent only for the channels ticked", async () => {
    const unit = await listing();
    await t.http().post("/public/inquiries").send({ name: "No consent", phone: "0933000001", unitId: unit.id }).expect(201);
    await t.http().post("/public/inquiries").send({ name: "Consent", phone: "0933000002", unitId: unit.id, consentChannels: ["TELEGRAM"] }).expect(201);
    const { agent } = await t.as("OWNER");
    const list = await agent.get("/customers").expect(200);
    const byName = Object.fromEntries(
      await Promise.all(list.body.items.map(async (c: { id: string; name: string }) => [c.name, (await agent.get(`/customers/${c.id}`)).body.consent])),
    );
    expect(byName["No consent"]).toEqual({ TELEGRAM: false, EMAIL: false, SMS: false, WHATSAPP: false });
    expect(byName["Consent"].TELEGRAM).toBe(true);
  });

  it("returns 429 on the sixth inquiry from one IP within a minute", async () => {
    const unit = await listing();
    for (let i = 0; i < 5; i += 1) await t.http().post("/public/inquiries").send({ name: `V${i}`, phone: `093300010${i}`, unitId: unit.id }).expect(201);
    await t.http().post("/public/inquiries").send({ name: "V6", phone: "0933000199", unitId: unit.id }).expect(429);
  });

  it("rejects the honeypot, link spam, and units that are not public", async () => {
    const unit = await listing();
    await t.http().post("/public/inquiries").send({ name: "Bot", phone: "0933000301", website: "http://spam" }).expect(400);
    await t.http().post("/public/inquiries").send({ name: "Spam", phone: "0933000302", message: "http://a http://b http://c" }).expect(400);
    const { agent } = await t.as("SALES_MANAGER");
    await agent.post(`/units/${unit.id}/status`).send({ status: "RESERVED" }).expect(200);
    const res = await t.http().post("/public/inquiries").send({ name: "Late", phone: "0933000303", unitId: unit.id }).expect(400);
    expect(res.body.code).toBe("UNIT_NOT_AVAILABLE");
  });

  it("creates a saved search when the visitor asks to hear about similar properties", async () => {
    const unit = await listing();
    await t.http().post("/public/inquiries").send({ name: "Alerts", phone: "0933000401", email: "a@example.com", unitId: unit.id, consentChannels: ["EMAIL"], notifySimilar: true }).expect(201);
    const [s] = await t.db.select().from(savedSearches);
    expect(s).toMatchObject({ purpose: "RENT", type: "APARTMENT", minPriceMinor: 3_200_000, maxPriceMinor: 4_800_000, bedrooms: 2, isActive: true });
  });

  it("serves the sitemap and site settings, and only the owner edits settings", async () => {
    const empty = await t.http().get("/public/settings").expect(200);
    expect(empty.body.companyName).toEqual({ am: "", en: "" });
    const unit = await listing();
    const sitemap = await t.http().get("/public/sitemap").expect(200);
    expect(sitemap.body.units.map((u: { id: string }) => u.id)).toEqual([unit.id]);
    const { agent: manager } = await t.as("SALES_MANAGER");
    await manager.put("/settings/site").send({}).expect(403);
    const { agent: owner } = await t.as("OWNER");
    await owner.put("/settings/site").send({ companyName: { am: "ፀሐይ ሪል እስቴት", en: "Sun Realty" }, phone: "+251911000000", address: { am: "", en: "Bole" }, openingHours: { am: "", en: "Mon-Sat 8-6" }, about: { am: "", en: "" } }).expect(200);
    const pub = await t.http().get("/public/settings").expect(200);
    expect(pub.body.companyName.en).toBe("Sun Realty");
  });
});
