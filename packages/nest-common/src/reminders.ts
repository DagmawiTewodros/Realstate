import { Inject, Injectable } from "@nestjs/common";
import { reminderLog } from "./schema";
import { DB } from "./tokens";
import type { Database, Executor } from "./db";

/** Makes reminders fire once: claim(key) is true only the first time a key is claimed. */
@Injectable()
export class ReminderLogService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async claim(key: string, tx?: Executor): Promise<boolean> {
    const rows = await (tx ?? this.db).insert(reminderLog).values({ key }).onConflictDoNothing().returning({ key: reminderLog.key });
    return rows.length === 1;
  }
}
