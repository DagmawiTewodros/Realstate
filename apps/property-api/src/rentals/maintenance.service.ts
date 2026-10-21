import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import {
  addDays,
  addisStartOfDay,
  canMoveMaintenance,
  type MaintenanceStatus,
  type Priority,
  type maintenanceAssignSchema,
  type maintenanceCreateSchema,
  type maintenanceStatusSchema,
} from "@platform/shared";
import {
  AppError,
  AuditService,
  CLOCK,
  DB,
  EXTENSION,
  MB,
  MIME,
  OutboxService,
  StorageService,
  conflict,
  notFound,
  validateUpload,
  type AuthUser,
  type Clock,
  type Database,
  type Executor,
  type UploadedFile,
} from "@platform/nest-common";
import { leases, maintenanceComments, maintenancePhotos, maintenanceRequests, units, users } from "../db/schema";

export const MAINTENANCE_PHOTO_MAX_BYTES = 10 * MB;

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(filter: { unitId?: string; status?: MaintenanceStatus; priority?: Priority; from?: string; to?: string; unitIds?: string[] }) {
    const c: SQL[] = [];
    if (filter.unitId) c.push(eq(maintenanceRequests.unitId, filter.unitId));
    if (filter.status) c.push(eq(maintenanceRequests.status, filter.status));
    if (filter.priority) c.push(eq(maintenanceRequests.priority, filter.priority));
    if (filter.from) c.push(gte(maintenanceRequests.createdAt, addisStartOfDay(filter.from)));
    if (filter.to) c.push(lt(maintenanceRequests.createdAt, addisStartOfDay(addDays(filter.to, 1))));
    if (filter.unitIds) c.push(filter.unitIds.length ? inArray(maintenanceRequests.unitId, filter.unitIds) : sql`false`);
    const rows = await this.db
      .select({ request: maintenanceRequests, unit: { id: units.id, code: units.code } })
      .from(maintenanceRequests)
      .innerJoin(units, eq(units.id, maintenanceRequests.unitId))
      .where(c.length ? and(...c) : undefined)
      .orderBy(sql`CASE ${maintenanceRequests.priority} WHEN 'URGENT' THEN 0 WHEN 'NORMAL' THEN 1 ELSE 2 END`, desc(maintenanceRequests.createdAt))
      .limit(500);
    return { items: rows.map((r) => ({ ...r.request, unit: r.unit })) };
  }

  async get(id: string, tx?: Executor) {
    const [row] = await (tx ?? this.db).select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id));
    if (!row) throw notFound("REQUEST_NOT_FOUND", "Repair request not found");
    return row;
  }

  async detail(id: string) {
    const request = await this.get(id);
    const [unit] = await this.db.select({ id: units.id, code: units.code }).from(units).where(eq(units.id, request.unitId));
    const comments = await this.db
      .select({ comment: maintenanceComments, by: { id: users.id, name: users.name } })
      .from(maintenanceComments)
      .leftJoin(users, eq(users.id, maintenanceComments.userId))
      .where(eq(maintenanceComments.requestId, id))
      .orderBy(asc(maintenanceComments.createdAt));
    const photos = await this.db.select().from(maintenancePhotos).where(eq(maintenancePhotos.requestId, id)).orderBy(asc(maintenancePhotos.createdAt));
    return { request, unit, comments: comments.map((c) => ({ ...c.comment, by: c.by?.id ? c.by : null })), photos };
  }

  async create(
    user: AuthUser,
    input: z.infer<typeof maintenanceCreateSchema> & { reportedByCustomerId?: string | null },
    tx?: Executor,
  ) {
    const exec = tx ?? this.db;
    const [unit] = await exec.select({ id: units.id, code: units.code }).from(units).where(eq(units.id, input.unitId));
    if (!unit) throw new AppError(400, "UNIT_NOT_FOUND", "Choose an existing unit");
    if (input.leaseId) {
      const [lease] = await exec.select({ unitId: leases.unitId }).from(leases).where(eq(leases.id, input.leaseId));
      if (!lease || lease.unitId !== input.unitId) throw new AppError(400, "LEASE_NOT_FOR_UNIT", "The lease must be for the same unit");
    }
    const run = async (t: Executor) => {
      const [row] = await t
        .insert(maintenanceRequests)
        .values({
          unitId: input.unitId,
          leaseId: input.leaseId ?? null,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority,
          reportedByCustomerId: input.reportedByCustomerId ?? null,
          createdById: user.id,
        })
        .returning();
      await this.audit.log({ userId: user.id, action: "maintenance.created", entityType: "maintenance", entityId: row.id }, t);
      await this.outbox.emit(t, "maintenance.created.v1", { requestId: row.id, unitId: row.unitId, priority: row.priority, title: row.title });
      return row;
    };
    return tx ? run(tx) : this.db.transaction((t) => run(t as unknown as Executor));
  }

  async assign(user: AuthUser, id: string, input: z.infer<typeof maintenanceAssignSchema>) {
    const current = await this.get(id);
    if (current.status === "DONE" || current.status === "CANCELLED") throw conflict("REQUEST_CLOSED", "This request is closed");
    const status: MaintenanceStatus = current.status === "NEW" ? "ASSIGNED" : (current.status as MaintenanceStatus);
    const [row] = await this.db
      .update(maintenanceRequests)
      .set({ assignedToName: input.assignedToName, assignedToPhone: input.assignedToPhone ?? null, status, updatedAt: this.clock.now() })
      .where(eq(maintenanceRequests.id, id))
      .returning();
    await this.audit.log({ userId: user.id, action: "maintenance.assigned", entityType: "maintenance", entityId: id, metadata: { to: input.assignedToName } });
    return row;
  }

  async setStatus(user: AuthUser, id: string, input: z.infer<typeof maintenanceStatusSchema>) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [current] = await tx.select().from(maintenanceRequests).where(eq(maintenanceRequests.id, id)).for("update");
      if (!current) throw notFound("REQUEST_NOT_FOUND");
      if (!canMoveMaintenance(current.status as MaintenanceStatus, input.status)) {
        throw conflict("ILLEGAL_MOVE", `A request cannot move from ${current.status} to ${input.status}`);
      }
      if (input.status === "ASSIGNED" && !current.assignedToName) throw conflict("NOT_ASSIGNED", "Assign someone first");
      const now = this.clock.now();
      const closing = input.status === "DONE" || input.status === "CANCELLED";
      const [row] = await tx
        .update(maintenanceRequests)
        .set({
          status: input.status,
          costMinor: input.status === "DONE" ? input.costMinor! : current.costMinor,
          paidByLandlord: input.paidByLandlord ?? current.paidByLandlord,
          closedAt: closing ? now : null,
          updatedAt: now,
        })
        .where(eq(maintenanceRequests.id, id))
        .returning();
      await this.audit.log({ userId: user.id, action: "maintenance.status_changed", entityType: "maintenance", entityId: id, metadata: { from: current.status, to: input.status } }, tx);
      if (input.status === "DONE") await this.outbox.emit(tx, "maintenance.done.v1", { requestId: id, unitId: row.unitId, costMinor: row.costMinor });
      return row;
    });
  }

  async comment(user: AuthUser, id: string, text: string) {
    await this.get(id);
    const [row] = await this.db.insert(maintenanceComments).values({ requestId: id, userId: user.id, text }).returning();
    return row;
  }

  async addPhoto(user: AuthUser, id: string, file: UploadedFile | undefined) {
    const kind = validateUpload(file, ["jpeg", "png", "webp"], MAINTENANCE_PHOTO_MAX_BYTES);
    await this.get(id);
    const key = this.storage.newKey(`maintenance/${id}`, EXTENSION[kind]);
    await this.storage.put(key, file!.buffer, MIME[kind]);
    const [row] = await this.db.insert(maintenancePhotos).values({ requestId: id, storageKey: key, contentType: MIME[kind] }).returning();
    await this.audit.log({ userId: user.id, action: "maintenance.photo_added", entityType: "maintenance", entityId: id });
    return row;
  }

  async photoFile(photoId: string) {
    const [row] = await this.db.select().from(maintenancePhotos).where(eq(maintenancePhotos.id, photoId));
    if (!row) throw notFound("PHOTO_NOT_FOUND");
    return { row, body: await this.storage.get(row.storageKey) };
  }

  /** Cost of finished requests for a unit, by the date they were closed (inclusive Addis days). */
  async costForUnit(unitId: string, from: string, to: string) {
    const [row] = await this.db
      .select({ total: sql<string | null>`sum(${maintenanceRequests.costMinor})`, n: sql<string>`count(*)` })
      .from(maintenanceRequests)
      .where(
        and(
          eq(maintenanceRequests.unitId, unitId),
          eq(maintenanceRequests.status, "DONE"),
          gte(maintenanceRequests.closedAt, addisStartOfDay(from)),
          lt(maintenanceRequests.closedAt, addisStartOfDay(addDays(to, 1))),
        ),
      );
    return { unitId, from, to, costMinor: Number(row.total ?? 0), requests: Number(row.n) };
  }
}
