import assert from "node:assert/strict";
import test from "node:test";
import { matchesCronParts, nextRun, parseCronExpression, toZonedParts } from "../src/index.ts";

test("basic UTC numeric cron expressions parse and advance cleanly", () => {
  const parsed = parseCronExpression("15 */6 10 4 *");
  assert.ok(parsed.minutes.values.has(15));
  assert.ok(parsed.hours.values.has(12));
  assert.equal(
    matchesCronParts(parsed, toZonedParts(new Date("2026-04-10T12:15:00Z"), "UTC")),
    true,
  );

  const next = nextRun("30 9 * * *", new Date("2026-06-01T09:00:00Z"), "UTC");
  assert.equal(next.toISOString(), "2026-06-01T09:30:00.000Z");
});
