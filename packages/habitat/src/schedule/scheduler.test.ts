import { afterEach, describe, it, expect, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { HabitatScheduler } from "./scheduler.js";

function fixedClock(iso: string) {
  return () => new Date(iso);
}

describe("HabitatScheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("fires a due tool entry and records success", async () => {
    let called = 0;
    const syncTool = tool({
      description: "sync",
      inputSchema: z.object({ n: z.number().optional() }),
      execute: async ({ n }) => {
        called += (n ?? 1);
        return { ok: true };
      },
    });
    const s = new HabitatScheduler({
      getTools: () => ({ sync_feed: syncTool }),
      now: fixedClock("2026-07-13T10:30:00Z"),
      log: () => {},
    });
    s.load([{ name: "feed", cron: "*/30 * * * *", tool: "sync_feed", args: { n: 3 } }]);
    await s.tick();
    expect(called).toBe(3);
    const st = s.status()[0];
    expect(st.lastOk).toBe(true);
    expect(st.running).toBe(false);
  });

  it("does not fire when the minute doesn't match", async () => {
    let called = 0;
    const t = tool({ description: "x", inputSchema: z.object({}), execute: async () => { called++; return {}; } });
    const s = new HabitatScheduler({
      getTools: () => ({ t }),
      now: fixedClock("2026-07-13T10:15:00Z"),
      log: () => {},
    });
    s.load([{ name: "half", cron: "*/30 * * * *", tool: "t" }]);
    await s.tick();
    expect(called).toBe(0);
  });

  it("only fires once per minute even across ticks", async () => {
    let called = 0;
    const t = tool({ description: "x", inputSchema: z.object({}), execute: async () => { called++; return {}; } });
    const s = new HabitatScheduler({
      getTools: () => ({ t }),
      now: fixedClock("2026-07-13T10:00:00Z"),
      log: () => {},
    });
    s.load([{ name: "every", cron: "* * * * *", tool: "t" }]);
    await s.tick();
    await s.tick();
    await s.tick();
    expect(called).toBe(1);
  });

  it("a tool returning {error} is recorded as a failure", async () => {
    const t = tool({ description: "x", inputSchema: z.object({}), execute: async () => ({ error: "boom" }) });
    const s = new HabitatScheduler({
      getTools: () => ({ t }),
      now: fixedClock("2026-07-13T00:00:00Z"),
      log: () => {},
    });
    s.load([{ name: "bad", cron: "0 0 * * *", tool: "t" }]);
    await s.tick();
    const st = s.status()[0];
    expect(st.lastOk).toBe(false);
    expect(st.lastError).toMatch(/boom/);
  });

  it("skips invalid entries (bad cron, both/neither of tool+prompt)", () => {
    const s = new HabitatScheduler({ getTools: () => ({}), log: () => {} });
    s.load([
      { name: "badcron", cron: "not a cron", tool: "t" },
      { name: "both", cron: "* * * * *", tool: "t", prompt: "p" },
      { name: "neither", cron: "* * * * *" },
      { name: "bad-timeout", cron: "* * * * *", tool: "t", timeoutMs: 0 },
      { name: "ok", cron: "0 12 * * *", tool: "t" },
    ]);
    expect(s.status().map((x) => x.name)).toEqual(["ok"]);
  });

  it("routes prompt entries to runPrompt", async () => {
    const runPrompt = vi.fn(async () => {});
    const s = new HabitatScheduler({
      getTools: () => ({}),
      runPrompt,
      now: fixedClock("2026-07-13T12:00:00Z"),
      log: () => {},
    });
    s.load([{ name: "digest", cron: "0 12 * * *", prompt: "make the digest" }]);
    await s.tick();
    expect(runPrompt).toHaveBeenCalledWith(
      "digest",
      "make the digest",
      expect.any(AbortSignal),
    );
  });

  it("reports the next scheduled run", () => {
    const s = new HabitatScheduler({
      getTools: () => ({}),
      now: fixedClock("2026-07-13T10:03:12Z"),
      log: () => {},
    });
    s.load([{ name: "half", cron: "*/30 * * * *", tool: "t" }]);
    expect(s.status()[0].nextRunAt).toBe("2026-07-13T10:30:00.000Z");
  });

  it("waits for the next minute plus boot jitter before starting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:30Z"));
    const execute = vi.fn(async () => ({}));
    const t = tool({ description: "x", inputSchema: z.object({}), execute });
    const s = new HabitatScheduler({
      getTools: () => ({ t }),
      now: () => new Date(Date.now()),
      random: () => 0.5,
      log: () => {},
    });
    s.load([{ name: "every", cron: "* * * * *", tool: "t" }]);
    s.start();

    await vi.advanceTimersByTimeAsync(32_499);
    expect(execute).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(execute).toHaveBeenCalledOnce();
    s.stop();
  });

  it("can stop before the first tick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T10:00:30Z"));
    const execute = vi.fn(async () => ({}));
    const t = tool({ description: "x", inputSchema: z.object({}), execute });
    const s = new HabitatScheduler({
      getTools: () => ({ t }),
      now: () => new Date(Date.now()),
      random: () => 0,
      log: () => {},
    });
    s.load([{ name: "every", cron: "* * * * *", tool: "t" }]);
    s.start();
    s.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(execute).not.toHaveBeenCalled();
  });

  it("aborts and fails work that exceeds its configured timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const t = tool({
      description: "hang",
      inputSchema: z.object({}),
      execute: async (_args, options) => {
        signal = options.abortSignal;
        await new Promise(() => {});
      },
    });
    const s = new HabitatScheduler({
      getTools: () => ({ t }),
      now: fixedClock("2026-07-13T10:00:00Z"),
      log: () => {},
    });
    s.load([
      { name: "bounded", cron: "* * * * *", tool: "t", timeoutMs: 25 },
    ]);

    const ticking = s.tick();
    await vi.advanceTimersByTimeAsync(25);
    await ticking;
    expect(signal?.aborted).toBe(true);
    expect(s.status()[0]).toMatchObject({
      running: false,
      lastOk: false,
      lastError: "timed out after 25ms",
    });
  });

  it("starts different due entries without serializing them", async () => {
    let release!: () => void;
    const slowStarted = vi.fn();
    const fastStarted = vi.fn();
    const slow = tool({
      description: "slow",
      inputSchema: z.object({}),
      execute: async () => {
        slowStarted();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {};
      },
    });
    const fast = tool({
      description: "fast",
      inputSchema: z.object({}),
      execute: async () => {
        fastStarted();
        return {};
      },
    });
    const s = new HabitatScheduler({
      getTools: () => ({ slow, fast }),
      now: fixedClock("2026-07-13T10:00:00Z"),
      log: () => {},
    });
    s.load([
      { name: "slow", cron: "* * * * *", tool: "slow" },
      { name: "fast", cron: "* * * * *", tool: "fast" },
    ]);

    const ticking = s.tick();
    await vi.waitFor(() => expect(fastStarted).toHaveBeenCalledOnce());
    expect(slowStarted).toHaveBeenCalledOnce();
    release();
    await ticking;
  });
});
