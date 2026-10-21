import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "platform:roles";
export const PUBLIC_KEY = "platform:public";
export const INTERNAL_KEY = "platform:internal";
export const ANY_ROLE = "*";

/** Roles allowed to call this endpoint. Endpoints without @Roles, @AnyRole, @Public or @Internal are denied. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
/** Any signed-in user, whatever the role. */
export const AnyRole = () => SetMetadata(ROLES_KEY, [ANY_ROLE]);
/** No sign-in needed. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Only callers with the internal shared secret (n8n). */
export const Internal = () => SetMetadata(INTERNAL_KEY, true);

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  locale: "am" | "en";
  linkedEntityId: string | null;
  telegramChatId: string | null;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
});

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<{ ip?: string; socket?: { remoteAddress?: string } }>();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
});
