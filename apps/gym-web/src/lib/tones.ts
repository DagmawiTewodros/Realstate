/** Badge colours for statuses. */
type Tone = "ok" | "warn" | "danger" | "brand" | undefined;

export const membershipTone = (s: string): Tone => (s === "ACTIVE" ? "ok" : s === "FROZEN" ? "warn" : s === "NONE" ? undefined : "danger");
export const bookingTone = (s: string): Tone => (s === "ATTENDED" ? "ok" : s === "BOOKED" ? "brand" : s === "NO_SHOW" ? "danger" : undefined);
export const messageTone = (s: string): Tone => (s === "SENT" ? "ok" : s === "FAILED" ? "danger" : "warn");
