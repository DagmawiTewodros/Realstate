import type { Locale } from "./enums";

/** Money is always an integer number of santim (1 birr = 100 santim). */
export function assertMinor(value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Money must be an integer number of santim, got ${value}`);
}

/** Parses "12,500.50" or "12500" (birr) into santim. Returns null for invalid input or more than 2 decimals. */
export function parseBirrToMinor(input: string): number | null {
  const cleaned = input.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) return null;
  return negative ? -minor : minor;
}

/** "ETB 12,500.50" in English, "12,500.50 ብር" in Amharic. */
export function formatMoney(minor: number, locale: Locale = "en"): string {
  assertMinor(minor);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = String(abs % 100).padStart(2, "0");
  const amount = `${negative ? "-" : ""}${whole}.${frac}`;
  return locale === "am" ? `${amount} ብር` : `ETB ${amount}`;
}
