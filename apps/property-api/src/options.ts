import { PROPERTY_ROLES, propertyUserSchemas } from "@platform/shared";
import type { PlatformOptions } from "@platform/nest-common";
import { PORTAL_ROLES } from "./access";

export function propertyOptions(nodeEnv: string): PlatformOptions {
  return {
    systemName: "property",
    roles: PROPERTY_ROLES,
    userSchemas: propertyUserSchemas,
    cookieName: "pp_session",
    portalRoles: PORTAL_ROLES,
    bcryptRounds: nodeEnv === "test" ? 4 : 12,
  };
}
