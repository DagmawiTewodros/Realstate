import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, ne, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { addDays, addisDateString, type LeaseStatus, type leaseCreateSchema, type leaseUpdateSchema } from "@platform/shared";
import { AppError, AuditService, CLOCK, DB, OutboxService, conflict, notFound, type AuthUser, type Clock, type Database, type Executor } from "@platform/nest-common";
import { customers, landlords, leases, rentCharges, units } from "../db/schema";
import { UnitsService } from "../inventory/units.service";
import { RentService } from "./rent.service";

export type LeaseRow = typeof leases.$inferSelect;

@Injectable()
export class LeasesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly units: UnitsService,
    private readonly rent: RentService,
  ) {}

  private today(): string {
    return addisDateString(this.clock.now());
  }

  async list(filter: { status?: LeaseStatus; unitId?: string; tenantId?: string; landlordId?: string; expiringDays?: number }) {
    const c: SQL[] = [];
    if (filter.status) c.push(eq(leases.status, filter.status));
    if (filter.unitId) c.push(eq(leases.unitId, filter.unitId));
    if (filter.tenantId) c.push(eq(leases.tenantId, filter.tenantId));
    if (filter.landlordId) c.push(eq(leases.landlordId, filter.landlordId));
    if (filter.expiringDays !== undefined) {
      const today = this.today();
      c.push(eq(leases.status, "ACTIVE"), gte(leases.endDate, today), lte(leases.endDate, addDays(today, filter.expiringDays)));
    }
    const rows = await this.db
      .select({ lease: leases, unit: { id: units.id, code: units.code }, tenant: { id: customers.id, name: customers.name }, landlord: { id: landlords.id, name: landlords.name } })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .innerJoin(customers, eq(customers.id, leases.tenantId))
      .leftJoin(landlords, eq(landlords.id, leases.landlordId))
      .where(c.length ? and(...c) : undefined)
      .orderBy(desc(leases.createdAt))
      .limit(500);
    return { items: rows.map((r) => ({ ...r.lease, unit: r.unit, tenant: r.tenant, landlord: r.landlord?.id ? r.landlord : null })) };
  }

  async get(id: string, tx?: Executor): Promise<LeaseRow> {
    const [row] = await (tx ?? this.db).select().from(leases).where(eq(leases.id, id)).limit(1);
    if (!row) throw notFound("LEASE_NOT_FOUND", "Lease not found");
    return row;
  }

  async detail(id: string) {
    const lease = await this.get(id);
    const [unit] = await this.db.select({ id: units.id, code: units.code, status: units.status }).from(units).where(eq(units.id, lease.unitId));
    const [tenant] = await this.db.select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email }).from(customers).where(eq(customers.id, lease.tenantId));
    const [landlord] = lease.landlordId ? await this.db.select({ id: landlords.id, name: landlords.name }).from(landlords).where(eq(landlords.id, lease.landlordId)) : [];
    return { lease, unit, tenant, landlord: landlord ?? null };
  }

  async create(user: AuthUser, input: z.infer<typeof leaseCreateSchema>) {
    const [unit] = await this.db.select().from(units).where(eq(units.id, input.unitId));
    if (!unit) throw new AppError(400, "UNIT_NOT_FOUND", "Choose an existing unit");
    if (unit.status === "SOLD") throw conflict("UNIT_SOLD", "A sold unit cannot be leased");
    const [tenant] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.id, input.tenantId));
    if (!tenant) throw new AppError(400, "TENANT_NOT_FOUND", "Choose an existing customer as tenant");
    const landlordId = input.landlordId ?? unit.landlordId ?? null;
    const [row] = await this.db
      .insert(leases)
      .values({ ...input, landlordId, currency: "ETB", status: "DRAFT", createdById: user.id })
      .returning();
    await this.audit.log({ userId: user.id, action: "lease.created", entityType: "lease", entityId: row.id });
    return row;
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof leaseUpdateSchema>) {
    const lease = await this.get(id);
    const termsChanged = ["startDate", "endDate", "rentMinor", "billingFrequency"].some((k) => k in input && input[k as keyof typeof input] !== undefined);
    if (lease.status !== "DRAFT" && termsChanged) throw conflict("LEASE_NOT_DRAFT", "Dates and rent can only change while the lease is a draft; renew instead");
    const next = { ...lease, ...input };
    if (next.startDate > next.endDate) throw new AppError(400, "END_BEFORE_START", "End date must be on or after start date");
    const [row] = await this.db
      .update(leases)
      .set({ ...input, updatedAt: this.clock.now() })
      .where(eq(leases.id, id))
      .returning();
    await this.audit.log({ userId: user.id, action: "lease.updated", entityType: "lease", entityId: id, metadata: { fields: Object.keys(input) } });
    return row;
  }

  /** Activates a draft: checks overlaps, marks the unit leased, and generates the rent schedule. */
  async activate(user: AuthUser, id: string) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [lease] = await tx.select().from(leases).where(eq(leases.id, id)).for("update");
      if (!lease) throw notFound("LEASE_NOT_FOUND");
      if (lease.status !== "DRAFT") throw conflict("LEASE_NOT_DRAFT", "Only a draft lease can be activated");
      // Lock the unit first so two activations on the same unit run one after the other.
      const [unit] = await tx.select().from(units).where(eq(units.id, lease.unitId)).for("update");
      if (unit.status === "SOLD") throw conflict("UNIT_SOLD", "A sold unit cannot be leased");
      const overlapping = await tx
        .select({ id: leases.id })
        .from(leases)
        .where(and(eq(leases.unitId, lease.unitId), eq(leases.status, "ACTIVE"), ne(leases.id, id), lte(leases.startDate, lease.endDate), gte(leases.endDate, lease.startDate)));
      if (overlapping.length) throw conflict("OVERLAP", "This unit already has an active lease for these dates");
      if (unit.status !== "LEASED") await this.units.setStatus(user, unit.id, "LEASED", "LEASE", tx);
      const [active] = await tx.update(leases).set({ status: "ACTIVE", activatedAt: this.clock.now(), updatedAt: this.clock.now() }).where(eq(leases.id, id)).returning();
      await this.rent.generateCharges(tx, active);
      await this.audit.log({ userId: user.id, action: "lease.activated", entityType: "lease", entityId: id }, tx);
      await this.outbox.emit(tx, "lease.activated.v1", { leaseId: id, unitId: lease.unitId, tenantId: lease.tenantId });
      return active;
    });
  }

  async end(user: AuthUser, id: string) {
    return this.close(user, id, "ENDED", null);
  }

  async terminate(user: AuthUser, id: string, reason: string) {
    return this.close(user, id, "TERMINATED", reason);
  }

  /**
   * Ends or terminates an active lease. Unpaid charges for periods that start after today are waived.
   * The unit returns to AVAILABLE (and is republished if it was published) unless another lease is active.
   */
  private async close(user: AuthUser, id: string, status: "ENDED" | "TERMINATED", reason: string | null) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [lease] = await tx.select().from(leases).where(eq(leases.id, id)).for("update");
      if (!lease) throw notFound("LEASE_NOT_FOUND");
      if (lease.status !== "ACTIVE") throw conflict("LEASE_NOT_ACTIVE", "Only an active lease can be ended or terminated");
      const now = this.clock.now();
      const today = this.today();
      const [closed] = await tx
        .update(leases)
        .set({ status, terminationReason: reason, endedAt: now, updatedAt: now })
        .where(eq(leases.id, id))
        .returning();
      await tx
        .update(rentCharges)
        .set({ status: "WAIVED" })
        .where(and(eq(rentCharges.leaseId, id), eq(rentCharges.paidMinor, 0), gte(rentCharges.periodStart, addDays(today, 1))));
      const [other] = await tx.select({ id: leases.id }).from(leases).where(and(eq(leases.unitId, lease.unitId), eq(leases.status, "ACTIVE")));
      const [unit] = await tx.select({ status: units.status }).from(units).where(eq(units.id, lease.unitId));
      if (!other && unit.status === "LEASED") await this.units.setStatus(user, lease.unitId, "AVAILABLE", "LEASE", tx);
      await this.audit.log({ userId: user.id, action: status === "ENDED" ? "lease.ended" : "lease.terminated", entityType: "lease", entityId: id, metadata: { reason } }, tx);
      await this.outbox.emit(tx, status === "ENDED" ? "lease.ended.v1" : "lease.terminated.v1", { leaseId: id, unitId: lease.unitId });
      return closed;
    });
  }

  /** Creates a new draft that starts the day after the old lease ends. The old lease is not changed. */
  async renew(user: AuthUser, id: string, input: { endDate: string; rentMinor?: number }) {
    const old = await this.get(id);
    const startDate = addDays(old.endDate, 1);
    if (input.endDate < startDate) throw new AppError(400, "END_BEFORE_START", `The renewal starts on ${startDate}; choose a later end date`);
    const [row] = await this.db
      .insert(leases)
      .values({
        unitId: old.unitId,
        tenantId: old.tenantId,
        landlordId: old.landlordId,
        startDate,
        endDate: input.endDate,
        rentMinor: input.rentMinor ?? old.rentMinor,
        billingFrequency: old.billingFrequency,
        depositMinor: old.depositMinor,
        depositStatus: old.depositStatus,
        status: "DRAFT",
        previousLeaseId: old.id,
        createdById: user.id,
      })
      .returning();
    await this.audit.log({ userId: user.id, action: "lease.renewal_created", entityType: "lease", entityId: row.id, metadata: { previousLeaseId: id } });
    return row;
  }
}
