import { normalizePhone, maskPhone } from "./phone";
import { formatMoney, parseBirrToMinor } from "./money";
import { allocatePayment, chargeStatusFor, generateRentSchedule } from "./rent";
import { endDateAfterFreeze, membershipEndDate, rangesOverlap, renewalStartDate } from "./membership";
import { canMoveLead, canMoveMaintenance, canMoveUnit, LEAD_FORWARD_MOVES } from "./transitions";
import { LEAD_STATUSES } from "./enums";
import { leadStatusSchema, maintenanceStatusSchema, publicInquirySchema, sellMembershipSchema } from "./index";

describe("phone numbers", () => {
  it("normalizes Ethiopian formats to the same value", () => {
    for (const input of ["0911 23 45 67", "+251911234567", "251911234567", "911234567", "+251 91 123 4567", "00251911234567"]) {
      expect(normalizePhone(input)).toBe("+251911234567");
    }
    expect(normalizePhone("0711234567")).toBe("+251711234567");
  });
  it("rejects invalid numbers", () => {
    for (const input of ["", "abc", "12345", "09112345", "+25191123456"]) expect(normalizePhone(input)).toBeNull();
  });
  it("masks numbers for logs", () => {
    expect(maskPhone("+251911234567")).toBe("+2519****4567");
  });
});

describe("money", () => {
  it("parses birr into santim without floating point errors", () => {
    expect(parseBirrToMinor("12,500.50")).toBe(1250050);
    expect(parseBirrToMinor("0.1")).toBe(10);
    expect(parseBirrToMinor("19.99")).toBe(1999);
    expect(parseBirrToMinor("1.234")).toBeNull();
    expect(parseBirrToMinor("abc")).toBeNull();
  });
  it("formats", () => {
    expect(formatMoney(1250050, "en")).toBe("ETB 12,500.50");
    expect(formatMoney(1250050, "am")).toBe("12,500.50 ብር");
    expect(formatMoney(-5, "en")).toBe("ETB -0.05");
  });
});

describe("rent schedule", () => {
  it("generates 12 monthly charges across the year boundary", () => {
    const charges = generateRentSchedule({ startDate: "2026-11-01", endDate: "2027-10-31", rentMinor: 3000000, frequency: "MONTHLY" });
    expect(charges).toHaveLength(12);
    expect(charges[0]).toEqual({ periodStart: "2026-11-01", periodEnd: "2026-11-30", dueDate: "2026-11-01", amountMinor: 3000000 });
    expect(charges[2].dueDate).toBe("2027-01-01");
    expect(charges[11]).toMatchObject({ periodStart: "2027-10-01", periodEnd: "2027-10-31" });
    expect(charges.every((c) => c.amountMinor === 3000000)).toBe(true);
  });
  it("handles quarterly and a prorated final period", () => {
    const charges = generateRentSchedule({ startDate: "2026-01-15", endDate: "2026-08-14", rentMinor: 900000, frequency: "QUARTERLY" });
    expect(charges.map((c) => c.periodStart)).toEqual(["2026-01-15", "2026-04-15", "2026-07-15"]);
    expect(charges[2].periodEnd).toBe("2026-08-14");
    // 31 of 92 days of the third quarter (15 Jul to 14 Oct)
    expect(charges[2].amountMinor).toBe(Math.round((900000 * 31) / 92));
  });
});

describe("payment allocation", () => {
  const charges = [
    { id: "b", dueDate: "2026-02-01", amountMinor: 1000, paidMinor: 0, status: "DUE" as const },
    { id: "a", dueDate: "2026-01-01", amountMinor: 1000, paidMinor: 0, status: "OVERDUE" as const },
    { id: "c", dueDate: "2026-03-01", amountMinor: 1000, paidMinor: 0, status: "WAIVED" as const },
  ];
  it("pays the oldest first; 1.5 months makes one paid and one partial", () => {
    expect(allocatePayment(charges, 1500)).toEqual({
      allocations: [
        { chargeId: "a", amountMinor: 1000 },
        { chargeId: "b", amountMinor: 500 },
      ],
      remainderMinor: 0,
    });
  });
  it("keeps overpayment as credit and skips waived charges", () => {
    expect(allocatePayment(charges, 2500).remainderMinor).toBe(500);
  });
  it("computes charge status", () => {
    expect(chargeStatusFor({ amountMinor: 10, paidMinor: 10, dueDate: "2026-01-01" }, "2026-05-01")).toBe("PAID");
    expect(chargeStatusFor({ amountMinor: 10, paidMinor: 5, dueDate: "2026-01-01" }, "2026-05-01")).toBe("PARTIAL");
    expect(chargeStatusFor({ amountMinor: 10, paidMinor: 0, dueDate: "2026-01-01" }, "2026-05-01")).toBe("OVERDUE");
    expect(chargeStatusFor({ amountMinor: 10, paidMinor: 0, dueDate: "2026-05-01" }, "2026-05-01")).toBe("DUE");
  });
});

