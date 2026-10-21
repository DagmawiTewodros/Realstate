import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { z } from "zod";
import { passwordSchema } from "@platform/shared";
import { asc, eq, sql } from "drizzle-orm";
import { AppError, notFound } from "../errors";
import { AuditService } from "../audit";
import { DB, PLATFORM_OPTIONS } from "../tokens";
import type { Database, Executor } from "../db";
import { zod } from "../zod.pipe";
import type { PlatformOptions } from "../options";
import { users } from "../schema";
import { AuthService, toAuthUser } from "./auth.service";
import { CurrentUser, Roles, type AuthUser } from "./decorators";

interface CreateUserBody {
  name: string;
  email: string;
  role: string;
  locale: "am" | "en";
  password: string;
  telegramChatId?: string | null;
}
interface UpdateUserBody {
  name?: string;
  role?: string;
  locale?: "am" | "en";
  telegramChatId?: string | null;
  isActive?: boolean;
}

const resetPasswordSchema = z.object({ password: passwordSchema });

/** Staff user management. Only the OWNER role exists in both systems and manages users. */
@Controller("users")
@Roles("OWNER")
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PLATFORM_OPTIONS) private readonly options: PlatformOptions,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list() {
    const rows = await this.db.select().from(users).orderBy(asc(users.name));
    return { items: rows.map((u) => ({ ...toAuthUser(u), isActive: u.isActive, createdAt: u.createdAt })) };
  }

  @Post()
  async create(@Body() raw: unknown, @CurrentUser() actor: AuthUser) {
    const body = this.options.userSchemas.create.parse(raw) as CreateUserBody;
    if (this.options.portalRoles.includes(body.role)) {
      throw new AppError(400, "PORTAL_ROLE", "Portal users are created by sending an invitation");
    }
    const [existing] = await this.db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${body.email}`);
    if (existing) throw new AppError(409, "EMAIL_IN_USE", "A user with this email already exists");
    const [row] = await this.db
      .insert(users)
      .values({
        name: body.name,
        email: body.email,
        role: body.role,
        locale: body.locale,
        telegramChatId: body.telegramChatId ?? null,
        passwordHash: await this.auth.hashPassword(body.password),
      })
      .returning();
    await this.audit.log({ userId: actor.id, action: "user.created", entityType: "user", entityId: row.id, metadata: { role: row.role } });
    return { user: { ...toAuthUser(row), isActive: row.isActive } };
  }

  /**
   * The owner sets a new temporary password for a staff member who forgot theirs (there is no email reset).
   * All of that user's sessions end, and the change is audited. Portal and member accounts are not changed here.
   */
  @Post(":id/password")
  @HttpCode(200)
  async resetPassword(@Param("id", ParseUUIDPipe) id: string, @Body(zod(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>, @CurrentUser() actor: AuthUser) {
    const [target] = await this.db.select().from(users).where(eq(users.id, id));
    if (!target) throw notFound();
    if (this.options.portalRoles.includes(target.role)) throw new AppError(400, "PORTAL_ROLE", "Portal accounts set their own password through an invitation");
    const passwordHash = await this.auth.hashPassword(body.password);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, id));
      await this.auth.endAllSessions(id, tx as unknown as Executor);
      await this.audit.log({ userId: actor.id, action: "user.password_reset", entityType: "user", entityId: id }, tx as unknown as Executor);
    });
    return { ok: true };
  }

  @Patch(":id")
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() raw: unknown, @CurrentUser() actor: AuthUser) {
    const body = this.options.userSchemas.update.parse(raw) as UpdateUserBody;
    if (body.role && this.options.portalRoles.includes(body.role)) throw new AppError(400, "PORTAL_ROLE", "Cannot change a staff user into a portal user");
    if (id === actor.id && (body.isActive === false || (body.role && body.role !== actor.role))) {
      throw new AppError(400, "CANNOT_CHANGE_SELF", "You cannot deactivate yourself or change your own role");
    }
    const row = await this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      if (!updated) throw notFound();
      if (body.isActive === false) await this.auth.endAllSessions(id, tx);
      await this.audit.log({ userId: actor.id, action: "user.updated", entityType: "user", entityId: id, metadata: { changes: Object.keys(body) } }, tx);
      return updated;
    });
    return { user: { ...toAuthUser(row), isActive: row.isActive } };
  }
}
