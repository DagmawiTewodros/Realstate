import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { addisDateString } from "@platform/shared";
import { createDatabase, users } from "@platform/nest-common";
import { members, plans } from "./db/schema";

/**
 * Seeds one user per gym role, sample plans and sample members. Safe to run twice (skips existing rows).
 * The password comes from SEED_PASSWORD; it is never stored in the repository.
 */
async function seed(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const password = process.env.SEED_PASSWORD;
  if (!url) throw new Error("DATABASE_URL is required");
  if (!password || password.length < 10) throw new Error("SEED_PASSWORD (at least 10 characters) is required");
  const { pool, db } = createDatabase(url, 1);
  try {
    const hash = await bcrypt.hash(password, 12);
    const staff: Array<{ role: string; name: string; email: string }> = [
      { role: "OWNER", name: "Gym Owner", email: "owner@gym.example" },
      { role: "GYM_MANAGER", name: "Gym Manager", email: "manager@gym.example" },
      { role: "TRAINER", name: "Trainer One", email: "trainer@gym.example" },
      { role: "FRONT_DESK", name: "Front Desk", email: "desk@gym.example" },
    ];
    for (const s of staff) {
      const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${s.email}`);
      if (!existing) await db.insert(users).values({ ...s, passwordHash: hash, locale: "en" });
    }
    const samplePlans = [
      { name: "Monthly", durationMonths: 1, priceMinor: 150000 },
      { name: "Quarterly", durationMonths: 3, priceMinor: 400000 },
      { name: "Annual", durationMonths: 12, priceMinor: 1400000 },
    ];
    for (const p of samplePlans) {
      const [existing] = await db.select({ id: plans.id }).from(plans).where(eq(plans.name, p.name));
      if (!existing) await db.insert(plans).values({ ...p, kind: "INDIVIDUAL" });
    }
    const today = addisDateString(new Date());
    const sampleMembers = [
      { name: "Abebe Kebede", phone: "+251911000101", locale: "am" },
      { name: "Sara Tesfaye", phone: "+251911000102", locale: "en" },
      { name: "Mulu Alemu", phone: "+251911000103", locale: "am" },
    ];
    for (const m of sampleMembers) {
      const [existing] = await db.select({ id: members.id }).from(members).where(eq(members.phone, m.phone));
      if (!existing) await db.insert(members).values({ ...m, joinedAt: today });
    }
    console.warn("Gym seed complete");
  } finally {
    await pool.end();
  }
}

seed().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
