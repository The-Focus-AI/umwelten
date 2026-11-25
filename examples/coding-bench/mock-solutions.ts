/**
 * Verified fixed-file overlays and scripted `fauxProvider` turns used ONLY in
 * `--mock` mode so `pnpm run bench:code -- --mock` exercises real `pi-durable`
 * `Harness`, real isolated git checkouts, real `CodingTools`, and real
 * `node --test` / `python3 -m unittest` grading across all 6 fixtures.
 */

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  formatModelSpecString,
  type ModelSpec,
  type ResolvedPiInvocationTarget,
} from "@umwelten/pi";
import type { MatrixModelEntry } from "../_shared/model-matrix.js";

export const MOCK_CODING_MODELS: MatrixModelEntry[] = [
  {
    provider: "anthropic",
    name: "claude-fable-5-2",
    weights: "closed",
    tier: "cloud",
    reasoningEffort: "high",
    enabled: true,
    costs: { promptTokens: 5.0, completionTokens: 25.0 },
  },
  {
    provider: "google",
    name: "gemini-4-hydrogen",
    weights: "closed",
    tier: "cloud",
    reasoningEffort: "low",
    enabled: true,
    costs: { promptTokens: 0.45, completionTokens: 2.0 },
  },
  {
    provider: "ollama",
    name: "inkling-2-mini:latest",
    weights: "open",
    tier: "local",
    reasoningEffort: "off",
    enabled: true,
    costs: { promptTokens: 0, completionTokens: 0 },
  },
];

