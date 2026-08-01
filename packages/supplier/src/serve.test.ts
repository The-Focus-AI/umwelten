/**
 * The serve loop, with the machine and the Exchange doubled out.
 *
 * Time is injected, so a 24-hour re-probe interval is asserted in
 * milliseconds.
 */

import { describe, it, expect } from "vitest";
import { runServeLoop, type ServeEffects } from "./serve.js";
import { OfferSupervisor, WITHDRAW_AFTER_FAILURES } from "./supervisor.js";
import { fingerprint, type ProbeInputs } from "./fingerprint.js";
import type { OfferDraft, ProbedOffer } from "./types.js";

const draft = (model: string, capabilities: OfferDraft["capabilities"] = ["chat"]): OfferDraft => ({
  model,
  capabilities,
  servingMode: "managed",
  headroom: [],
});

const probedOffer = (model: string): ProbedOffer => ({
  provider: "llamaswap",
  model,
  probedAt: "2026-08-01T12:00:00Z",
  capabilities: [{ name: "chat", supported: true, evidence: "ok", elapsedMs: 1 }],
  headroom: [],
});

const INPUTS: ProbeInputs = {
  agentVersion: "1",
  weights: [{ path: "/models/a.gguf", sizeBytes: 1 }],
  servingMode: "managed",
};

interface Harness {
  effects: ServeEffects;
  published: OfferDraft[][];
  logs: string[];
  reprobes: string[];
  persisted: number;
  /** Models that should fail their liveness check. */
  broken: Set<string>;
  runtimeUp: boolean;
  restarts: number;
  clock: number;
}

function harness(overrides: Partial<ServeEffects> = {}): Harness {
  const state = {
    published: [] as OfferDraft[][],
    logs: [] as string[],
    reprobes: [] as string[],
    persisted: 0,
    broken: new Set<string>(),
    runtimeUp: true,
    restarts: 0,
    clock: Date.parse("2026-08-01T12:00:00Z"),
    nextProbe: [draft("a"), draft("b")],
  };

  const effects: ServeEffects = {
    runtimeAlive: async () => state.runtimeUp,
    checkModel: async (model) =>
      state.broken.has(model) ? { ok: false, reason: "would not load" } : { ok: true },
    reprobe: async (reason) => {
      state.reprobes.push(reason);
      return {
        probed: state.nextProbe.map((d) => probedOffer(d.model)),
        drafts: state.nextProbe,
      };
    },
    publish: async (offers) => {
      state.published.push(offers);
      return { ok: true };
    },
    persist: () => {
      state.persisted += 1;
    },
    now: () => state.clock,
    // Advancing the clock as the loop sleeps is what makes a 24-hour interval
    // assertable in a millisecond.
    sleep: async (ms) => {
      state.clock += ms;
    },
    log: (line) => state.logs.push(line),
    ...overrides,
  };

  return {
    effects,
    get published() {
      return state.published;
    },
    get logs() {
      return state.logs;
    },
    get reprobes() {
      return state.reprobes;
    },
    get persisted() {
      return state.persisted;
    },
    broken: state.broken,
    get runtimeUp() {
      return state.runtimeUp;
    },
    set runtimeUp(value: boolean) {
      state.runtimeUp = value;
    },
    get restarts() {
      return state.restarts;
    },
    get clock() {
      return state.clock;
    },
    // Exposed so a test can change what the next re-probe returns.
    ...({ setNextProbe: (drafts: OfferDraft[]) => (state.nextProbe = drafts) } as object),
  } as Harness & { setNextProbe: (drafts: OfferDraft[]) => void };
}

/** Run the loop for a bounded number of health cycles. */
async function runFor(
  cycles: number,
  supervisor: OfferSupervisor,
  h: Harness,
  opts: Partial<Parameters<typeof runServeLoop>[2]> = {},
): Promise<void> {
  const abort = new AbortController();
  let seen = 0;
  const wrapped: ServeEffects = {
    ...h.effects,
    sleep: async (ms) => {
      await h.effects.sleep(ms);
      seen += 1;
      // The loop sleeps at the top and breaks on an aborted signal straight
      // after, so aborting on the Nth sleep would skip the Nth cycle's work.
      // Abort on the sleep *after* the last one we want.
      if (seen > cycles) abort.abort();
    },
  };
  await runServeLoop(supervisor, wrapped, {
    healthIntervalMs: 30_000,
    reprobeIntervalMs: 24 * 3_600_000,
    signal: abort.signal,
    probeInputs: INPUTS,
    previous: {
      fingerprint: fingerprint(INPUTS),
      probedAt: new Date(h.clock).toISOString(),
      inputs: INPUTS,
    },
    ...opts,
  });
}

