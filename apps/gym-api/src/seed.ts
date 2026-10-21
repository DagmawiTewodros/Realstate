import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { addisDateString, membershipEndDate } from "@platform/shared";
import { createDatabase, users } from "@platform/nest-common";
import { classTemplates, memberships, members, plans, trainers } from "./db/schema";
import { generateClassSessions } from "./classes/generate";

/**
 * Seeds one user per gym role, sample plans, sample members (one with an active membership and a member login),
 * a trainer profile, two weekly classes and their sessions. Safe to run twice (skips existing rows).
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
    // A member with an active membership and a login for the member app (member@gym.example).
    const [sara] = await db.select().from(members).where(eq(members.phone, "+251911000102"));
    if (sara && !sara.email) await db.update(members).set({ email: "member@gym.example" }).where(eq(members.id, sara.id));
    const [monthly] = await db.select().from(plans).where(eq(plans.name, "Monthly"));
    if (sara && monthly) {
      const [hasMembership] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.memberId, sara.id));
      if (!hasMembership) {
        await db.insert(memberships).values({
          memberId: sara.id,
          planId: monthly.id,
          startDate: today,
          endDate: membershipEndDate(today, monthly.durationMonths),
          status: "ACTIVE",
          priceMinor: 0,
          complimentaryReason: "Demo data",
        });
      }
      const [login] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = 'member@gym.example'`);
      if (!login) await db.insert(users).values({ name: sara.name, email: "member@gym.example", role: "MEMBER", linkedEntityId: sara.id, passwordHash: hash, locale: "en" });
    }

    // A trainer profile and two weekly classes (weekday 0 = Sunday, Addis Ababa time).
    const [trainerUser] = await db.select().from(users).where(sql`lower(${users.email}) = 'trainer@gym.example'`);
    if (trainerUser) {
      let [trainer] = await db.select().from(trainers).where(eq(trainers.userId, trainerUser.id));
      if (!trainer) [trainer] = await db.insert(trainers).values({ userId: trainerUser.id, bio: "Strength and conditioning" }).returning();
      const [anyTemplate] = await db.select({ id: classTemplates.id }).from(classTemplates);
      if (!anyTemplate) {
        await db.insert(classTemplates).values([
          { name: "Morning HIIT", trainerId: trainer.id, weekday: 1, startTime: "07:00", durationMinutes: 45, capacity: 12 },
          { name: "Evening Strength", trainerId: trainer.id, weekday: 3, startTime: "18:00", durationMinutes: 60, capacity: 10 },
        ]);
      }
      await generateClassSessions(db, new Date());
    }
    console.warn("Gym seed complete. Users: owner@gym.example, manager@gym.example, trainer@gym.example, desk@gym.example, member@gym.example");
  } finally {
    await pool.end();
  }
}

seed().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
