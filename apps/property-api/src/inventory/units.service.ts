import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  canMoveUnit,
  type Pagination,
  type UnitMoveContext,
  type UnitStatus,
  type unitCreateSchema,
  type unitListQuerySchema,
  type unitUpdateSchema,
} from "@platform/shared";
import { AppError, AuditService, CLOCK, DB, OutboxService, conflict, notFound, withTx, type AuthUser, type Clock, type Database, type Executor } from "@platform/nest-common";
import { buildings, landlords, photos, projects, units, documents } from "../db/schema";
import { isSalesManager } from "../access";

export type UnitRow = typeof units.$inferSelect;

@Injectable()
export class UnitsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  filters(q: z.infer<typeof unitListQuerySchema>): SQL[] {
    const c: SQL[] = [];
    if (q.status) c.push(eq(units.status, q.status));
    if (q.type) c.push(eq(units.type, q.type));
    if (q.purpose) c.push(eq(units.purpose, q.purpose));
    if (q.projectId) c.push(eq(units.projectId, q.projectId));
    if (q.area) c.push(ilike(projects.area, `%${q.area.replace(/[%_]/g, "")}%`));
    if (q.minPriceMinor !== undefined) c.push(gte(units.priceMinor, q.minPriceMinor));
    if (q.maxPriceMinor !== undefined) c.push(lte(units.priceMinor, q.maxPriceMinor));
    if (q.bedrooms !== undefined) c.push(gte(units.bedrooms, q.bedrooms));
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, "")}%`;
      c.push(or(ilike(units.code, like), ilike(projects.name, like), ilike(projects.area, like))!);
    }
    return c;
  }

  order(sort: "newest" | "price_asc" | "price_desc") {
    if (sort === "price_asc") return [asc(units.priceMinor), asc(units.id)];
    if (sort === "price_desc") return [desc(units.priceMinor), asc(units.id)];
    return [desc(units.createdAt), asc(units.id)];
  }

  async list(q: z.infer<typeof unitListQuerySchema>, page: Pagination) {
    const where = and(...this.filters(q));
    const rows = await this.db
      .select({ unit: units, project: { id: projects.id, name: projects.name, area: projects.area }, building: { id: buildings.id, name: buildings.name } })
      .from(units)
      .innerJoin(projects, eq(projects.id, units.projectId))
      .leftJoin(buildings, eq(buildings.id, units.buildingId))
      .where(where)
      .orderBy(...this.order(q.sort))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    const [{ n }] = await this.db.select({ n: count() }).from(units).innerJoin(projects, eq(projects.id, units.projectId)).where(where);
    const photoCounts = await this.photoCounts(rows.map((r) => r.unit.id));
    return {
      items: rows.map((r) => ({ ...r.unit, project: r.project, building: r.building?.id ? r.building : null, photoCount: photoCounts.get(r.unit.id) ?? 0 })),
      page: page.page,
      pageSize: page.pageSize,
      total: Number(n),
    };
  }

  private async photoCounts(unitIds: string[]): Promise<Map<string, number>> {
    if (!unitIds.length) return new Map();
    const rows = await this.db
      .select({ unitId: photos.unitId, n: count() })
      .from(photos)
      .where(or(...unitIds.map((id) => eq(photos.unitId, id))))
      .groupBy(photos.unitId);
    return new Map(rows.map((r) => [r.unitId!, Number(r.n)]));
  }

  async get(id: string, tx?: Executor): Promise<UnitRow> {
    const [row] = await (tx ?? this.db).select().from(units).where(eq(units.id, id)).limit(1);
    if (!row) throw notFound("UNIT_NOT_FOUND", "Unit not found");
    return row;
  }

  async detail(id: string) {
    const unit = await this.get(id);
    const [project] = await this.db.select().from(projects).where(eq(projects.id, unit.projectId));
    const [building] = unit.buildingId ? await this.db.select().from(buildings).where(eq(buildings.id, unit.buildingId)) : [];
    const [landlord] = unit.landlordId ? await this.db.select({ id: landlords.id, name: landlords.name }).from(landlords).where(eq(landlords.id, unit.landlordId)) : [];
    const unitPhotos = await this.db.select().from(photos).where(eq(photos.unitId, id)).orderBy(asc(photos.sortOrder), asc(photos.createdAt));
    const unitDocuments = await this.db.select().from(documents).where(eq(documents.unitId, id)).orderBy(asc(documents.createdAt));
    return { unit, project, building: building ?? null, landlord: landlord ?? null, photos: unitPhotos, documents: unitDocuments };
  }

  async create(user: AuthUser, input: z.infer<typeof unitCreateSchema>) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [project] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, input.projectId));
      if (!project) throw new AppError(400, "PROJECT_NOT_FOUND", "Choose an existing project");
      if (input.buildingId) await this.assertBuilding(tx, input.buildingId, input.projectId);
      const [existing] = await tx.select({ id: units.id }).from(units).where(and(eq(units.projectId, input.projectId), eq(units.code, input.code)));
      if (existing) throw conflict("UNIT_CODE_TAKEN", "Another unit in this project already has this code");
      const [row] = await tx.insert(units).values({ ...input, currency: "ETB" }).returning();
      await this.audit.log({ userId: user.id, action: "unit.created", entityType: "unit", entityId: row.id }, tx);
      await this.outbox.emit(tx, "unit.created.v1", { unitId: row.id, projectId: row.projectId });
      return row;
    });
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof unitUpdateSchema>) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const current = await this.get(id, tx);
      if (input.buildingId) await this.assertBuilding(tx, input.buildingId, current.projectId);
      if (input.code && input.code !== current.code) {
        const [existing] = await tx.select({ id: units.id }).from(units).where(and(eq(units.projectId, current.projectId), eq(units.code, input.code)));
        if (existing) throw conflict("UNIT_CODE_TAKEN", "Another unit in this project already has this code");
      }
      const [row] = await tx
        .update(units)
        .set({ ...input, updatedAt: this.clock.now() })
        .where(eq(units.id, id))
        .returning();
      await this.audit.log({ userId: user.id, action: "unit.updated", entityType: "unit", entityId: id, metadata: { fields: Object.keys(input) } }, tx);
      if (input.priceMinor !== undefined && input.priceMinor < current.priceMinor) {
        await this.outbox.emit(tx, "unit.price_dropped.v1", { unitId: id, oldPriceMinor: current.priceMinor, newPriceMinor: input.priceMinor });
      }
      return row;
    });
  }

  /**
   * Changes a unit's status. A unit that leaves AVAILABLE is unpublished (and remembered as "republish when
   * available"); when it returns to AVAILABLE it is republished and a unit.released.v1 event is emitted.
   */
  async setStatus(user: AuthUser | null, id: string, to: UnitStatus, context: UnitMoveContext = "MANUAL", tx?: Executor): Promise<UnitRow> {
    return withTx(this.db, tx, async (t) => {
      const [current] = await t.select().from(units).where(eq(units.id, id)).for("update").limit(1);
      if (!current) throw notFound("UNIT_NOT_FOUND", "Unit not found");
      const check = canMoveUnit(current.status as UnitStatus, to, user ? isSalesManager(user) : false, context);
      if (!check.ok) {
        const messages = {
          ILLEGAL_MOVE: `A unit cannot move from ${current.status} to ${to}`,
          MANAGER_ONLY: "Only a sales manager can mark an available unit sold or leased",
          SAME_STATUS: "The unit already has this status",
        };
        throw conflict(check.code, messages[check.code]);
      }
      const now = this.clock.now();
      const patch: Partial<typeof units.$inferInsert> = { status: to, statusChangedAt: now, updatedAt: now };
      const released = to === "AVAILABLE" && current.republishOnAvailable;
      if (to !== "AVAILABLE" && current.isPublished) {
        patch.isPublished = false;
        patch.republishOnAvailable = true;
      }
      if (released) {
        patch.isPublished = true;
        patch.republishOnAvailable = false;
        patch.publishedAt = now;
      }
      const [row] = await t.update(units).set(patch).where(eq(units.id, id)).returning();
      await this.audit.log({ userId: user?.id ?? null, action: "unit.status_changed", entityType: "unit", entityId: id, metadata: { from: current.status, to, context } }, t);
      await this.outbox.emit(t, "unit.status_changed.v1", { unitId: id, from: current.status, to });
      if (released) await this.outbox.emit(t, "unit.released.v1", { unitId: id });
      return row;
    });
  }

  async setPublished(user: AuthUser, id: string, isPublished: boolean) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [current] = await tx.select().from(units).where(eq(units.id, id)).for("update").limit(1);
      if (!current) throw notFound("UNIT_NOT_FOUND", "Unit not found");
      if (isPublished && current.status !== "AVAILABLE") throw conflict("UNIT_NOT_AVAILABLE", "Only available units can be published");
      if (current.isPublished === isPublished) return current;
      const now = this.clock.now();
      const [row] = await tx
        .update(units)
        .set({ isPublished, republishOnAvailable: false, publishedAt: isPublished ? now : current.publishedAt, updatedAt: now })
        .where(eq(units.id, id))
        .returning();
      await this.audit.log({ userId: user.id, action: isPublished ? "unit.published" : "unit.unpublished", entityType: "unit", entityId: id }, tx);
      if (isPublished) await this.outbox.emit(tx, "unit.published.v1", { unitId: id });
      return row;
    });
  }

  private async assertBuilding(tx: Executor, buildingId: string, projectId: string) {
    const [b] = await tx.select({ projectId: buildings.projectId }).from(buildings).where(eq(buildings.id, buildingId));
    if (!b || b.projectId !== projectId) throw new AppError(400, "BUILDING_NOT_IN_PROJECT", "The building must belong to the unit's project");
  }
}
