import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { CHANNELS, normalizePhone, type Channel, type customerCreateSchema, type customerUpdateSchema, type Pagination } from "@platform/shared";
import { AuditService, ConsentService, DB, notFound, withTx, type AuthUser, type Database, type Executor } from "@platform/nest-common";
import { consentRecords, customers, leads, leases, payments, activities, savedSearches } from "../db/schema";
import { ROLE } from "../access";

export type CustomerRow = typeof customers.$inferSelect;
type CreateInput = z.infer<typeof customerCreateSchema>;
type UpdateInput = z.infer<typeof customerUpdateSchema>;

@Injectable()
export class CustomersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
  ) {}

  /** Brokers see only customers they created or customers on leads assigned to them. */
  visibility(user: AuthUser): SQL | undefined {
    if (user.role !== ROLE.BROKER) return undefined;
    return or(
      eq(customers.createdById, user.id),
      exists(
        this.db
          .select({ one: sql`1` })
          .from(leads)
          .where(and(eq(leads.customerId, customers.id), eq(leads.assignedToId, user.id))),
      ),
    );
  }

  async list(user: AuthUser, page: Pagination, q?: string) {
    const conditions: SQL[] = [];
    const vis = this.visibility(user);
    if (vis) conditions.push(vis);
    if (q) {
      const phone = normalizePhone(q);
      const like = `%${q.replace(/[%_]/g, "")}%`;
      conditions.push(or(ilike(customers.name, like), ilike(customers.email, like), phone ? eq(customers.phone, phone) : ilike(customers.phone, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const items = await this.db
      .select()
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt), asc(customers.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    const [{ n }] = await this.db.select({ n: count() }).from(customers).where(where);
    return { items, page: page.page, pageSize: page.pageSize, total: Number(n) };
  }

  async get(user: AuthUser, id: string, tx?: Executor): Promise<CustomerRow> {
    const vis = this.visibility(user);
    const [row] = await (tx ?? this.db)
      .select()
      .from(customers)
      .where(vis ? and(eq(customers.id, id), vis) : eq(customers.id, id))
      .limit(1);
    if (!row) throw notFound("CUSTOMER_NOT_FOUND", "Customer not found");
    return row;
  }

  async consentState(customerId: string): Promise<Record<Channel, boolean>> {
    const state = {} as Record<Channel, boolean>;
    for (const channel of CHANNELS) state[channel] = await this.consent.canContact(customerId, channel);
    return state;
  }

  async findDuplicates(phone: string | null | undefined, email: string | null | undefined, excludeId?: string, tx?: Executor) {
    const ors: SQL[] = [];
    if (phone) ors.push(eq(customers.phone, phone));
    if (email) ors.push(sql`lower(${customers.email}) = ${email.toLowerCase()}`);
    if (!ors.length) return [];
    const rows = await (tx ?? this.db)
      .select({ id: customers.id, name: customers.name, phone: customers.phone, email: customers.email })
      .from(customers)
      .where(and(or(...ors), sql`${customers.anonymizedAt} is null`));
    return rows.filter((r) => r.id !== excludeId);
  }

  /** Creates a customer. Duplicates by phone or email are reported as warnings, not blocked. */
  async create(user: AuthUser | null, input: CreateInput, tx?: Executor) {
    return withTx(this.db, tx, async (t) => {
      const duplicates = await this.findDuplicates(input.phone, input.email, undefined, t);
      const [row] = await t
        .insert(customers)
        .values({
          name: input.name,
          phone: input.phone ?? null,
          email: input.email ?? null,
          telegramChatId: input.telegramChatId ?? null,
          locale: input.locale,
          source: input.source,
          createdById: user?.id ?? null,
        })
        .returning();
      await this.audit.log({ userId: user?.id ?? null, action: "customer.created", entityType: "customer", entityId: row.id }, t);
      return { customer: row, warnings: duplicates.length ? [{ code: "POSSIBLE_DUPLICATE", matches: duplicates }] : [] };
    });
  }

  /** Reuses the customer with the same phone (or email when there is no phone); otherwise creates one. */
  async findOrCreate(
    user: AuthUser | null,
    input: { name: string; phone?: string | null; email?: string | null; locale: "am" | "en"; source: string },
    tx: Executor,
  ): Promise<{ customer: CustomerRow; created: boolean }> {
    const match = input.phone
      ? await tx.select().from(customers).where(and(eq(customers.phone, input.phone), sql`${customers.anonymizedAt} is null`)).limit(1)
      : input.email
        ? await tx.select().from(customers).where(and(sql`lower(${customers.email}) = ${input.email.toLowerCase()}`, sql`${customers.anonymizedAt} is null`)).limit(1)
        : [];
    if (match[0]) {
      if (input.email && !match[0].email) {
        const [updated] = await tx.update(customers).set({ email: input.email, updatedAt: new Date() }).where(eq(customers.id, match[0].id)).returning();
        return { customer: updated, created: false };
      }
      return { customer: match[0], created: false };
    }
    const [row] = await tx
      .insert(customers)
      .values({ name: input.name, phone: input.phone ?? null, email: input.email ?? null, locale: input.locale, source: input.source, createdById: user?.id ?? null })
      .returning();
    await this.audit.log({ userId: user?.id ?? null, action: "customer.created", entityType: "customer", entityId: row.id }, tx);
    return { customer: row, created: true };
  }

  async update(user: AuthUser, id: string, input: UpdateInput) {
    await this.get(user, id);
    const [row] = await this.db
      .update(customers)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(customers.id, id))
      .returning();
    await this.audit.log({ userId: user.id, action: "customer.updated", entityType: "customer", entityId: id, metadata: { fields: Object.keys(input) } });
    const duplicates = await this.findDuplicates(row.phone, row.email, id);
    return { customer: row, warnings: duplicates.length ? [{ code: "POSSIBLE_DUPLICATE", matches: duplicates }] : [] };
  }

  async setConsent(user: AuthUser, id: string, channel: Channel, granted: boolean, note?: string | null) {
    await this.get(user, id);
    if (granted) await this.consent.grant(id, channel, { note, userId: user.id });
    else await this.consent.revoke(id, channel);
    await this.audit.log({ userId: user.id, action: granted ? "consent.granted" : "consent.revoked", entityType: "customer", entityId: id, metadata: { channel } });
    return { consent: await this.consentState(id), history: await this.consent.history(id) };
  }

  /** Everything stored about a customer, for a data request. */
  async export(id: string) {
    const [customer] = await this.db.select().from(customers).where(eq(customers.id, id));
    if (!customer) throw notFound("CUSTOMER_NOT_FOUND");
    const customerLeads = await this.db.select().from(leads).where(eq(leads.customerId, id));
    const leadIds = customerLeads.map((l) => l.id);
    const customerActivities = leadIds.length ? await this.db.select().from(activities).where(inArray(activities.leadId, leadIds)) : [];
    const customerLeases = await this.db.select().from(leases).where(eq(leases.tenantId, id));
    const leaseIds = customerLeases.map((l) => l.id);
    const customerPayments = leaseIds.length ? await this.db.select().from(payments).where(inArray(payments.leaseId, leaseIds)) : [];
    return {
      exportedAt: new Date().toISOString(),
      customer,
      consent: await this.db.select().from(consentRecords).where(eq(consentRecords.subjectId, id)),
      leads: customerLeads,
      activities: customerActivities,
      leases: customerLeases,
      payments: customerPayments,
      savedSearches: await this.db.select().from(savedSearches).where(eq(savedSearches.customerId, id)),
    };
  }

  /** Removes name and contact details but keeps the record, so counts and reports stay correct. */
  async anonymise(user: AuthUser, id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(customers)
        .set({ name: "Anonymised customer", phone: null, email: null, telegramChatId: null, anonymizedAt: new Date(), updatedAt: new Date() })
        .where(eq(customers.id, id))
        .returning();
      if (!row) throw notFound("CUSTOMER_NOT_FOUND");
      await this.consent.revokeAll(id, tx as unknown as Executor);
      await tx.update(savedSearches).set({ isActive: false }).where(eq(savedSearches.customerId, id));
      await this.audit.log({ userId: user.id, action: "customer.anonymised", entityType: "customer", entityId: id }, tx as unknown as Executor);
      return row;
    });
  }

  async countAll(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(customers);
    return Number(n);
  }
}
