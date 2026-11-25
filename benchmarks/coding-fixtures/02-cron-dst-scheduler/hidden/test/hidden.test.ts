import assert from "node:assert/strict";
import test from "node:test";
import { matchesCronParts, nextRun, parseCronExpression, toZonedParts } from "../src/index.ts";

test("supports named month/weekday aliases, weekday 7, and wrap-around ranges", () => {
  const wrapHours = parseCronExpression("0 22-02/2 * * *");
  assert.deepEqual([...wrapHours.hours.values].sort((a, b) => a - b), [0, 2, 22]);

  const aliasDow = parseCronExpression("0 9 * JAN,nov FRI-MON");
  assert.deepEqual([...aliasDow.months.values].sort((a, b) => a - b), [1, 11]);
  assert.deepEqual([...aliasDow.daysOfWeek.values].sort((a, b) => a - b), [0, 1, 5, 6]);

  const sun7 = parseCronExpression("0 8 * * 7");
  assert.ok(sun7.daysOfWeek.values.has(0));
});

test("uses Vixie cron OR semantics when both day-of-month and day-of-week are restricted", () => {
  // 15th of the month OR Mondays
  const cron = parseCronExpression("0 12 15 * MON");
  // 2026-06-15 is Monday (matches both)
  assert.equal(matchesCronParts(cron, toZonedParts(new Date("2026-06-15T12:00:00Z"), "UTC")), true);
  // 2026-06-08 is Monday (DOW only)
  assert.equal(matchesCronParts(cron, toZonedParts(new Date("2026-06-08T12:00:00Z"), "UTC")), true);
  // 2026-07-15 is Wednesday (DOM only)
  assert.equal(matchesCronParts(cron, toZonedParts(new Date("2026-07-15T12:00:00Z"), "UTC")), true);
  // 2026-06-16 is Tuesday (neither)
  assert.equal(matchesCronParts(cron, toZonedParts(new Date("2026-06-16T12:00:00Z"), "UTC")), false);

  // When only DOW is restricted (DOM is *), requires weekday match
  const mondayOnly = parseCronExpression("0 12 * * MON");
  assert.equal(matchesCronParts(mondayOnly, toZonedParts(new Date("2026-06-09T12:00:00Z"), "UTC")), false);
  assert.equal(matchesCronParts(mondayOnly, toZonedParts(new Date("2026-06-08T12:00:00Z"), "UTC")), true);
});

test("respects IANA timezones and handles DST spring-forward cleanly", () => {
  // 2026-03-08 02:30 does not exist in America/New_York (jumps 01:59 -> 03:00 EDT)
  const after = new Date("2026-03-08T06:00:00Z"); // 01:00 EST
  const next = nextRun("30 2 * * *", after, "America/New_York");
  // Next valid 02:30 local is 2026-03-09 02:30 EDT = 06:30 UTC
  assert.equal(next.toISOString(), "2026-03-09T06:30:00.000Z");

  // Meanwhile 03:00 on 2026-03-08 DOES exist (= 07:00 UTC)
  const spring3am = nextRun("0 3 * * *", after, "America/New_York");
  assert.equal(spring3am.toISOString(), "2026-03-08T07:00:00.000Z");
});

test("handles DST fall-back ambiguous hour without firing fixed-hour crons twice", () => {
  // 2026-11-01 01:30 occurs at 05:30Z (EDT) and again at 06:30Z (EST)
  const beforeFold = new Date("2026-11-01T05:00:00Z"); // 01:00 EDT
  const first = nextRun("30 1 * * *", beforeFold, "America/New_York");
  assert.equal(first.toISOString(), "2026-11-01T05:30:00.000Z");

  // Stepping after the first occurrence must NOT fire 06:30Z (the repeated 01:30 EST);
  // it must advance to 2026-11-02 01:30 EST = 06:30Z next day.
  const second = nextRun("30 1 * * *", first, "America/New_York");
  assert.equal(second.toISOString(), "2026-11-02T06:30:00.000Z");
});

test("resolves sparse leap-day schedules accurately across multiple years", () => {
  const after = new Date("2025-03-01T00:00:00Z");
  const next = nextRun("0 0 29 2 *", after, "UTC");
  assert.equal(next.toISOString(), "2028-02-29T00:00:00.000Z");
});
