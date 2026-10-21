import { addDays, addMonths, compareDates, diffDays } from "./dates";

/** A membership of N months starting on `start` ends the day before the same date N months later. */
export function membershipEndDate(start: string, durationMonths: number): string {
  if (!Number.isInteger(durationMonths) || durationMonths < 1) throw new RangeError("Duration must be a whole number of months");
  return addDays(addMonths(start, durationMonths), -1);
}

/** Renewal before expiry continues from the day after the current end; after expiry it starts today. */
export function renewalStartDate(currentEnd: string | null, today: string): string {
  if (currentEnd && compareDates(currentEnd, today) >= 0) return addDays(currentEnd, 1);
  return today;
}

/** Number of days in an inclusive freeze range. */
export function freezeDays(start: string, end: string): number {
  if (compareDates(end, start) < 0) throw new RangeError("Freeze end is before start");
  return diffDays(start, end) + 1;
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return compareDates(aStart, bEnd) <= 0 && compareDates(bStart, aEnd) <= 0;
}

/** End date after a freeze: moved later by exactly the frozen days. */
export function endDateAfterFreeze(currentEnd: string, freezeStart: string, freezeEnd: string): string {
  return addDays(currentEnd, freezeDays(freezeStart, freezeEnd));
}
