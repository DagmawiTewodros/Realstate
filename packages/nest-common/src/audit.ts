import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DB } from "./tokens";
import type { Database, Executor } from "./db";
import { auditLog } from "./schema";

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async log(entry: AuditEntry, tx?: Executor): Promise<void> {
    await (tx ?? this.db).insert(auditLog).values({
      userId: entry.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  }

  async forEntity(entityType: string, entityId: string) {
    return this.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
      .orderBy(desc(auditLog.createdAt));
  }
}
