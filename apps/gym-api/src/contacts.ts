import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB, type Contact, type ContactResolver, type Database } from "@platform/nest-common";
import { members } from "./db/schema";

/** Message recipients that are members (consent applies). Anonymised members cannot be reached. */
@Injectable()
export class MemberContactResolver implements ContactResolver {
  constructor(@Inject(DB) private readonly db: Database) {}

  async resolve(subjectId: string): Promise<Contact | null> {
    const [m] = await this.db.select().from(members).where(eq(members.id, subjectId)).limit(1);
    if (!m || m.anonymizedAt) return null;
    return { id: m.id, name: m.name, locale: m.locale === "en" ? "en" : "am", email: m.email, phone: m.phone, telegramChatId: m.telegramChatId };
  }
}
