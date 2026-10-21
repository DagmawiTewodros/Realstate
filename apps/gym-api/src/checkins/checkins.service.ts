import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { z } from "zod";
import { addDays, addisDateString, addisStartOfDay, type DeniedReason, type checkinSchema } from "@platform/shared";
import { AppError, AuditService, CLOCK, DB, forbidden, type AuthUser, type Clock, type Database, type Executor } from "@platform/nest-common";
import { checkins, members } from "../db/schema";
import { isManager } from "../access";
import { MembershipsService } from "../memberships/memberships.service";
import { QrService } from "../members/qr.service";

export const DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

export interface CheckinResponse {
  result: "ALLOWED" | "DENIED" | "DUPLICATE";
  deniedReason: DeniedReason | null;
  override: boolean;
  member: { id: string; name: string; hasPhoto: boolean } | null;
  membership: { planName: string; endDate: string; daysLeft: number | null } | null;
  checkinId: string;
}

@Injectable()
export class CheckinsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly memberships: MembershipsService,
    private readonly qr: QrService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Checks a member in by QR token or member id.
   * - A tampered, unknown or old-version code is DENIED with UNKNOWN_CODE.
   * - A second scan within 5 minutes after an allowed visit is DUPLICATE and is not a visit.
   * - Only a manager can let a denied member in, with a reason (logged and flagged).
   */
  async checkIn(user: AuthUser, input: z.infer<typeof checkinSchema>): Promise<CheckinResponse> {
    const wantsOverride = input.overrideReason !== undefined && input.overrideReason !== null;
    if (wantsOverride && !isManager(user)) throw forbidden("OVERRIDE_MANAGER_ONLY", "Only a manager can override a denied check-in");
    const overrideReason = input.overrideReason?.trim() || null;
    if (wantsOverride && (!overrideReason || overrideReason.length < 3)) {
      throw new AppError(400, "REASON_REQUIRED", "Give a reason for letting this member in");
    }
    const method = input.token ? "QR" : "MANUAL";
    let memberId: string | null = null;
    if (input.token) {
      const parsed = this.qr.verify(input.token);
      if (parsed) {
        const [m] = await this.db.select({ id: members.id, qrVersion: members.qrVersion }).from(members).where(eq(members.id, parsed.memberId));
        if (m && m.qrVersion === parsed.version) memberId = m.id;
      }
    } else {
      const [m] = await this.db.select({ id: members.id }).from(members).where(eq(members.id, input.memberId!));
      memberId = m?.id ?? null;
    }
    const now = this.clock.now();
    if (!memberId) {
      const [row] = await this.db
        .insert(checkins)
        .values({ memberId: null, at: now, method, result: "DENIED", deniedReason: "UNKNOWN_CODE", recordedById: user.id })
        .returning();
      return { result: "DENIED", deniedReason: "UNKNOWN_CODE", override: false, member: null, membership: null, checkinId: row.id };
    }

    return this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      // Locking the member row serializes two scans of the same member at the same moment.
      const [member] = await tx.select().from(members).where(eq(members.id, memberId!)).for("update").limit(1);
      const recent = await tx
        .select({ id: checkins.id })
        .from(checkins)
        .where(and(eq(checkins.memberId, member.id), eq(checkins.result, "ALLOWED"), gte(checkins.at, new Date(now.getTime() - DUPLICATE_WINDOW_MS))))
        .limit(1);
      const state = await this.memberships.currentState(member.id, tx, addisDateString(now));
      const memberInfo = { id: member.id, name: member.name, hasPhoto: Boolean(member.photoKey) };
      const membershipInfo = state.membership ? { planName: state.membership.planName, endDate: state.membership.endDate, daysLeft: state.daysLeft } : null;
      if (recent[0]) {
        const [row] = await tx.insert(checkins).values({ memberId: member.id, at: now, method, result: "DUPLICATE", recordedById: user.id }).returning();
        return { result: "DUPLICATE", deniedReason: null, override: false, member: memberInfo, membership: membershipInfo, checkinId: row.id };
      }
      let deniedReason: DeniedReason | null = null;
      if (member.status !== "ACTIVE" || member.anonymizedAt) deniedReason = "INACTIVE_MEMBER";
      else if (state.status === "FROZEN") deniedReason = "FROZEN";
      else if (state.status === "EXPIRED") deniedReason = "EXPIRED";
      else if (state.status === "CANCELLED") deniedReason = "CANCELLED";
      else if (state.status === "NONE") deniedReason = "NO_MEMBERSHIP";
      const override = Boolean(deniedReason && overrideReason);
      const result = !deniedReason || override ? "ALLOWED" : "DENIED";
      const [row] = await tx
        .insert(checkins)
        .values({
          memberId: member.id,
          at: now,
          method,
          result,
          deniedReason,
          override,
          overrideReason: override ? overrideReason : null,
          recordedById: user.id,
        })
        .returning();
      if (override) {
        await this.audit.log({ userId: user.id, action: "checkin.override", entityType: "member", entityId: member.id, metadata: { deniedReason, reason: overrideReason } }, tx);
      }
      return { result, deniedReason, override, member: memberInfo, membership: membershipInfo, checkinId: row.id };
    });
  }

  /** Allowed visits today (Addis Ababa day), newest first. */
  async today() {
    const today = addisDateString(this.clock.now());
    const from = addisStartOfDay(today);
    const to = addisStartOfDay(addDays(today, 1));
    return this.db
      .select({ id: checkins.id, at: checkins.at, method: checkins.method, override: checkins.override, member: { id: members.id, name: members.name } })
      .from(checkins)
      .innerJoin(members, eq(members.id, checkins.memberId))
      .where(and(eq(checkins.result, "ALLOWED"), gte(checkins.at, from), lt(checkins.at, to)))
      .orderBy(desc(checkins.at));
  }

  async forMember(memberId: string, limit = 100) {
    return this.db.select().from(checkins).where(eq(checkins.memberId, memberId)).orderBy(desc(checkins.at)).limit(limit);
  }
}
