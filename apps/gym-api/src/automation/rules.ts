import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { formatDate, formatDateTime, type Locale } from "@platform/shared";
import { DB, MessageService, ReminderLogService, type AutomationRules, type Database, type OutboxEvent } from "@platform/nest-common";
import { classSessions, members } from "../db/schema";

/**
 * Gym message rules (AUTOMATION_MODE=direct). In n8n mode, n8n workflows call POST /internal/messages/send instead.
 * Every send first claims "msg:{eventId}:{memberId}", so a retried event never sends twice.
 * Consent and quiet hours are enforced by MessageService.
 */
@Injectable()
export class GymAutomationRules implements AutomationRules {
  private readonly logger = new Logger("GymAutomation");

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly messages: MessageService,
    private readonly reminders: ReminderLogService,
  ) {}

  async handleMessaging(event: OutboxEvent): Promise<void> {
    const p = event.payload as Record<string, unknown>;
    switch (event.name) {
      case "membership.expiring.v1":
        return this.toMember(event, String(p.memberId), "member.renewal_reminder", (locale) => ({
          plan: String(p.planName),
          endDate: formatDate(String(p.endDate), locale),
        }));
      case "membership.expired.v1":
        return this.toMember(event, String(p.memberId), "member.expired", (locale) => ({
          plan: String(p.planName),
          endDate: formatDate(String(p.endDate), locale),
        }));
      case "member.inactive.v1":
        return this.toMember(event, String(p.memberId), "member.we_miss_you", () => ({ days: Number(p.days) }));
      case "member.birthday.v1":
        return this.toMember(event, String(p.memberId), "member.birthday", () => ({}));
      case "session.cancelled.v1": {
        const ids = (p.memberIds as string[] | undefined) ?? [];
        if (!ids.length) return;
        const [session] = await this.db.select().from(classSessions).where(eq(classSessions.id, String(p.sessionId)));
        if (!session) return;
        for (const memberId of ids) {
          await this.toMember(event, memberId, "member.session_cancelled", (locale) => ({
            className: session.name,
            when: formatDateTime(session.startsAt, locale),
          }));
        }
        return;
      }
      default:
        return;
    }
  }

  private async toMember(event: OutboxEvent, memberId: string, templateKey: string, data: (locale: Locale) => Record<string, unknown>) {
    const [m] = await this.db.select({ locale: members.locale }).from(members).where(inArray(members.id, [memberId]));
    if (!m) return;
    if (!(await this.reminders.claim(`msg:${event.id}:${memberId}`))) return;
    const result = await this.messages.send({
      recipient: { kind: "subject", id: memberId },
      templateKey,
      data: data(m.locale === "en" ? "en" : "am"),
    });
    if (result.status === "FAILED") this.logger.warn(`Message ${templateKey} to member ${memberId} failed`);
  }
}
