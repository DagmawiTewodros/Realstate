import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { acceptInvitationSchema, changePasswordSchema, localeSchema, loginSchema } from "@platform/shared";
import { zod } from "../zod.pipe";
import { APP_CONFIG, DB, PLATFORM_OPTIONS } from "../tokens";
import type { BaseConfig } from "../config";
import type { Database } from "../db";
import type { PlatformOptions } from "../options";
import { users } from "../schema";
import { InvitationService } from "../invitations";
import { AuthService, SESSION_TTL_MS } from "./auth.service";
import { AnyRole, ClientIp, CurrentUser, Public, type AuthUser } from "./decorators";

const updateMeSchema = z.object({
  locale: localeSchema.optional(),
  telegramChatId: z.string().trim().max(64).optional().nullable(),
});

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationService,
    @Inject(DB) private readonly db: Database,
    @Inject(PLATFORM_OPTIONS) private readonly options: PlatformOptions,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
  ) {}

  private setCookie(res: Response, token: string): void {
    res.cookie(this.options.cookieName, token, {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    });
  }

  @Post("login")
  @Public()
  @HttpCode(200)
  async login(@Body(zod(loginSchema)) body: z.infer<typeof loginSchema>, @ClientIp() ip: string, @Res({ passthrough: true }) res: Response) {
    const { token, user } = await this.auth.login(body.email, body.password, ip);
    this.setCookie(res, token);
    return { user };
  }

  @Post("logout")
  @Public()
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout((req.cookies as Record<string, string> | undefined)?.[this.options.cookieName]);
    res.clearCookie(this.options.cookieName, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  @AnyRole()
  me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  @Patch("me")
  @AnyRole()
  async updateMe(@CurrentUser() user: AuthUser, @Body(zod(updateMeSchema)) body: z.infer<typeof updateMeSchema>) {
    const [row] = await this.db
      .update(users)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return { user: { ...user, locale: row.locale, telegramChatId: row.telegramChatId } };
  }

  @Post("change-password")
  @AnyRole()
  @HttpCode(200)
  async changePassword(@CurrentUser() user: AuthUser, @Body(zod(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @Post("accept-invitation")
  @Public()
  @HttpCode(200)
  async acceptInvitation(@Body(zod(acceptInvitationSchema)) body: z.infer<typeof acceptInvitationSchema>, @Res({ passthrough: true }) res: Response) {
    const user = await this.invitations.accept(body.token, body.password, body.name);
    const token = await this.auth.createSession(user.id);
    this.setCookie(res, token);
    return { user };
  }
}
