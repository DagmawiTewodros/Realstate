import type { BillingFrequency, ChargeStatus } from "./enums";
import { addDays, addMonths, compareDates, diffDays } from "./dates";
import { assertMinor } from "./money";

export const MONTHS_PER_PERIOD: Record<BillingFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

/**
 * Due date rule (see docs/DECISIONS.md): rent for a period is due on the first day of that period.
 * Change this one constant to move due dates (for example to 5 days after the period starts).
 */
export const DUE_DAYS_AFTER_PERIOD_START = 0;

export interface GeneratedCharge {
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountMinor: number;
}

/**
 * Builds the rent schedule for a lease. Each period is 1, 3 or 12 months from the start date.
 * A final period shorter than a full period is prorated by days (rounded to the nearest santim).
 */
export function generateRentSchedule(input: {
  startDate: string;
  endDate: string;
  rentMinor: number;
  frequency: BillingFrequency;
}): GeneratedCharge[] {
  assertMinor(input.rentMinor);
  if (compareDates(input.endDate, input.startDate) < 0) throw new RangeError("Lease end date is before start date");
  const months = MONTHS_PER_PERIOD[input.frequency];
  const charges: GeneratedCharge[] = [];
  let index = 0;
  for (;;) {
    const periodStart = addMonths(input.startDate, months * index);
    if (compareDates(periodStart, input.endDate) > 0) break;
    const fullEnd = addDays(addMonths(input.startDate, months * (index + 1)), -1);
    const periodEnd = compareDates(fullEnd, input.endDate) <= 0 ? fullEnd : input.endDate;
    let amountMinor = input.rentMinor;
    if (periodEnd !== fullEnd) {
      const fullDays = diffDays(periodStart, fullEnd) + 1;
      const usedDays = diffDays(periodStart, periodEnd) + 1;
      amountMinor = Math.round((input.rentMinor * usedDays) / fullDays);
    }
    charges.push({ periodStart, periodEnd, dueDate: addDays(periodStart, DUE_DAYS_AFTER_PERIOD_START), amountMinor });
    index += 1;
    if (index > 1200) throw new RangeError("Lease is too long");
  }
  return charges;
}

export interface OpenCharge {
  id: string;
  dueDate: string;
  amountMinor: number;
  paidMinor: number;
  status: ChargeStatus;
}

export interface Allocation {
  chargeId: string;
  amountMinor: number;
}

/** Allocates a payment to the oldest unpaid charges first. Whatever is left over is credit. */
export function allocatePayment(charges: OpenCharge[], paymentMinor: number): { allocations: Allocation[]; remainderMinor: number } {
  assertMinor(paymentMinor);
  if (paymentMinor <= 0) throw new RangeError("Payment must be positive");
  const open = charges
    .filter((c) => c.status !== "WAIVED" && c.paidMinor < c.amountMinor)
    .sort((a, b) => compareDates(a.dueDate, b.dueDate) || a.id.localeCompare(b.id));
  let left = paymentMinor;
  const allocations: Allocation[] = [];
  for (const charge of open) {
    if (left === 0) break;
    const take = Math.min(left, charge.amountMinor - charge.paidMinor);
    allocations.push({ chargeId: charge.id, amountMinor: take });
    left -= take;
  }
  return { allocations, remainderMinor: left };
}

export function chargeStatusFor(charge: { amountMinor: number; paidMinor: number; dueDate: string; status?: ChargeStatus }, today: string): ChargeStatus {
  if (charge.status === "WAIVED") return "WAIVED";
  if (charge.paidMinor >= charge.amountMinor) return "PAID";
  if (charge.paidMinor > 0) return "PARTIAL";
  return compareDates(charge.dueDate, today) < 0 ? "OVERDUE" : "DUE";
}
