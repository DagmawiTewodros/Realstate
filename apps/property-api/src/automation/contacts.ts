import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB, type Contact, type ContactResolver, type Database } from "@platform/nest-common";
import { customers } from "../db/schema";

/** Message recipients that are customers (consent applies). Anonymised customers cannot be reached. */
@Injectable()
export class CustomerContactResolver implements ContactResolver {
  constructor(@Inject(DB) private readonly db: Database) {}

  async resolve(subjectId: string): Promise<Contact | null> {
    const [c] = await this.db.select().from(customers).where(eq(customers.id, subjectId)).limit(1);
    if (!c || c.anonymizedAt) return null;
    return { id: c.id, name: c.name, locale: c.locale === "en" ? "en" : "am", email: c.email, phone: c.phone, telegramChatId: c.telegramChatId };
  }
}
