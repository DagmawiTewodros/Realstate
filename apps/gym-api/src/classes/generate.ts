import { eq } from "drizzle-orm";
import { addDays, addisDateString, addisInstant, parseDateString } from "@platform/shared";
import type { Database } from "@platform/nest-common";
import { classSessions, classTemplates } from "../db/schema";

/** Sessions are generated this many days ahead. */
export const SESSION_HORIZON_DAYS = 28;

/** Day of the week for a YYYY-MM-DD date, 0 = Sunday. */
export const weekdayOf = (date: string) => {
  const { year, month, day } = parseDateString(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

/**
 * Creates class sessions for active templates over the next SESSION_HORIZON_DAYS days (Addis Ababa time).
 * Sessions that already exist are skipped (unique template + start), so this is safe to run any number of times.
 * Used by the classes service, the daily job, and the seed script.
 */
export async function generateClassSessions(db: Database, now: Date): Promise<number> {
  const today = addisDateString(now);
  const templates = await db.select().from(classTemplates).where(eq(classTemplates.isActive, true));
  let created = 0;
  for (let i = 0; i < SESSION_HORIZON_DAYS; i += 1) {
    const date = addDays(today, i);
    const weekday = weekdayOf(date);
    for (const t of templates.filter((x) => x.weekday === weekday)) {
      const [h, m] = t.startTime.split(":").map(Number);
      const startsAt = addisInstant(date, h, m);
      if (startsAt.getTime() < now.getTime()) continue;
      const rows = await db
        .insert(classSessions)
        .values({ templateId: t.id, trainerId: t.trainerId, name: t.name, startsAt, durationMinutes: t.durationMinutes, capacity: t.capacity })
        .onConflictDoNothing()
        .returning({ id: classSessions.id });
      created += rows.length;
    }
  }
  return created;
}
