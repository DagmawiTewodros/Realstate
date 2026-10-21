import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createHmac } from "node:crypto";
import type { Channel } from "@platform/shared";
import { APP_CONFIG, CLOCK, DB } from "./tokens";
import type { BaseConfig } from "./config";
import type { Clock } from "./clock";
import type { Database, Executor } from "./db";
import { consentRecords } from "./schema";
import { safeEqual } from "./auth/auth.guard";

/**
 * Consent per subject (customer or member) and channel. A channel may be used only when the newest
 * record for it is granted and not revoked. Every message to a customer or member must call canContact.
 */
@Injectable()
export class ConsentService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
  ) {}

  async canContact(subjectId: string, channel: Channel, tx?: Executor): Promise<boolean> {
    const [latest] = await (tx ?? this.db)
      .select({ revokedAt: consentRecords.revokedAt })
      .from(consentRecords)
      .where(and(eq(consentRecords.subjectId, subjectId), eq(consentRecords.channel, channel)))
      .orderBy(desc(consentRecords.grantedAt), desc(consentRecords.id))
      .limit(1);
    return Boolean(latest && latest.revokedAt === null);
  }

  async channelsWithConsent(subjectId: string, tx?: Executor): Promise<Channel[]> {
    const rows = await (tx ?? this.db)
      .selectDistinct({ channel: consentRecords.channel })
      .from(consentRecords)
      .where(and(eq(consentRecords.subjectId, subjectId), isNull(consentRecords.revokedAt)));
    return rows.map((r) => r.channel as Channel);
  }

  async grant(subjectId: string, channel: Channel, opts: { note?: string | null; userId?: string | null } = {}, tx?: Executor): Promise<void> {
    if (await this.canContact(subjectId, channel, tx)) return;
    await (tx ?? this.db).insert(consentRecords).values({
      subjectId,
      channel,
      grantedAt: this.clock.now(),
      note: opts.note ?? null,
      createdById: opts.userId ?? null,
    });
  }

  async revoke(subjectId: string, channel: Channel, tx?: Executor): Promise<void> {
    await (tx ?? this.db)
      .update(consentRecords)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(consentRecords.subjectId, subjectId), eq(consentRecords.channel, channel), isNull(consentRecords.revokedAt)));
  }

  async revokeAll(subjectId: string, tx?: Executor): Promise<void> {
    await (tx ?? this.db)
      .update(consentRecords)
      .set({ revokedAt: this.clock.now() })
      .where(and(eq(consentRecords.subjectId, subjectId), isNull(consentRecords.revokedAt)));
  }

  async history(subjectId: string) {
    return this.db.select().from(consentRecords).where(eq(consentRecords.subjectId, subjectId)).orderBy(desc(consentRecords.grantedAt));
  }

  /** Signed, non-guessable opt-out token. It identifies the subject but cannot be used to read any data. */
  optOutToken(subjectId: string): string {
    return `${Buffer.from(subjectId).toString("base64url")}.${this.sign(`optout:${subjectId}`)}`;
  }

  /** Returns the subject id for a valid token, otherwise null. */
  verifyOptOutToken(token: string): string | null {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;
    let subjectId: string;
    try {
      subjectId = Buffer.from(encoded, "base64url").toString("utf8");
    } catch {
      return null;
    }
    if (!/^[0-9a-f-]{36}$/i.test(subjectId)) return null;
    return safeEqual(signature, this.sign(`optout:${subjectId}`)) ? subjectId : null;
  }

  /** Generic signed token for one-purpose links (for example removing one saved search). */
  signedToken(purpose: string, id: string): string {
    return `${Buffer.from(id).toString("base64url")}.${this.sign(`${purpose}:${id}`)}`;
  }

  verifySignedToken(purpose: string, token: string): string | null {
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;
    const id = Buffer.from(encoded, "base64url").toString("utf8");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return safeEqual(signature, this.sign(`${purpose}:${id}`)) ? id : null;
  }

  private sign(value: string): string {
    return createHmac("sha256", this.config.SESSION_SECRET).update(value).digest("base64url").slice(0, 32);
  }
}
