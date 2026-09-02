// Habitat-native scheduler (#240). Config-declared cron entries run INSIDE the
// container — a `tool` entry calls a registered tool directly (deterministic,
// no LLM), a `prompt` entry runs an agent turn. No host cron, no external
// state: the schedule lives in the habitat's repo, gaia supervises the
// container, and the whole thing survives a host migration untouched.
//
// Runs as the OPERATOR (no per-user speaker) — scheduled work uses habitat-wide
// secrets, never a user's per-user credential.

import type { Tool } from "ai";
import {
  parseCron,
  cronMatches,
  nextCronDate,
  type CronExpr,
} from "./cron.js";

export interface ScheduleEntry {
  /** Stable name (used in logs + status). */
  name: string;
  /** 5-field cron (UTC). */
  cron: string;
  /** Tool to call. Mutually exclusive with `prompt`. */
  tool?: string;
  /** Args passed to the tool's execute(). */
  args?: Record<string, unknown>;
  /** Prompt to run as an agent turn. Mutually exclusive with `tool`. */
  prompt?: string;
  /** Skip this entry without deleting it. */
  disabled?: boolean;
  /** Maximum run time. Defaults to five minutes. */
  timeoutMs?: number;
}

export interface ScheduleStatus {
  name: string;
  cron: string;
  kind: "tool" | "prompt";
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  running: boolean;
}

export interface SchedulerDeps {
  /** Registered tools by name (habitat.getTools()). */
  getTools: () => Record<string, Tool>;
  /** Run a prompt as an operator agent turn; resolves when the turn ends. */
  runPrompt?: (
    name: string,
    prompt: string,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Injectable clock (defaults to Date). */
  now?: () => Date;
  /** Injectable only to make boot jitter deterministic in tests. */
  random?: () => number;
  log?: (msg: string) => void;
}

type Compiled = {
  entry: ScheduleEntry;
  cron: CronExpr;
  kind: "tool" | "prompt";
  running: boolean;
  lastRunAt: string | null;
  lastOk: boolean | null;
  lastError: string | null;
  /** Minute-key of the last fire, so a minute never double-fires. */
  lastFiredMinute: string | null;
};

const TOOL_TIMEOUT_MS = 5 * 60 * 1000;
const BOOT_JITTER_MS = 5_000;

export class HabitatScheduler {
  private compiled: Compiled[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly log: (msg: string) => void;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.random = deps.random ?? Math.random;
    this.log = deps.log ?? ((m) => console.log(m));
  }

