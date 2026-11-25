import type { CronFieldSet, ParsedCron } from "./types.ts";

function parseFieldToken(
  token: string,
  min: number,
  max: number,
  normalizeValue?: (v: number) => number,
): number[] {
  const [rangePart, stepPart] = token.split("/");
  const step = stepPart !== undefined ? Number(stepPart) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid step in cron token "${token}"`);
  }

  if (rangePart === "*") {
    const out: number[] = [];
    for (let v = min; v <= max; v += step) {
      out.push(normalizeValue ? normalizeValue(v) : v);
    }
    return out;
  }

  if (rangePart.includes("-")) {
    const [rawStart, rawEnd] = rangePart.split("-");
    const start = Number(rawStart);
    const end = Number(rawEnd);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < min ||
      end > max ||
      start > end
    ) {
      // BUG: rejects named aliases and wrap-around ranges like 22-02 or FRI-MON
      throw new Error(`Invalid range in cron token "${token}"`);
    }
    const out: number[] = [];
    for (let v = start; v <= end; v += step) {
      out.push(normalizeValue ? normalizeValue(v) : v);
    }
    return out;
  }

  const single = Number(rangePart);
  if (!Number.isInteger(single) || single < min || single > max) {
    throw new Error(`Invalid number in cron token "${token}"`);
  }
  return [normalizeValue ? normalizeValue(single) : single];
}

function parseField(
  raw: string,
  min: number,
  max: number,
  normalizeValue?: (v: number) => number,
): CronFieldSet {
  const trimmed = raw.trim();
  const isWildcard = trimmed === "*";
  const values = new Set<number>();
  for (const part of trimmed.split(",")) {
    for (const v of parseFieldToken(part.trim(), min, max, normalizeValue)) {
      values.add(v);
    }
  }
  return { values, isWildcard };
}

export function parseCronExpression(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Expected 5 cron fields, got "${expr}"`);
  }
  const [minRaw, hourRaw, domRaw, monthRaw, dowRaw] = fields;
  return {
    expression: expr.trim(),
    minutes: parseField(minRaw, 0, 59),
    hours: parseField(hourRaw, 0, 23),
    daysOfMonth: parseField(domRaw, 1, 31),
    months: parseField(monthRaw, 1, 12),
    daysOfWeek: parseField(dowRaw, 0, 7, (v) => (v === 7 ? 0 : v)),
  };
}
