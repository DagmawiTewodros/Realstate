import type { PropertyRole } from "@platform/shared";
import type { AuthUser } from "@platform/nest-common";

/** Role groups used by @Roles(...). The full matrix is documented in docs/PERMISSIONS.md and tested. */
export const ROLE = {
  OWNER: "OWNER",
  SALES_MANAGER: "SALES_MANAGER",
  BROKER: "BROKER",
  PROPERTY_MANAGER: "PROPERTY_MANAGER",
  LANDLORD: "LANDLORD",
  TENANT: "TENANT",
} as const satisfies Record<PropertyRole, PropertyRole>;

export const STAFF = [ROLE.OWNER, ROLE.SALES_MANAGER, ROLE.BROKER, ROLE.PROPERTY_MANAGER];
export const SALES = [ROLE.OWNER, ROLE.SALES_MANAGER, ROLE.BROKER];
export const SALES_MANAGERS = [ROLE.OWNER, ROLE.SALES_MANAGER];
export const RENTALS = [ROLE.OWNER, ROLE.PROPERTY_MANAGER];
export const RENTALS_READ = [ROLE.OWNER, ROLE.PROPERTY_MANAGER, ROLE.SALES_MANAGER];
export const IMPORTERS = [ROLE.OWNER, ROLE.SALES_MANAGER, ROLE.PROPERTY_MANAGER];
export const PORTAL_ROLES = [ROLE.LANDLORD, ROLE.TENANT];

export const isSalesManager = (user: AuthUser) => user.role === ROLE.OWNER || user.role === ROLE.SALES_MANAGER;
export const isBroker = (user: AuthUser) => user.role === ROLE.BROKER;
