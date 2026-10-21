import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { channelSchema, idSchema, MESSAGE_STATUSES, paginationSchema } from "@platform/shared";
import { Internal, Public, Roles } from "./auth/decorators";
import { zod } from "./zod.pipe";
import { AppError } from "./errors";
import { ConsentService } from "./consent";
import { MessageService } from "./messaging";
import { ReminderLogService } from "./reminders";
import { RateLimiter } from "./rate-limit";
import { DB, PLATFORM_OPTIONS } from "./tokens";
import type { Database } from "./db";
import type { PlatformOptions } from "./options";
import { messageLog, outboxEvents } from "./schema";
import { ClientIp } from "./auth/decorators";

@Controller("health")
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @Public()
  health() {
    return { status: "ok" };
  }

  @Get("ready")
  @Public()
  async ready() {
    await this.db.execute(sql`select 1`);
    const [failed] = await this.db.select({ n: count() }).from(outboxEvents).where(eq(outboxEvents.status, "FAILED"));
    return { status: "ready", database: "ok", failedEvents: Number(failed.n) };
  }
}

const internalSendSchema = z.object({
  recipient: z.object({ kind: z.enum(["subject", "user"]), id: idSchema }),
  channel: channelSchema.optional(),
  templateKey: z.string().min(1).max(100),
  data: z.record(z.unknown()).default({}),
  /** When given, the message is sent only the first time this key is seen. */
  reminderKey: z.string().max(200).optional(),
});

/** Called by n8n workflows. Protected by the INTERNAL_API_SECRET header, never by a user session. */
@Controller("internal")
export class InternalController {
  constructor(
    private readonly messages: MessageService,
    private readonly reminders: ReminderLogService,
  ) {}

  @Post("messages/send")
  @Internal()
  @HttpCode(200)
  async send(@Body(zod(internalSendSchema)) body: z.infer<typeof internalSendSchema>) {
    if (body.reminderKey && !(await this.reminders.claim(`msg:${body.reminderKey}`))) return { status: "DUPLICATE" };
    return this.messages.send({ recipient: body.recipient, channel: body.channel, templateKey: body.templateKey, data: body.data });
  }
}

/** Public opt-out link. It can only revoke consent; it never returns personal data. */
@Controller("optout")
export class OptOutController {
  constructor(
    private readonly consent: ConsentService,
    private readonly limiter: RateLimiter,
  ) {}

  @Get(":token")
  @Public()
  check(@Param("token") token: string, @ClientIp() ip: string) {
    this.limiter.enforce(`optout:${ip}`, 30, 60_000);
    if (!this.consent.verifyOptOutToken(token)) throw new AppError(404, "INVALID_LINK", "This link is not valid");
    return { valid: true };
  }

  @Post(":token")
  @Public()
  @HttpCode(200)
  async optOut(@Param("token") token: string, @ClientIp() ip: string) {
    this.limiter.enforce(`optout:${ip}`, 30, 60_000);
    const subjectId = this.consent.verifyOptOutToken(token);
    if (!subjectId) throw new AppError(404, "INVALID_LINK", "This link is not valid");
    await this.consent.revokeAll(subjectId);
    return { ok: true };
  }
}

const messageQuery = paginationSchema.extend({ status: z.enum(MESSAGE_STATUSES).optional() });

@Controller("messages")
export class MessageLogController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @Roles("OWNER")
  async list(@Query(zod(messageQuery)) q: z.infer<typeof messageQuery>) {
    const where = q.status ? and(eq(messageLog.status, q.status)) : undefined;
    const items = await this.db
      .select()
      .from(messageLog)
      .where(where)
      .orderBy(desc(messageLog.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    const [{ n }] = await this.db.select({ n: count() }).from(messageLog).where(where);
    return { items, page: q.page, pageSize: q.pageSize, total: Number(n) };
  }

  @Get("failed-events")
  @Roles("OWNER")
  async failedEvents() {
    const items = await this.db.select().from(outboxEvents).where(eq(outboxEvents.status, "FAILED")).orderBy(desc(outboxEvents.createdAt)).limit(100);
    return { items };
  }
}

/** Exported for apps that need the options (for example to list roles). */
export const PlatformOptionsToken = PLATFORM_OPTIONS;
export type { PlatformOptions };
