import type { ZonedParts } from "./types.ts";

export function toZonedParts(date: Date, timeZone: string = "UTC"): ZonedParts {
  // BUG: ignores requested IANA timezone and returns UTC components
  void timeZone;
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    weekday: date.getUTCDay(),
  };
}
