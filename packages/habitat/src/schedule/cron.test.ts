import { describe, it, expect } from "vitest";
import { parseCron, cronMatches } from "./cron.js";

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
