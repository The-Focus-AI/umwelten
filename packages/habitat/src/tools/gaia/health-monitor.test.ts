import { afterEach, describe, expect, it, vi } from "vitest";
import { ChildHealthMonitor } from "./health-monitor.js";
import type { GaiaHabitatEntry } from "./types.js";

function entry(id: string, running = true): GaiaHabitatEntry {
  return {
    id,
    name: id,
    config: { name: id, agents: [] },
    secretBindings: [],
    apiKey: "key",
    containerPort: running ? 7440 : undefined,
    createdAt: "2026-09-02T00:00:00.000Z",
  };
}

afterEach(() => vi.useRealTimers());

describe("ChildHealthMonitor", () => {
  it("restarts a dead expected child after consecutive failures", async () => {
    const restart = vi.fn(async () => {});
    const monitor = new ChildHealthMonitor({
      listEntries: () => [entry("dead")],
      getStatus: async () => "exited",
      getHealthStatus: async () => "not-found",
      restart,
      failureThreshold: 3,
      log: () => {},
    });
    await monitor.tick();
    await monitor.tick();
    expect(restart).not.toHaveBeenCalled();
    await monitor.tick();
    expect(restart).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledWith("dead");
  });

  it("restarts a process that remains Docker-unhealthy", async () => {
    const restart = vi.fn(async () => {});
    const monitor = new ChildHealthMonitor({
      listEntries: () => [entry("sick")],
      getStatus: async () => "running",
      getHealthStatus: async () => "unhealthy",
      restart,
      failureThreshold: 2,
      log: () => {},
    });
    await monitor.tick();
    await monitor.tick();
    expect(restart).toHaveBeenCalledWith("sick");
  });

  it("never restarts a deliberately dormant child", async () => {
    const getStatus = vi.fn(async () => "exited" as const);
    const restart = vi.fn(async () => {});
    const monitor = new ChildHealthMonitor({
      listEntries: () => [entry("dormant", false)],
      getStatus,
      getHealthStatus: async () => "unhealthy",
      restart,
      failureThreshold: 1,
      log: () => {},
    });
    await monitor.tick();
    expect(getStatus).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it("clears a partial failure streak after recovery", async () => {
    const getStatus = vi
      .fn<() => Promise<"exited" | "running">>()
      .mockResolvedValueOnce("exited")
      .mockResolvedValueOnce("running")
      .mockResolvedValueOnce("exited")
      .mockResolvedValueOnce("exited");
    const restart = vi.fn(async () => {});
    const monitor = new ChildHealthMonitor({
      listEntries: () => [entry("flap")],
      getStatus,
      getHealthStatus: async () => "healthy",
      restart,
      failureThreshold: 2,
      log: () => {},
    });
    await monitor.tick();
    await monitor.tick();
    await monitor.tick();
    expect(restart).not.toHaveBeenCalled();
    await monitor.tick();
    expect(restart).toHaveBeenCalledOnce();
  });

  it("logs resource pressure once per condition and logs recovery", async () => {
    const log = vi.fn();
    const sampleHostResources = vi
      .fn()
      .mockResolvedValueOnce({ warnings: ["Host memory available is 0.50 GiB"] })
      .mockResolvedValueOnce({ warnings: ["Host memory available is 0.40 GiB"] })
      .mockResolvedValueOnce({ warnings: [] });
    const monitor = new ChildHealthMonitor({
      listEntries: () => [],
      getStatus: async () => "not-found",
      getHealthStatus: async () => "not-found",
      restart: async () => {},
      sampleHostResources,
      log,
    });
    await monitor.tick();
    await monitor.tick();
    await monitor.tick();
    expect(log.mock.calls.flat().filter((line) => line.includes("WARNING"))).toHaveLength(1);
    expect(log).toHaveBeenCalledWith("[resources] Host resource pressure recovered");
  });

  it("stops its periodic checks", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn(async () => "running" as const);
    const monitor = new ChildHealthMonitor({
      listEntries: () => [entry("live")],
      getStatus,
      getHealthStatus: async () => "healthy",
      restart: async () => {},
      intervalMs: 100,
      log: () => {},
    });
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(getStatus).toHaveBeenCalledOnce();
    monitor.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(getStatus).toHaveBeenCalledOnce();
  });
});
