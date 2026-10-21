import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { AppError } from "./errors";
import { AuditService } from "./audit";
import { CLOCK, DB, PLATFORM_OPTIONS } from "./tokens";
import type { Clock } from "./clock";
import type { Database, Executor } from "./db";
import type { PlatformOptions } from "./options";
import { invitations, users } from "./schema";
import { toAuthUser } from "./auth/auth.service";
import type { AuthUser } from "./auth/decorators";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Single-use invitation links that create a portal login (landlord, tenant, gym member). */
@Injectable()
export class InvitationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PLATFORM_OPTIONS) private readonly options: PlatformOptions,
    private readonly audit: AuditService,
  ) {}

  async create(
    input: { role: string; linkedEntityId: string; email: string | null | undefined; name: string; locale: string; createdById: string | null },
    tx?: Executor,
  ): Promise<{ token: string; expiresAt: Date }> {
    if (!this.options.portalRoles.includes(input.role)) throw new Error(`Role ${input.role} is not a portal role`);
    if (!input.email) throw new AppError(400, "EMAIL_REQUIRED", "Add an email address first; it becomes the login name");
    const exec = tx ?? this.db;
    const [existingUser] = await exec.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`);
    if (existingUser) throw new AppError(409, "EMAIL_IN_USE", "A login with this email already exists");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.clock.now().getTime() + INVITATION_TTL_MS);
    await exec.insert(invitations).values({
      tokenHash: sha256(token),
      role: input.role,
      linkedEntityId: input.linkedEntityId,
      email: input.email.toLowerCase(),
      name: input.name,
      locale: input.locale,
      expiresAt,
      createdById: input.createdById,
    });
    await this.audit.log({ userId: input.createdById, action: "invitation.created", entityType: input.role.toLowerCase(), entityId: input.linkedEntityId }, tx);
    return { token, expiresAt };
  }

  async accept(token: string, password: string, name?: string): Promise<AuthUser> {
    return this.db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, sha256(token))).for("update").limit(1);
      if (!inv) throw new AppError(404, "INVITATION_NOT_FOUND", "This invitation link is not valid");
      if (inv.usedAt) throw new AppError(400, "INVITATION_USED", "This invitation link has already been used");
      if (inv.expiresAt.getTime() < this.clock.now().getTime()) throw new AppError(400, "INVITATION_EXPIRED", "This invitation link has expired; ask for a new one");
      const [clash] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${inv.email}`);
      if (clash) throw new AppError(409, "EMAIL_IN_USE", "A login with this email already exists");
      const [user] = await tx
        .insert(users)
        .values({
          name: name ?? inv.name,
          email: inv.email,
          role: inv.role,
          locale: inv.locale,
          linkedEntityId: inv.linkedEntityId,
          passwordHash: await bcrypt.hash(password, this.options.bcryptRounds ?? 12),
        })
        .returning();
      await tx.update(invitations).set({ usedAt: this.clock.now() }).where(eq(invitations.id, inv.id));
      await this.audit.log({ userId: user.id, action: "invitation.accepted", entityType: "user", entityId: user.id }, tx as unknown as Executor);
      return toAuthUser(user);
    });
  }
}