// Clean root-cause fixes per taskId (keyed by relative path inside repo)
const FULL_FIXES: Record<string, Record<string, string>> = {
  "01-ledger-rounding": {
    "src/money.ts": `export interface Money {
  readonly minor: number;
  readonly currency: string;
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "CLP", "ISK", "PYG", "UGX", "RWF",
]);
const THREE_DECIMAL_CURRENCIES = new Set([
  "BHD", "JOD", "KWD", "OMR", "TND",
]);

export function currencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function fromMajor(amount: number, currency: string): Money {
  const code = currency.toUpperCase();
  const scale = 10 ** currencyDecimals(code);
  const absMinor = Math.round(Math.abs(amount) * scale + 1e-9);
  const minor = amount < 0 ? -absMinor : absMinor;
  return { minor: normalizeZero(minor), currency: code };
}

export function toMajor(m: Money): number {
  const scale = 10 ** currencyDecimals(m.currency);
  return normalizeZero(m.minor) / scale;
}

export function formatMoney(m: Money): string {
  const code = m.currency.toUpperCase();
  const decimals = currencyDecimals(code);
  const scale = 10 ** decimals;
  const val = (normalizeZero(m.minor) / scale).toFixed(decimals);
  return \`\${code} \${val}\`;
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
    throw new Error(\`Currency mismatch: \${a.currency} vs \${b.currency}\`);
  }
  return {
    minor: normalizeZero(a.minor + b.minor),
    currency: a.currency.toUpperCase(),
  };
}
`,
    "src/tax.ts": `import type { Money } from "./money.ts";

export function calculateTax(amount: Money, taxBps: number): Money {
  const code = amount.currency.toUpperCase();
  if (amount.minor === 0 || taxBps === 0) {
    return { minor: 0, currency: code };
  }
  const sign = (amount.minor < 0 ? -1 : 1) * (taxBps < 0 ? -1 : 1);
  const absNum = BigInt(Math.abs(amount.minor)) * BigInt(Math.abs(taxBps));
  const rounded = Number((absNum + 5000n) / 10000n);
  const minor = rounded === 0 ? 0 : sign * rounded;
  return { minor, currency: code };
}

export function addTax(amount: Money, taxBps: number): Money {
  const tax = calculateTax(amount, taxBps);
  return {
    minor: amount.minor + tax.minor === 0 ? 0 : amount.minor + tax.minor,
    currency: amount.currency.toUpperCase(),
  };
}
`,
    "src/split.ts": `import type { Money } from "./money.ts";

export function splitByWeights(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) throw new Error("weights must not be empty");
  if (weights.some((w) => w < 0 || !Number.isFinite(w))) {
    throw new Error("weights must be finite non-negative numbers");
  }
  const sumWeights = weights.reduce((acc, w) => acc + w, 0);
  if (sumWeights <= 0) throw new Error("sum of weights must be positive");

  const code = total.currency.toUpperCase();
  const sign = total.minor < 0 ? -1 : 1;
  const absTotal = Math.abs(total.minor);

  const scaled = weights.map((w, idx) => {
    const exact = (absTotal * w) / sumWeights;
    const base = Math.floor(exact + 1e-12);
    return { idx, base, rem: exact - base };
  });

  let remaining = absTotal - scaled.reduce((s, x) => s + x.base, 0);
  const order = [...scaled].sort((a, b) => b.rem - a.rem || a.idx - b.idx);
  for (let i = 0; i < remaining; i++) {
    order[i % order.length].base += 1;
  }

  return scaled.map((x) => ({
    minor: x.base === 0 ? 0 : sign * x.base,
    currency: code,
  }));
}
`,
    "src/invoice.ts": `import { fromMajor, type Money } from "./money.ts";
import { calculateTax } from "./tax.ts";

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPriceMajor: number;
}

export interface InvoiceOptions {
  currency: string;
  discountBps?: number;
  taxBps?: number;
}

export interface InvoiceSummary {
  currency: string;
  subtotal: Money;
  discount: Money;
  taxableSubtotal: Money;
  tax: Money;
  total: Money;
}

export function calculateInvoiceSummary(
  lines: readonly InvoiceLine[],
  options: InvoiceOptions,
): InvoiceSummary {
  const currency = options.currency.toUpperCase();
  let subtotalMinor = 0;
  for (const line of lines) {
    const unitMinor = fromMajor(line.unitPriceMajor, currency).minor;
    subtotalMinor += Math.round(line.quantity * unitMinor);
  }
  const subtotal: Money = { minor: subtotalMinor === 0 ? 0 : subtotalMinor, currency };
  const discount = calculateTax(subtotal, options.discountBps ?? 0);
  const taxableMinor = subtotal.minor - discount.minor;
  const taxableSubtotal: Money = { minor: taxableMinor === 0 ? 0 : taxableMinor, currency };
  const tax = calculateTax(taxableSubtotal, options.taxBps ?? 0);
  const totalMinor = taxableSubtotal.minor + tax.minor;
  const total: Money = { minor: totalMinor === 0 ? 0 : totalMinor, currency };
  return { currency, subtotal, discount, taxableSubtotal, tax, total };
}
`,
  },

  "02-cron-dst-scheduler": {
    "src/parser.ts": `import type { CronFieldSet, ParsedCron } from "./types.ts";

const MONTH_ALIASES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const DOW_ALIASES: Record<string, number> = {
  SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6,
};

function parseAtom(
  raw: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
): number {
  const up = raw.trim().toUpperCase();
  if (aliases && up in aliases) return aliases[up];
  const n = Number(up);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(\`Invalid cron value "\${raw}" (expected \${min}-\${max})\`);
  }
  return n;
}

function parseFieldToken(
  token: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
  normalizeValue?: (v: number) => number,
): number[] {
  const [rangePart, stepPart] = token.split("/");
  const step = stepPart !== undefined ? Number(stepPart) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(\`Invalid step in cron token "\${token}"\`);
  }

  const norm = (v: number) => (normalizeValue ? normalizeValue(v) : v);

  if (rangePart === "*") {
    const out: number[] = [];
    for (let v = min; v <= max; v += step) out.push(norm(v));
    return out;
  }

  if (rangePart.includes("-")) {
    const [rawStart, rawEnd] = rangePart.split("-");
    const start = parseAtom(rawStart, min, max, aliases);
    const end = parseAtom(rawEnd, min, max, aliases);
    const out: number[] = [];
    if (start <= end) {
      for (let v = start; v <= end; v += step) out.push(norm(v));
    } else {
      // Wrap-around (note weekday domain wraps over 0..6 rather than 7)
      const wrapMax = max === 7 ? 6 : max;
      const effStart = start === 7 ? 0 : start;
      const effEnd = end === 7 ? 0 : end;
      const seq: number[] = [];
      for (let v = effStart; v <= wrapMax; v++) seq.push(v);
      for (let v = min; v <= effEnd; v++) seq.push(v);
      for (let i = 0; i < seq.length; i += step) out.push(norm(seq[i]));
    }
    return out;
  }

  const single = parseAtom(rangePart, min, max, aliases);
  if (stepPart !== undefined) {
    const out: number[] = [];
    for (let v = single; v <= max; v += step) out.push(norm(v));
    return out;
  }
  return [norm(single)];
}

function parseField(
  raw: string,
  min: number,
  max: number,
  aliases?: Record<string, number>,
  normalizeValue?: (v: number) => number,
): CronFieldSet {
  const trimmed = raw.trim();
  const isWildcard = trimmed === "*";
  const values = new Set<number>();
  for (const part of trimmed.split(",")) {
    for (const v of parseFieldToken(part.trim(), min, max, aliases, normalizeValue)) {
      values.add(v);
    }
  }
  return { values, isWildcard };
}

export function parseCronExpression(expr: string): ParsedCron {
  const fields = expr.trim().split(/\\s+/);
  if (fields.length !== 5) {
    throw new Error(\`Expected 5 cron fields, got "\${expr}"\`);
  }
  const [minRaw, hourRaw, domRaw, monthRaw, dowRaw] = fields;
  return {
    expression: expr.trim(),
    minutes: parseField(minRaw, 0, 59),
    hours: parseField(hourRaw, 0, 23),
    daysOfMonth: parseField(domRaw, 1, 31),
    months: parseField(monthRaw, 1, 12, MONTH_ALIASES),
    daysOfWeek: parseField(dowRaw, 0, 7, DOW_ALIASES, (v) => (v === 7 ? 0 : v)),
  };
}
`,
    "src/timezone.ts": `import type { ZonedParts } from "./types.ts";

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = fmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    fmtCache.set(timeZone, fmt);
  }
  return fmt;
}

export function toZonedParts(date: Date, timeZone: string = "UTC"): ZonedParts {
  const parts = getFormatter(timeZone).formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let weekday = 0;

  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
    else if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "weekday") weekday = WEEKDAY_MAP[p.value] ?? 0;
  }
  return { year, month, day, hour, minute, weekday };
}
`,
    "src/matcher.ts": `import type { ParsedCron, ZonedParts } from "./types.ts";

export function matchesCronParts(cron: ParsedCron, parts: ZonedParts): boolean {
  if (!cron.minutes.values.has(parts.minute)) return false;
  if (!cron.hours.values.has(parts.hour)) return false;
  if (!cron.months.values.has(parts.month)) return false;

  const domMatch = cron.daysOfMonth.values.has(parts.day);
  const dowMatch = cron.daysOfWeek.values.has(parts.weekday);

  if (!cron.daysOfMonth.isWildcard && !cron.daysOfWeek.isWildcard) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}
`,
    "src/next-run.ts": `import { matchesCronParts } from "./matcher.ts";
import { parseCronExpression } from "./parser.ts";
import { toZonedParts } from "./timezone.ts";
import type { ParsedCron, ZonedParts } from "./types.ts";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

function sameMinuteWallClock(a: ZonedParts, b: ZonedParts): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

export function nextRun(
  expression: string,
  after: Date,
  timeZone: string = "UTC",
): Date {
  const cron: ParsedCron = parseCronExpression(expression);
  let ms = Math.floor(after.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE;
  // Jump up to 8 years (handles 4-year leap cycles cleanly while skipping non-matching days/hours)
  const limitMs = ms + 8 * 366 * 24 * MS_PER_HOUR;

  while (ms <= limitMs) {
    const candidate = new Date(ms);
    const parts = toZonedParts(candidate, timeZone);

    if (!cron.months.values.has(parts.month)) {
      ms += parts.minute !== 0
        ? (60 - parts.minute) * MS_PER_MINUTE
        : 12 * MS_PER_HOUR;
      continue;
    }

    const domMatch = cron.daysOfMonth.values.has(parts.day);
    const dowMatch = cron.daysOfWeek.values.has(parts.weekday);
    const dayMatches =
      !cron.daysOfMonth.isWildcard && !cron.daysOfWeek.isWildcard
        ? domMatch || dowMatch
        : domMatch && dowMatch;

    if (!dayMatches) {
      if (parts.minute !== 0) {
        ms += (60 - parts.minute) * MS_PER_MINUTE;
      } else {
        ms += parts.hour < 4 ? 12 * MS_PER_HOUR : MS_PER_HOUR;
      }
      continue;
    }

    if (!cron.hours.values.has(parts.hour)) {
      ms += (60 - parts.minute) * MS_PER_MINUTE;
      continue;
    }

    if (matchesCronParts(cron, parts)) {
      if (!cron.hours.isWildcard) {
        const oneHourEarlier = toZonedParts(new Date(ms - MS_PER_HOUR), timeZone);
        if (sameMinuteWallClock(parts, oneHourEarlier)) {
          ms += MS_PER_MINUTE;
          continue;
        }
      }
      return candidate;
    }

    ms += MS_PER_MINUTE;
  }

  throw new Error(\`No next run found within search horizon for "\${expression}"\`);
}
`,
  },

  "03-wal-kv-recovery": {
    "src/codec.ts": `import { crc32 } from "./crc.ts";

export type WalOp = "put" | "del";

export interface WalRecord {
  op: WalOp;
  seq: number;
  key: string;
  value: string | null;
}

const OP_PUT = 1;
const OP_DEL = 2;

export function encodeRecord(rec: WalRecord): Buffer {
  const keyBuf = Buffer.from(rec.key, "utf8");
  const valBuf = rec.value !== null ? Buffer.from(rec.value, "utf8") : Buffer.alloc(0);

  const payload = Buffer.allocUnsafe(13 + keyBuf.length + valBuf.length);
  payload.writeUInt8(rec.op === "put" ? OP_PUT : OP_DEL, 0);
  payload.writeUInt32BE(rec.seq, 1);
  payload.writeUInt32BE(keyBuf.length, 5);
  payload.writeUInt32BE(valBuf.length, 9);
  keyBuf.copy(payload, 13);
  valBuf.copy(payload, 13 + keyBuf.length);

  const checksum = crc32(payload);
  const frame = Buffer.allocUnsafe(payload.length + 4);
  payload.copy(frame, 0);
  frame.writeUInt32BE(checksum, payload.length);
  return frame;
}

export function decodeRecordAt(
  buf: Buffer,
  offset: number,
): { record: WalRecord; nextOffset: number } {
  if (offset + 17 > buf.length) {
    throw new Error(\`Truncated WAL header at offset \${offset}\`);
  }
  const opByte = buf.readUInt8(offset);
  const seq = buf.readUInt32BE(offset + 1);
  const keyLen = buf.readUInt32BE(offset + 5);
  const valLen = buf.readUInt32BE(offset + 9);
  const bodyLen = 13 + keyLen + valLen;
  const totalLen = bodyLen + 4;

  if (offset + totalLen > buf.length) {
    throw new Error(\`Truncated WAL body at offset \${offset}\`);
  }

  const payload = buf.subarray(offset, offset + bodyLen);
  const expectedCrc = buf.readUInt32BE(offset + bodyLen);
  const actualCrc = crc32(payload);
  if (expectedCrc !== actualCrc) {
    throw new Error(\`CRC mismatch at offset \${offset}\`);
  }
  if (opByte !== OP_PUT && opByte !== OP_DEL) {
    throw new Error(\`Unknown WAL op byte \${opByte} at offset \${offset}\`);
  }

  const key = buf.subarray(offset + 13, offset + 13 + keyLen).toString("utf8");
  const value =
    opByte === OP_PUT
      ? buf.subarray(offset + 13 + keyLen, offset + bodyLen).toString("utf8")
      : null;

  return {
    record: { op: opByte === OP_PUT ? "put" : "del", seq, key, value },
    nextOffset: offset + totalLen,
  };
}
`,
    "src/wal.ts": `import fs from "node:fs";
import path from "node:path";
import { decodeRecordAt, encodeRecord, type WalRecord } from "./codec.ts";

export function segmentFileName(index: number): string {
  return \`wal-\${String(index).padStart(4, "0")}.log\`;
}

export function listSegments(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^wal-\\d{4}\\.log$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

export function appendWalRecord(filePath: string, rec: WalRecord): void {
  fs.appendFileSync(filePath, encodeRecord(rec));
}

export function readWalSegment(
  filePath: string,
  options: { truncateCorruptTail?: boolean } = { truncateCorruptTail: true },
): {
  records: WalRecord[];
  validBytes: number;
  truncatedTail: boolean;
} {
  if (!fs.existsSync(filePath)) {
    return { records: [], validBytes: 0, truncatedTail: false };
  }
  const buf = fs.readFileSync(filePath);
  const records: WalRecord[] = [];
  let offset = 0;
  let truncatedTail = false;

  while (offset < buf.length) {
    try {
      const { record, nextOffset } = decodeRecordAt(buf, offset);
      records.push(record);
      offset = nextOffset;
    } catch {
      truncatedTail = true;
      break;
    }
  }

  if (truncatedTail && options.truncateCorruptTail !== false) {
    fs.truncateSync(filePath, offset);
  }

  return { records, validBytes: offset, truncatedTail };
}
`,
    "src/compactor.ts": `import fs from "node:fs";
import { encodeRecord, type WalRecord } from "./codec.ts";
import { readWalSegment } from "./wal.ts";

export function compactSegmentFiles(
  segmentPaths: readonly string[],
  targetPath: string,
  options: { preserveTombstones?: boolean } = {},
): WalRecord[] {
  const latestByKey = new Map<string, WalRecord>();
  for (const segPath of segmentPaths) {
    const { records } = readWalSegment(segPath);
    for (const rec of records) {
      const prev = latestByKey.get(rec.key);
      if (!prev || rec.seq >= prev.seq) {
        latestByKey.set(rec.key, rec);
      }
    }
  }

  const kept: WalRecord[] = [];
  for (const rec of latestByKey.values()) {
    if (rec.op === "del" && !options.preserveTombstones) continue;
    kept.push(rec);
  }
  kept.sort((a, b) => a.seq - b.seq);

  const chunks = kept.map((r) => encodeRecord(r));
  const tmpPath = \`\${targetPath}.tmp\`;
  fs.writeFileSync(tmpPath, Buffer.concat(chunks));

  for (const segPath of segmentPaths) {
    if (segPath !== targetPath && fs.existsSync(segPath)) {
      fs.unlinkSync(segPath);
    }
  }
  fs.renameSync(tmpPath, targetPath);
  return kept;
}
`,
  },

  "04-reactive-dag-engine": {
    "src/cell.ts": `import { scheduleNotification } from "./batch.ts";
import {
  getActiveConsumer,
  linkDependency,
  popConsumer,
  pushConsumer,
  unlinkAllSources,
  type GraphNode,
} from "./graph.ts";
import { topologicalOrder } from "./topo.ts";
import { CycleError, type Computed, type Listener, type Signal } from "./types.ts";

let nextCellId = 1;

interface InternalNode extends GraphNode {
  dirty: boolean;
  recomputeOnly(): boolean;
  notifyIfChanged(): void;
}

const dirtyQueue: InternalNode[] = [];
let flushing = false;
let batchDepth = 0;

function markDownstreamDirty(start: GraphNode): void {
  const order = topologicalOrder([start]);
  for (const n of order) {
    if (n === start) continue;
    const node = n as InternalNode;
    node.dirty = true;
    if (!dirtyQueue.includes(node)) {
      dirtyQueue.push(node);
    }
  }
}

function flushDirty(): void {
  if (flushing || batchDepth > 0) return;
  flushing = true;
  try {
    // Recompute dirty nodes strictly in topological depth / dependency order without glitches
    while (dirtyQueue.length > 0) {
      // Pick first dirty node whose upstream sources are already clean
      let pickedIdx = dirtyQueue.findIndex((n) => {
        for (const src of n.sources) {
          if ((src as InternalNode).dirty) return false;
        }
        return true;
      });
      if (pickedIdx === -1) pickedIdx = 0;
      const [node] = dirtyQueue.splice(pickedIdx, 1);
      if (node.dirty) {
        node.recomputeOnly();
      }
      node.notifyIfChanged();
    }
  } finally {
    flushing = false;
  }
}

export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const listeners = new Set<Listener<T>>();

  const node: InternalNode = {
    id: nextCellId++,
    sources: new Set(),
    dependents: new Set(),
    dirty: false,
    onDependencyInvalidated() {},
    recomputeOnly() {
      return false;
    },
    notifyIfChanged() {},
  };

  return {
    id: node.id,
    get(): T {
      const consumer = getActiveConsumer();
      if (consumer) linkDependency(node, consumer);
      return value;
    },
    set(next: T): void {
      if (Object.is(value, next)) return;
      value = next;
      markDownstreamDirty(node);
      flushDirty();
      for (const listener of [...listeners]) {
        scheduleNotification(() => listener(value));
      }
    },
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function computed<T>(compute: () => T): Computed<T> {
  let value!: T;
  let initialized = false;
  let recomputes = 0;
  let evaluating = false;
  let pendingNotify = false;
  const listeners = new Set<Listener<T>>();

  const node: InternalNode = {
    id: nextCellId++,
    sources: new Set(),
    dependents: new Set(),
    dirty: false,
    onDependencyInvalidated() {
      node.dirty = true;
    },
    recomputeOnly(): boolean {
      const prev = value;
      const next = evaluate();
      if (initialized && !Object.is(prev, next)) {
        pendingNotify = true;
        return true;
      }
      return false;
    },
    notifyIfChanged(): void {
      if (!pendingNotify) return;
      pendingNotify = false;
      for (const listener of [...listeners]) {
        scheduleNotification(() => listener(value));
      }
    },
  };

  function evaluate(): T {
    if (evaluating) {
      throw new CycleError();
    }
    const prevSources = new Set(node.sources);
    unlinkAllSources(node);
    evaluating = true;
    pushConsumer(node);
    let next: T;
    try {
      next = compute();
    } catch (err) {
      // Restore previous clean edges on failed cycle evaluation so revert recovers cleanly
      unlinkAllSources(node);
      for (const src of prevSources) {
        linkDependency(src, node);
      }
      node.dirty = true;
      throw err;
    } finally {
      popConsumer();
      evaluating = false;
    }

    node.dirty = false;
    recomputes += 1;
    const changed = initialized && !Object.is(value, next);
    value = next;
    initialized = true;
    if (changed && !flushing) {
      for (const listener of [...listeners]) {
        scheduleNotification(() => listener(value));
      }
    }
    return value;
  }

  evaluate();

  return {
    id: node.id,
    get recomputeCount(): number {
      return recomputes;
    },
    get(): T {
      const consumer = getActiveConsumer();
      if (consumer) linkDependency(node, consumer);
      if (evaluating) throw new CycleError();
      if (!initialized || node.dirty) {
        return evaluate();
      }
      return value;
    },
    subscribe(listener: Listener<T>): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function runInBatch<T>(fn: () => T): T {
  batchDepth += 1;
  try {
    return fn();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0) {
      flushDirty();
    }
  }
}
`,
    "src/batch.ts": `import { runInBatch } from "./cell.ts";

let depth = 0;
const deferredCallbacks: Array<() => void> = [];

export function scheduleNotification(fn: () => void): void {
  if (depth > 0) {
    deferredCallbacks.push(fn);
  } else {
    fn();
  }
}

export function batch<T>(fn: () => T): T {
  depth += 1;
  try {
    return runInBatch(fn);
  } finally {
    depth -= 1;
    if (depth === 0) {
      const pending = deferredCallbacks.splice(0, deferredCallbacks.length);
      for (const cb of pending) cb();
    }
  }
}
`,
  },

  "05-async-rate-limiter": {
    "limiter/bucket.py": `from dataclasses import dataclass
from .clock import Clock, MonotonicClock


class CostExceedsCapacityError(ValueError):
    pass


@dataclass(frozen=True)
class Decision:
    allowed: bool
    remaining: float
    retry_after: float


class TokenBucketLimiter:
    def __init__(
        self,
        capacity: float,
        refill_rate: float,
        clock: Clock | None = None,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if refill_rate <= 0:
            raise ValueError("refill_rate must be positive")
        self.capacity = float(capacity)
        self.refill_rate = float(refill_rate)
        self.clock: Clock = clock if clock is not None else MonotonicClock()
        self._tokens = float(capacity)
        self._last_refill = self.clock.time()

    def _refill(self) -> None:
        now = self.clock.time()
        elapsed = now - self._last_refill
        if elapsed > 0:
            self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_rate)
            self._last_refill = now

    def _validate_cost(self, cost: float) -> None:
        if cost < 0:
            raise ValueError("cost must be non-negative")
        if cost > self.capacity:
            raise CostExceedsCapacityError(
                f"cost {cost} exceeds capacity {self.capacity}"
            )

    def can_acquire(self, cost: float = 1.0) -> bool:
        self._validate_cost(cost)
        self._refill()
        return self._tokens >= cost

    def preview(self, cost: float = 1.0) -> Decision:
        self._validate_cost(cost)
        self._refill()
        if self._tokens >= cost:
            return Decision(allowed=True, remaining=self._tokens - cost, retry_after=0.0)
        deficit = cost - self._tokens
        return Decision(
            allowed=False,
            remaining=self._tokens,
            retry_after=deficit / self.refill_rate,
        )

    def allow(self, cost: float = 1.0) -> Decision:
        d = self.preview(cost)
        if d.allowed:
            self._tokens -= cost
        return d
`,
    "limiter/sliding.py": `from collections import deque
from .bucket import CostExceedsCapacityError, Decision
from .clock import Clock, MonotonicClock


class SlidingWindowLimiter:
    def __init__(
        self,
        capacity: int,
        window_seconds: float,
        clock: Clock | None = None,
    ) -> None:
        if capacity <= 0:
            raise ValueError("capacity must be positive")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self.capacity = int(capacity)
        self.window_seconds = float(window_seconds)
        self.clock: Clock = clock if clock is not None else MonotonicClock()
        self._events: deque[tuple[float, int]] = deque()
        self._used = 0

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        while self._events and self._events[0][0] <= cutoff:
            _, c = self._events.popleft()
            self._used -= c

    def _validate_cost(self, cost: int) -> int:
        if cost < 0:
            raise ValueError("cost must be non-negative")
        if cost > self.capacity:
            raise CostExceedsCapacityError(
                f"cost {cost} exceeds capacity {self.capacity}"
            )
        return int(cost)

    def preview(self, cost: int = 1) -> Decision:
        c = self._validate_cost(cost)
        now = self.clock.time()
        self._prune(now)
        if self._used + c <= self.capacity:
            return Decision(
                allowed=True,
                remaining=float(self.capacity - (self._used + c)),
                retry_after=0.0,
            )
        need = (self._used + c) - self.capacity
        freed = 0
        retry_at = now
        for ts, amount in self._events:
            freed += amount
            if freed >= need:
                retry_at = ts + self.window_seconds
                break
        return Decision(
            allowed=False,
            remaining=float(max(0, self.capacity - self._used)),
            retry_after=max(0.0, retry_at - now),
        )

    def allow(self, cost: int = 1) -> Decision:
        c = self._validate_cost(cost)
        d = self.preview(c)
        if d.allowed:
            now = self.clock.time()
            self._events.append((now, c))
            self._used += c
        return d
`,
    "limiter/hierarchy.py": `from .bucket import CostExceedsCapacityError, Decision, TokenBucketLimiter
from .sliding import SlidingWindowLimiter


RateLimiterTier = TokenBucketLimiter | SlidingWindowLimiter


class HierarchicalLimiter:
    def __init__(self, tiers: list[RateLimiterTier]) -> None:
        if not tiers:
            raise ValueError("tiers must not be empty")
        self.tiers = list(tiers)

    def acquire(self, cost: int = 1) -> Decision:
        previews = [tier.preview(cost) for tier in self.tiers]
        if any(not d.allowed for d in previews):
            retry_after = max((d.retry_after for d in previews if not d.allowed), default=0.0)
            min_rem = min(d.remaining for d in previews)
            return Decision(allowed=False, remaining=min_rem, retry_after=retry_after)

        decisions = [tier.allow(cost) for tier in self.tiers]
        return Decision(
            allowed=True,
            remaining=min(d.remaining for d in decisions),
            retry_after=0.0,
        )
`,
  },

  "06-sql-mini-planner": {
    "minisql/eval_expr.py": `from typing import Any
from .ast_nodes import (
    AggExpr,
    BinaryOpExpr,
    ColumnExpr,
    Expr,
    IsNullExpr,
    LiteralExpr,
    UnaryOpExpr,
)


def lookup_column(row: dict[str, Any], expr: ColumnExpr) -> Any:
    if expr.table is not None:
        qualified = f"{expr.table}.{expr.column}"
        if qualified in row:
            return row[qualified]
    if expr.column in row:
        return row[expr.column]
    suffix = f".{expr.column}"
    matches = [v for k, v in row.items() if k.endswith(suffix)]
    if len(matches) == 1:
        return matches[0]
    raise KeyError(f"Column not found in row: {expr}")


def eval_expr(expr: Expr, row: dict[str, Any]) -> Any:
    if isinstance(expr, LiteralExpr):
        return expr.value
    if isinstance(expr, ColumnExpr):
        return lookup_column(row, expr)
    if isinstance(expr, IsNullExpr):
        val = eval_expr(expr.operand, row)
        is_null = val is None
        return (not is_null) if expr.negated else is_null
    if isinstance(expr, UnaryOpExpr):
        if expr.op == "NOT":
            val = eval_expr(expr.operand, row)
            return None if val is None else (not bool(val))
        raise ValueError(f"Unknown unary op: {expr.op}")
    if isinstance(expr, BinaryOpExpr):
        op = expr.op.upper()
        if op == "AND":
            left = eval_expr(expr.left, row)
            if left is False:
                return False
            right = eval_expr(expr.right, row)
            if right is False:
                return False
            if left is None or right is None:
                return None
            return bool(left) and bool(right)
        if op == "OR":
            left = eval_expr(expr.left, row)
            if left is True:
                return True
            right = eval_expr(expr.right, row)
            if right is True:
                return True
            if left is None or right is None:
                return None
            return bool(left) or bool(right)

        left = eval_expr(expr.left, row)
        right = eval_expr(expr.right, row)
        if left is None or right is None:
            return None
        if op == "=":
            return left == right
        if op in ("!=", "<>"):
            return left != right
        if op == "<":
            return left < right
        if op == "<=":
            return left <= right
        if op == ">":
            return left > right
        if op == ">=":
            return left >= right
        raise ValueError(f"Unknown operator: {op}")
    if isinstance(expr, AggExpr):
        raise ValueError("Aggregate expression evaluated directly outside aggregation")
    raise ValueError(f"Unsupported expression node: {expr}")


def eval_predicate(expr: Expr, row: dict[str, Any]) -> bool:
    return eval_expr(expr, row) is True
`,
    "minisql/optimizer.py": `from dataclasses import dataclass
from .ast_nodes import (
    AggExpr,
    BinaryOpExpr,
    ColumnExpr,
    Expr,
    IsNullExpr,
    JoinClause,
    OrderByItem,
    SelectItem,
    SelectQuery,
    TableRef,
    UnaryOpExpr,
)


@dataclass
class QueryPlan:
    from_table: TableRef
    join: JoinClause | None
    left_filters: list[Expr]
    right_filters: list[Expr]
    post_join_filters: list[Expr]
    group_by: list[ColumnExpr]
    having_filters: list[Expr]
    select_items: list[SelectItem]
    order_by: list[OrderByItem]


def split_conjuncts(expr: Expr | None) -> list[Expr]:
    if expr is None:
        return []
    if isinstance(expr, BinaryOpExpr) and expr.op.upper() == "AND":
        return split_conjuncts(expr.left) + split_conjuncts(expr.right)
    return [expr]


def referenced_tables(expr: Expr) -> set[str]:
    tables: set[str] = set()
    if isinstance(expr, ColumnExpr):
        if expr.table is not None:
            tables.add(expr.table)
    elif isinstance(expr, (UnaryOpExpr, IsNullExpr)):
        tables.update(referenced_tables(expr.operand))
    elif isinstance(expr, BinaryOpExpr):
        tables.update(referenced_tables(expr.left))
        tables.update(referenced_tables(expr.right))
    elif isinstance(expr, AggExpr):
        tables.update(referenced_tables(expr.arg))
    return tables


def build_plan(query: SelectQuery) -> QueryPlan:
    left_alias = query.from_table.alias
    right_alias = query.join.table.alias if query.join else None
    is_inner = query.join is not None and query.join.join_type == "INNER"

    left_filters: list[Expr] = []
    right_filters: list[Expr] = []
    post_join_filters: list[Expr] = []
    having_filters: list[Expr] = split_conjuncts(query.having)

    for pred in split_conjuncts(query.where):
        tables = referenced_tables(pred)
        if not query.join:
            left_filters.append(pred)
        elif tables == {left_alias}:
            left_filters.append(pred)
        elif is_inner and right_alias and tables == {right_alias}:
            right_filters.append(pred)
        else:
            post_join_filters.append(pred)

    return QueryPlan(
        from_table=query.from_table,
        join=query.join,
        left_filters=left_filters,
        right_filters=right_filters,
        post_join_filters=post_join_filters,
        group_by=query.group_by,
        having_filters=having_filters,
        select_items=query.items,
        order_by=query.order_by,
    )
`,
    "minisql/executor.py": `from typing import Any
from .ast_nodes import (
    AggExpr,
    BinaryOpExpr,
    ColumnExpr,
    Expr,
    IsNullExpr,
    SelectItem,
    StarExpr,
    UnaryOpExpr,
)
from .eval_expr import eval_expr, eval_predicate
from .optimizer import QueryPlan, build_plan
from .parser import parse_sql


class Database:
    def __init__(self) -> None:
        self._tables: dict[str, list[dict[str, Any]]] = {}

    def create_table(self, name: str, rows: list[dict[str, Any]]) -> None:
        self._tables[name] = [dict(r) for r in rows]

    def get_rows(self, name: str) -> list[dict[str, Any]]:
        if name not in self._tables:
            raise KeyError(f"Unknown table {name}")
        return [dict(r) for r in self._tables[name]]


def _qualify_row(alias: str, row: dict[str, Any]) -> dict[str, Any]:
    out = dict(row)
    for k, v in row.items():
        out[f"{alias}.{k}"] = v
    return out


def _left_join_null_row(alias: str, sample_rows: list[dict[str, Any]], known_cols: set[str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    cols = set(known_cols)
    for r in sample_rows:
        cols.update(r.keys())
    for c in cols:
        out[f"{alias}.{c}"] = None
        if c not in out:
            out[c] = None
    return out


def _contains_agg(expr: Expr) -> bool:
    if isinstance(expr, AggExpr):
        return True
    if isinstance(expr, (UnaryOpExpr, IsNullExpr)):
        return _contains_agg(expr.operand)
    if isinstance(expr, BinaryOpExpr):
        return _contains_agg(expr.left) or _contains_agg(expr.right)
    return False


def _item_key(item: SelectItem) -> str:
    if item.alias:
        return item.alias
    if isinstance(item.expr, ColumnExpr):
        return item.expr.column
    if isinstance(item.expr, AggExpr):
        return item.expr.func.lower()
    return "expr"


def _eval_agg(expr: AggExpr, rows: list[dict[str, Any]]) -> Any:
    func = expr.func.upper()
    if func == "COUNT":
        if isinstance(expr.arg, StarExpr):
            return len(rows)
        return sum(1 for r in rows if eval_expr(expr.arg, r) is not None)

    vals: list[Any] = []
    for r in rows:
        v = eval_expr(expr.arg, r)
        if v is not None:
            vals.append(v)

    if not vals:
        return None
    if func == "SUM":
        return sum(vals)
    if func == "AVG":
        return sum(vals) / len(vals)
    if func == "MIN":
        return min(vals)
    if func == "MAX":
        return max(vals)
    raise ValueError(f"Unknown aggregate: {func}")


def _eval_group_expr(expr: Expr, rows: list[dict[str, Any]]) -> Any:
    if isinstance(expr, AggExpr):
        return _eval_agg(expr, rows)
    if isinstance(expr, UnaryOpExpr) and expr.op == "NOT":
        val = _eval_group_expr(expr.operand, rows)
        return None if val is None else (not bool(val))
    if isinstance(expr, BinaryOpExpr):
        op = expr.op.upper()
        l = _eval_group_expr(expr.left, rows)
        r = _eval_group_expr(expr.right, rows)
        if op == "AND":
            if l is False or r is False:
                return False
            if l is None or r is None:
                return None
            return bool(l) and bool(r)
        if op == "OR":
            if l is True or r is True:
                return True
            if l is None or r is None:
                return None
            return bool(l) or bool(r)
        if l is None or r is None:
            return None
        if op == "=":
            return l == r
        if op in ("!=", "<>"):
            return l != r
        if op == "<":
            return l < r
        if op == "<=":
            return l <= r
        if op == ">":
            return l > r
        if op == ">=":
            return l >= r
    if isinstance(expr, IsNullExpr):
        val = _eval_group_expr(expr.operand, rows)
        return (val is not None) if expr.negated else (val is None)
    if rows:
        return eval_expr(expr, rows[0])
    return None


def _apply_filters(rows: list[dict[str, Any]], filters: list[Expr]) -> list[dict[str, Any]]:
    if not filters:
        return rows
    return [r for r in rows if all(eval_predicate(f, r) for f in filters)]


def execute_plan(db: Database, plan: QueryPlan) -> list[dict[str, Any]]:
    raw_left = db.get_rows(plan.from_table.name)
    left_rows = _apply_filters(
        [_qualify_row(plan.from_table.alias, r) for r in raw_left],
        plan.left_filters,
    )

    if plan.join is None:
        working_rows = left_rows
    else:
        raw_right = db.get_rows(plan.join.table.name)
        right_rows = _apply_filters(
            [_qualify_row(plan.join.table.alias, r) for r in raw_right],
            plan.right_filters,
        )
        known_right_cols: set[str] = set()
        for rr in raw_right:
            known_right_cols.update(rr.keys())

        joined: list[dict[str, Any]] = []
        for lrow in left_rows:
            matched = False
            for rrow in right_rows:
                combined = {**lrow, **rrow}
                for k, v in rrow.items():
                    if "." not in k and k in lrow:
                        combined[k] = lrow[k]
                if eval_predicate(plan.join.on, combined):
                    joined.append(combined)
                    matched = True
            if not matched and plan.join.join_type == "LEFT":
                null_r = _left_join_null_row(plan.join.table.alias, raw_right, known_right_cols)
                combined = {**null_r, **lrow}
                joined.append(combined)
        working_rows = joined

    working_rows = _apply_filters(working_rows, plan.post_join_filters)

    is_agg_query = bool(plan.group_by) or any(
        _contains_agg(item.expr) for item in plan.select_items
    )

    results: list[dict[str, Any]] = []
    if is_agg_query:
        groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        if plan.group_by:
            for row in working_rows:
                key = tuple(eval_expr(col, row) for col in plan.group_by)
                groups.setdefault(key, []).append(row)
        else:
            groups[()] = working_rows

        for group_rows in groups.values():
            if plan.having_filters and not all(
                _eval_group_expr(h, group_rows) is True for h in plan.having_filters
            ):
                continue
            out_row: dict[str, Any] = {}
            for item in plan.select_items:
                out_row[_item_key(item)] = _eval_group_expr(item.expr, group_rows)
            results.append(out_row)
    else:
        for row in working_rows:
            out_row = {}
            for item in plan.select_items:
                if isinstance(item.expr, StarExpr):
                    for k, v in row.items():
                        if "." not in k:
                            out_row[k] = v
                else:
                    out_row[_item_key(item)] = eval_expr(item.expr, row)
            results.append(out_row)

    if plan.order_by:
        for ob in reversed(plan.order_by):
            key_name = ob.expr.column if isinstance(ob.expr, ColumnExpr) else ob.expr
            results.sort(
                key=lambda r: (r.get(key_name) is None, r.get(key_name)),
                reverse=ob.desc,
            )

    return results


def execute_sql(db: Database, sql: str) -> list[dict[str, Any]]:
    query = parse_sql(sql)
    plan = build_plan(query)
    return execute_plan(db, plan)
`,
  },
};

