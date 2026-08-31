import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewControl } from "./preview-control.js";
import { GaiaRegistryManager } from "./registry.js";
import { HabitatWaker } from "./waker.js";
import type { CredentialAuditLogger } from "./credential-audit.js";

describe("PreviewControl", () => {
  let dir: string;
  let registry: GaiaRegistryManager;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "preview-control-"));
    registry = new GaiaRegistryManager(dir);
    await registry.load();
    await registry.create({ id: "demo", name: "Demo" });
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  function harness(start = vi.fn(async () => 7440)) {
    const logs: unknown[] = [];
    const waker = new HabitatWaker({
      getEntry: (id) => registry.get(id),
      getStatus: async () => "exited",
      start,
    });
    const control = new PreviewControl({
      registry,
      waker,
      audit: { log: async (value: unknown) => void logs.push(value) } as CredentialAuditLogger,
      wakeKey: "wake-only",
      activityKey: "activity-only",
      wakeIntervalMs: 10_000,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });
    return { control, logs, start };
  }

  it("keeps wake and activity credentials narrowly scoped", () => {
    const { control } = harness();
    expect(control.authorizesWake("wake-only")).toBe(true);
    expect(control.authorizesActivity("wake-only")).toBe(false);
    expect(control.authorizesActivity("activity-only")).toBe(true);
    expect(control.authorizesWake("activity-only")).toBe(false);
  });

  it("coalesces concurrent first wakes before applying the per-Habitat rate limit", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const start = vi.fn(async () => {
      await gate;
      return 7440;
    });
    const { control } = harness(start);
    const first = control.wake("demo");
    const second = control.wake("demo");
    release();
    const outcomes = await Promise.all([first, second]);
    expect(start).toHaveBeenCalledOnce();
    expect(outcomes.some((outcome) => outcome.coalesced)).toBe(true);
  });

  it("rate-limits a later wake and audits both attempts", async () => {
    const { control, logs } = harness();
    await control.wake("demo");
    const second = await control.wake("demo");
    expect(second.rateLimited).toBe(true);
    expect(logs).toEqual([
      expect.objectContaining({ operation: "preview_wake_attempt", habitatId: "demo" }),
      expect.objectContaining({ operation: "preview_wake_rate_limited", habitatId: "demo" }),
    ]);
  });

  it("records only a timestamp and touches the named worktree", async () => {
    const touchHabitat = vi.fn(async () => {});
    const withTouch = new PreviewControl({
      registry,
      waker: new HabitatWaker({
        getEntry: (id) => registry.get(id),
        getStatus: async () => "running",
        start: async () => 7440,
      }),
      audit: { log: async () => {} } as CredentialAuditLogger,
      activityKey: "activity-only",
      touchHabitat,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });
    await withTouch.activity("demo", "feature-123");
    expect(registry.get("demo")?.lastPreviewActivityAt).toBe("2026-08-31T12:00:00.000Z");
    expect(touchHabitat).toHaveBeenCalledWith("demo", "feature-123");
  });

  it("never moves preview activity backwards", async () => {
    await registry.update("demo", {
      lastPreviewActivityAt: "2026-08-31T13:00:00.000Z",
    });
    const { control } = harness();
    await control.activity("demo", "primary");
    expect(registry.get("demo")?.lastPreviewActivityAt).toBe(
      "2026-08-31T13:00:00.000Z",
    );
  });
});