  /**
   * Compile entries. Invalid cron / entry shapes are logged and skipped — one
   * bad entry must never stop the others or crash boot.
   */
  load(entries: ScheduleEntry[]): void {
    this.compiled = [];
    for (const entry of entries) {
      if (entry.disabled) continue;
      const hasTool = Boolean(entry.tool);
      const hasPrompt = Boolean(entry.prompt);
      if (hasTool === hasPrompt) {
        this.log(
          `[scheduler] skip "${entry.name}": exactly one of tool/prompt required`,
        );
        continue;
      }
      if (
        entry.timeoutMs !== undefined &&
        (!Number.isFinite(entry.timeoutMs) || entry.timeoutMs <= 0)
      ) {
        this.log(
          `[scheduler] skip "${entry.name}": timeoutMs must be greater than zero`,
        );
        continue;
      }
      let cron: CronExpr;
      try {
        cron = parseCron(entry.cron);
      } catch (err) {
        this.log(
          `[scheduler] skip "${entry.name}": bad cron "${entry.cron}" — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }
      this.compiled.push({
        entry,
        cron,
        kind: hasTool ? "tool" : "prompt",
        running: false,
        lastRunAt: null,
        lastOk: null,
        lastError: null,
        lastFiredMinute: null,
      });
    }
    if (this.compiled.length) {
      this.log(
        `[scheduler] loaded ${this.compiled.length} schedule(s): ${this.compiled
          .map((c) => `${c.entry.name}(${c.entry.cron})`)
          .join(", ")}`,
      );
    }
  }

  /** Begin ticking once per minute. No-op when nothing is scheduled. */
  start(): void {
    if (this.timer || this.startTimer || !this.compiled.length) return;
    // Start just after the next minute boundary, spread over five seconds so a
    // fleet restart does not fire every habitat at the same instant.
    const tick = () => void this.tick();
    const now = this.now().getTime();
    const untilNextMinute = 60_000 - (now % 60_000);
    const jitter = Math.floor(this.random() * BOOT_JITTER_MS);
    this.startTimer = setTimeout(() => {
      this.startTimer = null;
      void this.tick();
      this.timer = setInterval(tick, 60_000);
    }, untilNextMinute + jitter);
  }

  stop(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  status(): ScheduleStatus[] {
    return this.compiled.map((c) => ({
      name: c.entry.name,
      cron: c.entry.cron,
      kind: c.kind,
      nextRunAt: nextCronDate(c.cron, this.now())?.toISOString() ?? null,
      lastRunAt: c.lastRunAt,
      lastOk: c.lastOk,
      lastError: c.lastError,
      running: c.running,
    }));
  }

  /** One scheduling pass — public for deterministic tests. */
  async tick(): Promise<void> {
    const at = this.now();
    const minuteKey = at.toISOString().slice(0, 16); // yyyy-mm-ddThh:mm
    const due: Compiled[] = [];
    for (const c of this.compiled) {
      if (c.running) continue; // no overlap of the same entry
      if (c.lastFiredMinute === minuteKey) continue; // one fire per minute
      if (!cronMatches(c.cron, at)) continue;
      c.lastFiredMinute = minuteKey;
      due.push(c);
    }
    // One slow schedule must not hold up unrelated entries due in the same
    // minute. fire() marks each entry running before its first await.
    await Promise.all(due.map((c) => this.fire(c)));
  }

  private async fire(c: Compiled): Promise<void> {
    c.running = true;
    c.lastRunAt = this.now().toISOString();
    const started = Date.now();
    const controller = new AbortController();
    const timeoutMs = c.entry.timeoutMs ?? TOOL_TIMEOUT_MS;
    try {
      await this.withTimeout(
        c.kind === "tool"
          ? this.runTool(c.entry, controller.signal)
          : this.deps.runPrompt
            ? this.deps.runPrompt(
                c.entry.name,
                c.entry.prompt!,
                controller.signal,
              )
            : Promise.reject(
                new Error("prompt schedules unsupported in this runtime"),
              ),
        timeoutMs,
        controller,
      );
      c.lastOk = true;
      c.lastError = null;
      this.log(
        `[scheduler] ⏰ ${c.entry.name} → ${c.kind === "tool" ? c.entry.tool : "prompt"} ✓ ${
          Date.now() - started
        }ms`,
      );
    } catch (err) {
      c.lastOk = false;
      c.lastError = err instanceof Error ? err.message : String(err);
      this.log(`[scheduler] ⏰ ${c.entry.name} ✗ ${c.lastError}`);
    } finally {
      c.running = false;
    }
  }

  private async runTool(entry: ScheduleEntry, signal: AbortSignal): Promise<void> {
    const tools = this.deps.getTools();
    const tool = tools[entry.tool!];
    if (!tool || typeof (tool as { execute?: unknown }).execute !== "function") {
      throw new Error(`tool "${entry.tool}" not found or not executable`);
    }
    const exec = (tool as { execute: (a: unknown, o: unknown) => Promise<unknown> })
      .execute;
    const result = await exec(entry.args ?? {}, {
      toolCallId: `schedule:${entry.name}:${Date.now()}`,
      messages: [],
      abortSignal: signal,
    });
    // Tools return {error} rather than throwing — surface it as a failure.
    if (result && typeof result === "object" && "error" in result) {
      throw new Error(String((result as { error: unknown }).error));
    }
  }

  private async withTimeout(
    work: Promise<unknown>,
    timeoutMs: number,
    controller: AbortController,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      await Promise.race([work, expired]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
