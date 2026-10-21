import {
  addDays,
  addMonths,
  addisDateString,
  addisInstant,
  daysInEthiopianMonth,
  diffDays,
  formatDate,
  fromEthiopian,
  isEthiopianLeapYear,
  isQuietHours,
  isValidDateString,
  nextAllowedSendTime,
  toEthiopian,
} from "./dates";

/**
 * Known date pairs from independent sources (not computed by this module):
 * - Ethiopian millennium, Meskerem 1, 2000 = 12 September 2007 (New Year falls on 12 Sept before a Gregorian leap year)
 * - Battle of Adwa, Yekatit 23, 1888 = 1 March 1896
 * - Ethiopian New Year 2019 = 11 September 2026; 2016 = 12 September 2023; 2017 = 11 September 2024
 * - Pagume 6, 2015 = 11 September 2023 (2015 is a leap year: year % 4 == 3)
 * - Pagume 5, 2016 = 10 September 2024
 * - Genna (Christmas) is 7 January: Tahsas 28, 2016 (7 Jan 2024) and Tahsas 29, 2017 (7 Jan 2025)
 * - Timket (Epiphany) Tir 11, 2017 = 19 January 2025
 * - Gregorian leap day 29 Feb 2024 = Yekatit 21, 2016
 */
const KNOWN: Array<[string, [number, number, number]]> = [
  ["2007-09-12", [2000, 1, 1]],
  ["1896-03-01", [1888, 6, 23]],
  ["2026-09-11", [2019, 1, 1]],
  ["2023-09-12", [2016, 1, 1]],
  ["2024-09-11", [2017, 1, 1]],
  ["2023-09-11", [2015, 13, 6]],
  ["2024-09-10", [2016, 13, 5]],
  ["2024-01-07", [2016, 4, 28]],
  ["2025-01-07", [2017, 4, 29]],
  ["2025-01-19", [2017, 5, 11]],
  ["2024-02-29", [2016, 6, 21]],
  ["2026-10-22", [2019, 2, 12]],
];

describe("Ethiopian calendar", () => {
  it.each(KNOWN)("%s is %j in the Ethiopian calendar", (gregorian, [y, m, d]) => {
    expect(toEthiopian(gregorian)).toEqual({ year: y, month: m, day: d });
    expect(fromEthiopian(y, m, d)).toBe(gregorian);
  });

  it("knows leap years and Pagume length", () => {
    expect(isEthiopianLeapYear(2015)).toBe(true);
    expect(isEthiopianLeapYear(2016)).toBe(false);
    expect(daysInEthiopianMonth(2015, 13)).toBe(6);
    expect(daysInEthiopianMonth(2016, 13)).toBe(5);
    expect(daysInEthiopianMonth(2016, 1)).toBe(30);
    expect(() => fromEthiopian(2016, 13, 6)).toThrow(RangeError);
  });

  it("round-trips every day for 30 years", () => {
    let date = "2000-01-01";
    for (let i = 0; i < 365 * 30; i += 1) {
      const e = toEthiopian(date);
      expect(fromEthiopian(e.year, e.month, e.day)).toBe(date);
      date = addDays(date, 1);
    }
  });

  it("formats in both languages", () => {
    expect(formatDate("2026-10-22", "en")).toBe("12 Tikimt 2019 (22 Oct 2026)");
    expect(formatDate("2026-10-22", "am")).toBe("ጥቅምት 12 2019 ዓ.ም. (22 Oct 2026)");
  });
});

describe("Addis Ababa time", () => {
  it("uses UTC+3 regardless of the machine time zone", () => {
    // 22:30 UTC on 21 Oct is 01:30 on 22 Oct in Addis Ababa.
    expect(addisDateString(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-22");
    expect(addisDateString(new Date("2026-10-21T20:59:59Z"))).toBe("2026-10-21");
    expect(addisInstant("2026-10-22", 9, 30).toISOString()).toBe("2026-10-22T06:30:00.000Z");
  });

  it("applies quiet hours from 20:00 to 07:00", () => {
    expect(isQuietHours(addisInstant("2026-10-22", 19, 59))).toBe(false);
    expect(isQuietHours(addisInstant("2026-10-22", 20, 0))).toBe(true);
    expect(isQuietHours(addisInstant("2026-10-22", 6, 59))).toBe(true);
    expect(isQuietHours(addisInstant("2026-10-22", 7, 0))).toBe(false);
    expect(nextAllowedSendTime(addisInstant("2026-10-22", 21, 15)).toISOString()).toBe(addisInstant("2026-10-23", 7).toISOString());
    expect(nextAllowedSendTime(addisInstant("2026-10-22", 5, 0)).toISOString()).toBe(addisInstant("2026-10-22", 7).toISOString());
  });
});

describe("date strings", () => {
  it("validates and does arithmetic", () => {
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2024-02-29")).toBe(true);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-01-01", "2026-12-31")).toBe(364);
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2026-11-15", 2)).toBe("2027-01-15");
    expect(addMonths("2026-03-15", -3)).toBe("2025-12-15");
  });
});
