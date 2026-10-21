import type { ZodTypeAny } from "zod";

export interface PlatformOptions {
  /** "property" or "gym": used in receipt scopes, logs and cookie names. */
  systemName: string;
  /** Every role in this system. */
  roles: readonly string[];
  /** Schemas for creating and updating staff users (roles differ per system). */
  userSchemas: { create: ZodTypeAny; update: ZodTypeAny };
  /** Session cookie name; must differ between the two systems because cookies are shared across ports. */
  cookieName: string;
  /** Roles portal users get through invitations (they cannot be created from the users screen). */
  portalRoles: readonly string[];
  /** bcrypt cost; lower only in tests. */
  bcryptRounds?: number;
}
