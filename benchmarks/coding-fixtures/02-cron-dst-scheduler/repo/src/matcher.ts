import type { ParsedCron, ZonedParts } from "./types.ts";

export function matchesCronParts(cron: ParsedCron, parts: ZonedParts): boolean {
  if (!cron.minutes.values.has(parts.minute)) return false;
  if (!cron.hours.values.has(parts.hour)) return false;
  if (!cron.months.values.has(parts.month)) return false;

  const domMatch = cron.daysOfMonth.values.has(parts.day);
  const dowMatch = cron.daysOfWeek.values.has(parts.weekday);

  // BUG: always applies AND even when both day-of-month and day-of-week are restricted
  return domMatch && dowMatch;
}
