/**
 * Ethiopian calendar and Addis Ababa date helpers.
 *
 * Conversion uses Julian Day Numbers (JDN). The Ethiopian (Amete Mihret) epoch used here is JDN 1723856,
 * the standard value used by published converters. Verified against independent historical dates in dates.test.ts
 * (Ethiopian millennium, the battle of Adwa, Genna and Timket dates, Pagume 5 and 6).
 *
 * Date-only values (due dates, lease dates, membership dates) are handled as "YYYY-MM-DD" strings so that
 * no machine time zone can shift them. Instants are JavaScript Date objects in UTC.
 * Addis Ababa is UTC+3 all year (no daylight saving time).
 */
import type { Locale } from "./enums";

export const ADDIS_OFFSET_MINUTES = 180;
const ETHIOPIAN_EPOCH_JDN = 1723856;

export interface YMD {
  year: number;
  month: number;
  day: number;
}

export const ETHIOPIAN_MONTHS_EN = [
  "Meskerem", "Tikimt", "Hidar", "Tahsas", "Tir", "Yekatit", "Megabit",
  "Miyazya", "Ginbot", "Sene", "Hamle", "Nehase", "Pagume",
] as const;

export const ETHIOPIAN_MONTHS_AM = [
  "መስከረም", "ጥቅምት", "ኅዳር", "ታኅሣሥ", "ጥር", "የካቲት", "መጋቢት",
  "ሚያዝያ", "ግንቦት", "ሰኔ", "ሐምሌ", "ነሐሴ", "ጳጉሜ",
] as const;

const GREGORIAN_MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function gregorianToJdn({ year, month, day }: YMD): number {
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
}

export function jdnToGregorian(jdn: number): YMD {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    day: e - Math.floor((153 * m + 2) / 5) + 1,
    month: m + 3 - 12 * Math.floor(m / 10),
    year: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

export function isEthiopianLeapYear(year: number): boolean {
  return year % 4 === 3;
}

export function daysInEthiopianMonth(year: number, month: number): number {
  if (month < 1 || month > 13) throw new RangeError(`Ethiopian month must be 1-13, got ${month}`);
  if (month <= 12) return 30;
  return isEthiopianLeapYear(year) ? 6 : 5;
}

export function ethiopianToJdn({ year, month, day }: YMD): number {
  if (day < 1 || day > daysInEthiopianMonth(year, month)) {
    throw new RangeError(`Invalid Ethiopian date ${year}-${month}-${day}`);
  }
  return ETHIOPIAN_EPOCH_JDN + 365 + 365 * (year - 1) + Math.floor(year / 4) + 30 * month + day - 31;
}

export function jdnToEthiopian(jdn: number): YMD {
  const r = (jdn - ETHIOPIAN_EPOCH_JDN) % 1461;
  const n = (r % 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * Math.floor((jdn - ETHIOPIAN_EPOCH_JDN) / 1461) + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: (n % 30) + 1,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function ymdToString({ year, month, day }: YMD): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export function parseDateString(value: string): YMD {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`Expected YYYY-MM-DD, got "${value}"`);
  const ymd = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  // Round-trip through JDN to reject impossible dates such as 2026-02-30.
  if (ymdToString(jdnToGregorian(gregorianToJdn(ymd))) !== value) throw new RangeError(`Invalid date "${value}"`);
  return ymd;
}

export function isValidDateString(value: string): boolean {
  try {
    parseDateString(value);
    return true;
  } catch {
    return false;
  }
}

/** The calendar date in Addis Ababa for an instant. Independent of the machine time zone. */
export function addisDateString(instant: Date): string {
  const shifted = new Date(instant.getTime() + ADDIS_OFFSET_MINUTES * 60_000);
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Hour of day (0-23) in Addis Ababa. */
export function addisHour(instant: Date): number {
  return new Date(instant.getTime() + ADDIS_OFFSET_MINUTES * 60_000).getUTCHours();
}

/** The instant of local midnight in Addis Ababa at the start of a date string. */
export function addisStartOfDay(date: string): Date {
  const { year, month, day } = parseDateString(date);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - ADDIS_OFFSET_MINUTES * 60_000);
}

/** An instant at a local Addis time on a date, for example 09:30 on 2026-10-22. */
export function addisInstant(date: string, hours: number, minutes = 0): Date {
  return new Date(addisStartOfDay(date).getTime() + (hours * 60 + minutes) * 60_000);
}

export function addDays(date: string, days: number): string {
  return ymdToString(jdnToGregorian(gregorianToJdn(parseDateString(date)) + days));
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return gregorianToJdn(parseDateString(b)) - gregorianToJdn(parseDateString(a));
}

/** Adds calendar months; the day is clamped to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number): string {
  const { year, month, day } = parseDateString(date);
  const total = year * 12 + (month - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = jdnToGregorian(gregorianToJdn({ year: tm === 12 ? ty + 1 : ty, month: tm === 12 ? 1 : tm + 1, day: 1 }) - 1).day;
  return ymdToString({ year: ty, month: tm, day: Math.min(day, lastDay) });
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function toEthiopian(input: Date | string): YMD {
  const date = typeof input === "string" ? input : addisDateString(input);
  return jdnToEthiopian(gregorianToJdn(parseDateString(date)));
}

/** Gregorian "YYYY-MM-DD" for an Ethiopian date. */
export function fromEthiopian(year: number, month: number, day: number): string {
  return ymdToString(jdnToGregorian(ethiopianToJdn({ year, month, day })));
}

export function formatEthiopian(ymd: YMD, locale: Locale): string {
  if (locale === "am") return `${ETHIOPIAN_MONTHS_AM[ymd.month - 1]} ${ymd.day} ${ymd.year} ዓ.ም.`;
  return `${ymd.day} ${ETHIOPIAN_MONTHS_EN[ymd.month - 1]} ${ymd.year}`;
}

export function formatGregorian(date: string): string {
  const { year, month, day } = parseDateString(date);
  return `${day} ${GREGORIAN_MONTHS_EN[month - 1]} ${year}`;
}

/** "12 Tikimt 2019 (22 Oct 2026)" in English, "ጥቅምት 12 2019 ዓ.ም. (22 Oct 2026)" in Amharic. */
export function formatDate(input: Date | string, locale: Locale): string {
  const date = typeof input === "string" ? input : addisDateString(input);
  return `${formatEthiopian(toEthiopian(date), locale)} (${formatGregorian(date)})`;
}

/** Date and Addis local time, for example "12 Tikimt 2019 (22 Oct 2026) 14:05". */
export function formatDateTime(instant: Date, locale: Locale): string {
  const shifted = new Date(instant.getTime() + ADDIS_OFFSET_MINUTES * 60_000);
  return `${formatDate(instant, locale)} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** Customer messages are not sent between 20:00 and 07:00 Addis Ababa time. */
export const QUIET_HOURS = { startHour: 20, endHour: 7 } as const;

export function isQuietHours(instant: Date): boolean {
  const h = addisHour(instant);
  return h >= QUIET_HOURS.startHour || h < QUIET_HOURS.endHour;
}

/** The next instant at which a customer message may be sent (the same instant if allowed now). */
export function nextAllowedSendTime(instant: Date): Date {
  if (!isQuietHours(instant)) return instant;
  const today = addisDateString(instant);
  const h = addisHour(instant);
  const day = h >= QUIET_HOURS.startHour ? addDays(today, 1) : today;
  return addisInstant(day, QUIET_HOURS.endHour, 0);
}
