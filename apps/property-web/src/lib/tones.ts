/** Badge colours for statuses, shared by lists and detail pages. */
type Tone = "ok" | "warn" | "danger" | "brand" | undefined;

export const unitTone = (status: string): Tone => (status === "AVAILABLE" ? "ok" : status === "RESERVED" ? "warn" : "brand");
export const leadTone = (status: string): Tone => (status === "SIGNED" ? "ok" : status === "LOST" ? "danger" : "brand");
export const leaseTone = (status: string): Tone => (status === "ACTIVE" ? "ok" : status === "DRAFT" ? "warn" : undefined);
export const chargeTone = (status: string): Tone =>
  status === "PAID" ? "ok" : status === "OVERDUE" ? "danger" : status === "PARTIAL" ? "warn" : status === "WAIVED" ? undefined : "brand";
export const maintenanceTone = (status: string): Tone => (status === "DONE" ? "ok" : status === "CANCELLED" ? undefined : status === "NEW" ? "warn" : "brand");
export const priorityTone = (p: string): Tone => (p === "URGENT" ? "danger" : p === "LOW" ? undefined : "brand");
export const messageTone = (s: string): Tone => (s === "SENT" ? "ok" : s === "FAILED" ? "danger" : "warn");
