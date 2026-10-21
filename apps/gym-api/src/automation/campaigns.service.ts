import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { addisDateString, type campaignSchema } from "@platform/shared";
import { AuditService, CLOCK, DB, MessageService, notFound, type AuthUser, type Clock, type Database } from "@platform/nest-common";
import { campaigns } from "../db/schema";

/** At most this many marketing messages per member in any 30 days. */
export const MARKETING_CAP = 4;
export const MARKETING_WINDOW_DAYS = 30;

@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly messages: MessageService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100);
  }

  async get(id: string) {
    const [row] = await this.db.select().from(campaigns).where(eq(campaigns.id, id));
    if (!row) throw notFound("CAMPAIGN_NOT_FOUND", "Announcement not found");
    return row;
  }

  /** Members matching the filter: ACTIVE = a membership covers today; EXPIRED = only past memberships; ANY = all. */
  async recipients(filter: z.infer<typeof campaignSchema>["filter"]): Promise<string[]> {
    const today = addisDateString(this.clock.now());
    const plan = filter.planId ? sql`AND ms.plan_id = ${filter.planId}` : sql``;
    let condition;
    if (filter.membershipStatus === "ACTIVE") {
      condition = sql`EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status <> 'CANCELLED' AND ms.start_date <= ${today} AND ms.end_date >= ${today} ${plan})`;
    } else if (filter.membershipStatus === "EXPIRED") {
      condition = sql`EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id AND ms.status <> 'CANCELLED' AND ms.end_date < ${today} ${plan})
        AND NOT EXISTS (SELECT 1 FROM memberships cur WHERE cur.member_id = m.id AND cur.status <> 'CANCELLED' AND cur.end_date >= ${today})`;
    } else {
      condition = filter.planId ? sql`EXISTS (SELECT 1 FROM memberships ms WHERE ms.member_id = m.id ${plan})` : sql`TRUE`;
    }
    const result = await this.db.execute(sql`SELECT m.id FROM members m WHERE m.anonymized_at IS NULL AND m.status = 'ACTIVE' AND ${condition} ORDER BY m.name`);
    return (result.rows as Array<{ id: string }>).map((r) => r.id);
  }

  private async marketingCount(memberId: string): Promise<number> {
    const since = new Date(this.clock.now().getTime() - MARKETING_WINDOW_DAYS * 86_400_000);
    const result = await this.db.execute(sql`
      SELECT count(*)::int AS n FROM message_log
      WHERE subject_id = ${memberId} AND campaign_id IS NOT NULL
        AND status IN ('SENT', 'DEFERRED_QUIET_HOURS')
        AND coalesce(sent_at, send_after) >= ${since.toISOString()}`);
    return Number((result.rows[0] as { n: number }).n);
  }

  /**
   * Sends a one-off announcement. Consent is checked for every recipient by MessageService; members who already
   * had 4 marketing messages in 30 days are skipped (counted as capped). Counts are stored on the campaign.
   */
  async send(user: AuthUser, input: z.infer<typeof campaignSchema>) {
    const [campaign] = await this.db
      .insert(campaigns)
      .values({ title: input.title, messageAm: input.messageAm, messageEn: input.messageEn, filter: input.filter, createdById: user.id })
      .returning();
    const ids = await this.recipients(input.filter);
    const counts = { sent: 0, blocked: 0, failed: 0, deferred: 0, capped: 0 };
    for (const memberId of ids) {
      if ((await this.marketingCount(memberId)) >= MARKETING_CAP) {
        counts.capped += 1;
        continue;
      }
      const result = await this.messages.send({
        recipient: { kind: "subject", id: memberId },
        templateKey: "member.announcement",
        data: { title: input.title, messageAm: input.messageAm, messageEn: input.messageEn },
        campaignId: campaign.id,
      });
      if (result.status === "SENT") counts.sent += 1;
      else if (result.status === "DEFERRED_QUIET_HOURS") counts.deferred += 1;
      else if (result.status === "FAILED") counts.failed += 1;
      else counts.blocked += 1;
    }
    const [row] = await this.db
      .update(campaigns)
      .set({
        recipientCount: ids.length,
        sentCount: counts.sent,
        blockedCount: counts.blocked,
        failedCount: counts.failed,
        deferredCount: counts.deferred,
        cappedCount: counts.capped,
      })
      .where(eq(campaigns.id, campaign.id))
      .returning();
    await this.audit.log({ userId: user.id, action: "campaign.sent", entityType: "campaign", entityId: campaign.id, metadata: { ...counts, recipients: ids.length } });
    return row;
  }
}
