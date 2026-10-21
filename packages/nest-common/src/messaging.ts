import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { and, eq, lte } from "drizzle-orm";
import { ENABLED_CHANNELS, isQuietHours, nextAllowedSendTime, type Channel, type MessageStatus } from "@platform/shared";
import { APP_CONFIG, CLOCK, CONTACT_RESOLVER, DB, MESSAGE_TEMPLATES, MESSAGE_TRANSPORTS } from "./tokens";
import type { BaseConfig } from "./config";
import type { Clock } from "./clock";
import type { Database } from "./db";
import { messageLog, users } from "./schema";
import { ConsentService } from "./consent";
import { OPT_OUT_LINE, renderTemplate, type TemplateSet } from "./templates";
import type { Contact, MessageTransport } from "./transports";

/** Looks up a customer (System A) or member (System B) by id. Provided by each app. */
export interface ContactResolver {
  resolve(subjectId: string): Promise<Contact | null>;
}

export type Recipient = { kind: "subject"; id: string } | { kind: "user"; id: string };

export interface SendInput {
  recipient: Recipient;
  templateKey: string;
  data?: Record<string, unknown>;
  /** Leave empty to pick the first channel the recipient can be reached on (Telegram, then email). */
  channel?: Channel;
  campaignId?: string | null;
}

export interface SendResult {
  status: MessageStatus;
  channel: Channel | null;
  messageId: string;
}

const PREFERRED_ORDER: Channel[] = ["TELEGRAM", "EMAIL"];