describe("runServeLoop", () => {
  it("publishes nothing while everything is healthy", async () => {
    // Republishing on a timer would be a write per interval that says exactly
    // what the last one said.
    const h = harness();
    await runFor(4, new OfferSupervisor([draft("a"), draft("b")]), h);
    expect(h.published).toEqual([]);
  });

  it("republishes the moment an Offer crosses the withdrawal threshold", async () => {
    // Immediately, not at the next scheduled publish — an agent that waits
    // lets Dispatch route into a known failure.
    const h = harness();
    h.broken.add("b");
    const supervisor = new OfferSupervisor([draft("a"), draft("b")]);

    await runFor(WITHDRAW_AFTER_FAILURES, supervisor, h);

    expect(h.published).toHaveLength(1);
    expect(h.published[0].map((o) => o.model)).toEqual(["a"]);
  });

  it("keeps the machine's other Offers up when one Model breaks", async () => {
    const h = harness();
    h.broken.add("b");
    const supervisor = new OfferSupervisor([draft("a"), draft("b")]);

    await runFor(WITHDRAW_AFTER_FAILURES + 1, supervisor, h);
    expect(supervisor.live().map((o) => o.model)).toEqual(["a"]);
  });

  it("withdraws everything at once when the runtime dies", async () => {
    const h = harness();
    h.runtimeUp = false;
    const supervisor = new OfferSupervisor([draft("a"), draft("b")]);

    await runFor(1, supervisor, h);

    expect(h.published[0]).toEqual([]);
    expect(supervisor.live()).toEqual([]);
  });

  it("does not check each Model individually once the runtime is gone", async () => {
    // It would just be the same news five times.
    const checked: string[] = [];
    const h = harness({ checkModel: async (m) => (checked.push(m), { ok: true }) });
    h.runtimeUp = false;

    await runFor(2, new OfferSupervisor([draft("a"), draft("b")]), h);
    expect(checked).toEqual([]);
  });

  it("tries to bring a dead runtime back", async () => {
    let restarts = 0;
    const h = harness({
      restartRuntime: async () => {
        restarts += 1;
        return true;
      },
    });
    h.runtimeUp = false;

    await runFor(1, new OfferSupervisor([draft("a")]), h);
    expect(restarts).toBe(1);
  });

  it("republishes when a withdrawn Offer recovers, without an operator", async () => {
    const h = harness();
    h.broken.add("b");
    const supervisor = new OfferSupervisor([draft("a"), draft("b")]);

    await runFor(WITHDRAW_AFTER_FAILURES, supervisor, h);
    expect(h.published).toHaveLength(1);

    h.broken.delete("b");
    await runFor(1, supervisor, h);

    expect(h.published).toHaveLength(2);
    expect(h.published[1].map((o) => o.model)).toEqual(["a", "b"]);
  });

  it("re-probes once the backstop interval has passed", async () => {
    const h = harness();
    // 30s cycles, so this is well past a one-hour interval.
    await runFor(200, new OfferSupervisor([draft("a")]), h, {
      reprobeIntervalMs: 60 * 60 * 1000,
    });
    expect(h.reprobes[0]).toMatch(/last probed/);
  });

  it("re-probes immediately when our own version moved", async () => {
    const h = harness();
    await runFor(1, new OfferSupervisor([draft("a")]), h, {
      previous: {
        fingerprint: fingerprint({ ...INPUTS, agentVersion: "0" }),
        probedAt: new Date(h.clock).toISOString(),
        inputs: { ...INPUTS, agentVersion: "0" },
      },
    });
    expect(h.reprobes[0]).toMatch(/agent upgraded/);
  });

  it("does not republish when a re-probe finds nothing new", async () => {
    const h = harness() as Harness & { setNextProbe: (d: OfferDraft[]) => void };
    h.setNextProbe([draft("a"), draft("b")]);

    await runFor(1, new OfferSupervisor([draft("a"), draft("b")]), h, {
      previous: {
        fingerprint: "different",
        probedAt: new Date(h.clock).toISOString(),
        inputs: INPUTS,
      },
    });

    expect(h.reprobes).toHaveLength(1);
    expect(h.published).toEqual([]);
    expect(h.logs.some((l) => l.includes("no change"))).toBe(true);
  });

  it("updates the Offer when a re-probe finds different Capabilities", async () => {
    const h = harness() as Harness & { setNextProbe: (d: OfferDraft[]) => void };
    h.setNextProbe([draft("a", ["chat", "reasoning"])]);

    const supervisor = new OfferSupervisor([draft("a")]);
    await runFor(1, supervisor, h, {
      previous: { fingerprint: "different", probedAt: new Date(h.clock).toISOString(), inputs: INPUTS },
    });

    expect(supervisor.live()[0].capabilities).toEqual(["chat", "reasoning"]);
    expect(h.published).toHaveLength(1);
    // Visible to an operator, not just to the Exchange.
    expect(h.logs.some((l) => l.includes("gained reasoning"))).toBe(true);
  });

  it("saves every probe result, changed or not, so a restart can resume", async () => {
    const h = harness();
    await runFor(1, new OfferSupervisor([draft("a")]), h, {
      previous: { fingerprint: "different", probedAt: new Date(h.clock).toISOString(), inputs: INPUTS },
    });
    expect(h.persisted).toBe(1);
  });
});
