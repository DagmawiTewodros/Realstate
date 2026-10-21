import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { viewingCreateSchema, viewingUpdateSchema } from "@platform/shared";
import { AppError, AuditService, CLOCK, DB, OutboxService, conflict, notFound, type AuthUser, type Clock, type Database, type Executor } from "@platform/nest-common";
import { activities, leads, projects, units, viewings } from "../db/schema";
import { LeadsService } from "../leads/leads.service";

@Injectable()
export class ViewingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly leads: LeadsService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async forLead(user: AuthUser, leadId: string) {
    await this.leads.get(user, leadId);
    const rows = await this.db
      .select({ viewing: viewings, unitCode: units.code })
      .from(viewings)
      .leftJoin(units, eq(units.id, viewings.unitId))
      .where(eq(viewings.leadId, leadId))
      .orderBy(asc(viewings.scheduledAt));
    return { items: rows.map((r) => ({ ...r.viewing, unitCode: r.unitCode })) };
  }

  private async unitLabel(tx: Executor, unitId: string | null) {
    if (!unitId) return "";
    const [u] = await tx.select({ code: units.code, project: projects.name }).from(units).innerJoin(projects, eq(projects.id, units.projectId)).where(eq(units.id, unitId));
    if (!u) throw new AppError(400, "UNIT_NOT_FOUND", "That unit does not exist");
    return `${u.project} ${u.code}`;
  }

  async book(user: AuthUser, leadId: string, input: z.infer<typeof viewingCreateSchema>) {
    if (input.scheduledAt.getTime() < this.clock.now().getTime()) throw new AppError(400, "IN_THE_PAST", "Choose a time in the future");
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const lead = await this.leads.get(user, leadId, tx);
      const unitId = input.unitId ?? lead.interestedUnitId ?? null;
      const unitLabel = await this.unitLabel(tx, unitId);
      const [viewing] = await tx.insert(viewings).values({ leadId, unitId, scheduledAt: input.scheduledAt, createdById: user.id }).returning();
      await tx.insert(activities).values({ leadId, type: "VIEWING", notes: `Viewing booked${unitLabel ? `: ${unitLabel}` : ""}`, occurredAt: this.clock.now(), createdById: user.id });
      if (!lead.firstContactAt) await tx.update(leads).set({ firstContactAt: this.clock.now() }).where(eq(leads.id, leadId));
      await this.audit.log({ userId: user.id, action: "viewing.booked", entityType: "lead", entityId: leadId, metadata: { viewingId: viewing.id } }, tx);
      await this.outbox.emit(tx, "viewing.booked.v1", {
        viewingId: viewing.id,
        leadId,
        customerId: lead.customerId,
        brokerId: lead.assignedToId,
        unitLabel,
        scheduledAt: viewing.scheduledAt.toISOString(),
      });
      return viewing;
    });
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof viewingUpdateSchema>) {
    const [current] = await this.db.select().from(viewings).where(eq(viewings.id, id));
    if (!current) throw notFound("VIEWING_NOT_FOUND");
    await this.leads.get(user, current.leadId);
    if (current.status !== "BOOKED") throw conflict("VIEWING_CLOSED", "This viewing is already closed");
    const [row] = await this.db
      .update(viewings)
      .set({ ...input, updatedAt: this.clock.now() })
      .where(eq(viewings.id, id))
      .returning();
    await this.audit.log({ userId: user.id, action: "viewing.updated", entityType: "lead", entityId: current.leadId, metadata: { viewingId: id, ...input } });
    return row;
  }
}
