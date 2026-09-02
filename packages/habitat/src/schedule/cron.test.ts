import { describe, it, expect } from "vitest";
import { parseCron, cronMatches, nextCronDate } from "./cron.js";

const at = (iso: string) => new Date(iso);

describe("parseCron", () => {
  it("rejects wrong field counts and out-of-range values", () => {
    expect(() => parseCron("* * * *")).toThrow(/5 fields/);
    expect(() => parseCron("60 * * * *")).toThrow(/out of range/);
    expect(() => parseCron("*/0 * * * *")).toThrow(/step/);
  });
});

describe("cronMatches", () => {
  it("*/30 fires at :00 and :30, not :15", () => {
    const c = parseCron("*/30 * * * *");
    expect(cronMatches(c, at("2026-07-13T10:00:00Z"))).toBe(true);
    expect(cronMatches(c, at("2026-07-13T10:30:00Z"))).toBe(true);
    expect(cronMatches(c, at("2026-07-13T10:15:00Z"))).toBe(false);
  });
  it("0 12 * * * fires only at noon UTC", () => {
    const c = parseCron("0 12 * * *");
    expect(cronMatches(c, at("2026-07-13T12:00:00Z"))).toBe(true);
    expect(cronMatches(c, at("2026-07-13T12:01:00Z"))).toBe(false);
    expect(cronMatches(c, at("2026-07-13T13:00:00Z"))).toBe(false);
  });
  it("lists, ranges, and day-of-week (Sunday 0==7)", () => {
    expect(cronMatches(parseCron("0,30 * * * *"), at("2026-07-13T09:30:00Z"))).toBe(true);
    expect(cronMatches(parseCron("0 9-17 * * *"), at("2026-07-13T14:00:00Z"))).toBe(true);
    expect(cronMatches(parseCron("0 9-17 * * *"), at("2026-07-13T18:00:00Z"))).toBe(false);
    // 2026-07-12 is a Sunday
    expect(cronMatches(parseCron("0 0 * * 7"), at("2026-07-12T00:00:00Z"))).toBe(true);
    expect(cronMatches(parseCron("0 0 * * 0"), at("2026-07-12T00:00:00Z"))).toBe(true);
  });
});

describe("nextCronDate", () => {
  it("finds the next matching UTC minute", () => {
    expect(
      nextCronDate(
        parseCron("*/30 9-17 * * 1-5"),
        at("2026-07-13T10:03:12Z"),
      )?.toISOString(),
    ).toBe("2026-07-13T10:30:00.000Z");
  });

  it("crosses years and leap days without scanning every minute", () => {
    expect(
      nextCronDate(parseCron("0 0 29 2 *"), at("2027-03-01T00:00:00Z"))?.toISOString(),
    ).toBe("2028-02-29T00:00:00.000Z");
  });

  it("returns null for an impossible calendar expression", () => {
    expect(nextCronDate(parseCron("0 0 30 2 *"), at("2026-01-01T00:00:00Z"))).toBeNull();
  });
});