describe("memberships", () => {
  it("computes end dates, renewals and freezes", () => {
    expect(membershipEndDate("2026-01-31", 1)).toBe("2026-02-27");
    expect(membershipEndDate("2026-01-01", 12)).toBe("2026-12-31");
    expect(renewalStartDate("2026-05-31", "2026-05-20")).toBe("2026-06-01");
    expect(renewalStartDate("2026-05-31", "2026-05-31")).toBe("2026-06-01");
    expect(renewalStartDate("2026-05-10", "2026-05-20")).toBe("2026-05-20");
    expect(renewalStartDate(null, "2026-05-20")).toBe("2026-05-20");
    expect(endDateAfterFreeze("2026-06-30", "2026-06-01", "2026-06-10")).toBe("2026-07-10");
    expect(rangesOverlap("2026-01-01", "2026-01-10", "2026-01-10", "2026-01-20")).toBe(true);
    expect(rangesOverlap("2026-01-01", "2026-01-10", "2026-01-11", "2026-01-20")).toBe(false);
  });
});

describe("status rules", () => {
  it("allows only the defined forward lead moves", () => {
    for (const from of LEAD_STATUSES) {
      for (const to of LEAD_STATUSES) {
        const result = canMoveLead(from, to, false);
        expect(result.ok).toBe(LEAD_FORWARD_MOVES[from].includes(to));
      }
    }
  });
  it("lets only managers move a lead back", () => {
    expect(canMoveLead("OFFER", "VIEWING", false)).toEqual({ ok: false, code: "MANAGER_ONLY" });
    expect(canMoveLead("OFFER", "VIEWING", true)).toEqual({ ok: true });
    expect(canMoveLead("LOST", "INQUIRY", true)).toEqual({ ok: true });
    expect(canMoveLead("INQUIRY", "SIGNED", true)).toEqual({ ok: false, code: "ILLEGAL_MOVE" });
  });
  it("enforces unit moves", () => {
    expect(canMoveUnit("AVAILABLE", "RESERVED", false).ok).toBe(true);
    expect(canMoveUnit("AVAILABLE", "SOLD", false)).toEqual({ ok: false, code: "MANAGER_ONLY" });
    expect(canMoveUnit("AVAILABLE", "SOLD", true).ok).toBe(true);
    expect(canMoveUnit("RESERVED", "SOLD", false).ok).toBe(true);
    expect(canMoveUnit("SOLD", "AVAILABLE", true).ok).toBe(false);
    expect(canMoveUnit("LEASED", "AVAILABLE", true).ok).toBe(false);
    expect(canMoveUnit("LEASED", "AVAILABLE", true, "LEASE").ok).toBe(true);
  });
  it("enforces maintenance moves", () => {
    expect(canMoveMaintenance("NEW", "ASSIGNED")).toBe(true);
    expect(canMoveMaintenance("NEW", "DONE")).toBe(false);
    expect(canMoveMaintenance("IN_PROGRESS", "DONE")).toBe(true);
    expect(canMoveMaintenance("DONE", "NEW")).toBe(false);
  });
});

describe("schemas", () => {
  it("requires a reason to mark a lead lost", () => {
    expect(leadStatusSchema.safeParse({ status: "LOST" }).success).toBe(false);
    expect(leadStatusSchema.safeParse({ status: "LOST", lostReason: "Bought elsewhere" }).success).toBe(true);
  });
  it("requires a cost to finish maintenance, zero allowed", () => {
    expect(maintenanceStatusSchema.safeParse({ status: "DONE" }).success).toBe(false);
    expect(maintenanceStatusSchema.safeParse({ status: "DONE", costMinor: 0 }).success).toBe(true);
  });
  it("rejects a filled honeypot and normalizes phone", () => {
    expect(publicInquirySchema.safeParse({ name: "A", phone: "0911234567", website: "spam" }).success).toBe(false);
    const ok = publicInquirySchema.parse({ name: "A", phone: "0911234567" });
    expect(ok.phone).toBe("+251911234567");
  });
  it("needs either payment or a complimentary reason", () => {
    const planId = "4b0b7d1c-2c1e-4f55-9d0a-0d9a3c1d7e11";
    expect(sellMembershipSchema.safeParse({ planId }).success).toBe(false);
    expect(sellMembershipSchema.safeParse({ planId, complimentaryReason: "Staff" }).success).toBe(true);
    expect(sellMembershipSchema.safeParse({ planId, payment: { amountMinor: 100, method: "CASH" } }).success).toBe(true);
  });
});
