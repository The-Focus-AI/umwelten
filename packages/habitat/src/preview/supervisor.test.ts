import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { PreviewSupervisor, type PreviewProcess } from "./supervisor.js";

class FakeProcess extends EventEmitter implements PreviewProcess {
  pid = 999_999;
  stdout = new PassThrough();
  stderr = new PassThrough();
  kill = vi.fn(() => true);

  exit(code: number | null): void {
    this.emit("exit", code);
  }
}

interface ScheduledTimer {
  callback: () => void;
  delay: number;
  timer: NodeJS.Timeout;
}

function harness(
  discoverPorts: (
    pid: number,
  ) => Promise<Array<{ port: number; loopbackOnly: boolean }>> = async () => [],
) {
  const processes: FakeProcess[] = [];
  const timers: ScheduledTimer[] = [];
  const supervisor = new PreviewSupervisor({
    projectDir: "/project",
    projectId: "demo",
    branch: "feature/client-review",
    previewSuffix: "a1b2c3d4e5f60718293a4b5c",
    secrets: ["secret-token"],
    spawnProcess: () => {
      const child = new FakeProcess();
      processes.push(child);
      return child;
    },
    discoverPorts,
    setTimer: (callback, delay) => {
      const timer = {} as NodeJS.Timeout;
      timers.push({ callback, delay, timer });
      return timer;
    },
    clearTimer: (timer) => {
      const index = timers.findIndex((scheduled) => scheduled.timer === timer);
      if (index >= 0) timers.splice(index, 1);
    },
  });
  return { supervisor, processes, timers };
}

async function runNext(timers: ScheduledTimer[]): Promise<number> {
  const next = timers.shift();
  if (!next) throw new Error("No scheduled timer");
  next.callback();
  await Promise.resolve();
  await Promise.resolve();
  return next.delay;
}

describe("PreviewSupervisor", () => {
  it("settles a clean task with no listeners as no-service", () => {
    const { supervisor, processes, timers } = harness();
    supervisor.start();
    processes[0].exit(0);

    expect(supervisor.status().snapshot).toEqual({ status: "no-service" });
    expect(timers).toHaveLength(0);
  });

  it("publishes sorted reachable listeners and restarts a clean server exit", async () => {
    const { supervisor, processes, timers } = harness(async () => [
      { port: 8080, loopbackOnly: false },
      { port: 3000, loopbackOnly: false },
    ]);
    supervisor.start();
    await runNext(timers);

    expect(supervisor.status().snapshot).toEqual({
      status: "serving",
      addresses: [
        "https://demo-feature-client-review-1-a1b2c3d4e5f60718293a4b5c.preview.crepusculardiphthong.com",
        "https://demo-feature-client-review-2-a1b2c3d4e5f60718293a4b5c.preview.crepusculardiphthong.com",
      ],
    });

    processes[0].exit(0);
    expect(await runNext(timers)).toBe(0);
    expect(processes).toHaveLength(2);
  });

  it("names loopback-only binding failures", async () => {
    const { supervisor, timers } = harness(async () => [
      { port: 5173, loopbackOnly: true },
    ]);
    supervisor.start();
    await runNext(timers);

    expect(supervisor.status().snapshot).toEqual({
      status: "failing",
      error: expect.stringContaining("Bind the dev server to 0.0.0.0 or ::"),
    });
  });

  it("bounds failure backoff and exposes only redacted logs", async () => {
    const { supervisor, processes, timers } = harness();
    supervisor.start();
    processes[0].stderr.write("credential=secret-token\n");
    processes[0].exit(1);
    expect(supervisor.status().logs).toContain("credential=[REDACTED]");
    expect(await runNext(timers)).toBe(1_000);

    for (const expected of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      processes.at(-1)?.exit(1);
      expect(await runNext(timers)).toBe(expected);
    }
  });

  it("kills the process and cancels polling when the Habitat stops", async () => {
    const { supervisor, processes, timers } = harness();
    supervisor.start();
    await supervisor.stop();

    expect(timers).toHaveLength(0);
    expect(processes).toHaveLength(1);
    expect(processes[0].kill).toHaveBeenCalledWith("SIGTERM");
  });
});
