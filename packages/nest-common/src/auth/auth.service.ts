import { Inject, Injectable } from "@nestjs/common";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { AppError } from "../errors";
import { AuditService } from "../audit";
import { RateLimiter } from "../rate-limit";
import { CLOCK, DB, PLATFORM_OPTIONS } from "../tokens";
import type { Clock } from "../clock";
import type { Database, Executor } from "../db";
import type { PlatformOptions } from "../options";
import { sessions, users } from "../schema";
import type { AuthUser } from "./decorators";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_WINDOW_MS = 60_000;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export type UserRow = typeof users.$inferSelect;

export function toAuthUser(u: UserRow): AuthUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    locale: u.locale === "am" ? "am" : "en",
    linkedEntityId: u.linkedEntityId,
    telegramChatId: u.telegramChatId,
  };
}

@Injectable()
export class AuthService {
  /** A real bcrypt hash used when the email is unknown, so both cases take the same time. */
  private readonly dummyHash: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PLATFORM_OPTIONS) private readonly options: PlatformOptions,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {
    this.dummyHash = bcrypt.hashSync("not-a-real-password", this.rounds);
  }

  get rounds(): number {
    return this.options.bcryptRounds ?? 12;
  }

  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.rounds);
  }

  async login(email: string, password: string, ip: string): Promise<{ token: string; user: AuthUser }> {
    const emailKey = `login:email:${email.toLowerCase()}`;
    const ipKey = `login:ip:${ip}`;
    if (
      this.limiter.count(emailKey, LOGIN_WINDOW_MS) >= LOGIN_FAILURE_LIMIT ||
      this.limiter.count(ipKey, LOGIN_WINDOW_MS) >= LOGIN_FAILURE_LIMIT
    ) {
      throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-in attempts. Wait a minute and try again.");
    }

    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
      .limit(1);
    const ok = await bcrypt.compare(password, user?.passwordHash ?? this.dummyHash);
    if (!user || !ok || !user.isActive) {
      this.limiter.record(emailKey);
      this.limiter.record(ipKey);
      await this.audit.log({ userId: user?.id ?? null, action: "auth.login_failed", entityType: "user", entityId: user?.id ?? null, metadata: { ip } });
      // Same answer for unknown email, wrong password and deactivated account.
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is not correct");
    }
    const token = await this.createSession(user.id);
    await this.audit.log({ userId: user.id, action: "auth.login", entityType: "user", entityId: user.id, metadata: { ip } });
    return { token, user: toAuthUser(user) };
  }

  async createSession(userId: string, tx?: Executor): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await (tx ?? this.db).insert(sessions).values({
      id: sha256(token),
      userId,
      expiresAt: new Date(this.clock.now().getTime() + SESSION_TTL_MS),
    });
    return token;
  }

  async userForToken(token: string): Promise<AuthUser | null> {
    if (!token || token.length > 200) return null;
    const rows = await this.db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, this.clock.now()), eq(users.isActive, true)))
      .limit(1);
    return rows[0] ? toAuthUser(rows[0].user) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.db.delete(sessions).where(eq(sessions.id, sha256(token)));
  }

  async endAllSessions(userId: string, tx?: Executor): Promise<void> {
    await (tx ?? this.db).delete(sessions).where(eq(sessions.userId, userId));
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new AppError(400, "WRONG_PASSWORD", "The current password is not correct");
    }
    await this.db.update(users).set({ passwordHash: await this.hashPassword(newPassword), updatedAt: this.clock.now() }).where(eq(users.id, userId));
    await this.audit.log({ userId, action: "auth.password_changed", entityType: "user", entityId: userId });
  }
}
