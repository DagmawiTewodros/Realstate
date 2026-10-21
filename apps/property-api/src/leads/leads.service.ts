import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  CLOSED_LEAD_STATUSES,
  canMoveLead,
  type ActivityType,
  type LeadStatus,
  type Pagination,
  type activityCreateSchema,
  type leadCreateSchema,
  type leadListQuerySchema,
  type leadUpdateSchema,
} from "@platform/shared";
import { AppError, AuditService, CLOCK, DB, OutboxService, conflict, notFound, type AuthUser, type Clock, type Database, type Executor } from "@platform/nest-common";
import { activities, customers, leads, units, users } from "../db/schema";
import { CustomersService } from "../customers/customers.service";
import { ROLE, isBroker, isSalesManager } from "../access";

const CONTACT_TYPES: ActivityType[] = ["CALL", "VIEWING", "EMAIL", "TELEGRAM", "OFFER"];

@Injectable()
export class LeadsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
  ) {}

  private scope(user: AuthUser): SQL | undefined {
    return isBroker(user) ? eq(leads.assignedToId, user.id) : undefined;
  }

  private selection() {
    return {
      lead: leads,
      customer: { id: customers.id, name: customers.name, phone: customers.phone, email: customers.email, locale: customers.locale },
      assignee: { id: users.id, name: users.name },
      unit: { id: units.id, code: units.code },
    };
  }

  async list(user: AuthUser, q: z.infer<typeof leadListQuerySchema>, page: Pagination) {
    const conditions: SQL[] = [];
    const scope = this.scope(user);
    if (scope) conditions.push(scope);
    if (q.status) conditions.push(eq(leads.status, q.status));
    if (q.assignedToId && !isBroker(user)) conditions.push(eq(leads.assignedToId, q.assignedToId));
    if (q.source) conditions.push(eq(leads.source, q.source));
    if (q.customerId) conditions.push(eq(leads.customerId, q.customerId));
    if (q.overdue) conditions.push(lt(leads.nextStepAt, this.clock.now()), notInArray(leads.status, [...CLOSED_LEAD_STATUSES]));
    if (q.q) {
      const digits = q.q.replace(/\D/g, "");
      const byName = ilike(customers.name, `%${q.q.replace(/[%_]/g, "")}%`);
      conditions.push(digits.length >= 3 ? or(byName, ilike(customers.phone, `%${digits}%`))! : byName);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const items = await this.db
      .select(this.selection())
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .leftJoin(users, eq(users.id, leads.assignedToId))
      .leftJoin(units, eq(units.id, leads.interestedUnitId))
      .where(where)
      .orderBy(sql`${leads.nextStepAt} asc nulls last`, desc(leads.createdAt))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    const [{ n }] = await this.db.select({ n: count() }).from(leads).innerJoin(customers, eq(customers.id, leads.customerId)).where(where);
    return { items: items.map(flatten), page: page.page, pageSize: page.pageSize, total: Number(n) };
  }

  /** Overdue next steps for the "My day" screen: past due, and not closed. */
  async overdue(user: AuthUser) {
    const scope = this.scope(user);
    const rows = await this.db
      .select(this.selection())
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .leftJoin(users, eq(users.id, leads.assignedToId))
      .leftJoin(units, eq(units.id, leads.interestedUnitId))
      .where(and(isNotNull(leads.nextStepAt), lt(leads.nextStepAt, this.clock.now()), notInArray(leads.status, [...CLOSED_LEAD_STATUSES]), scope))
      .orderBy(asc(leads.nextStepAt));
    return { items: rows.map(flatten) };
  }

  async get(user: AuthUser, id: string, tx?: Executor) {
    const scope = this.scope(user);
    const [row] = await (tx ?? this.db)
      .select(this.selection())
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .leftJoin(users, eq(users.id, leads.assignedToId))
      .leftJoin(units, eq(units.id, leads.interestedUnitId))
      .where(and(eq(leads.id, id), scope))
      .limit(1);
    if (!row) throw notFound("LEAD_NOT_FOUND", "Lead not found");
    return flatten(row);
  }

  async detail(user: AuthUser, id: string) {
    const lead = await this.get(user, id);
    const timeline = await this.db
      .select({ activity: activities, by: { id: users.id, name: users.name } })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.createdById))
      .where(eq(activities.leadId, id))
      .orderBy(desc(activities.occurredAt));
    return { lead, activities: timeline.map((t) => ({ ...t.activity, createdBy: t.by?.id ? t.by : null })), consent: await this.customers.consentState(lead.customerId) };
  }

  async create(user: AuthUser, input: z.infer<typeof leadCreateSchema>) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      let customerId: string;
      if (input.customerId) {
        customerId = (await this.customers.get(user, input.customerId, tx)).id;
      } else {
        const c = input.customer!;
        customerId = (await this.customers.findOrCreate(user, { ...c, source: input.source }, tx)).customer.id;
      }
      // A broker's new lead is theirs; a manager may assign it straight away.
      const assignedToId = isBroker(user) ? user.id : (input.assignedToId ?? null);
      if (assignedToId && !isBroker(user)) await this.assertAssignable(assignedToId, tx);
      if (input.interestedUnitId) await this.assertUnit(input.interestedUnitId, tx);
      const [lead] = await tx
        .insert(leads)
        .values({
          customerId,
          source: input.source,
          assignedToId,
          interestedUnitNote: input.interestedUnitNote ?? null,
          interestedUnitId: input.interestedUnitId ?? null,
          nextStepAt: input.nextStepAt ?? null,
          nextStepNote: input.nextStepNote ?? null,
          createdById: user.id,
        })
        .returning();
      await this.audit.log({ userId: user.id, action: "lead.created", entityType: "lead", entityId: lead.id }, tx);
      await this.outbox.emit(tx, "lead.created.v1", { leadId: lead.id, customerId, source: lead.source, assignedToId });
      if (assignedToId) await this.outbox.emit(tx, "lead.assigned.v1", { leadId: lead.id, assignedToId, customerId });
      return lead;
    });
  }

  /** Used by the public website: the lead is created by no signed-in user. */
  async createFromWebsite(tx: Executor, input: { customerId: string; unitId: string | null; message: string | null }) {
    const [lead] = await tx
      .insert(leads)
      .values({ customerId: input.customerId, source: "WEBSITE", interestedUnitId: input.unitId, interestedUnitNote: input.message })
      .returning();
    await this.audit.log({ userId: null, action: "lead.created", entityType: "lead", entityId: lead.id, metadata: { source: "WEBSITE" } }, tx);
    await this.outbox.emit(tx, "lead.created.v1", { leadId: lead.id, customerId: input.customerId, source: "WEBSITE", assignedToId: null });
    return lead;
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof leadUpdateSchema>) {
    await this.get(user, id);
    if (input.interestedUnitId) await this.assertUnit(input.interestedUnitId, this.db);
    const [lead] = await this.db
      .update(leads)
      .set({ ...input, updatedAt: this.clock.now() })
      .where(eq(leads.id, id))
      .returning();
    return lead;
  }

  async assign(user: AuthUser, id: string, assignedToId: string) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const current = await this.get(user, id, tx);
      await this.assertAssignable(assignedToId, tx);
      const [lead] = await tx.update(leads).set({ assignedToId, updatedAt: this.clock.now() }).where(eq(leads.id, id)).returning();
      await tx.insert(activities).values({ leadId: id, type: "NOTE", notes: `Assigned`, isSystem: true, createdById: user.id, occurredAt: this.clock.now() });
      await this.audit.log({ userId: user.id, action: "lead.assigned", entityType: "lead", entityId: id, metadata: { from: current.assignedToId, to: assignedToId } }, tx);
      await this.outbox.emit(tx, "lead.assigned.v1", { leadId: id, assignedToId, customerId: current.customerId });
      return lead;
    });
  }

  async changeStatus(user: AuthUser, id: string, status: LeadStatus, lostReason?: string | null) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const current = await this.get(user, id, tx);
      const check = canMoveLead(current.status as LeadStatus, status, isSalesManager(user));
      if (!check.ok) {
        const messages = {
          ILLEGAL_MOVE: `A lead cannot move from ${current.status} to ${status}`,
          MANAGER_ONLY: "Only a sales manager can move a lead back",
          SAME_STATUS: "The lead already has this status",
        };
        throw conflict(check.code, messages[check.code]);
      }
      const closed = CLOSED_LEAD_STATUSES.includes(status);
      const now = this.clock.now();
      const [lead] = await tx
        .update(leads)
        .set({
          status,
          lostReason: status === "LOST" ? lostReason! : null,
          closedAt: closed ? now : null,
          nextStepAt: closed ? null : current.nextStepAt,
          updatedAt: now,
        })
        .where(eq(leads.id, id))
        .returning();
      await tx.insert(activities).values({ leadId: id, type: "NOTE", notes: `${current.status} → ${status}${lostReason ? `: ${lostReason}` : ""}`, isSystem: true, createdById: user.id, occurredAt: now });
      await this.audit.log({ userId: user.id, action: "lead.status_changed", entityType: "lead", entityId: id, metadata: { from: current.status, to: status } }, tx);
      await this.outbox.emit(tx, "lead.status_changed.v1", { leadId: id, from: current.status, to: status });
      return lead;
    });
  }

  async addActivity(user: AuthUser, id: string, input: z.infer<typeof activityCreateSchema>) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const current = await this.get(user, id, tx);
      const occurredAt = input.occurredAt ?? this.clock.now();
      const [activity] = await tx
        .insert(activities)
        .values({ leadId: id, type: input.type, notes: input.notes ?? null, result: input.result ?? null, occurredAt, createdById: user.id })
        .returning();
      const patch: Partial<typeof leads.$inferInsert> = { updatedAt: this.clock.now() };
      if (CONTACT_TYPES.includes(input.type) && !current.firstContactAt) patch.firstContactAt = occurredAt;
      if (input.nextStepAt !== undefined) {
        patch.nextStepAt = input.nextStepAt;
        patch.nextStepNote = input.nextStepNote ?? null;
      }
      await tx.update(leads).set(patch).where(eq(leads.id, id));
      return activity;
    });
  }

  private async assertAssignable(userId: string, tx: Executor) {
    const [u] = await tx.select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, userId));
    if (!u || !u.isActive || ![ROLE.BROKER, ROLE.SALES_MANAGER].includes(u.role as "BROKER")) {
      throw new AppError(400, "INVALID_ASSIGNEE", "Leads can be assigned only to active brokers or sales managers");
    }
  }

  private async assertUnit(unitId: string, tx: Executor) {
    const [u] = await tx.select({ id: units.id }).from(units).where(eq(units.id, unitId));
    if (!u) throw new AppError(400, "UNIT_NOT_FOUND", "That unit does not exist");
  }

  async idsForCustomer(customerId: string) {
    const rows = await this.db.select({ id: leads.id }).from(leads).where(inArray(leads.customerId, [customerId]));
    return rows.map((r) => r.id);
  }
}

function flatten(row: {
  lead: typeof leads.$inferSelect;
  customer: { id: string; name: string; phone: string | null; email: string | null; locale: string };
  assignee: { id: string | null; name: string | null } | null;
  unit: { id: string | null; code: string | null } | null;
}) {
  return {
    ...row.lead,
    customer: row.customer,
    assignee: row.assignee?.id ? row.assignee : null,
    interestedUnit: row.unit?.id ? row.unit : null,
  };
}