/**
 * Sends one message. For customers and members it always checks consent first and respects quiet hours
 * (20:00 to 07:00 Addis Ababa time): a message in quiet hours is stored and sent at 07:00.
 * Staff messages (recipient kind "user") need no consent and are not deferred.
 * Every attempt, including blocked ones, is written to message_log.
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger("MessageService");

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    @Inject(MESSAGE_TRANSPORTS) private readonly transports: MessageTransport[],
    @Inject(MESSAGE_TEMPLATES) private readonly templates: TemplateSet,
    @Optional() @Inject(CONTACT_RESOLVER) private readonly resolver: ContactResolver | null,
    private readonly consent: ConsentService,
  ) {}

  async send(input: SendInput): Promise<SendResult> {
    const data = input.data ?? {};
    const isSubject = input.recipient.kind === "subject";
    const contact = await this.contactFor(input.recipient);
    const base = {
      subjectId: isSubject ? input.recipient.id : null,
      userId: isSubject ? null : input.recipient.id,
      templateKey: input.templateKey,
      data,
      campaignId: input.campaignId ?? null,
    };
    if (!contact) return this.log({ ...base, channel: input.channel ?? null, status: "BLOCKED_NO_CONTACT", error: "Recipient not found" });

    const channel = input.channel ?? (await this.pickChannel(contact, isSubject));
    if (!channel) {
      const anyAddress = PREFERRED_ORDER.some((c) => this.addressFor(contact, c));
      return this.log({ ...base, channel: null, status: isSubject && anyAddress ? "BLOCKED_NO_CONSENT" : "BLOCKED_NO_CONTACT" });
    }
    if (!ENABLED_CHANNELS.includes(channel)) return this.log({ ...base, channel, status: "BLOCKED_CHANNEL_DISABLED" });
    if (isSubject && !(await this.consent.canContact(contact.id, channel))) return this.log({ ...base, channel, status: "BLOCKED_NO_CONSENT" });
    if (!this.addressFor(contact, channel)) return this.log({ ...base, channel, status: "BLOCKED_NO_CONTACT" });

    const now = this.clock.now();
    if (isSubject && isQuietHours(now)) {
      return this.log({ ...base, channel, status: "DEFERRED_QUIET_HOURS", sendAfter: nextAllowedSendTime(now) });
    }
    return this.deliver(contact, channel, base, isSubject);
  }

  /** Sends messages that were held back during quiet hours. Consent is checked again at send time. */
  async flushDeferred(): Promise<number> {
    const now = this.clock.now();
    if (isQuietHours(now)) return 0;
    const due = await this.db
      .select()
      .from(messageLog)
      .where(and(eq(messageLog.status, "DEFERRED_QUIET_HOURS"), lte(messageLog.sendAfter, now)))
      .limit(200);
    let sent = 0;
    for (const row of due) {
      const recipient: Recipient = row.subjectId ? { kind: "subject", id: row.subjectId } : { kind: "user", id: row.userId! };
      const contact = await this.contactFor(recipient);
      const channel = row.channel as Channel;
      let status: MessageStatus;
      let error: string | null = null;
      if (!contact || !this.addressFor(contact, channel)) status = "BLOCKED_NO_CONTACT";
      else if (row.subjectId && !(await this.consent.canContact(row.subjectId, channel))) status = "BLOCKED_NO_CONSENT";
      else {
        try {
          await this.transportFor(channel).send(contact, this.render(contact, row.templateKey, row.data, Boolean(row.subjectId)));
          status = "SENT";
          sent += 1;
        } catch (e) {
          status = "FAILED";
          error = e instanceof Error ? e.message : String(e);
        }
      }
      await this.db
        .update(messageLog)
        .set({ status, error, attempts: row.attempts + 1, sentAt: status === "SENT" ? this.clock.now() : null })
        .where(eq(messageLog.id, row.id));
    }
    return sent;
  }

  private async deliver(
    contact: Contact,
    channel: Channel,
    base: { subjectId: string | null; userId: string | null; templateKey: string; data: Record<string, unknown>; campaignId: string | null },
    isSubject: boolean,
  ): Promise<SendResult> {
    const message = this.render(contact, base.templateKey, base.data, isSubject);
    try {
      await this.transportFor(channel).send(contact, message);
      return this.log({ ...base, channel, status: "SENT", sentAt: this.clock.now(), attempts: 1 });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Message ${base.templateKey} on ${channel} failed: ${error}`);
      return this.log({ ...base, channel, status: "FAILED", error, attempts: 1 });
    }
  }

  render(contact: Contact, templateKey: string, data: Record<string, unknown>, withOptOut: boolean) {
    const message = renderTemplate(this.templates, templateKey, contact.locale, { name: contact.name, ...data });
    if (!withOptOut) return message;
    const url = `${this.config.PUBLIC_WEB_URL.replace(/\/$/, "")}/optout/${this.consent.optOutToken(contact.id)}`;
    return { ...message, text: `${message.text}\n\n${OPT_OUT_LINE[contact.locale].replace("{{url}}", url)}` };
  }

  private async pickChannel(contact: Contact, isSubject: boolean): Promise<Channel | null> {
    for (const channel of PREFERRED_ORDER) {
      if (!this.addressFor(contact, channel)) continue;
      if (!isSubject || (await this.consent.canContact(contact.id, channel))) return channel;
    }
    return null;
  }

  private addressFor(contact: Contact, channel: Channel): string | null | undefined {
    switch (channel) {
      case "TELEGRAM":
        return contact.telegramChatId;
      case "EMAIL":
        return contact.email;
      case "SMS":
      case "WHATSAPP":
        return contact.phone;
    }
  }

  private transportFor(channel: Channel): MessageTransport {
    const transport = this.transports.find((t) => t.channel === channel);
    if (!transport) throw new Error(`No transport for ${channel}`);
    return transport;
  }

  private async contactFor(recipient: Recipient): Promise<Contact | null> {
    if (recipient.kind === "subject") return this.resolver ? this.resolver.resolve(recipient.id) : null;
    const [u] = await this.db.select().from(users).where(eq(users.id, recipient.id)).limit(1);
    if (!u || !u.isActive) return null;
    return { id: u.id, name: u.name, locale: u.locale === "am" ? "am" : "en", email: u.email, telegramChatId: u.telegramChatId };
  }

  private async log(entry: {
    subjectId: string | null;
    userId: string | null;
    templateKey: string;
    data: Record<string, unknown>;
    campaignId: string | null;
    channel: Channel | null;
    status: MessageStatus;
    error?: string | null;
    sendAfter?: Date;
    sentAt?: Date;
    attempts?: number;
  }): Promise<SendResult> {
    const [row] = await this.db
      .insert(messageLog)
      .values({
        subjectId: entry.subjectId,
        userId: entry.userId,
        templateKey: entry.templateKey,
        data: entry.data,
        campaignId: entry.campaignId,
        channel: entry.channel,
        status: entry.status,
        error: entry.error ?? null,
        sendAfter: entry.sendAfter ?? null,
        sentAt: entry.sentAt ?? null,
        attempts: entry.attempts ?? 0,
      })
      .returning({ id: messageLog.id });
    return { status: entry.status, channel: entry.channel, messageId: row.id };
  }
}
