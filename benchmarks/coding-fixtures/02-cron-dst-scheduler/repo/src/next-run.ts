import { matchesCronParts } from "./matcher.ts";
import { parseCronExpression } from "./parser.ts";
import { toZonedParts } from "./timezone.ts";
import type { ParsedCron } from "./types.ts";

const MS_PER_MINUTE = 60_000;

export function nextRun(
  expression: string,
  after: Date,
  timeZone: string = "UTC",
): Date {
  const cron: ParsedCron = parseCronExpression(expression);
  const startMs = Math.floor(after.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE;

  // BUG: only scans ~14 months minute-by-minute (fails on leap-day schedules and doesn't handle DST folds)
  const maxMinutes = 400 * 24 * 60;
  for (let i = 0; i < maxMinutes; i++) {
    const candidate = new Date(startMs + i * MS_PER_MINUTE);
    const parts = toZonedParts(candidate, timeZone);
    if (matchesCronParts(cron, parts)) {
      return candidate;
    }
  }

  throw new Error(`No next run found within search horizon for "${expression}"`);
}
