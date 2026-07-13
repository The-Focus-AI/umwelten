// Minimal 5-field cron matcher (minute hour day-of-month month day-of-week),
// dependency-free. Supports `*`, numbers, lists (a,b), ranges (a-b), and steps
// (*/n, a-b/n). Day-of-week: 0-6, Sunday = 0 (7 also accepted as Sunday).
//
// Enough for the habitat scheduler's needs (`*/30 * * * *`, `0 12 * * *`).
// Not supported (throws on parse): names (JAN/MON), `?`, `L`, `W`, `#`, `@`
// macros. Match granularity is one minute — the scheduler ticks per minute.

type Field = { min: number; max: number };
const FIELDS: Field[] = [
  { min: 0, max: 59 }, // minute
  { min: 0, max: 23 }, // hour
  { min: 1, max: 31 }, // day of month
  { min: 1, max: 12 }, // month
  { min: 0, max: 6 }, // day of week
];

export type CronExpr = {
  /** For each of the 5 fields, the exact set of allowed values. */
  sets: Set<number>[];
};

export function parseCron(expr: string): CronExpr {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`cron must have 5 fields, got ${parts.length}: "${expr}"`);
  }
  const sets = parts.map((part, i) => parseField(part, FIELDS[i]));
  return { sets };
}

function parseField(part: string, field: Field): Set<number> {
  const out = new Set<number>();
  for (const chunk of part.split(",")) {
    let range = chunk;
    let step = 1;
    const slash = chunk.indexOf("/");
    if (slash !== -1) {
      range = chunk.slice(0, slash);
      step = Number(chunk.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) {
        throw new Error(`invalid step in "${chunk}"`);
      }
    }
    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = field.min;
      hi = field.max;
    } else {
      const dash = range.indexOf("-");
      if (dash !== -1) {
        lo = Number(range.slice(0, dash));
        hi = Number(range.slice(dash + 1));
      } else {
        lo = hi = Number(range);
      }
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error(`invalid cron range in "${chunk}"`);
    }
    // Day-of-week 7 == Sunday == 0.
    if (field.max === 6) {
      if (lo === 7) lo = 0;
      if (hi === 7) hi = 0;
    }
    if (lo < field.min || hi > field.max || lo > hi) {
      throw new Error(`cron value out of range in "${chunk}"`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

/** True iff `date` (its minute) matches the expression. */
export function cronMatches(cron: CronExpr, date: Date): boolean {
  const [min, hr, dom, mon, dow] = cron.sets;
  return (
    min.has(date.getUTCMinutes()) &&
    hr.has(date.getUTCHours()) &&
    dom.has(date.getUTCDate()) &&
    mon.has(date.getUTCMonth() + 1) &&
    dow.has(date.getUTCDay())
  );
}
