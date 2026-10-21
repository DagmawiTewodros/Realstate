import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { Locale } from "@platform/shared";
import { DB, type Database } from "@platform/nest-common";
import { customers, users } from "../db/schema";

/** Looks up who should get a message and in which language. */
@Injectable()
export class Recipients {
  constructor(@Inject(DB) private readonly db: Database) {}

  async usersWithRole(role: string): Promise<Array<{ id: string; name: string; locale: Locale }>> {
    const rows = await this.db.select({ id: users.id, name: users.name, locale: users.locale }).from(users).where(and(eq(users.role, role), eq(users.isActive, true)));
    return rows.map((r) => ({ ...r, locale: r.locale === "am" ? "am" : "en" }));
  }

  async user(id: string | null | undefined): Promise<{ id: string; name: string; locale: Locale } | null> {
    if (!id) return null;
    const [u] = await this.db.select({ id: users.id, name: users.name, locale: users.locale, isActive: users.isActive }).from(users).where(eq(users.id, id));
    return u && u.isActive ? { id: u.id, name: u.name, locale: u.locale === "am" ? "am" : "en" } : null;
  }

  async landlordUsers(landlordId: string | null | undefined) {
    if (!landlordId) return [];
    const rows = await this.db
      .select({ id: users.id, name: users.name, locale: users.locale })
      .from(users)
      .where(and(eq(users.role, "LANDLORD"), eq(users.linkedEntityId, landlordId), eq(users.isActive, true)));
    return rows.map((r) => ({ ...r, locale: (r.locale === "am" ? "am" : "en") as Locale }));
  }

  async customer(id: string): Promise<{ id: string; name: string; locale: Locale } | null> {
    const [c] = await this.db.select({ id: customers.id, name: customers.name, locale: customers.locale }).from(customers).where(eq(customers.id, id));
    return c ? { id: c.id, name: c.name, locale: c.locale === "en" ? "en" : "am" } : null;
  }
}
