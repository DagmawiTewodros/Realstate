import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { AppError } from "../errors";
import { APP_CONFIG, PLATFORM_OPTIONS } from "../tokens";
import type { BaseConfig } from "../config";
import type { PlatformOptions } from "../options";
import { AuthService } from "./auth.service";
import { ANY_ROLE, INTERNAL_KEY, PUBLIC_KEY, ROLES_KEY, type AuthUser } from "./decorators";

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Global guard. Every endpoint must declare who may call it:
 * @Public, @Internal (shared secret), @AnyRole (any signed-in user) or @Roles(...).
 * An endpoint with none of these is denied (403), so a forgotten decorator never opens an endpoint.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    @Inject(PLATFORM_OPTIONS) private readonly options: PlatformOptions,
    @Inject(APP_CONFIG) private readonly config: BaseConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(INTERNAL_KEY, targets)) {
      const given = req.header("x-internal-secret") ?? "";
      if (!safeEqual(given, this.config.INTERNAL_API_SECRET)) throw new AppError(401, "UNAUTHENTICATED", "Internal secret missing or wrong");
      return true;
    }

    const token = (req.cookies as Record<string, string> | undefined)?.[this.options.cookieName];
    if (token) req.user = (await this.auth.userForToken(token)) ?? undefined;

    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    if (!req.user) throw new AppError(401, "UNAUTHENTICATED", "Sign in first");

    const roles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, targets);
    if (!roles || roles.length === 0) throw new AppError(403, "NO_ROLES_DECLARED", "This endpoint does not allow any role");
    if (roles.includes(ANY_ROLE) || roles.includes(req.user.role)) return true;
    throw new AppError(403, "FORBIDDEN", "Your role cannot do this");
  }
}
