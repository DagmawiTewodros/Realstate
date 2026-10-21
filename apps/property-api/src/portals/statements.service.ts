import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { addDays, addMonths, addisDateString, addisStartOfDay } from "@platform/shared";
import { AppError, AuditService, CLOCK, DB, notFound, type AuthUser, type Clock, type Database } from "@platform/nest-common";
import { customers, landlords, leases, maintenanceRequests, payments, rentCharges, statements, units, type StatementFigures } from "../db/schema";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Monthly owner statements. Figures for a month: rent charged (charges due in the month), rent received
 * (valid payments dated in the month), outstanding arrears (unpaid parts of charges due by the month end,
 * as recorded now), maintenance paid by the owner (requests finished in the month), and net = received - maintenance.
 * Management fees are not included (open decision, see docs/DECISIONS.md).
 * A finished month is saved once as a snapshot and only changes when a manager re-issues it.
 */
@Injectable()
export class StatementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  monthBounds(month: string) {
    if (!MONTH.test(month)) throw new AppError(400, "INVALID_MONTH", "Use YYYY-MM");
    const start = `${month}-01`;
    const end = addDays(addMonths(start, 1), -1);
    return { start, end };
  }

  async compute(landlordId: string, month: string): Promise<StatementFigures> {
    const { start, end } = this.monthBounds(month);
    const [owner] = await this.db.select({ id: landlords.id }).from(landlords).where(eq(landlords.id, landlordId));
    if (!owner) throw notFound("LANDLORD_NOT_FOUND");
    const ownerLeases = await this.db
      .select({ id: leases.id, unitCode: units.code, tenantName: customers.name })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(customers, eq(customers.id, leases.tenantId))
      .where(and(eq(leases.landlordId, landlordId), ne(leases.status, "DRAFT")))
      .orderBy(units.code);
    const perLease: StatementFigures["leases"] = [];
    for (const l of ownerLeases) {
      const [charged] = await this.db
        .select({ v: sql<string | null>`sum(${rentCharges.amountMinor})` })
        .from(rentCharges)
        .where(and(eq(rentCharges.leaseId, l.id), ne(rentCharges.status, "WAIVED"), gte(rentCharges.dueDate, start), lte(rentCharges.dueDate, end)));
      const [received] = await this.db
        .select({ v: sql<string | null>`sum(${payments.amountMinor})` })
        .from(payments)
        .where(and(eq(payments.leaseId, l.id), eq(payments.status, "VALID"), gte(payments.paidAt, start), lte(payments.paidAt, end)));
      const [arrears] = await this.db
        .select({ v: sql<string | null>`sum(${rentCharges.amountMinor} - ${rentCharges.paidMinor})` })
        .from(rentCharges)
        .where(and(eq(rentCharges.leaseId, l.id), ne(rentCharges.status, "WAIVED"), lte(rentCharges.dueDate, end), sql`${rentCharges.paidMinor} < ${rentCharges.amountMinor}`));
      const row = { leaseId: l.id, unitCode: l.unitCode, tenantName: l.tenantName, chargedMinor: Number(charged.v ?? 0), receivedMinor: Number(received.v ?? 0), arrearsMinor: Number(arrears.v ?? 0) };
      if (row.chargedMinor || row.receivedMinor || row.arrearsMinor) perLease.push(row);
    }
    const repairs = await this.db
      .select({ id: maintenanceRequests.id, unitCode: units.code, title: maintenanceRequests.title, cost: maintenanceRequests.costMinor, closedAt: maintenanceRequests.closedAt })
      .from(maintenanceRequests)
      .innerJoin(units, eq(units.id, maintenanceRequests.unitId))
      .where(
        and(
          eq(units.landlordId, landlordId),
          eq(maintenanceRequests.status, "DONE"),
          eq(maintenanceRequests.paidByLandlord, true),
          gte(maintenanceRequests.closedAt, addisStartOfDay(start)),
          sql`${maintenanceRequests.closedAt} < ${addisStartOfDay(addDays(end, 1)).toISOString()}`,
        ),
      )
      .orderBy(maintenanceRequests.closedAt);
    const maintenance = repairs.map((r) => ({ requestId: r.id, unitCode: r.unitCode, title: r.title, costMinor: Number(r.cost ?? 0), closedAt: r.closedAt!.toISOString() }));
    const rentChargedMinor = perLease.reduce((a, l) => a + l.chargedMinor, 0);
    const rentReceivedMinor = perLease.reduce((a, l) => a + l.receivedMinor, 0);
    const arrearsMinor = perLease.reduce((a, l) => a + l.arrearsMinor, 0);
    const maintenanceCostMinor = maintenance.reduce((a, m) => a + m.costMinor, 0);
    return { month, currency: "ETB", rentChargedMinor, rentReceivedMinor, arrearsMinor, maintenanceCostMinor, netMinor: rentReceivedMinor - maintenanceCostMinor, leases: perLease, maintenance };
  }

  isClosedMonth(month: string): boolean {
    const { end } = this.monthBounds(month);
    return end < addisDateString(this.clock.now());
  }

  /** The saved statement for a finished month (created on first request), or a live preview for the current month. */
  async get(landlordId: string, month: string, user: AuthUser | null) {
    if (!this.isClosedMonth(month)) {
      return { preview: true, figures: await this.compute(landlordId, month), version: 0, issuedAt: this.clock.now() };
    }
    const [saved] = await this.db.select().from(statements).where(and(eq(statements.landlordId, landlordId), eq(statements.month, month)));
    if (saved) return { preview: false, figures: saved.figures, version: saved.version, issuedAt: saved.issuedAt, id: saved.id };
    const figures = await this.compute(landlordId, month);
    const [row] = await this.db
      .insert(statements)
      .values({ landlordId, month, figures, version: 1, issuedAt: this.clock.now(), issuedById: user?.id ?? null })
      .onConflictDoNothing()
      .returning();
    const final = row ?? (await this.db.select().from(statements).where(and(eq(statements.landlordId, landlordId), eq(statements.month, month))))[0];
    return { preview: false, figures: final.figures, version: final.version, issuedAt: final.issuedAt, id: final.id };
  }

  async reissue(user: AuthUser, landlordId: string, month: string) {
    if (!this.isClosedMonth(month)) throw new AppError(409, "MONTH_NOT_FINISHED", "Only a finished month can be issued");
    const figures = await this.compute(landlordId, month);
    const [existing] = await this.db.select().from(statements).where(and(eq(statements.landlordId, landlordId), eq(statements.month, month)));
    const version = (existing?.version ?? 0) + 1;
    const [row] = await this.db
      .insert(statements)
      .values({ landlordId, month, figures, version, issuedAt: this.clock.now(), issuedById: user.id })
      .onConflictDoUpdate({ target: [statements.landlordId, statements.month], set: { figures, version, issuedAt: this.clock.now(), issuedById: user.id } })
      .returning();
    await this.audit.log({ userId: user.id, action: "statement.reissued", entityType: "landlord", entityId: landlordId, metadata: { month, version } });
    return { preview: false, figures: row.figures, version: row.version, issuedAt: row.issuedAt, id: row.id };
  }

  async listSaved(landlordId: string) {
    return this.db
      .select({ id: statements.id, month: statements.month, version: statements.version, issuedAt: statements.issuedAt, netMinor: sql<number>`(${statements.figures}->>'netMinor')::bigint` })
      .from(statements)
      .where(eq(statements.landlordId, landlordId))
      .orderBy(desc(statements.month));
  }
}
