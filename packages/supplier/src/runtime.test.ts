/**
 * Owning the serving process, with the outside world doubled out.
 *
 * What is being asserted is the supervision contract, not llama-swap: a
 * runtime that will not come up produces no Offers, and a runtime we started
 * is not left behind.
 */

import { describe, it, expect } from "vitest";
import { ManagedRuntime, RuntimeStartError } from "./runtime.js";
import type { RuntimeEffects, SpawnedProcess } from "./runtime.js";
import { planManagedRuntime } from "./managed.js";
import type { GgufModel } from "@umwelten/core/providers/llamaswap-config.js";

const DISK: GgufModel[] = [
  { path: "/models/gemma.gguf", baseName: "gemma-4-26b-Q4_K_M", alias: "gemma-4-26b", sizeBytes: 1 },
];

const PLAN = planManagedRuntime({
  managed: {
    models: ["gemma-4-26b"],
    contextTokens: 32_768,
    parallel: 4,
    port: 7439,
    configPath: "/tmp/umwelten-test/llama-swap.yaml",
  },
  available: DISK,
});

interface Fake {
  effects: RuntimeEffects;
  written: { path: string; contents: string }[];
  spawned: { command: string; args: string[] }[];
  signals: string[];
  /** Let the fake process exit with the given status. */
  exit: (code: number | null) => void;
}

function fakeEffects(opts: { readyAfter?: number; stderr?: string } = {}): Fake {
  const written: { path: string; contents: string }[] = [];
  const spawned: { command: string; args: string[] }[] = [];
  const signals: string[] = [];
  let readyPolls = 0;
  let resolveExit: (status: { code: number | null; signal: string | null }) => void = () => {};

  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    resolveExit = resolve;
  });

  const child: SpawnedProcess = {
    pid: 4242,
    exited,
    stderr: () => opts.stderr ?? "",
    kill(signal) {
      signals.push(signal);
      resolveExit({ code: null, signal });
    },
  };

  return {
    written,
    spawned,
    signals,
    exit: (code) => resolveExit({ code, signal: null }),
    effects: {
      writeConfig: (path, contents) => written.push({ path, contents }),
      spawnRuntime: (command, args) => {
        spawned.push({ command, args });
        return child;
      },
      isReady: async () => {
        readyPolls += 1;
        return opts.readyAfter !== undefined && readyPolls >= opts.readyAfter;
      },
      // Instant, so a 60s readiness deadline does not become a 60s test.
      sleep: async () => {},
    },
  };
}

describe("ManagedRuntime.start", () => {
  it("writes the generated configuration before starting anything", async () => {
    const fake = fakeEffects({ readyAfter: 1 });
    const runtime = await ManagedRuntime.start(PLAN, fake.effects);

    expect(fake.written[0].path).toBe(PLAN.configPath);
    expect(fake.written[0].contents).toContain("--ctx-size 32768");
    expect(fake.spawned[0].command).toBe("llama-swap");
    await runtime.stop();
  });

  it("waits until the runtime actually answers", async () => {
    // Returning a runtime that has not answered yet would publish Offers for a
    // serving path that is not serving, and the first Dispatch would find out.
    const fake = fakeEffects({ readyAfter: 5 });
    const runtime = await ManagedRuntime.start(PLAN, fake.effects);
    expect(runtime.baseUrl).toBe("http://127.0.0.1:7439/v1");
    await runtime.stop();
  });

  it("fails loudly when the runtime exits before it is ready", async () => {
    const fake = fakeEffects({ stderr: "error: failed to load model" });
    fake.exit(1);

    await expect(ManagedRuntime.start(PLAN, fake.effects)).rejects.toThrow(RuntimeStartError);
  });

  it("carries the runtime's own complaint into the failure", async () => {
    // An operator debugging a bad quantization needs what llama-server said,
    // not "managed mode failed".
    const fake = fakeEffects({ stderr: "error: failed to load model" });
    fake.exit(1);

    await ManagedRuntime.start(PLAN, fake.effects).catch((error: RuntimeStartError) => {
      expect(error.detail).toContain("failed to load model");
    });
    expect.assertions(1);
  });

  it("does not leave the runtime running when it gives up waiting", async () => {
    // Never ready, deadline passes.
    const fake = fakeEffects();
    await expect(
      ManagedRuntime.start(PLAN, fake.effects, { readyTimeoutMs: 5 }),
    ).rejects.toThrow(/did not answer/);
    expect(fake.signals).toContain("SIGTERM");
  });
});

describe("ManagedRuntime.stop", () => {
  it("takes the runtime down", async () => {
    const fake = fakeEffects({ readyAfter: 1 });
    const runtime = await ManagedRuntime.start(PLAN, fake.effects);
    await runtime.stop();
    expect(fake.signals).toEqual(["SIGTERM"]);
  });

  it("is safe to call twice", async () => {
    // The failure paths and the happy path both stop it, and a double-stop
    // must not throw on the way out of a `finally`.
    const fake = fakeEffects({ readyAfter: 1 });
    const runtime = await ManagedRuntime.start(PLAN, fake.effects);
    await runtime.stop();
    await runtime.stop();
    expect(fake.signals).toEqual(["SIGTERM"]);
  });

  it("registers exit hooks while running and clears them on stop", async () => {
    // The orphan case is Ctrl-C during a long probe run — the path that never
    // reaches stop(). Counting listeners is the closest we get to asserting it
    // without killing the test runner.
    const before = process.listenerCount("SIGINT");
    const fake = fakeEffects({ readyAfter: 1 });
    const runtime = await ManagedRuntime.start(PLAN, fake.effects);

    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    await runtime.stop();
    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