function solveSetForModel(spec: ModelSpec, taskId: string): Record<string, string> {
  const full = FULL_FIXES[taskId] ?? {};
  if (spec.name === "claude-fable-5-2") return full;
  if (spec.name === "gemini-4-hydrogen") {
    // Solves 4/6 cleanly, misses the two Hard DAG/SQL tasks
    if (taskId === "04-reactive-dag-engine" || taskId === "06-sql-mini-planner") {
      return {};
    }
    return full;
  }
  // inkling-2-mini@off solves 01 and 05 cleanly, partial on 03 (utf8/wal only -> misses compactor)
  if (taskId === "01-ledger-rounding" || taskId === "05-async-rate-limiter") {
    return full;
  }
  if (taskId === "03-wal-kv-recovery") {
    return {
      "src/codec.ts": full["src/codec.ts"],
      "src/wal.ts": full["src/wal.ts"],
    };
  }
  return {};
}

function visibleCmdForTask(prompt: string): string {
  const m = prompt.match(/`((?:node|python3)[^`]+)`/);
  return m ? m[1] : "node --test test/public.test.ts";
}

function detectTaskIdFromPrompt(prompt: string): string {
  if (prompt.includes("multi-currency ledger")) return "01-ledger-rounding";
  if (prompt.includes("cron parsing")) return "02-cron-dst-scheduler";
  if (prompt.includes("Write-Ahead Log")) return "03-wal-kv-recovery";
  if (prompt.includes("reactive dependency tracking")) return "04-reactive-dag-engine";
  if (prompt.includes("rate limiter package")) return "05-async-rate-limiter";
  if (prompt.includes("in-memory SQL engine")) return "06-sql-mini-planner";
  return "01-ledger-rounding";
}

function makeMockUsage(spec: ModelSpec, phase: number) {
  const isFable = spec.name === "claude-fable-5-2";
  const isLocal = spec.provider === "ollama";
  const input = isFable ? 1400 + phase * 650 : 1200 + phase * 550;
  const reasoning = isLocal ? 450 : isFable ? 820 : 160;
  const textOut = 140 + phase * 40;
  const output = reasoning + textOut;
  const costRates = spec.costs ?? { promptTokens: 0.45, completionTokens: 2.0 };
  const costTotal =
    (input * costRates.promptTokens + output * costRates.completionTokens) /
    1_000_000;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning,
    totalTokens: input + output,
    cost: {
      input: (input * costRates.promptTokens) / 1_000_000,
      output: (output * costRates.completionTokens) / 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
      total: costTotal,
    },
  };
}

export function createMockTargetMap(
  models: ModelSpec[],
): Map<string, ResolvedPiInvocationTarget> {
  const map = new Map<string, ResolvedPiInvocationTarget>();

  for (const spec of models) {
    const key = formatModelSpecString(spec);
    const faux = fauxProvider({
      provider: spec.provider,
      models: [
        {
          id: spec.name,
          name: spec.name,
          reasoning: spec.reasoningEffort !== "off",
          cost: {
            input: spec.costs?.promptTokens ?? 0.45,
            output: spec.costs?.completionTokens ?? 2.0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 131072,
          maxTokens: 32768,
        },
      ],
    });

    const handler = (ctx: TranscriptContext) => {
      faux.appendResponses([handler]);
      const userMsg = ctx.messages.find((m) => m.role === "user");
      const promptText =
        typeof userMsg?.content === "string"
          ? userMsg.content
          : Array.isArray(userMsg?.content)
            ? userMsg.content
                .filter((b): b is { type: "text"; text: string } => b.type === "text")
                .map((b) => b.text)
                .join("\n")
            : "";
      const taskId = detectTaskIdFromPrompt(promptText);
      const toolResultsCount = ctx.messages.filter(
        (m) => m.role === "toolResult",
      ).length;
      const fixes = solveSetForModel(spec, taskId);
      const filesToWrite = Object.entries(fixes);
      const firstRead =
        filesToWrite[0]?.[0] ??
        (taskId.startsWith("05")
          ? "limiter/hierarchy.py"
          : taskId.startsWith("06")
            ? "minisql/optimizer.py"
            : "src/index.ts");

      const msgCount = ctx.messages.filter((m) => m.role === "assistant").length;
      const maybeThink =
        spec.reasoningEffort !== "off"
          ? [fauxThinking(`Analyzing ${taskId} root causes at effort=${spec.reasoningEffort ?? "default"}.`)]
          : [];

      if (msgCount === 0) {
        const msg = fauxAssistantMessage(
          [...maybeThink, fauxToolCall("read", { path: firstRead }, { id: "m-read-1" })],
          { stopReason: "toolUse" },
        );
        return { ...msg, usage: makeMockUsage(spec, 0) };
      }
      if (msgCount === 1 && filesToWrite.length > 0) {
        const calls = filesToWrite.map(([p, content], idx) =>
          fauxToolCall("write", { path: p, content }, { id: `m-write-${idx}` }),
        );
        const msg = fauxAssistantMessage([...maybeThink, ...calls], { stopReason: "toolUse" });
        return { ...msg, usage: makeMockUsage(spec, 1) };
      }
      if ((msgCount === 2 && filesToWrite.length > 0) || (msgCount === 1 && toolResultsCount > 0)) {
        const cmd = visibleCmdForTask(promptText);
        const msg = fauxAssistantMessage(
          [...maybeThink, fauxToolCall("bash", { command: cmd }, { id: "m-bash-1" })],
          { stopReason: "toolUse" },
        );
        return { ...msg, usage: makeMockUsage(spec, 2) };
      }

      const summary =
        filesToWrite.length > 0
          ? `Applied ${filesToWrite.length} targeted fix(es) for ${taskId} and verified visible tests.`
          : `Inspected ${taskId}; no additional edits applied.`;
      const msg = fauxAssistantMessage([...maybeThink, fauxText(summary)], {
        stopReason: "stop",
      });
      return { ...msg, usage: makeMockUsage(spec, 3) };
    };

    faux.setResponses(Array.from({ length: 64 }, () => handler));

    const piModels = createModels();
    piModels.setProvider(faux.provider);
    const piModel = piModels.getModel(spec.provider, spec.name)!;
    map.set(key, { models: piModels, piModel });
  }

  return map;
}
