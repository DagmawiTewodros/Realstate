import type { GymRole } from "@platform/shared";
import type { AuthUser } from "@platform/nest-common";

/** Role groups used by @Roles(...). */
export const ROLE = {
  OWNER: "OWNER",
  GYM_MANAGER: "GYM_MANAGER",
  TRAINER: "TRAINER",
  FRONT_DESK: "FRONT_DESK",
  MEMBER: "MEMBER",
} as const satisfies Record<GymRole, GymRole>;

/** Manage members, sell memberships, check members in. */
export const DESK = [ROLE.OWNER, ROLE.GYM_MANAGER, ROLE.FRONT_DESK];
/** Plans, freezes, voids, classes setup, campaigns, revenue. */
export const MANAGERS = [ROLE.OWNER, ROLE.GYM_MANAGER];
/** Every staff role. */
export const STAFF = [ROLE.OWNER, ROLE.GYM_MANAGER, ROLE.FRONT_DESK, ROLE.TRAINER];
/** Everyone, including members (timetable). */
export const EVERYONE = [...STAFF, ROLE.MEMBER];

export const isManager = (user: AuthUser) => user.role === ROLE.OWNER || user.role === ROLE.GYM_MANAGER;
