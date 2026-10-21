import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import {
  addisDateString,
  type classTemplateSchema,
  type classTemplateUpdateSchema,
  type personalSessionSchema,
  type trainerCreateSchema,
} from "@platform/shared";
import {
  AppError,
  AuditService,
  CLOCK,
  DB,
  OutboxService,
  conflict,
  forbidden,
  notFound,
  type AuthUser,
  type Clock,
  type Database,
  type Executor,
} from "@platform/nest-common";
import { bookings, classSessions, classTemplates, members, personalSessions, trainerAssignments, trainers, users } from "../db/schema";
import { ROLE, isManager } from "../access";
import { MembershipsService } from "../memberships/memberships.service";
import { generateClassSessions } from "./generate";

/** Members may cancel up to this many hours before a class starts. */
export const CANCELLATION_CUTOFF_HOURS = 2;
export { SESSION_HORIZON_DAYS } from "./generate";

@Injectable()
export class ClassesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly memberships: MembershipsService,
  ) {}

  // ---------- Trainers and assignments ----------
  async listTrainers() {
    return this.db
      .select({ trainer: trainers, user: { id: users.id, name: users.name, isActive: users.isActive } })
      .from(trainers)
      .innerJoin(users, eq(users.id, trainers.userId))
      .orderBy(asc(users.name));
  }

  async createTrainer(user: AuthUser, input: z.infer<typeof trainerCreateSchema>) {
    const [u] = await this.db.select().from(users).where(eq(users.id, input.userId));
    if (!u || u.role !== ROLE.TRAINER || !u.isActive) throw new AppError(400, "NOT_A_TRAINER", "Choose an active user with the TRAINER role");
    const [existing] = await this.db.select({ id: trainers.id }).from(trainers).where(eq(trainers.userId, input.userId));
    if (existing) throw conflict("TRAINER_EXISTS", "This user already has a trainer profile");
    const [row] = await this.db.insert(trainers).values({ userId: input.userId, bio: input.bio ?? null, phone: input.phone ?? null }).returning();
    await this.audit.log({ userId: user.id, action: "trainer.created", entityType: "trainer", entityId: row.id });
    return row;
  }

  async trainerForUser(userId: string, tx?: Executor) {
    const [t] = await (tx ?? this.db).select().from(trainers).where(eq(trainers.userId, userId)).limit(1);
    return t ?? null;
  }

  async assign(user: AuthUser, trainerId: string, memberId: string) {
    const [t] = await this.db.select({ id: trainers.id }).from(trainers).where(eq(trainers.id, trainerId));
    if (!t) throw notFound("TRAINER_NOT_FOUND", "Trainer not found");
    const [m] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, memberId));
    if (!m) throw notFound("MEMBER_NOT_FOUND", "Member not found");
    const [row] = await this.db.insert(trainerAssignments).values({ trainerId, memberId }).onConflictDoNothing().returning();
    await this.audit.log({ userId: user.id, action: "trainer.assigned", entityType: "member", entityId: memberId, metadata: { trainerId } });
    return row ?? null;
  }

  async unassign(user: AuthUser, trainerId: string, memberId: string) {
    await this.db.delete(trainerAssignments).where(and(eq(trainerAssignments.trainerId, trainerId), eq(trainerAssignments.memberId, memberId)));
    await this.audit.log({ userId: user.id, action: "trainer.unassigned", entityType: "member", entityId: memberId, metadata: { trainerId } });
  }

  /** Trainers a member is assigned to, for the member page. */
  async trainersForMember(memberId: string) {
    return this.db
      .select({ trainerId: trainers.id, name: users.name })
      .from(trainerAssignments)
      .innerJoin(trainers, eq(trainers.id, trainerAssignments.trainerId))
      .innerJoin(users, eq(users.id, trainers.userId))
      .where(eq(trainerAssignments.memberId, memberId))
      .orderBy(asc(users.name));
  }

  async assignedMembers(userId: string) {
    return this.db
      .select({ id: members.id, name: members.name, phone: members.phone })
      .from(trainerAssignments)
      .innerJoin(trainers, eq(trainers.id, trainerAssignments.trainerId))
      .innerJoin(members, eq(members.id, trainerAssignments.memberId))
      .where(eq(trainers.userId, userId))
      .orderBy(asc(members.name));
  }

  // ---------- Templates and sessions ----------
  async listTemplates() {
    return this.db.select().from(classTemplates).orderBy(asc(classTemplates.weekday), asc(classTemplates.startTime));
  }

  async createTemplate(user: AuthUser, input: z.infer<typeof classTemplateSchema>) {
    await this.assertTrainer(input.trainerId);
    const [row] = await this.db.insert(classTemplates).values(input).returning();
    await this.audit.log({ userId: user.id, action: "class_template.created", entityType: "class_template", entityId: row.id });
    await this.generateSessions();
    return row;
  }

  async updateTemplate(user: AuthUser, id: string, input: z.infer<typeof classTemplateUpdateSchema>) {
    if (input.trainerId) await this.assertTrainer(input.trainerId);
    const [row] = await this.db
      .update(classTemplates)
      .set({ ...input, updatedAt: this.clock.now() })
      .where(eq(classTemplates.id, id))
      .returning();
    if (!row) throw notFound("TEMPLATE_NOT_FOUND", "Class not found");
    await this.audit.log({ userId: user.id, action: "class_template.updated", entityType: "class_template", entityId: id });
    return row;
  }

  private async assertTrainer(trainerId: string) {
    const [t] = await this.db.select({ id: trainers.id }).from(trainers).where(eq(trainers.id, trainerId));
    if (!t) throw new AppError(400, "TRAINER_NOT_FOUND", "Choose an existing trainer");
  }

  /**
   * Creates sessions for active templates for the next 28 days (Addis Ababa time).
   * Running it again creates no duplicates (unique on template and start time).
   */
  async generateSessions(): Promise<number> {
    return generateClassSessions(this.db, this.clock.now());
  }

  async listSessions(from: Date, to: Date, trainerUserId?: string) {
    const conditions = [gte(classSessions.startsAt, from), lt(classSessions.startsAt, to)];
    if (trainerUserId) {
      const trainer = await this.trainerForUser(trainerUserId);
      if (!trainer) return [];
      conditions.push(eq(classSessions.trainerId, trainer.id));
    }
    const rows = await this.db
      .select({
        session: classSessions,
        trainerName: users.name,
        booked: sql<number>`(SELECT count(*)::int FROM bookings b WHERE b.session_id = ${classSessions.id} AND b.status IN ('BOOKED','ATTENDED'))`,
      })
      .from(classSessions)
      .innerJoin(trainers, eq(trainers.id, classSessions.trainerId))
      .innerJoin(users, eq(users.id, trainers.userId))
      .where(and(...conditions))
      .orderBy(asc(classSessions.startsAt));
    return rows.map((r) => ({ ...r.session, trainerName: r.trainerName, booked: Number(r.booked), spotsLeft: Math.max(0, r.session.capacity - Number(r.booked)) }));
  }

  async cancelSession(user: AuthUser, sessionId: string, reason: string) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [s] = await tx.select().from(classSessions).where(eq(classSessions.id, sessionId)).for("update").limit(1);
      if (!s) throw notFound("SESSION_NOT_FOUND", "Class not found");
      if (s.status === "CANCELLED") throw conflict("ALREADY_CANCELLED", "This class is already cancelled");
      const [updated] = await tx.update(classSessions).set({ status: "CANCELLED", cancelReason: reason }).where(eq(classSessions.id, sessionId)).returning();
      const affected = await tx
        .update(bookings)
        .set({ status: "CANCELLED", cancelledAt: this.clock.now(), cancelReason: "Class cancelled" })
        .where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, "BOOKED")))
        .returning({ memberId: bookings.memberId });
      await this.audit.log({ userId: user.id, action: "session.cancelled", entityType: "class_session", entityId: sessionId, metadata: { reason } }, tx);
      await this.outbox.emit(tx, "session.cancelled.v1", { sessionId, memberIds: affected.map((a) => a.memberId) });
      return updated;
    });
  }

  // ---------- Bookings ----------
  /**
   * Books a class. Only members with an ACTIVE membership on the class date can book.
   * The session row is locked while counting, so concurrent requests never go over capacity.
   */
  async book(user: AuthUser, sessionId: string, memberIdInput: string | undefined) {
    const memberId = user.role === ROLE.MEMBER ? user.linkedEntityId : memberIdInput;
    if (!memberId) throw new AppError(400, "MEMBER_REQUIRED", "Choose a member");
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [session] = await tx.select().from(classSessions).where(eq(classSessions.id, sessionId)).for("update").limit(1);
      if (!session) throw notFound("SESSION_NOT_FOUND", "Class not found");
      if (session.status !== "SCHEDULED") throw conflict("SESSION_CANCELLED", "This class is cancelled");
      if (session.startsAt.getTime() <= this.clock.now().getTime()) throw conflict("SESSION_STARTED", "This class has already started");
      const [member] = await tx.select({ id: members.id, status: members.status }).from(members).where(eq(members.id, memberId)).limit(1);
      if (!member) throw notFound("MEMBER_NOT_FOUND", "Member not found");
      const state = await this.memberships.currentState(memberId, tx, addisDateString(session.startsAt));
      if (member.status !== "ACTIVE" || state.status !== "ACTIVE") {
        throw conflict("NO_ACTIVE_MEMBERSHIP", "An active membership on the class date is needed to book");
      }
      const [{ n }] = await tx
        .select({ n: count() })
        .from(bookings)
        .where(and(eq(bookings.sessionId, sessionId), inArray(bookings.status, ["BOOKED", "ATTENDED"])));
      const [existing] = await tx.select().from(bookings).where(and(eq(bookings.sessionId, sessionId), eq(bookings.memberId, memberId))).limit(1);
      if (existing && existing.status !== "CANCELLED") throw conflict("ALREADY_BOOKED", "This member is already booked for this class");
      if (Number(n) >= session.capacity) throw conflict("SESSION_FULL", "This class is full");
      const now = this.clock.now();
      const [booking] = existing
        ? await tx
            .update(bookings)
            .set({ status: "BOOKED", bookedAt: now, cancelledAt: null, cancelReason: null })
            .where(eq(bookings.id, existing.id))
            .returning()
        : await tx.insert(bookings).values({ sessionId, memberId, status: "BOOKED", bookedAt: now }).returning();
      await this.outbox.emit(tx, "booking.created.v1", { bookingId: booking.id, sessionId, memberId });
      return booking;
    });
  }

  /**
   * Cancels a booking. Members and front desk can cancel until 2 hours before the class;
   * after that only a manager can, with a reason.
   */
  async cancelBooking(user: AuthUser, bookingId: string, reason?: string | null) {
    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for("update").limit(1);
      if (!b || (user.role === ROLE.MEMBER && b.memberId !== user.linkedEntityId)) throw notFound("BOOKING_NOT_FOUND", "Booking not found");
      if (b.status !== "BOOKED") throw conflict("NOT_BOOKED", "This booking cannot be cancelled");
      const [s] = await tx.select().from(classSessions).where(eq(classSessions.id, b.sessionId));
      const cutoff = s.startsAt.getTime() - CANCELLATION_CUTOFF_HOURS * 3600_000;
      const late = this.clock.now().getTime() > cutoff;
      if (late) {
        if (!isManager(user)) throw conflict("CANCELLATION_CUTOFF", `Bookings can be cancelled up to ${CANCELLATION_CUTOFF_HOURS} hours before the class`);
        if (!reason || reason.trim().length < 3) throw new AppError(400, "REASON_REQUIRED", "Give a reason for a late cancellation");
      }
      const [updated] = await tx
        .update(bookings)
        .set({ status: "CANCELLED", cancelledAt: this.clock.now(), cancelReason: reason ?? null })
        .where(eq(bookings.id, bookingId))
        .returning();
      if (late) await this.audit.log({ userId: user.id, action: "booking.late_cancel", entityType: "booking", entityId: bookingId, metadata: { reason } }, tx);
      await this.outbox.emit(tx, "booking.cancelled.v1", { bookingId, sessionId: b.sessionId, memberId: b.memberId });
      return updated;
    });
  }

  private async assertSessionAccess(user: AuthUser, sessionId: string, tx?: Executor) {
    const [s] = await (tx ?? this.db).select().from(classSessions).where(eq(classSessions.id, sessionId)).limit(1);
    if (!s) throw notFound("SESSION_NOT_FOUND", "Class not found");
    if (user.role === ROLE.TRAINER) {
      const t = await this.trainerForUser(user.id, tx);
      if (!t || t.id !== s.trainerId) throw notFound("SESSION_NOT_FOUND", "Class not found");
    }
    return s;
  }

  async roster(user: AuthUser, sessionId: string) {
    const session = await this.assertSessionAccess(user, sessionId);
    const rows = await this.db
      .select({ booking: bookings, member: { id: members.id, name: members.name, phone: members.phone } })
      .from(bookings)
      .innerJoin(members, eq(members.id, bookings.memberId))
      .where(eq(bookings.sessionId, sessionId))
      .orderBy(asc(members.name));
    return { session, bookings: rows.map((r) => ({ ...r.booking, member: r.member })) };
  }

  async markAttendance(user: AuthUser, sessionId: string, bookingIds: string[]) {
    await this.assertSessionAccess(user, sessionId);
    if (!bookingIds.length) return { updated: 0 };
    const rows = await this.db
      .update(bookings)
      .set({ status: "ATTENDED" })
      .where(and(eq(bookings.sessionId, sessionId), inArray(bookings.id, bookingIds), inArray(bookings.status, ["BOOKED", "NO_SHOW"])))
      .returning({ id: bookings.id });
    return { updated: rows.length };
  }

  /** Daily job: bookings still BOOKED after the class ended become NO_SHOW. Idempotent. */
  async markNoShows(): Promise<number> {
    const result = await this.db.execute(sql`
      UPDATE bookings b SET status = 'NO_SHOW'
      FROM class_sessions s
      WHERE b.session_id = s.id AND b.status = 'BOOKED' AND s.status = 'SCHEDULED'
        AND s.starts_at + make_interval(mins => s.duration_minutes) < ${this.clock.now().toISOString()}`);
    return result.rowCount ?? 0;
  }

  // ---------- Personal training ----------
  async createPersonal(user: AuthUser, input: z.infer<typeof personalSessionSchema>) {
    if (user.role === ROLE.TRAINER) {
      const t = await this.trainerForUser(user.id);
      if (!t || t.id !== input.trainerId) throw forbidden("OWN_SESSIONS_ONLY", "Trainers can book only their own personal sessions");
    }
    await this.assertTrainer(input.trainerId);
    const [m] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, input.memberId));
    if (!m) throw notFound("MEMBER_NOT_FOUND", "Member not found");
    const [row] = await this.db
      .insert(personalSessions)
      .values({ ...input, notes: input.notes ?? null, createdById: user.id })
      .returning();
    return row;
  }

  async listPersonal(user: AuthUser, from: Date, to: Date) {
    const conditions = [gte(personalSessions.startsAt, from), lt(personalSessions.startsAt, to)];
    if (user.role === ROLE.TRAINER) {
      const t = await this.trainerForUser(user.id);
      if (!t) return [];
      conditions.push(eq(personalSessions.trainerId, t.id));
    }
    return this.db
      .select({ session: personalSessions, member: { id: members.id, name: members.name } })
      .from(personalSessions)
      .innerJoin(members, eq(members.id, personalSessions.memberId))
      .where(and(...conditions))
      .orderBy(asc(personalSessions.startsAt));
  }

  async setPersonalStatus(user: AuthUser, id: string, status: "BOOKED" | "DONE" | "CANCELLED" | "NO_SHOW") {
    const [p] = await this.db.select().from(personalSessions).where(eq(personalSessions.id, id));
    if (!p) throw notFound("SESSION_NOT_FOUND", "Session not found");
    if (user.role === ROLE.TRAINER) {
      const t = await this.trainerForUser(user.id);
      if (!t || t.id !== p.trainerId) throw notFound("SESSION_NOT_FOUND", "Session not found");
    }
    const [row] = await this.db.update(personalSessions).set({ status }).where(eq(personalSessions.id, id)).returning();
    return row;
  }
}
