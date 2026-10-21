import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { ZodTypeAny, z } from "zod";
import { appSettings } from "./schema";
import { DB } from "./tokens";
import type { Database } from "./db";

/** Small JSON settings records (site details, reminder switches). Missing values get the schema defaults. */
@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get<S extends ZodTypeAny>(key: string, schema: S): Promise<z.infer<S>> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return schema.parse(row?.value ?? {});
  }

  async set<S extends ZodTypeAny>(key: string, schema: S, value: unknown, userId: string | null): Promise<z.infer<S>> {
    const parsed = schema.parse(value);
    await this.db
      .insert(appSettings)
      .values({ key, value: parsed, updatedById: userId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed, updatedAt: new Date(), updatedById: userId } });
    return parsed;
  }
}
