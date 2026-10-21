import type { LeadStatus, MaintenanceStatus, UnitStatus } from "./enums";

/** Forward moves any lead owner may make. Moving back is a manager-only action (see canMoveLead). */
export const LEAD_FORWARD_MOVES: Record<LeadStatus, readonly LeadStatus[]> = {
  INQUIRY: ["VIEWING", "LOST"],
  VIEWING: ["OFFER", "LOST"],
  OFFER: ["SIGNED", "LOST"],
  SIGNED: [],
  LOST: [],
};

const LEAD_ORDER: LeadStatus[] = ["INQUIRY", "VIEWING", "OFFER", "SIGNED"];

export type MoveCheck = { ok: true } | { ok: false; code: "ILLEGAL_MOVE" | "MANAGER_ONLY" | "SAME_STATUS" };

/**
 * Lead moves. Forward moves follow LEAD_FORWARD_MOVES.
 * A backward move (for example OFFER to VIEWING, or LOST back to INQUIRY) needs a manager.
 */
export function canMoveLead(from: LeadStatus, to: LeadStatus, isManager: boolean): MoveCheck {
  if (from === to) return { ok: false, code: "SAME_STATUS" };
  if (LEAD_FORWARD_MOVES[from].includes(to)) return { ok: true };
  const isBackward =
    (from === "LOST" && to !== "SIGNED") ||
    (LEAD_ORDER.indexOf(to) >= 0 && LEAD_ORDER.indexOf(from) > LEAD_ORDER.indexOf(to));
  if (isBackward) return isManager ? { ok: true } : { ok: false, code: "MANAGER_ONLY" };
  return { ok: false, code: "ILLEGAL_MOVE" };
}

export type UnitMoveContext = "MANUAL" | "LEASE";

/**
 * Unit moves.
 * - AVAILABLE -> RESERVED (anyone with unit access)
 * - RESERVED -> AVAILABLE | SOLD | LEASED
 * - AVAILABLE -> SOLD | LEASED (managers only)
 * - LEASED -> AVAILABLE only when a lease ends or is terminated (context LEASE)
 */
export function canMoveUnit(from: UnitStatus, to: UnitStatus, isManager: boolean, context: UnitMoveContext = "MANUAL"): MoveCheck {
  if (from === to) return { ok: false, code: "SAME_STATUS" };
  if (from === "AVAILABLE" && to === "RESERVED") return { ok: true };
  if (from === "RESERVED" && (to === "AVAILABLE" || to === "SOLD" || to === "LEASED")) return { ok: true };
  if (from === "AVAILABLE" && (to === "SOLD" || to === "LEASED")) {
    if (context === "LEASE") return { ok: true };
    return isManager ? { ok: true } : { ok: false, code: "MANAGER_ONLY" };
  }
  if (from === "LEASED" && to === "AVAILABLE" && context === "LEASE") return { ok: true };
  return { ok: false, code: "ILLEGAL_MOVE" };
}

export const MAINTENANCE_MOVES: Record<MaintenanceStatus, readonly MaintenanceStatus[]> = {
  NEW: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["DONE"],
  DONE: [],
  CANCELLED: [],
};

export function canMoveMaintenance(from: MaintenanceStatus, to: MaintenanceStatus): boolean {
  return MAINTENANCE_MOVES[from].includes(to);
}
