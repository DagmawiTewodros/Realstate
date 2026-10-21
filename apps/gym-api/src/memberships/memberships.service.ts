import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  addDays,
  addisDateString,
  compareDates,
  diffDays,
  freezeDays,
  membershipEndDate,
  rangesOverlap,
  renewalStartDate,
  type MembershipStatus,
  type freezeSchema,
  type planCreateSchema,
  type planUpdateSchema,
  type sellMembershipSchema,
} from "@platform/shared";
import {
  AppError,
  AuditService,
  CLOCK,
  CounterService,
  DB,
  OutboxService,
  conflict,
  forbidden,
  formatReceiptNumber,
  notFound,
  type AuthUser,
  type Clock,
  type Database,
  type Executor,
} from "@platform/nest-common";
import { gymPayments, members, membershipFreezes, memberships, plans } from "../db/schema";
import { isManager } from "../access";

export type MembershipRow = typeof memberships.$inferSelect;
export type CurrentStatus = "ACTIVE" | "FROZEN" | "EXPIRED" | "CANCELLED" | "NONE";

export interface MembershipState {
  status: CurrentStatus;
  membership: (MembershipRow & { planName: string }) | null;
  /** Days left including today (only for ACTIVE or FROZEN). */
  daysLeft: number | null;
  freeze: { startDate: string; endDate: string } | null;
  next: (MembershipRow & { planName: string }) | null;
}

export const RECEIPT_SCOPE = "gym-receipt";

