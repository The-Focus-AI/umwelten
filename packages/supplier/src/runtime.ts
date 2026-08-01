/**
 * Owning the serving process.
 *
 * The half of managed mode that touches the machine: write the generated
 * configuration, start the runtime, wait until it answers, and — the part that
 * matters most — make sure it is gone when we are.
 *
 * Effects are injected so the supervision logic is testable without spawning
 * anything. What is *not* injectable is the exit wiring, because a test double
 * that promises to clean up is not evidence that we do.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ManagedPlan } from "./managed.js";

/** The runtime would not come up. Managed mode publishes nothing. */
export class RuntimeStartError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "RuntimeStartError";
  }
}

export interface SpawnedProcess {
  pid?: number;
  /** Resolves when the process exits, whatever the reason. */
  exited: Promise<{ code: number | null; signal: string | null }>;
  /** Whatever it said on the way down. */
  stderr(): string;
  kill(signal: NodeJS.Signals): void;
}

/**
 * Everything `ManagedRuntime` does to the outside world. Real by default; a
 * test hands in doubles and asserts on the sequence.
 */
export interface RuntimeEffects {
  writeConfig(configPath: string, contents: string): void;
  spawnRuntime(command: string, args: string[]): SpawnedProcess;
  /** True once the runtime answers. Errors are a "not yet", not a failure. */
  isReady(baseUrl: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

export const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;
/** Long enough for llama-swap to stop its children, short enough to not hang. */
const STOP_GRACE_MS = 5_000;

export const nodeRuntimeEffects: RuntimeEffects = {
  writeConfig(configPath, contents) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, contents, "utf8");
  },

  spawnRuntime(command, args) {
    // `detached` puts the runtime in its own process group. That reads like the
    // opposite of what we want, but it is what lets us take down llama-swap
    // *and the llama-server processes it spawned* with one signal — those are
    // the ones that would otherwise sit there holding the GPU. Surviving our
    // own death is handled separately, by the exit hooks below.
    const child = spawn(command, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // Keep the tail only. A runtime that fails is usually loud, and the
      // useful part is the end.
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });

    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.once("exit", (code, signal) => resolve({ code, signal }));
      child.once("error", (error) => {
        stderr += `\n${String(error)}`;
        resolve({ code: null, signal: null });
      });
    });

    return {
      pid: child.pid,
      exited,
      stderr: () => stderr,
      kill(signal) {
        if (child.pid === undefined) return;
        try {
          // Negative pid = the whole group, so children go too.
          process.kill(-child.pid, signal);
        } catch {
          try {
            child.kill(signal);
          } catch {
            /* already gone */
          }
        }
      },
    };
  },

  async isReady(baseUrl) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
        signal: AbortSignal.timeout(2_000),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * A runtime this agent started and is responsible for.
 *
 * Construct through `ManagedRuntime.start`, which either returns a runtime that
 * is answering or throws. There is no third state — a runtime that half-started
 * would be published as an Offer, and the first Dispatch would find out.
 */
export class ManagedRuntime {
  private stopped = false;
  private readonly onProcessExit: () => void;

  private constructor(
    readonly plan: ManagedPlan,
    private readonly child: SpawnedProcess,
    private readonly effects: RuntimeEffects,
  ) {
    // Registered at construction, not at stop() — the whole point is to cover
    // the paths that never reach stop(). Ctrl-C during a two-hour probe run is
    // the normal way this exits, not the exceptional one.
    this.onProcessExit = () => this.killNow();
    process.once("exit", this.onProcessExit);
    process.once("SIGINT", this.onProcessExit);
    process.once("SIGTERM", this.onProcessExit);
    process.once("uncaughtException", this.onProcessExit);
  }

  get baseUrl(): string {
    return this.plan.baseUrl;
  }

  /** Recorded so a start after an unclean shutdown can reap what we left. */
  get pid(): number | undefined {
    return this.child.pid;
  }

  /** Has the runtime we started stopped answering? */
  isAlive(): Promise<boolean> {
    return this.effects.isReady(this.plan.baseUrl);
  }

  static async start(
    plan: ManagedPlan,
    effects: RuntimeEffects = nodeRuntimeEffects,
    opts: { readyTimeoutMs?: number; onProgress?: (line: string) => void } = {},
  ): Promise<ManagedRuntime> {
    const log = opts.onProgress ?? (() => {});
    const timeoutMs = opts.readyTimeoutMs ?? READY_TIMEOUT_MS;

    effects.writeConfig(plan.configPath, plan.config);
    log(`wrote ${plan.configPath} — ${plan.models.length} model(s)`);

    const child = effects.spawnRuntime(plan.command, plan.args);
    log(`started ${plan.command} (pid ${child.pid ?? "?"}) on ${plan.baseUrl}`);

    let exitedEarly: { code: number | null; signal: string | null } | undefined;
    void child.exited.then((status) => {
      exitedEarly = status;
    });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (exitedEarly) {
        throw new RuntimeStartError(
          `${plan.command} exited before it was ready (code ${exitedEarly.code ?? "null"}).`,
          child.stderr().trim() || undefined,
        );
      }
      if (await effects.isReady(plan.baseUrl)) {
        log(`${plan.command} is answering`);
        return new ManagedRuntime(plan, child, effects);
      }
      await effects.sleep(READY_POLL_MS);
    }

    // Do not leave it running just because we gave up waiting.
    child.kill("SIGTERM");
    throw new RuntimeStartError(
      `${plan.command} did not answer on ${plan.baseUrl} within ${Math.round(timeoutMs / 1000)}s.`,
      child.stderr().trim() || undefined,
    );
  }

  /** Ask nicely, then insist. */
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.unhook();

    this.child.kill("SIGTERM");
    const settled = await Promise.race([
      this.child.exited.then(() => true),
      this.effects.sleep(STOP_GRACE_MS).then(() => false),
    ]);
    if (!settled) this.child.kill("SIGKILL");
  }

  /** Synchronous best effort, for the exit paths that cannot await. */
  private killNow(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unhook();
    try {
      this.child.kill("SIGTERM");
    } catch {
      /* nothing useful to do while the process is on its way out */
    }
  }

  private unhook(): void {
    process.off("exit", this.onProcessExit);
    process.off("SIGINT", this.onProcessExit);
    process.off("SIGTERM", this.onProcessExit);
    process.off("uncaughtException", this.onProcessExit);
  }
}
