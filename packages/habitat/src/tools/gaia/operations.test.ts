import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GaiaOperations,
  type OperationsDeps,
  type OperationalTelemetry,
} from "./operations.js";
import type { GaiaHabitatEntry } from "./types.js";
import type { HostResourceSnapshot } from "./host-resources.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
const entry = (id: string): GaiaHabitatEntry => ({
  id,
  name: id,
  config: { agents: [] },
  secretBindings: [],
  apiKey: `private-${id}`,
  hostname: `${id}.example.test`,
  containerPort: 7440,
  createdAt: "2026-11-01T00:00:00.000Z",
});
async function fixture(overrides: Partial<OperationsDeps> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "gaia-operations-"));
  dirs.push(dir);
  let now = Date.parse("2026-11-04T12:00:00Z");
  const entries = [entry("a"), entry("b")];
  const telemetry = (): OperationalTelemetry => ({
    version: 1,
    observedAt: new Date(now).toISOString(),
    tasks: { active: 0, waiting: 0, oldestActiveAt: null },
    executions: {
      count: 2,
      errors: 0,
      slow: 0,
      tokens: 50,
      cost: 0.01,
      available: true,
      truncated: false,
    },
    runtimeErrors: 0,
    configurationReady: true,
  });
  const deps: OperationsDeps = {
    file: join(dir, "operations.json"),
    listEntries: () => entries,
    getStatus: async () => "running",
    getHealthStatus: async () => "healthy",
    telemetry: async () => telemetry(),
    resources: async () =>
      ({ warnings: [] }) as unknown as HostResourceSnapshot,
    registryConfig: () => ({
      url: "https://registry.example.test",
      secret: "private-registry",
      workspace: "selected-workspace",
    }),
    announce: async () => ({ ok: true }),
    now: () => now,
    ...overrides,
  };
  const ops = new GaiaOperations(deps);
  await ops.load();
  return {
    ops,
    deps,
    entries,
    telemetry,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const active = (ops: GaiaOperations, subject = "a") =>
  ops
    .snapshot(subject)
    .conditions.filter((c) => c.state === "active")
    .map((c) => c.code);

describe("Gaia operational reconciliation", () => {
  it("requires an explicit destination before transmitting a child credential", async () => {
    let calls = 0;
    const f = await fixture({
      registryConfig: () => ({
        url: "https://registry.example.test",
        secret: "private",
      }),
      announce: async () => {
        calls++;
        return { ok: true };
      },
    });
    await f.ops.tick();
    expect(calls).toBe(0);
    expect(active(f.ops)).toContain("registration-destination");
  });

  it("persists a blocked 409 and retries only after a destination decision, without leaking errors", async () => {
    let announcements = 0;
    const f = await fixture({
      announce: async (e) => {
        announcements++;
        return e.saasRegistration
          ? { ok: true }
          : { ok: false, status: 409, reason: "secret financial text" };
      },
    });
    f.entries.splice(1);
    await f.ops.tick();
    const restarted = new GaiaOperations(f.deps);
    await restarted.load();
    f.advance(3_600_000);
    await restarted.tick();
    expect(announcements).toBe(1);
    expect(active(restarted)).toContain("registration-destination");
    expect(JSON.stringify(restarted.snapshot())).not.toMatch(
      /private-|secret financial/,
    );
    expect(await readFile(f.deps.file, "utf8")).not.toMatch(
      /private-|secret financial/,
    );
    f.entries[0].saasRegistration = {
      organizationId: "org-one",
      workspaceId: "workspace-one",
    };
    await restarted.tick();
    expect(announcements).toBe(2);
    expect(active(restarted)).not.toContain("registration-destination");
    expect(
      restarted
        .snapshot("a")
        .conditions.find((c) => c.code === "registration-destination")
        ?.resolvedAt,
    ).toBeDefined();
  });

  it("backs off transient failures across restarts and recovers without restarting children", async () => {
    let calls = 0;
    const f = await fixture({
      announce: async () => {
        calls++;
        return calls < 3
          ? { ok: false, status: 503, reason: "unsafe" }
          : { ok: true };
      },
    });
    f.entries.splice(1);
    await f.ops.tick();
    f.advance(29_999);
    await f.ops.tick();
    expect(calls).toBe(1);
    const restarted = new GaiaOperations(f.deps);
    await restarted.load();
    f.advance(1);
    await restarted.tick();
    expect(calls).toBe(2);
    f.advance(59_999);
    await restarted.tick();
    expect(calls).toBe(2);
    f.advance(1);
    await restarted.tick();
    expect(calls).toBe(3);
    expect(active(restarted)).not.toContain("registration-transient");
  });

  it("does not probe or wake dormant containers even with their retained port", async () => {
    const f = await fixture({
      getStatus: async () => "not-found",
      telemetry: async () => {
        throw new Error("must not probe");
      },
      restart: async () => {
        throw new Error("must not wake");
      },
      recoveryEnabled: true,
    });
    for (let n = 0; n < 4; n++) await f.ops.tick();
    expect(active(f.ops)).toEqual([]);
    expect(f.ops.snapshot()).toMatchObject({ actions: [] });
  });

  it("separates waiting work from stalled active tasks and scopes child summaries", async () => {
    const f = await fixture();
    f.deps.telemetry = async (e) => ({
      ...f.telemetry(),
      tasks:
        e.id === "a"
          ? { active: 0, waiting: 2, oldestActiveAt: null }
          : {
              active: 1,
              waiting: 0,
              oldestActiveAt: "2026-11-04T10:00:00.000Z",
            },
    });
    await f.ops.tick();
    await f.ops.tick();
    expect(active(f.ops)).toEqual(["waiting-input"]);
    expect(active(f.ops, "b")).toContain("long-running");
    expect(f.ops.snapshot("a").conditions.every((c) => c.subject === "a")).toBe(
      true,
    );
    expect(f.ops.snapshot("a")).not.toHaveProperty("investigations");
    expect(f.ops.snapshot()).toMatchObject({
      investigations: expect.arrayContaining([
        expect.objectContaining({ conditionId: "b:long-running" }),
      ]),
    });
    const full = f.ops.snapshot();
    expect(
      "investigations" in full &&
        full.investigations.filter((i) => i.conditionId === "b:long-running"),
    ).toHaveLength(1);
    f.advance(120_001);
    expect(f.ops.snapshot("a").stale).toBe(true);
    f.advance(-120_002);
    expect(f.ops.snapshot("a").stale).toBe(true);
    expect(f.ops.snapshot().stale).toBe(true);
  });

  it("retains unhealthy evidence until an actual healthy observation", async () => {
    const f = await fixture({ getHealthStatus: async () => "unhealthy" });
    await f.ops.tick();
    for (const health of ["starting", "none", "not-found"] as const) {
      f.deps.getHealthStatus = async () => health;
      await f.ops.tick();
      expect(active(f.ops)).toContain("runtime-unhealthy");
    }
    f.deps.getStatus = async () => "not-found";
    await f.ops.tick();
    expect(active(f.ops)).toContain("runtime-unhealthy");
    f.deps.getStatus = async () => "running";
    f.deps.getHealthStatus = async () => "healthy";
    await f.ops.tick();
    expect(active(f.ops)).not.toContain("runtime-unhealthy");
  });

  it("requires three new unhealthy samples after a failed status probe", async () => {
    let restarts = 0;
    const f = await fixture({
      getHealthStatus: async () => "unhealthy",
      recoveryEnabled: true,
      restart: async () => {
        restarts++;
      },
    });
    f.entries.splice(1);
    await f.ops.tick();
    await f.ops.tick();
    f.deps.getStatus = async () => {
      throw new Error("unavailable");
    };
    await f.ops.tick();
    f.deps.getStatus = async () => "running";
    await f.ops.tick();
    await f.ops.tick();
    expect(restarts).toBe(0);
    await f.ops.tick();
    expect(restarts).toBe(1);
  });

  it("requires policy, consecutive failures and idle work; persists cooldown and verifies later", async () => {
    let restarts = 0;
    const f = await fixture({
      getHealthStatus: async () => "unhealthy",
      restart: async () => {
        restarts++;
      },
    });
    f.entries.splice(1);
    for (let n = 0; n < 4; n++) await f.ops.tick();
    expect(restarts).toBe(0);
    f.deps.recoveryEnabled = true;
    f.deps.telemetry = async () => ({
      ...f.telemetry(),
      tasks: { active: 1, waiting: 0, oldestActiveAt: null },
    });
    await f.ops.tick();
    expect(restarts).toBe(0);
    f.deps.telemetry = async () => f.telemetry();
    await f.ops.tick();
    expect(restarts).toBe(1);
    expect(f.ops.snapshot()).toMatchObject({
      actions: [expect.objectContaining({ outcome: "pending-verification" })],
    });
    const restarted = new GaiaOperations(f.deps);
    await restarted.load();
    for (let n = 0; n < 4; n++) await restarted.tick();
    expect(restarts).toBe(1);
    f.deps.getHealthStatus = async () => "healthy";
    await restarted.tick();
    expect(restarted.snapshot()).toMatchObject({
      actions: [expect.objectContaining({ outcome: "verified" })],
    });
    expect(active(restarted)).not.toContain("runtime-unhealthy");
  });

  it("preserves the fleet-wide daily restart budget across Gaia restarts", async () => {
    let restarts = 0;
    const f = await fixture({
      getHealthStatus: async () => "unhealthy",
      recoveryEnabled: true,
      restart: async () => {
        restarts++;
      },
    });
    f.entries.push(entry("c"), entry("d"));
    for (let n = 0; n < 3; n++) await f.ops.tick();
    expect(restarts).toBe(3);
    const restarted = new GaiaOperations(f.deps);
    await restarted.load();
    f.advance(86_400_000 - 1);
    for (let n = 0; n < 3; n++) await restarted.tick();
    expect(restarts).toBe(3);
    f.advance(1);
    await restarted.tick();
    expect(restarts).toBe(6);
  });

  it("denies recovery when work arrives after the observation", async () => {
    let restarts = 0;
    const f = await fixture({
      getHealthStatus: async () => "unhealthy",
      recoveryEnabled: true,
      restart: async () => {
        restarts++;
      },
    });
    f.entries.splice(1);
    await f.ops.tick();
    await f.ops.tick();
    let samples = 0;
    f.deps.telemetry = async () => ({
      ...f.telemetry(),
      tasks: {
        active: 0,
        waiting: samples++ === 0 ? 0 : 1,
        oldestActiveAt: null,
      },
    });
    await f.ops.tick();
    expect(restarts).toBe(0);
    expect(f.ops.snapshot()).toMatchObject({ actions: [] });
  });

  it("never recovers when telemetry is unavailable, and never overwrites corrupt durable state", async () => {
    let restarts = 0;
    const f = await fixture({
      getHealthStatus: async () => "unhealthy",
      telemetry: async () => {
        throw new Error("private");
      },
      recoveryEnabled: true,
      restart: async () => {
        restarts++;
      },
    });
    for (let n = 0; n < 4; n++) await f.ops.tick();
    expect(restarts).toBe(0);
    expect(active(f.ops)).toContain("telemetry-unavailable");
    await writeFile(f.deps.file, "invalid");
    await expect(new GaiaOperations(f.deps).load()).rejects.toThrow();
    expect(await readFile(f.deps.file, "utf8")).toBe("invalid");
  });
});