@Injectable()
export class MembershipsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly counters: CounterService,
    private readonly outbox: OutboxService,
  ) {}

  today(): string {
    return addisDateString(this.clock.now());
  }

  // ---------- Plans ----------
  async listPlans(onlyActive: boolean) {
    return this.db
      .select()
      .from(plans)
      .where(onlyActive ? eq(plans.isActive, true) : undefined)
      .orderBy(asc(plans.durationMonths), asc(plans.name));
  }

  async createPlan(user: AuthUser, input: z.infer<typeof planCreateSchema>) {
    const [row] = await this.db.insert(plans).values({ ...input, currency: "ETB" }).returning();
    await this.audit.log({ userId: user.id, action: "plan.created", entityType: "plan", entityId: row.id });
    return row;
  }

  async updatePlan(user: AuthUser, id: string, input: z.infer<typeof planUpdateSchema>) {
    const [row] = await this.db
      .update(plans)
      .set({ ...input, updatedAt: this.clock.now() })
      .where(eq(plans.id, id))
      .returning();
    if (!row) throw notFound("PLAN_NOT_FOUND", "Plan not found");
    await this.audit.log({ userId: user.id, action: "plan.updated", entityType: "plan", entityId: id, metadata: { fields: Object.keys(input) } });
    return row;
  }

  // ---------- State ----------
  /**
   * The member's membership situation today: ACTIVE (a membership covers today), FROZEN (a freeze covers
   * today), CANCELLED (the membership covering today was cancelled), EXPIRED (only past memberships) or NONE.
   */
  async currentState(memberId: string, tx?: Executor, today = this.today()): Promise<MembershipState> {
    const exec = tx ?? this.db;
    const rows = await exec
      .select({ m: memberships, planName: plans.name })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(eq(memberships.memberId, memberId))
      .orderBy(desc(memberships.endDate), desc(memberships.createdAt));
    const all = rows.map((r) => ({ ...r.m, planName: r.planName }));
    const covering = all.find((m) => m.status !== "CANCELLED" && m.startDate <= today && m.endDate >= today) ?? null;
    const next = all.filter((m) => m.status !== "CANCELLED" && m.startDate > today).sort((a, b) => compareDates(a.startDate, b.startDate))[0] ?? null;
    if (covering) {
      const freezes = await exec
        .select()
        .from(membershipFreezes)
        .where(and(eq(membershipFreezes.membershipId, covering.id), lte(membershipFreezes.startDate, today), gte(membershipFreezes.endDate, today)))
        .limit(1);
      const daysLeft = diffDays(today, covering.endDate) + 1;
      if (freezes[0]) {
        return { status: "FROZEN", membership: covering, daysLeft, freeze: { startDate: freezes[0].startDate, endDate: freezes[0].endDate }, next };
      }
      return { status: "ACTIVE", membership: covering, daysLeft, freeze: null, next };
    }
    const cancelledCovering = all.find((m) => m.status === "CANCELLED" && m.startDate <= today && m.endDate >= today);
    if (cancelledCovering) return { status: "CANCELLED", membership: cancelledCovering, daysLeft: null, freeze: null, next };
    const past = all.find((m) => m.status !== "CANCELLED" && m.endDate < today);
    if (past) return { status: "EXPIRED", membership: past, daysLeft: null, freeze: null, next };
    const latestCancelled = all.find((m) => m.status === "CANCELLED");
    if (latestCancelled && !next) return { status: "CANCELLED", membership: latestCancelled, daysLeft: null, freeze: null, next };
    return { status: "NONE", membership: null, daysLeft: null, freeze: null, next };
  }

  async history(memberId: string) {
    const rows = await this.db
      .select({ m: memberships, planName: plans.name })
      .from(memberships)
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(eq(memberships.memberId, memberId))
      .orderBy(desc(memberships.startDate));
    const ids = rows.map((r) => r.m.id);
    const freezes = ids.length ? await this.db.select().from(membershipFreezes).where(inArray(membershipFreezes.membershipId, ids)) : [];
    const payments = await this.db.select().from(gymPayments).where(eq(gymPayments.memberId, memberId)).orderBy(desc(gymPayments.createdAt));
    return {
      memberships: rows.map((r) => ({ ...r.m, planName: r.planName, freezes: freezes.filter((f) => f.membershipId === r.m.id) })),
      payments,
    };
  }

  // ---------- Selling and renewal ----------
  /**
   * Sells a membership (new or renewal). A renewal before expiry starts the day after the current end date;
   * after expiry it starts today. A payment is recorded in the same transaction, unless a manager marks it
   * complimentary with a reason.
   */
  async sell(user: AuthUser, memberId: string, input: z.infer<typeof sellMembershipSchema>) {
    if (input.complimentaryReason && !isManager(user)) throw forbidden("COMPLIMENTARY_MANAGER_ONLY", "Only a manager can give a complimentary membership");
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [member] = await tx.select().from(members).where(eq(members.id, memberId)).for("update").limit(1);
      if (!member) throw notFound("MEMBER_NOT_FOUND", "Member not found");
      if (member.anonymizedAt) throw new AppError(400, "MEMBER_ANONYMISED", "This member was anonymised");
      const [plan] = await tx.select().from(plans).where(eq(plans.id, input.planId)).limit(1);
      if (!plan || !plan.isActive) throw new AppError(400, "PLAN_NOT_AVAILABLE", "Choose an active plan");
      const today = this.today();
      const existing = await tx
        .select()
        .from(memberships)
        .where(and(eq(memberships.memberId, memberId), ne(memberships.status, "CANCELLED")));
      const latestEnd = existing.reduce<string | null>((max, m) => (!max || m.endDate > max ? m.endDate : max), null);
      const start = input.startDate ?? renewalStartDate(latestEnd, today);
      const end = membershipEndDate(start, plan.durationMonths);
      if (existing.some((m) => rangesOverlap(m.startDate, m.endDate, start, end))) {
        throw conflict("MEMBERSHIP_OVERLAP", "This membership would overlap another membership of this member");
      }
      const [membership] = await tx
        .insert(memberships)
        .values({
          memberId,
          planId: plan.id,
          startDate: start,
          endDate: end,
          status: "ACTIVE",
          priceMinor: plan.priceMinor,
          complimentaryReason: input.complimentaryReason ?? null,
          createdById: user.id,
        })
        .returning();
      let payment: typeof gymPayments.$inferSelect | null = null;
      if (input.payment) {
        const year = Number(today.slice(0, 4));
        const number = await this.counters.next(tx, RECEIPT_SCOPE, year);
        [payment] = await tx
          .insert(gymPayments)
          .values({
            memberId,
            membershipId: membership.id,
            amountMinor: input.payment.amountMinor,
            paidAt: today,
            method: input.payment.method,
            reference: input.payment.reference ?? null,
            receiptNumber: formatReceiptNumber("G", year, number),
            recordedById: user.id,
          })
          .returning();
      }
      if (member.status !== "ACTIVE") await tx.update(members).set({ status: "ACTIVE", updatedAt: this.clock.now() }).where(eq(members.id, memberId));
      await this.audit.log(
        {
          userId: user.id,
          action: input.complimentaryReason ? "membership.complimentary" : "membership.sold",
          entityType: "membership",
          entityId: membership.id,
          metadata: { memberId, planId: plan.id, start, end, reason: input.complimentaryReason ?? undefined },
        },
        tx,
      );
      await this.outbox.emit(tx, "membership.sold.v1", { membershipId: membership.id, memberId, planId: plan.id, startDate: start, endDate: end });
      return { membership, payment };
    });
  }

  // ---------- Freeze, unfreeze, cancel ----------
  /**
   * Freezes a membership for a date range. The end date moves later by exactly the frozen days
   * (applied when the freeze is recorded, so the end date is always correct).
   */
  async freeze(user: AuthUser, membershipId: string, input: z.infer<typeof freezeSchema>) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [m] = await tx.select().from(memberships).where(eq(memberships.id, membershipId)).for("update").limit(1);
      if (!m) throw notFound("MEMBERSHIP_NOT_FOUND", "Membership not found");
      if (m.status === "CANCELLED") throw conflict("MEMBERSHIP_CANCELLED", "A cancelled membership cannot be frozen");
      const today = this.today();
      if (m.endDate < today) throw conflict("MEMBERSHIP_ENDED", "This membership has already ended");
      if (input.startDate < m.startDate || input.startDate > m.endDate) {
        throw new AppError(400, "FREEZE_OUTSIDE_MEMBERSHIP", "The freeze must start within the membership dates");
      }
      if (input.startDate < today) throw new AppError(400, "FREEZE_IN_PAST", "A freeze cannot start in the past");
      const freezes = await tx.select().from(membershipFreezes).where(eq(membershipFreezes.membershipId, membershipId));
      if (freezes.some((f) => rangesOverlap(f.startDate, f.endDate, input.startDate, input.endDate))) {
        throw conflict("FREEZE_OVERLAP", "This freeze overlaps another freeze of the same membership");
      }
      const later = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.memberId, m.memberId), ne(memberships.status, "CANCELLED"), sql`${memberships.startDate} > ${m.endDate}`))
        .limit(1);
      if (later[0]) throw conflict("HAS_LATER_MEMBERSHIP", "This member already has a renewal after this membership; freeze or cancel that one instead");
      const days = freezeDays(input.startDate, input.endDate);
      const newEnd = addDays(m.endDate, days);
      const status: MembershipStatus = input.startDate <= today && input.endDate >= today ? "FROZEN" : "ACTIVE";
      const [freeze] = await tx
        .insert(membershipFreezes)
        .values({ membershipId, startDate: input.startDate, endDate: input.endDate, reason: input.reason, applied: true, createdById: user.id })
        .returning();
      const [updated] = await tx.update(memberships).set({ endDate: newEnd, status, updatedAt: this.clock.now() }).where(eq(memberships.id, membershipId)).returning();
      await this.audit.log({ userId: user.id, action: "membership.frozen", entityType: "membership", entityId: membershipId, metadata: { ...input, days, oldEnd: m.endDate, newEnd } }, tx);
      return { membership: updated, freeze };
    });
  }

  /** Ends a freeze early (or removes a future one). The end date gives back the days not used. */
  async unfreeze(user: AuthUser, freezeId: string) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [f] = await tx.select().from(membershipFreezes).where(eq(membershipFreezes.id, freezeId)).for("update").limit(1);
      if (!f) throw notFound("FREEZE_NOT_FOUND", "Freeze not found");
      const [m] = await tx.select().from(memberships).where(eq(memberships.id, f.membershipId)).for("update").limit(1);
      const today = this.today();
      if (f.endDate < today) throw conflict("FREEZE_ENDED", "This freeze has already ended");
      const oldDays = freezeDays(f.startDate, f.endDate);
      let newDays = 0;
      if (f.startDate >= today) {
        await tx.delete(membershipFreezes).where(eq(membershipFreezes.id, freezeId));
      } else {
        const newEnd = addDays(today, -1);
        newDays = freezeDays(f.startDate, newEnd);
        await tx.update(membershipFreezes).set({ endDate: newEnd }).where(eq(membershipFreezes.id, freezeId));
      }
      const removed = oldDays - newDays;
      const [updated] = await tx
        .update(memberships)
        .set({ endDate: addDays(m.endDate, -removed), status: m.status === "FROZEN" ? "ACTIVE" : m.status, updatedAt: this.clock.now() })
        .where(eq(memberships.id, m.id))
        .returning();
      await this.audit.log({ userId: user.id, action: "membership.unfrozen", entityType: "membership", entityId: m.id, metadata: { freezeId, daysReturned: removed } }, tx);
      return { membership: updated };
    });
  }

  async cancel(user: AuthUser, membershipId: string, reason: string) {
    const [m] = await this.db.select().from(memberships).where(eq(memberships.id, membershipId)).limit(1);
    if (!m) throw notFound("MEMBERSHIP_NOT_FOUND", "Membership not found");
    if (m.status === "CANCELLED") throw conflict("ALREADY_CANCELLED", "This membership is already cancelled");
    const [updated] = await this.db
      .update(memberships)
      .set({ status: "CANCELLED", cancelReason: reason, updatedAt: this.clock.now() })
      .where(eq(memberships.id, membershipId))
      .returning();
    await this.audit.log({ userId: user.id, action: "membership.cancelled", entityType: "membership", entityId: membershipId, metadata: { reason } });
    return updated;
  }

  // ---------- Lists ----------
  /** Active memberships ending within `days` days with no renewal after them. */
  async expiring(days: number) {
    const today = this.today();
    const until = addDays(today, days);
    return this.db
      .select({ membership: memberships, member: { id: members.id, name: members.name, phone: members.phone }, planName: plans.name })
      .from(memberships)
      .innerJoin(members, eq(members.id, memberships.memberId))
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(
        and(
          inArray(memberships.status, ["ACTIVE", "FROZEN"]),
          gte(memberships.endDate, today),
          lte(memberships.endDate, until),
          sql`NOT EXISTS (SELECT 1 FROM memberships later WHERE later.member_id = ${memberships.memberId} AND later.status <> 'CANCELLED' AND later.start_date > ${memberships.endDate})`,
        ),
      )
      .orderBy(asc(memberships.endDate));
  }

  /** Memberships that ended in the last `sinceDays` days and were not renewed. */
  async expired(sinceDays: number) {
    const today = this.today();
    const from = addDays(today, -sinceDays);
    return this.db
      .select({ membership: memberships, member: { id: members.id, name: members.name, phone: members.phone }, planName: plans.name })
      .from(memberships)
      .innerJoin(members, eq(members.id, memberships.memberId))
      .innerJoin(plans, eq(plans.id, memberships.planId))
      .where(
        and(
          ne(memberships.status, "CANCELLED"),
          lt(memberships.endDate, today),
          gte(memberships.endDate, from),
          sql`NOT EXISTS (SELECT 1 FROM memberships later WHERE later.member_id = ${memberships.memberId} AND later.status <> 'CANCELLED' AND later.end_date >= ${today})`,
        ),
      )
      .orderBy(desc(memberships.endDate));
  }

  /**
   * Daily job: stores the derived status (EXPIRED, FROZEN, back to ACTIVE after a freeze).
   * Running it twice gives the same state.
   */
  async refreshStatuses(today = this.today()): Promise<{ expired: string[] }> {
    return this.db.transaction(async (tx) => {
      const expired = await tx
        .update(memberships)
        .set({ status: "EXPIRED", updatedAt: this.clock.now() })
        .where(and(inArray(memberships.status, ["ACTIVE", "FROZEN"]), lt(memberships.endDate, today)))
        .returning({ id: memberships.id });
      await tx.execute(sql`
        UPDATE memberships m SET status = 'FROZEN', updated_at = now()
        WHERE m.status = 'ACTIVE' AND EXISTS (
          SELECT 1 FROM membership_freezes f WHERE f.membership_id = m.id AND f.start_date <= ${today} AND f.end_date >= ${today})`);
      await tx.execute(sql`
        UPDATE memberships m SET status = 'ACTIVE', updated_at = now()
        WHERE m.status = 'FROZEN' AND m.end_date >= ${today} AND NOT EXISTS (
          SELECT 1 FROM membership_freezes f WHERE f.membership_id = m.id AND f.start_date <= ${today} AND f.end_date >= ${today})`);
      return { expired: expired.map((e) => e.id) };
    });
  }
}
