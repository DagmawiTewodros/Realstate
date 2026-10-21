import { Inject, Injectable } from "@nestjs/common";
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { CHANNELS, addisDateString, formatDate, normalizePhone, type Channel, type Pagination, type memberCreateSchema, type memberUpdateSchema } from "@platform/shared";
import {
  APP_CONFIG,
  AuditService,
  CLOCK,
  ConsentService,
  DB,
  EXTENSION,
  InvitationService,
  MB,
  MIME,
  MessageService,
  StorageService,
  notFound,
  validateUpload,
  type AuthUser,
  type BaseConfig,
  type Clock,
  type Database,
  type Executor,
  type UploadedFile,
} from "@platform/nest-common";
import { bookings, checkins, consentRecords, gymPayments, members, memberships, trainerAssignments, trainers } from "../db/schema";
import { ROLE } from "../access";

export type MemberRow = typeof members.$inferSelect;
export const MEMBER_PHOTO_MAX_BYTES = 5 * MB;

@Injectable()
export class MembersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
    private readonly consent: ConsentService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly invitations: InvitationService,
    private readonly messages: MessageService,
  ) {}

  today(): string {
    return addisDateString(this.clock.now());
  }

  async list(page: Pagination, q?: string, extra?: SQL) {
    const conditions: SQL[] = [];
    if (extra) conditions.push(extra);
    if (q) {
      const phone = normalizePhone(q);
      const like = `%${q.replace(/[%_]/g, "")}%`;
      conditions.push(or(ilike(members.name, like), ilike(members.email, like), phone ? eq(members.phone, phone) : ilike(members.phone, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const items = await this.db
      .select()
      .from(members)
      .where(where)
      .orderBy(asc(members.name), asc(members.id))
      .limit(page.pageSize)
      .offset((page.page - 1) * page.pageSize);
    const [{ n }] = await this.db.select({ n: count() }).from(members).where(where);
    return { items, page: page.page, pageSize: page.pageSize, total: Number(n) };
  }

  async get(id: string, tx?: Executor): Promise<MemberRow> {
    const [row] = await (tx ?? this.db).select().from(members).where(eq(members.id, id)).limit(1);
    if (!row) throw notFound("MEMBER_NOT_FOUND", "Member not found");
    return row;
  }

  /** Trainers may read only members assigned to them; members only themselves; desk staff everyone. */
  async getFor(user: AuthUser, id: string): Promise<MemberRow> {
    if (user.role === ROLE.MEMBER && user.linkedEntityId !== id) throw notFound("MEMBER_NOT_FOUND", "Member not found");
    if (user.role === ROLE.TRAINER && !(await this.isAssignedToTrainer(user.id, id))) throw notFound("MEMBER_NOT_FOUND", "Member not found");
    return this.get(id);
  }

  async isAssignedToTrainer(userId: string, memberId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: trainerAssignments.id })
      .from(trainerAssignments)
      .innerJoin(trainers, eq(trainers.id, trainerAssignments.trainerId))
      .where(and(eq(trainers.userId, userId), eq(trainerAssignments.memberId, memberId)))
      .limit(1);
    return rows.length > 0;
  }

  async consentState(memberId: string): Promise<Record<Channel, boolean>> {
    const state = {} as Record<Channel, boolean>;
    for (const channel of CHANNELS) state[channel] = await this.consent.canContact(memberId, channel);
    return state;
  }

  async findDuplicates(phone: string | null | undefined, email: string | null | undefined, excludeId?: string) {
    const ors: SQL[] = [];
    if (phone) ors.push(eq(members.phone, phone));
    if (email) ors.push(sql`lower(${members.email}) = ${email.toLowerCase()}`);
    if (!ors.length) return [];
    const rows = await this.db
      .select({ id: members.id, name: members.name, phone: members.phone, email: members.email })
      .from(members)
      .where(and(or(...ors), sql`${members.anonymizedAt} is null`));
    return rows.filter((r) => r.id !== excludeId);
  }

  async create(user: AuthUser, input: z.infer<typeof memberCreateSchema>) {
    const duplicates = await this.findDuplicates(input.phone, input.email);
    const [row] = await this.db
      .insert(members)
      .values({
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        telegramChatId: input.telegramChatId ?? null,
        locale: input.locale,
        birthDate: input.birthDate ?? null,
        emergencyContactName: input.emergencyContactName ?? null,
        emergencyContactPhone: input.emergencyContactPhone ?? null,
        joinedAt: this.today(),
        createdById: user.id,
      })
      .returning();
    await this.audit.log({ userId: user.id, action: "member.created", entityType: "member", entityId: row.id });
    return { member: row, warnings: duplicates.length ? [{ code: "POSSIBLE_DUPLICATE", matches: duplicates }] : [] };
  }

  async update(user: AuthUser, id: string, input: z.infer<typeof memberUpdateSchema>) {
    await this.get(id);
    const [row] = await this.db
      .update(members)
      .set({ ...input, updatedAt: this.clock.now() })
      .where(eq(members.id, id))
      .returning();
    await this.audit.log({ userId: user.id, action: "member.updated", entityType: "member", entityId: id, metadata: { fields: Object.keys(input) } });
    const duplicates = await this.findDuplicates(row.phone, row.email, id);
    return { member: row, warnings: duplicates.length ? [{ code: "POSSIBLE_DUPLICATE", matches: duplicates }] : [] };
  }

  async setConsent(user: AuthUser, id: string, channel: Channel, granted: boolean, note?: string | null) {
    await this.get(id);
    if (granted) await this.consent.grant(id, channel, { note, userId: user.id });
    else await this.consent.revoke(id, channel);
    await this.audit.log({ userId: user.id, action: granted ? "consent.granted" : "consent.revoked", entityType: "member", entityId: id, metadata: { channel } });
    return { consent: await this.consentState(id), history: await this.consent.history(id) };
  }

  async setPhoto(user: AuthUser, id: string, file: UploadedFile | undefined) {
    const kind = validateUpload(file, ["jpeg", "png", "webp"], MEMBER_PHOTO_MAX_BYTES);
    const member = await this.get(id);
    const key = this.storage.newKey(`members/${id}`, EXTENSION[kind]);
    await this.storage.put(key, file!.buffer, MIME[kind]);
    if (member.photoKey) await this.storage.delete(member.photoKey);
    const [row] = await this.db.update(members).set({ photoKey: key, updatedAt: this.clock.now() }).where(eq(members.id, id)).returning();
    await this.audit.log({ userId: user.id, action: "member.photo_changed", entityType: "member", entityId: id });
    return row;
  }

  async photo(id: string) {
    const member = await this.get(id);
    if (!member.photoKey) throw notFound("PHOTO_NOT_FOUND", "No photo");
    const ext = member.photoKey.split(".").pop();
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return { body: await this.storage.get(member.photoKey), contentType };
  }

  async regenerateQr(user: AuthUser, id: string) {
    await this.get(id);
    const [row] = await this.db
      .update(members)
      .set({ qrVersion: sql`${members.qrVersion} + 1`, updatedAt: this.clock.now() })
      .where(eq(members.id, id))
      .returning();
    await this.audit.log({ userId: user.id, action: "member.qr_regenerated", entityType: "member", entityId: id, metadata: { version: row.qrVersion } });
    return row;
  }

  /** Creates a single-use link that sets up a MEMBER login. The link is returned so the desk can share it. */
  async invite(user: AuthUser, id: string) {
    const member = await this.get(id);
    const { token, expiresAt } = await this.invitations.create({
      role: ROLE.MEMBER,
      linkedEntityId: member.id,
      email: member.email,
      name: member.name,
      locale: member.locale,
      createdById: user.id,
    });
    const link = `${this.config.PUBLIC_WEB_URL.replace(/\/$/, "")}/invite/${token}`;
    const delivery = await this.messages.send({
      recipient: { kind: "subject", id: member.id },
      templateKey: "member.invitation",
      data: { link, expires: formatDate(expiresAt, member.locale === "en" ? "en" : "am") },
    });
    return { link, expiresAt, delivery: delivery.status };
  }

  async export(id: string) {
    const member = await this.get(id);
    const ms = await this.db.select().from(memberships).where(eq(memberships.memberId, id));
    return {
      exportedAt: this.clock.now().toISOString(),
      member,
      consent: await this.db.select().from(consentRecords).where(eq(consentRecords.subjectId, id)),
      memberships: ms,
      payments: await this.db.select().from(gymPayments).where(eq(gymPayments.memberId, id)),
      checkins: await this.db.select().from(checkins).where(eq(checkins.memberId, id)).orderBy(desc(checkins.at)),
      bookings: await this.db.select().from(bookings).where(eq(bookings.memberId, id)),
    };
  }

  /** Removes name and contact details but keeps the record, so counts and reports stay correct. */
  async anonymise(user: AuthUser, id: string) {
    const member = await this.get(id);
    const row = await this.db.transaction(async (raw) => {
      const tx = raw as unknown as Executor;
      const [updated] = await tx
        .update(members)
        .set({
          name: "Anonymised member",
          phone: null,
          email: null,
          telegramChatId: null,
          birthDate: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          photoKey: null,
          anonymizedAt: this.clock.now(),
          updatedAt: this.clock.now(),
        })
        .where(eq(members.id, id))
        .returning();
      await this.consent.revokeAll(id, tx);
      await this.audit.log({ userId: user.id, action: "member.anonymised", entityType: "member", entityId: id }, tx);
      return updated;
    });
    if (member.photoKey) await this.storage.delete(member.photoKey);
    return row;
  }

  async namesByIds(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, ids));
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
