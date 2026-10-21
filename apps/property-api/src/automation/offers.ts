import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { formatMoney, reminderSettingsSchema, type Locale } from "@platform/shared";
import { APP_CONFIG, CLOCK, ConsentService, DB, MessageService, SettingsService, type BaseConfig, type Clock, type Database, type OutboxEvent } from "@platform/nest-common";
import { offerNotifications, projects, savedSearches, units, customers } from "../db/schema";
import { OFFER_EVENT_LABEL } from "./templates";

/** At most this many offer messages per customer in any 7 days; extra matches wait for one digest. */
export const OFFER_CAP = 3;
export const OFFER_WINDOW_MS = 7 * 86_400_000;

/**
 * Matches saved searches when a unit is published, its price drops, or it becomes available again.
 * Each saved search is told about a unit at most once per event type (unique key), and each customer
 * gets one message per unit even when several of their searches match.
 */
@Injectable()
export class OfferMatcher {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly messages: MessageService,
    private readonly consent: ConsentService,
    private readonly settings: SettingsService,
  ) {}

  private web(path: string) {
    return `${this.config.PUBLIC_WEB_URL.replace(/\/$/, "")}${path}`;
  }

  private async enabled(): Promise<boolean> {
    const s = await this.settings.get("reminders", reminderSettingsSchema);
    return s.enabled.offers !== false;
  }

  async handle(event: OutboxEvent): Promise<void> {
    if (!(await this.enabled())) return;
    const unitId = String(event.payload.unitId ?? "");
    const [unit] = await this.db
      .select({ unit: units, project: { name: projects.name, area: projects.area } })
      .from(units)
      .innerJoin(projects, eq(projects.id, units.projectId))
      .where(and(eq(units.id, unitId), eq(units.isPublished, true), eq(units.status, "AVAILABLE")));
    if (!unit) return;
    const u = unit.unit;
    const matches = await this.db
      .select({ id: savedSearches.id, customerId: savedSearches.customerId })
      .from(savedSearches)
      .innerJoin(customers, eq(customers.id, savedSearches.customerId))
      .where(
        and(
          eq(savedSearches.isActive, true),
          isNull(customers.anonymizedAt),
          or(isNull(savedSearches.purpose), eq(savedSearches.purpose, u.purpose)),
          or(isNull(savedSearches.type), eq(savedSearches.type, u.type)),
          or(isNull(savedSearches.area), sql`${unit.project.area} ILIKE '%' || ${savedSearches.area} || '%'`),
          or(isNull(savedSearches.minPriceMinor), sql`${savedSearches.minPriceMinor} <= ${u.priceMinor}`),
          or(isNull(savedSearches.maxPriceMinor), sql`${savedSearches.maxPriceMinor} >= ${u.priceMinor}`),
          or(isNull(savedSearches.bedrooms), sql`${savedSearches.bedrooms} <= coalesce(${u.bedrooms}, 0)`),
        ),
      )
      .orderBy(asc(savedSearches.createdAt));

    const byCustomer = new Map<string, string[]>();
    for (const m of matches) {
      const inserted = await this.db
        .insert(offerNotifications)
        .values({ savedSearchId: m.id, customerId: m.customerId, unitId, eventType: event.name, status: "PENDING" })
        .onConflictDoNothing()
        .returning({ id: offerNotifications.id });
      if (!inserted.length) continue;
      byCustomer.set(m.customerId, [...(byCustomer.get(m.customerId) ?? []), inserted[0].id]);
    }

    for (const [customerId, notificationIds] of byCustomer) {
      const now = this.clock.now();
      if ((await this.sentInWindow(customerId)) >= OFFER_CAP) {
        await this.db.update(offerNotifications).set({ status: "QUEUED" }).where(inArray(offerNotifications.id, notificationIds));
        continue;
      }
      const [first] = await this.db.select().from(offerNotifications).where(eq(offerNotifications.id, notificationIds[0]));
      const locale = await this.localeOf(customerId);
      const result = await this.messages.send({
        recipient: { kind: "subject", id: customerId },
        templateKey: "customer.new_offer",
        data: {
          event: OFFER_EVENT_LABEL[event.name]?.[locale] ?? "",
          unit: `${unit.project.name} ${u.code}`,
          area: unit.project.area,
          price: formatMoney(u.priceMinor, locale),
          link: this.web(`/listings/${unitId}`),
          removeLink: this.web(`/saved-search/remove/${this.consent.signedToken("saved-search", first.savedSearchId)}`),
        },
      });
      const sent = result.status === "SENT" || result.status === "DEFERRED_QUIET_HOURS";
      await this.db
        .update(offerNotifications)
        .set({ status: sent ? "SENT" : "BLOCKED", messageId: result.messageId, sentAt: sent ? now : null })
        .where(inArray(offerNotifications.id, notificationIds));
    }
  }

  /** Offer messages (single offers and digests) sent to a customer in the last 7 days. */
  async sentInWindow(customerId: string): Promise<number> {
    const since = new Date(this.clock.now().getTime() - OFFER_WINDOW_MS);
    const [row] = await this.db
      .select({ n: sql<string>`count(DISTINCT ${offerNotifications.messageId})` })
      .from(offerNotifications)
      .where(and(eq(offerNotifications.customerId, customerId), inArray(offerNotifications.status, ["SENT", "DIGESTED"]), gte(offerNotifications.sentAt, since)));
    return Number(row.n);
  }

  /** Sends one digest per customer for matches held back by the cap, as soon as the cap allows. */
  async flushDigests(): Promise<number> {
    const queued = await this.db
      .select({
        id: offerNotifications.id,
        customerId: offerNotifications.customerId,
        unitId: offerNotifications.unitId,
        code: units.code,
        project: projects.name,
        priceMinor: units.priceMinor,
        isPublished: units.isPublished,
        status: units.status,
      })
      .from(offerNotifications)
      .innerJoin(units, eq(units.id, offerNotifications.unitId))
      .innerJoin(projects, eq(projects.id, units.projectId))
      .where(eq(offerNotifications.status, "QUEUED"))
      .orderBy(asc(offerNotifications.createdAt));
    const byCustomer = new Map<string, typeof queued>();
    for (const q of queued) byCustomer.set(q.customerId, [...(byCustomer.get(q.customerId) ?? []), q]);
    let digests = 0;
    for (const [customerId, items] of byCustomer) {
      if ((await this.sentInWindow(customerId)) >= OFFER_CAP) continue;
      const stillAvailable = items.filter((i) => i.isPublished && i.status === "AVAILABLE");
      const ids = items.map((i) => i.id);
      if (!stillAvailable.length) {
        await this.db.update(offerNotifications).set({ status: "BLOCKED" }).where(inArray(offerNotifications.id, ids));
        continue;
      }
      const locale = await this.localeOf(customerId);
      const seen = new Set<string>();
      const lines = stillAvailable
        .filter((i) => (seen.has(i.unitId) ? false : (seen.add(i.unitId), true)))
        .map((i) => `- ${i.project} ${i.code}, ${formatMoney(i.priceMinor, locale)}: ${this.web(`/listings/${i.unitId}`)}`);
      const result = await this.messages.send({
        recipient: { kind: "subject", id: customerId },
        templateKey: "customer.offer_digest",
        data: { count: lines.length, list: lines.join("\n") },
      });
      const sent = result.status === "SENT" || result.status === "DEFERRED_QUIET_HOURS";
      await this.db
        .update(offerNotifications)
        .set({ status: sent ? "DIGESTED" : "BLOCKED", messageId: result.messageId, sentAt: sent ? this.clock.now() : null })
        .where(inArray(offerNotifications.id, ids));
      if (sent) digests += 1;
    }
    return digests;
  }

  private async localeOf(customerId: string): Promise<Locale> {
    const [c] = await this.db.select({ locale: customers.locale }).from(customers).where(eq(customers.id, customerId));
    return c?.locale === "en" ? "en" : "am";
  }
}
