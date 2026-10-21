import { GYM_ROLES, gymUserSchemas } from "@platform/shared";
import type { PlatformOptions } from "@platform/nest-common";
import { ROLE } from "./access";

export function gymOptions(nodeEnv: string): PlatformOptions {
  return {
    systemName: "gym",
    roles: GYM_ROLES,
    userSchemas: gymUserSchemas,
    cookieName: "gym_session",
    portalRoles: [ROLE.MEMBER],
    bcryptRounds: nodeEnv === "test" ? 4 : 12,
  };
}
