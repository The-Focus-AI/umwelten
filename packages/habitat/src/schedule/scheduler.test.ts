import { describe, it, expect, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { HabitatScheduler } from "./scheduler.js";

function fixedClock(iso: string) {
  return () => new Date(iso);
}

describe("HabitatScheduler", () => {
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
    expect(runPrompt).toHaveBeenCalledWith("digest", "make the digest");
  });
});
