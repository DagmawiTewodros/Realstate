import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { and, between, eq, gt, isNotNull, isNull, lt, notInArray, sql } from "drizzle-orm";
import { CLOSED_LEAD_STATUSES, addDays, addisDateString, diffDays, reminderSettingsSchema, type ReminderSettings } from "@platform/shared";
import {
  AlertService,
  APP_CONFIG,
  CLOCK,
  DB,
  MessageService,
  OutboxService,
  ReminderLogService,
  SettingsService,
  type BaseConfig,
  type Clock,
  type Database,
} from "@platform/nest-common";
import { customers, leads, leases, projects, rentCharges, units, viewings } from "../db/schema";
import { RentService } from "../rentals/rent.service";
import { OfferMatcher } from "./offers";

const on = (s: ReminderSettings, key: keyof ReminderSettings["enabled"] | string) => (s.enabled as Record<string, boolean>)[key] !== false;

/**
 * Time-based work for System A. Every reminder is claimed in reminder_log first, so running the scheduler
 * any number of times produces each reminder once. Runs every 10 minutes when SCHEDULER_ENABLED=true.
 */
@Injectable()
export class ReminderScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ReminderScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly outbox: OutboxService,
    private readonly reminders: ReminderLogService,
    private readonly settings: SettingsService,
    private readonly rent: RentService,
    private readonly offers: OfferMatcher,
    private readonly messages: MessageService,
    private readonly alerts: AlertService,
  ) {}

  onModuleInit(): void {
    if (this.config.SCHEDULER_ENABLED && this.config.NODE_ENV !== "test") {
      this.timer = setInterval(() => void this.tick(), 10 * 60_000);
      setTimeout(() => void this.tick(), 15_000);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (e) {
      await this.alerts.alert(`Scheduler failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }

  async run(): Promise<Record<string, number>> {
    const s = await this.settings.get("reminders", reminderSettingsSchema);
    const result = {
      overdueMarked: await this.rent.markOverdue(),
      viewingReminders: on(s, "viewing.reminder") ? await this.viewingReminders() : 0,
      rentDueSoon: on(s, "rent.due_soon") ? await this.rentDueSoon(s.rentDueSoonDays) : 0,
      rentOverdue: on(s, "rent.overdue") ? await this.rentOverdue(s.rentOverdueDays) : 0,
      leaseExpiring: on(s, "lease.expiring") ? await this.leaseExpiring(s.leaseExpiringDays) : 0,
      followUps: on(s, "lead.followup_overdue") ? await this.followUps(s.leadResponseHours) : 0,
      digests: on(s, "offers") ? await this.offers.flushDigests() : 0,
      deferredSent: await this.messages.flushDeferred(),
    };
    this.logger.debug(JSON.stringify(result));
    return result;
  }

  private async emitOnce(key: string, name: string, payload: Record<string, unknown>): Promise<boolean> {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Parameters<OutboxService["emit"]>[0];
      if (!(await this.reminders.claim(key, tx))) return false;
      await this.outbox.emit(tx, name, payload);
      return true;
    });
  }

  /** The day before a booked viewing (Addis date). */
  async viewingReminders(): Promise<number> {
    const tomorrow = addDays(addisDateString(this.clock.now()), 1);
    const rows = await this.db
      .select({ viewing: viewings, lead: { customerId: leads.customerId, assignedToId: leads.assignedToId }, unitCode: units.code, project: projects.name })
      .from(viewings)
      .innerJoin(leads, eq(leads.id, viewings.leadId))
      .leftJoin(units, eq(units.id, viewings.unitId))
      .leftJoin(projects, eq(projects.id, units.projectId))
      .where(and(eq(viewings.status, "BOOKED"), sql`(${viewings.scheduledAt} AT TIME ZONE 'Africa/Addis_Ababa')::date = ${tomorrow}::date`));
    let n = 0;
    for (const r of rows) {
      const fired = await this.emitOnce(`viewing.reminder:${r.viewing.id}`, "viewing.reminder.v1", {
        viewingId: r.viewing.id,
        leadId: r.viewing.leadId,
        customerId: r.lead.customerId,
        brokerId: r.lead.assignedToId,
        unitLabel: r.unitCode ? `${r.project} ${r.unitCode}` : "",
        scheduledAt: r.viewing.scheduledAt.toISOString(),
      });
      if (fired) n += 1;
    }
    return n;
  }

  private chargeRows(where: ReturnType<typeof and>) {
    return this.db
      .select({ charge: rentCharges, tenantId: leases.tenantId, unitCode: units.code })
      .from(rentCharges)
      .innerJoin(leases, eq(leases.id, rentCharges.leaseId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(and(eq(leases.status, "ACTIVE"), notInArray(rentCharges.status, ["PAID", "WAIVED"]), sql`${rentCharges.paidMinor} < ${rentCharges.amountMinor}`, where));
  }

  async rentDueSoon(days: number): Promise<number> {
    const target = addDays(addisDateString(this.clock.now()), days);
    let n = 0;
    for (const r of await this.chargeRows(and(eq(rentCharges.dueDate, target)))) {
      if (
        await this.emitOnce(`rent.due_soon:${r.charge.id}`, "rent.due_soon.v1", {
          chargeId: r.charge.id,
          leaseId: r.charge.leaseId,
          tenantId: r.tenantId,
          unitCode: r.unitCode,
          amountMinor: r.charge.amountMinor - r.charge.paidMinor,
          dueDate: r.charge.dueDate,
        })
      )
        n += 1;
    }
    return n;
  }

  /** Fires on each threshold (default day 1 and day 7). A 3-day window covers a scheduler that was down. */
  async rentOverdue(thresholds: number[]): Promise<number> {
    const today = addisDateString(this.clock.now());
    let n = 0;
    for (const d of thresholds) {
      const rows = await this.chargeRows(and(between(rentCharges.dueDate, addDays(today, -d - 2), addDays(today, -d))));
      for (const r of rows) {
        if (
          await this.emitOnce(`rent.overdue:${r.charge.id}:${d}`, "rent.overdue.v1", {
            chargeId: r.charge.id,
            leaseId: r.charge.leaseId,
            tenantId: r.tenantId,
            unitCode: r.unitCode,
            amountMinor: r.charge.amountMinor - r.charge.paidMinor,
            dueDate: r.charge.dueDate,
            daysOverdue: diffDays(r.charge.dueDate, today),
            threshold: d,
          })
        )
          n += 1;
      }
    }
    return n;
  }

  async leaseExpiring(days: number): Promise<number> {
    const today = addisDateString(this.clock.now());
    const rows = await this.db
      .select({ lease: leases, unitCode: units.code, tenantName: customers.name })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(customers, eq(customers.id, leases.tenantId))
      .where(and(eq(leases.status, "ACTIVE"), between(leases.endDate, today, addDays(today, days))));
    let n = 0;
    for (const r of rows) {
      if (
        await this.emitOnce(`lease.expiring:${r.lease.id}`, "lease.expiring.v1", {
          leaseId: r.lease.id,
          landlordId: r.lease.landlordId,
          unitCode: r.unitCode,
          tenantName: r.tenantName,
          endDate: r.lease.endDate,
        })
      )
        n += 1;
    }
    return n;
  }

  /**
   * Broker nudges: a next step that is overdue, or a new lead not contacted within the response time.
   * If it is still overdue a day later, the sales managers are told too.
   */
  async followUps(responseHours: number): Promise<number> {
    const now = this.clock.now();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const open = and(isNotNull(leads.assignedToId), notInArray(leads.status, [...CLOSED_LEAD_STATUSES]));
    let n = 0;
    const overdue = await this.db
      .select({ lead: leads, customerName: customers.name })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(and(open, lt(leads.nextStepAt, now)));
    for (const r of overdue) {
      const base = `followup:${r.lead.id}:${r.lead.nextStepAt!.toISOString()}`;
      const payload = { leadId: r.lead.id, brokerId: r.lead.assignedToId, customerName: r.customerName, reason: r.lead.nextStepNote ?? "next step" };
      if (await this.emitOnce(`${base}:broker`, "lead.followup_overdue.v1", { ...payload, level: "broker" })) n += 1;
      if (r.lead.nextStepAt! < dayAgo && (await this.emitOnce(`${base}:manager`, "lead.followup_overdue.v1", { ...payload, level: "manager" }))) n += 1;
    }
    const cutoff = new Date(now.getTime() - responseHours * 3_600_000);
    const notContacted = await this.db
      .select({ lead: leads, customerName: customers.name })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .where(and(open, isNull(leads.firstContactAt), lt(leads.createdAt, cutoff), gt(leads.createdAt, new Date(now.getTime() - 14 * 86_400_000))));
    for (const r of notContacted) {
      const payload = { leadId: r.lead.id, brokerId: r.lead.assignedToId, customerName: r.customerName, reason: "first contact" };
      if (await this.emitOnce(`firstcontact:${r.lead.id}:broker`, "lead.followup_overdue.v1", { ...payload, level: "broker" })) n += 1;
      if (r.lead.createdAt < new Date(cutoff.getTime() - 86_400_000) && (await this.emitOnce(`firstcontact:${r.lead.id}:manager`, "lead.followup_overdue.v1", { ...payload, level: "manager" }))) n += 1;
    }
    return n;
  }
}
