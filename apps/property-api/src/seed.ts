import bcrypt from "bcryptjs";
import { count, eq } from "drizzle-orm";
import { createDatabase, users } from "@platform/nest-common";
import { buildings, customers, landlords, leads, projects, units } from "./db/schema";

/**
 * Seeds one user per role and a small demo data set. Safe to run twice: users are matched by email and the
 * demo data is only added to an empty database. The password comes from SEED_PASSWORD and is never stored
 * in the repository.
 */
export async function seed(databaseUrl: string, password: string): Promise<void> {
  if (password.length < 10) throw new Error("SEED_PASSWORD must be at least 10 characters");
  const { pool, db } = createDatabase(databaseUrl, 1);
  try {
    const hash = await bcrypt.hash(password, 12);
    const [project] = await db.select({ n: count() }).from(projects);
    const isEmpty = Number(project.n) === 0;

    let landlordId: string | null = null;
    let tenantId: string | null = null;
    if (isEmpty) {
      const [l] = await db.insert(landlords).values({ name: "Demo Owner", email: "landlord@example.com", phone: "+251911000101" }).returning();
      landlordId = l.id;
      const [tenant] = await db.insert(customers).values({ name: "Demo Tenant", email: "tenant@example.com", phone: "+251911000102", locale: "am", source: "OTHER" }).returning();
      tenantId = tenant.id;
    } else {
      landlordId = (await db.select({ id: landlords.id }).from(landlords).where(eq(landlords.email, "landlord@example.com")))[0]?.id ?? null;
      tenantId = (await db.select({ id: customers.id }).from(customers).where(eq(customers.email, "tenant@example.com")))[0]?.id ?? null;
    }

    const people: Array<{ name: string; email: string; role: string; linkedEntityId?: string | null }> = [
      { name: "Owner", email: "owner@example.com", role: "OWNER" },
      { name: "Sales Manager", email: "sales.manager@example.com", role: "SALES_MANAGER" },
      { name: "Broker", email: "broker@example.com", role: "BROKER" },
      { name: "Property Manager", email: "property.manager@example.com", role: "PROPERTY_MANAGER" },
      { name: "Demo Owner", email: "landlord@example.com", role: "LANDLORD", linkedEntityId: landlordId },
      { name: "Demo Tenant", email: "tenant@example.com", role: "TENANT", linkedEntityId: tenantId },
    ];
    for (const p of people) {
      await db
        .insert(users)
        .values({ ...p, linkedEntityId: p.linkedEntityId ?? null, passwordHash: hash, locale: "am" })
        .onConflictDoNothing(); // the only unique rule on users is the case-insensitive email
    }

    if (isEmpty) {
      const [sunrise] = await db.insert(projects).values({ name: "Sunrise Residences", area: "Bole", description: "Apartments near Bole Medhanialem", isPublished: true }).returning();
      const [garden] = await db.insert(projects).values({ name: "Garden View", area: "CMC", description: "Family homes and shops", isPublished: true }).returning();
      const [blockA] = await db.insert(buildings).values({ projectId: sunrise.id, name: "Block A" }).returning();
      const now = new Date();
      await db.insert(units).values([
        { projectId: sunrise.id, buildingId: blockA.id, code: "A-101", type: "APARTMENT", purpose: "SALE", bedrooms: 2, areaSqm: 98, floor: 1, priceMinor: 1_530_000_000, isPublished: true, publishedAt: now, description: "Two-bedroom apartment with a balcony." },
        { projectId: sunrise.id, buildingId: blockA.id, code: "A-201", type: "APARTMENT", purpose: "SALE", bedrooms: 3, areaSqm: 132, floor: 2, priceMinor: 2_150_000_000, isPublished: true, publishedAt: now, description: "Three bedrooms, two bathrooms." },
        { projectId: sunrise.id, buildingId: blockA.id, code: "A-301", type: "APARTMENT", purpose: "RENT", bedrooms: 2, areaSqm: 95, floor: 3, priceMinor: 4_500_000, isPublished: true, publishedAt: now, landlordId, description: "Furnished, available now." },
        { projectId: garden.id, code: "G-1", type: "HOUSE", purpose: "SALE", bedrooms: 4, areaSqm: 250, priceMinor: 3_800_000_000, isPublished: true, publishedAt: now, description: "Family house with a garden." },
        { projectId: garden.id, code: "S-1", type: "SHOP", purpose: "RENT", bedrooms: 0, areaSqm: 40, priceMinor: 6_000_000, landlordId },
      ]);
      const [buyer] = await db.insert(customers).values({ name: "Abebe Kebede", phone: "+251911000201", locale: "am", source: "PHONE" }).returning();
      const [broker] = await db.select({ id: users.id }).from(users).where(eq(users.email, "broker@example.com"));
      await db.insert(leads).values({ customerId: buyer.id, source: "PHONE", assignedToId: broker?.id ?? null, interestedUnitNote: "Two bedrooms in Bole" });
    }
    console.warn(`Seed complete. Users: ${people.map((p) => p.email).join(", ")}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  const password = process.env.SEED_PASSWORD;
  if (!url || !password) {
    console.error("DATABASE_URL and SEED_PASSWORD are required");
    process.exit(1);
  }
  seed(url, password).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
