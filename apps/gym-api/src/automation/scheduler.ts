import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { and, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { addDays, addisDateString, diffDays, gymSettingsSchema, type GymReminderType, type GymSettings } from "@platform/shared";
import {
  APP_CONFIG,
  AlertService,
  CLOCK,
  DB,
  MessageService,
  OutboxService,
  ReminderLogService,
  SettingsService,
  type BaseConfig,
  type Clock,
  type Database,
  type Executor,
} from "@platform/nest-common";
import { members, memberships, plans } from "../db/schema";
import { MembershipsService } from "../memberships/memberships.service";
import { ClassesService } from "../classes/classes.service";

export const GYM_SETTINGS_KEY = "gym-settings";
/** Expired-membership messages are sent only for memberships that ended in the last 7 days. */
const EXPIRED_LOOKBACK_DAYS = 7;

export interface SchedulerResult {
  expiredStatuses: number;
  sessionsCreated: number;
  noShows: number;
  events: Record<GymReminderType, number>;
  deferredSent: number;
}

/**
 * Daily jobs for the gym. Safe to run as often as you like (every 15 minutes in production):
 * statuses and sessions are idempotent, and each reminder claims a unique key so it fires once.
 */
@Injectable()
export class GymScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("GymScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly memberships: MembershipsService,
    private readonly classes: ClassesService,
    private readonly outbox: OutboxService,
    private readonly reminders: ReminderLogService,
    private readonly settings: SettingsService,
    private readonly messages: MessageService,
    private readonly alerts: AlertService,
  ) {}

  onModuleInit(): void {
    if (this.config.SCHEDULER_ENABLED && this.config.NODE_ENV !== "test") {
      this.timer = setInterval(() => void this.tick(), 15 * 60_000);
      setTimeout(() => void this.tick(), 10_000);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (e) {
      await this.alerts.alert(`Gym scheduler failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<SchedulerResult> {
    const today = addisDateString(this.clock.now());
    const settings: GymSettings = await this.settings.get(GYM_SETTINGS_KEY, gymSettingsSchema);
    const on = (type: GymReminderType) => settings.enabled[type] !== false;
    const { expired } = await this.memberships.refreshStatuses(today);
    const sessionsCreated = await this.classes.generateSessions();
    const noShows = await this.classes.markNoShows();
    const events: Record<GymReminderType, number> = {
      "membership.expiring": on("membership.expiring") ? await this.expiring(today, settings.expiringDays) : 0,
      "membership.expired": on("membership.expired") ? await this.expired(today) : 0,
      "member.inactive": on("member.inactive") ? await this.inactive(today, settings.inactiveDays) : 0,
      "member.birthday": on("member.birthday") ? await this.birthdays(today) : 0,
    };
    const deferredSent = await this.messages.flushDeferred();
    if (Object.values(events).some((n) => n > 0)) this.logger.log(`Reminder events: ${JSON.stringify(events)}`);
    return { expiredStatuses: expired.length, sessionsCreated, noShows, events, deferredSent };
  }

  private async fire(key: string, name: string, payload: Record<string, unknown>): Promise<boolean> {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      if (!(await this.reminders.claim(key, tx))) return false;
      await this.outbox.emit(tx, name, payload);
      return true;
    });
  }

  /** Memberships ending within `days` days with no renewal after them. */
  private async expiring(today: string, days: number): Promise<number> {
    const rows = await this.db
      .select({ id: memberships.id, memberId: memberships.memberId, endDate: memberships.endDate, planName: plans.name })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .innerJoin(members, eq(members.id, memberships.memberId))
      .where(
        and(
          inArray(memberships.status, ["ACTIVE", "FROZEN"]),
          gte(memberships.endDate, today),
          lte(memberships.endDate, addDays(today, days)),
          sql`${members.anonymizedAt} IS NULL`,
          sql`NOT EXISTS (SELECT 1 FROM memberships later WHERE later.member_id = ${memberships.memberId} AND later.status <> 'CANCELLED' AND later.start_date > ${memberships.endDate})`,
        ),
      );
    let n = 0;
    for (const r of rows) {
      if (await this.fire(`membership.expiring:${r.id}`, "membership.expiring.v1", { membershipId: r.id, memberId: r.memberId, endDate: r.endDate, planName: r.planName })) n += 1;
    }
    return n;
  }

  /** Memberships that ended recently (the day after the end, or up to 7 days later) and were not renewed. */
  private async expired(today: string): Promise<number> {
    const rows = await this.db
      .select({ id: memberships.id, memberId: memberships.memberId, endDate: memberships.endDate, planName: plans.name })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .innerJoin(members, eq(members.id, memberships.memberId))
      .where(
        and(
          ne(memberships.status, "CANCELLED"),
          gte(memberships.endDate, addDays(today, -EXPIRED_LOOKBACK_DAYS)),
          lte(memberships.endDate, addDays(today, -1)),
          sql`${members.anonymizedAt} IS NULL`,
          sql`NOT EXISTS (SELECT 1 FROM memberships later WHERE later.member_id = ${memberships.memberId} AND later.status <> 'CANCELLED' AND later.end_date >= ${today})`,
        ),
      );
    let n = 0;
    for (const r of rows) {
      if (await this.fire(`membership.expired:${r.id}`, "membership.expired.v1", { membershipId: r.id, memberId: r.memberId, endDate: r.endDate, planName: r.planName })) n += 1;
    }
    return n;
  }

  /**
   * Members with an active membership (not frozen) and no visit for `days` days. Fires once per period of
   * inactivity: the key includes the date of the last visit (or the membership start if never visited).
   */
  private async inactive(today: string, days: number): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT m.id AS member_id,
             (SELECT max(((c.at AT TIME ZONE 'UTC') + interval '3 hours')::date)::text FROM checkins c WHERE c.member_id = m.id AND c.result = 'ALLOWED') AS last_visit,
             ms.start_date::text AS start_date
      FROM members m
      JOIN memberships ms ON ms.member_id = m.id AND ms.status <> 'CANCELLED' AND ms.start_date <= ${today} AND ms.end_date >= ${today}
      WHERE m.status = 'ACTIVE' AND m.anonymized_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM membership_freezes f WHERE f.membership_id = ms.id AND f.start_date <= ${today} AND f.end_date >= ${today})`);
    let n = 0;
    for (const row of result.rows as Array<{ member_id: string; last_visit: string | null; start_date: string }>) {
      const anchor = row.last_visit ?? row.start_date;
      const since = diffDays(anchor, today);
      if (since < days) continue;
      if (await this.fire(`member.inactive:${row.member_id}:${anchor}`, "member.inactive.v1", { memberId: row.member_id, days: since, lastVisit: row.last_visit })) n += 1;
    }
    return n;
  }

  /** Birthdays today. Members born on 29 February are greeted on 28 February in non-leap years. */
  private async birthdays(today: string): Promise<number> {
    const monthDay = today.slice(5);
    const year = today.slice(0, 4);
    const isLeap = (Number(year) % 4 === 0 && Number(year) % 100 !== 0) || Number(year) % 400 === 0;
    const days = monthDay === "02-28" && !isLeap ? ["02-28", "02-29"] : [monthDay];
    const rows = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.status, "ACTIVE"), sql`${members.anonymizedAt} IS NULL`, inArray(sql`to_char(${members.birthDate}, 'MM-DD')`, days)));
    let n = 0;
    for (const r of rows) {
      if (await this.fire(`member.birthday:${r.id}:${year}`, "member.birthday.v1", { memberId: r.id })) n += 1;
    }
    return n;
  }
}
