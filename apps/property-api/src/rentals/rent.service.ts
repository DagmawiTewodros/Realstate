import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  addisDateString,
  allocatePayment,
  chargeStatusFor,
  diffDays,
  generateRentSchedule,
  type BillingFrequency,
  type ChargeStatus,
  type paymentCreateSchema,
} from "@platform/shared";
import {
  AppError,
  AuditService,
  CLOCK,
  CounterService,
  DB,
  EXTENSION,
  MB,
  MIME,
  OutboxService,
  StorageService,
  conflict,
  formatReceiptNumber,
  notFound,
  validateUpload,
  type AuthUser,
  type Clock,
  type Database,
  type Executor,
  type UploadedFile,
} from "@platform/nest-common";
import { customers, leases, paymentAllocations, payments, rentCharges, units } from "../db/schema";
import type { LeaseRow } from "./leases.service";

export const SLIP_MAX_BYTES = 5 * MB;

@Injectable()
export class RentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly counters: CounterService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private today(): string {
    return addisDateString(this.clock.now());
  }

  /** Creates every charge for the lease term, then applies any credit the tenant already has. */
  async generateCharges(tx: Executor, lease: LeaseRow): Promise<void> {
    const schedule = generateRentSchedule({
      startDate: lease.startDate,
      endDate: lease.endDate,
      rentMinor: lease.rentMinor,
      frequency: lease.billingFrequency as BillingFrequency,
    });
    const today = this.today();
    if (schedule.length) {
      await tx.insert(rentCharges).values(
        schedule.map((c) => ({ leaseId: lease.id, ...c, status: chargeStatusFor({ ...c, paidMinor: 0 }, today) })),
      );
    }
    await this.carryCreditFromPreviousLease(tx, lease);
    await this.applyCredit(tx, lease.id);
  }

  /** Credit left on the lease this one renews moves to the new lease. */
  private async carryCreditFromPreviousLease(tx: Executor, lease: LeaseRow) {
    if (!lease.previousLeaseId) return;
    const [prev] = await tx.select().from(leases).where(eq(leases.id, lease.previousLeaseId)).for("update");
    if (!prev || prev.creditMinor <= 0) return;
    await tx.update(payments).set({ leaseId: lease.id }).where(and(eq(payments.leaseId, prev.id), gt(payments.unappliedMinor, 0)));
    await tx.update(leases).set({ creditMinor: 0 }).where(eq(leases.id, prev.id));
    await tx.update(leases).set({ creditMinor: sql`${leases.creditMinor} + ${prev.creditMinor}` }).where(eq(leases.id, lease.id));
  }

  /** Uses unapplied money from earlier payments (oldest first) to pay open charges (oldest first). */
  async applyCredit(tx: Executor, leaseId: string): Promise<void> {
    const sources = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.leaseId, leaseId), eq(payments.status, "VALID"), gt(payments.unappliedMinor, 0)))
      .orderBy(asc(payments.paidAt), asc(payments.createdAt));
    const today = this.today();
    for (const p of sources) {
      const open = await tx.select().from(rentCharges).where(eq(rentCharges.leaseId, leaseId));
      const { allocations, remainderMinor } = allocatePayment(
        open.map((c) => ({ id: c.id, dueDate: c.dueDate, amountMinor: c.amountMinor, paidMinor: c.paidMinor, status: c.status as ChargeStatus })),
        p.unappliedMinor,
      );
      if (!allocations.length) break;
      await this.writeAllocations(tx, p.id, allocations, open, today);
      const used = p.unappliedMinor - remainderMinor;
      await tx.update(payments).set({ unappliedMinor: remainderMinor }).where(eq(payments.id, p.id));
      await tx.update(leases).set({ creditMinor: sql`${leases.creditMinor} - ${used}` }).where(eq(leases.id, leaseId));
    }
  }

  private async writeAllocations(
    tx: Executor,
    paymentId: string,
    allocations: Array<{ chargeId: string; amountMinor: number }>,
    charges: Array<typeof rentCharges.$inferSelect>,
    today: string,
  ) {
    for (const a of allocations) {
      const charge = charges.find((c) => c.id === a.chargeId)!;
      const paidMinor = charge.paidMinor + a.amountMinor;
      await tx.insert(paymentAllocations).values({ paymentId, chargeId: a.chargeId, amountMinor: a.amountMinor });
      await tx
        .update(rentCharges)
        .set({ paidMinor, status: chargeStatusFor({ ...charge, paidMinor, status: charge.status as ChargeStatus }, today) })
        .where(eq(rentCharges.id, a.chargeId));
      charge.paidMinor = paidMinor;
    }
  }

  /**
   * Records a payment and allocates it to the oldest unpaid charges first. The lease row is locked so
   * two payments on one lease are allocated one after the other. Overpayment becomes credit.
   */
  async recordPayment(user: AuthUser, leaseId: string, input: z.infer<typeof paymentCreateSchema>, slip?: UploadedFile) {
    let slipKey: string | null = null;
    if (slip) {
      const kind = validateUpload(slip, ["jpeg", "png", "webp", "pdf"], SLIP_MAX_BYTES);
      slipKey = this.storage.newKey(`leases/${leaseId}/slips`, EXTENSION[kind]);
      await this.storage.put(slipKey, slip.buffer, MIME[kind]);
    }
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [lease] = await tx.select().from(leases).where(eq(leases.id, leaseId)).for("update");
      if (!lease) throw notFound("LEASE_NOT_FOUND");
      if (lease.status === "DRAFT") throw conflict("LEASE_NOT_ACTIVE", "Activate the lease before recording payments");
      const year = Number(input.paidAt.slice(0, 4));
      const receiptNumber = formatReceiptNumber("R", year, await this.counters.next(tx, "property-receipt", year));
      const charges = await tx.select().from(rentCharges).where(eq(rentCharges.leaseId, leaseId));
      const { allocations, remainderMinor } = allocatePayment(
        charges.map((c) => ({ id: c.id, dueDate: c.dueDate, amountMinor: c.amountMinor, paidMinor: c.paidMinor, status: c.status as ChargeStatus })),
        input.amountMinor,
      );
      const [payment] = await tx
        .insert(payments)
        .values({
          leaseId,
          amountMinor: input.amountMinor,
          paidAt: input.paidAt,
          method: input.method,
          reference: input.reference ?? null,
          receiptNumber,
          unappliedMinor: remainderMinor,
          slipKey,
          recordedById: user.id,
        })
        .returning();
      await this.writeAllocations(tx, payment.id, allocations, charges, this.today());
      if (remainderMinor > 0) await tx.update(leases).set({ creditMinor: sql`${leases.creditMinor} + ${remainderMinor}` }).where(eq(leases.id, leaseId));
      await this.audit.log({ userId: user.id, action: "payment.recorded", entityType: "lease", entityId: leaseId, metadata: { paymentId: payment.id, amountMinor: input.amountMinor } }, tx);
      await this.outbox.emit(tx, "payment.recorded.v1", { paymentId: payment.id, leaseId, amountMinor: input.amountMinor });
      return payment;
    });
  }

  /** Voids a payment: its allocations are reversed exactly and its credit removed. Payments are never deleted. */
  async voidPayment(user: AuthUser, paymentId: string, reason: string) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
      if (!payment) throw notFound("PAYMENT_NOT_FOUND");
      await tx.select().from(leases).where(eq(leases.id, payment.leaseId)).for("update");
      const [locked] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
      if (locked.status === "VOIDED") throw conflict("ALREADY_VOIDED", "This payment is already voided");
      const allocs = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
      const today = this.today();
      for (const a of allocs) {
        const [charge] = await tx.select().from(rentCharges).where(eq(rentCharges.id, a.chargeId));
        const paidMinor = charge.paidMinor - a.amountMinor;
        await tx
          .update(rentCharges)
          .set({ paidMinor, status: chargeStatusFor({ ...charge, paidMinor, status: charge.status as ChargeStatus }, today) })
          .where(eq(rentCharges.id, a.chargeId));
      }
      await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
      if (locked.unappliedMinor > 0) await tx.update(leases).set({ creditMinor: sql`${leases.creditMinor} - ${locked.unappliedMinor}` }).where(eq(leases.id, locked.leaseId));
      const [voided] = await tx
        .update(payments)
        .set({ status: "VOIDED", voidReason: reason, voidedAt: this.clock.now(), voidedById: user.id, unappliedMinor: 0 })
        .where(eq(payments.id, paymentId))
        .returning();
      await this.applyCredit(tx, locked.leaseId);
      await this.audit.log({ userId: user.id, action: "payment.voided", entityType: "lease", entityId: locked.leaseId, metadata: { paymentId, reason, amountMinor: locked.amountMinor } }, tx);
      return voided;
    });
  }

  /**
   * Ledger: charges that are already due (due date on or before today) and all payments, with a running
   * balance. Positive balance = tenant owes; negative = paid ahead. Future charges are listed separately.
   */
  async ledger(leaseId: string) {
    const [lease] = await this.db.select().from(leases).where(eq(leases.id, leaseId));
    if (!lease) throw notFound("LEASE_NOT_FOUND");
    const today = this.today();
    const charges = await this.db.select().from(rentCharges).where(eq(rentCharges.leaseId, leaseId)).orderBy(asc(rentCharges.dueDate));
    const leasePayments = await this.db.select().from(payments).where(eq(payments.leaseId, leaseId)).orderBy(asc(payments.paidAt), asc(payments.createdAt));
    type Entry = { date: string; kind: "CHARGE" | "PAYMENT"; id: string; description: string; debitMinor: number; creditMinor: number; status: string; balanceMinor?: number };
    const posted = charges.filter((c) => c.status !== "WAIVED" && c.dueDate <= today);
    const entries: Entry[] = [
      ...posted.map((c) => ({ date: c.dueDate, kind: "CHARGE" as const, id: c.id, description: `Rent ${c.periodStart} to ${c.periodEnd}`, debitMinor: c.amountMinor, creditMinor: 0, status: c.status })),
      ...leasePayments.map((p) => ({
        date: p.paidAt,
        kind: "PAYMENT" as const,
        id: p.id,
        description: `${p.receiptNumber} ${p.method}${p.reference ? ` ${p.reference}` : ""}`,
        debitMinor: 0,
        creditMinor: p.status === "VALID" ? p.amountMinor : 0,
        status: p.status,
      })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === "CHARGE" ? -1 : 1));
    let balance = 0;
    for (const e of entries) {
      balance += e.debitMinor - e.creditMinor;
      e.balanceMinor = balance;
    }
    const upcoming = charges.filter((c) => c.status !== "WAIVED" && c.dueDate > today);
    return {
      lease,
      charges,
      payments: leasePayments,
      entries,
      upcomingCharges: upcoming,
      balanceMinor: balance,
      creditMinor: lease.creditMinor,
      totalContractMinor: charges.filter((c) => c.status !== "WAIVED").reduce((a, c) => a + c.amountMinor, 0),
    };
  }

  /** Tenants with overdue amounts: unpaid parts of charges whose due date has passed. */
  async arrears() {
    const today = this.today();
    const rows = await this.db
      .select({
        leaseId: leases.id,
        tenantId: customers.id,
        tenantName: customers.name,
        unitCode: units.code,
        dueMinor: sql<string>`sum(${rentCharges.amountMinor} - ${rentCharges.paidMinor})`,
        oldestDue: sql<string>`to_char(min(${rentCharges.dueDate}), 'YYYY-MM-DD')`,
      })
      .from(rentCharges)
      .innerJoin(leases, eq(leases.id, rentCharges.leaseId))
      .innerJoin(customers, eq(customers.id, leases.tenantId))
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(and(notInArray(rentCharges.status, ["PAID", "WAIVED"]), lt(rentCharges.dueDate, today), sql`${rentCharges.paidMinor} < ${rentCharges.amountMinor}`))
      .groupBy(leases.id, customers.id, customers.name, units.code)
      .orderBy(sql`min(${rentCharges.dueDate})`);
    return {
      items: rows.map((r) => ({ ...r, dueMinor: Number(r.dueMinor), daysOverdue: diffDays(r.oldestDue, today) })),
    };
  }

  /** Daily job: unpaid charges past their due date become OVERDUE. Safe to run any number of times. */
  async markOverdue(): Promise<number> {
    const rows = await this.db
      .update(rentCharges)
      .set({ status: "OVERDUE" })
      .where(and(eq(rentCharges.status, "DUE"), lt(rentCharges.dueDate, this.today()), eq(rentCharges.paidMinor, 0)))
      .returning({ id: rentCharges.id });
    return rows.length;
  }

  async payment(paymentId: string) {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw notFound("PAYMENT_NOT_FOUND");
    return p;
  }

  async slip(paymentId: string) {
    const p = await this.payment(paymentId);
    if (!p.slipKey) throw notFound("SLIP_NOT_FOUND");
    const ext = p.slipKey.split(".").pop() ?? "";
    const contentType = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { body: await this.storage.get(p.slipKey), contentType };
  }

  async chargesFor(leaseIds: string[]) {
    if (!leaseIds.length) return [];
    return this.db.select().from(rentCharges).where(inArray(rentCharges.leaseId, leaseIds)).orderBy(asc(rentCharges.dueDate));
  }

  assertAmount(amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new AppError(400, "INVALID_AMOUNT");
  }
}
