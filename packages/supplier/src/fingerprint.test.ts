/**
 * When a probe goes stale (ADR 0022), from a fabricated machine state.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_REPROBE_INTERVAL_MS,
  capabilitiesChanged,
  fingerprint,
  reprobeReason,
  type ProbeInputs,
} from "./fingerprint.js";

const NOW = Date.parse("2026-08-01T12:00:00Z");

const inputs = (overrides: Partial<ProbeInputs> = {}): ProbeInputs => ({
  agentVersion: "1",
  runtimeVersion: "llama-swap@4x",
  weights: [{ path: "/models/gemma.gguf", sizeBytes: 16_000, mtimeMs: 1_000 }],
  contextTokens: 32_768,
  parallel: 4,
  servingMode: "managed",
  ...overrides,
});

const probedAgo = (ms: number, current = inputs()) => ({
  fingerprint: fingerprint(current),
  probedAt: new Date(NOW - ms).toISOString(),
  inputs: current,
});

describe("fingerprint", () => {
  it("is stable across reorderings of the same machine", () => {
    // Directory listing order is not a change to the serving path.
    const a = inputs({
      weights: [
        { path: "/models/a.gguf", sizeBytes: 1 },
        { path: "/models/b.gguf", sizeBytes: 2 },
      ],
    });
    const b = inputs({
      weights: [
        { path: "/models/b.gguf", sizeBytes: 2 },
        { path: "/models/a.gguf", sizeBytes: 1 },
      ],
    });
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it("moves when our own code does", () => {
    expect(fingerprint(inputs())).not.toBe(fingerprint(inputs({ agentVersion: "2" })));
  });

  it("moves when weights are replaced in place", () => {
    // Same path, different file. A quantization swapped underneath us is a
    // different serving path wearing the same name.
    const before = inputs();
    const after = inputs({
      weights: [{ path: "/models/gemma.gguf", sizeBytes: 28_000, mtimeMs: 2_000 }],
    });
    expect(fingerprint(before)).not.toBe(fingerprint(after));
  });
});

describe("reprobeReason", () => {
  it("probes when there is nothing to resume from", () => {
    expect(reprobeReason({ current: inputs(), now: NOW })).toBe("no previous probe");
  });

  it("names our own version first when it moved", () => {
    // The layer least likely to prompt anyone to re-probe, and the one that
    // measurement found dominating the result — twice.
    const reason = reprobeReason({
      previous: probedAgo(60_000),
      current: inputs({ agentVersion: "2" }),
      now: NOW,
    });
    expect(reason).toMatch(/agent upgraded \(1 → 2\)/);
  });

  it("names a runtime upgrade", () => {
    const reason = reprobeReason({
      previous: probedAgo(60_000),
      current: inputs({ runtimeVersion: "llama-swap@8x", parallel: 4 }),
      now: NOW,
    });
    expect(reason).toMatch(/runtime upgraded/);
  });

  it("names a change to what is pinned", () => {
    expect(
      reprobeReason({
        previous: probedAgo(60_000),
        current: inputs({ contextTokens: 65_536 }),
        now: NOW,
      }),
    ).toMatch(/context length changed/);
  });

  it("notices weights arriving and leaving", () => {
    const reason = reprobeReason({
      previous: probedAgo(60_000),
      current: inputs({
        weights: [
          { path: "/models/gemma.gguf", sizeBytes: 16_000, mtimeMs: 1_000 },
          { path: "/models/qwen.gguf", sizeBytes: 19_000, mtimeMs: 1_000 },
        ],
      }),
      now: NOW,
    });
    expect(reason).toMatch(/weights changed \(1 added, 0 removed\)/);
  });

  it("falls back to elapsed time for everything it cannot see", () => {
    // A driver update, a firmware change, a warmer room. The timer is the
    // backstop, not the policy.
    const reason = reprobeReason({
      previous: probedAgo(DEFAULT_REPROBE_INTERVAL_MS + 1_000),
      current: inputs(),
      now: NOW,
    });
    expect(reason).toMatch(/last probed \d+h ago/);
  });

  it("says nothing when the machine has not changed and the timer has not run out", () => {
    // A re-probe policy that fires on a timer alone is too eager for a stable
    // machine, and every re-probe costs the machine time it could be earning.
    expect(reprobeReason({ previous: probedAgo(60_000), current: inputs(), now: NOW })).toBeUndefined();
  });

  it("honours a configured interval", () => {
    const previous = probedAgo(2 * 3_600_000);
    expect(
      reprobeReason({ previous, current: inputs(), now: NOW, intervalMs: 1 * 3_600_000 }),
    ).toMatch(/last probed/);
    expect(
      reprobeReason({ previous, current: inputs(), now: NOW, intervalMs: 6 * 3_600_000 }),
    ).toBeUndefined();
  });

  it("re-probes rather than trusting an unreadable timestamp", () => {
    expect(
      reprobeReason({
        previous: { fingerprint: fingerprint(inputs()), probedAt: "not a date" },
        current: inputs(),
        now: NOW,
      }),
    ).toMatch(/no usable timestamp/);
  });

  it("still fires when it cannot name the layer that moved", () => {
    // An older state file with no recorded inputs must not become a state file
    // that never re-probes.
    const reason = reprobeReason({
      previous: { fingerprint: "stale", probedAt: new Date(NOW - 1_000).toISOString() },
      current: inputs(),
      now: NOW,
    });
    expect(reason).toBe("the serving path changed");
  });
});

describe("capabilitiesChanged", () => {
  it("is quiet when a re-probe finds exactly what the last one did", () => {
    // A daily write per Model that says what the last one said is noise, and
    // it makes the real changes harder to see.
    const same = [{ model: "a", capabilities: ["chat", "streaming"] }];
    expect(capabilitiesChanged(same, [{ model: "a", capabilities: ["streaming", "chat"] }])).toEqual(
      { changed: false, summary: [] },
    );
  });

  it("reports a Capability gained", () => {
    const diff = capabilitiesChanged(
      [{ model: "a", capabilities: ["chat"] }],
      [{ model: "a", capabilities: ["chat", "reasoning"] }],
    );
    expect(diff.changed).toBe(true);
    expect(diff.summary[0]).toMatch(/gained reasoning/);
  });

  it("reports a Capability lost", () => {
    const diff = capabilitiesChanged(
      [{ model: "a", capabilities: ["chat", "tool-calling"] }],
      [{ model: "a", capabilities: ["chat"] }],
    );
    expect(diff.summary[0]).toMatch(/lost tool-calling/);
  });

  it("reports Models appearing and disappearing", () => {
    const diff = capabilitiesChanged(
      [{ model: "gone", capabilities: ["chat"] }],
      [{ model: "new", capabilities: ["chat"] }],
    );
    expect(diff.summary).toContain("+ new (new)");
    expect(diff.summary).toContain("- gone (gone)");
  });
});
