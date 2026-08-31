import { spawn } from "node:child_process";
import { readFile, readdir, readlink } from "node:fs/promises";
import {
  assignPreviewOrdinals,
  previewLabel,
} from "../tools/gaia/preview-address.js";
import {
  decidePreviewExit,
  discoverPreviewPorts,
  RedactedLogBuffer,
  type DiscoveredPreviewPort,
  type PreviewSupervisorSnapshot,
} from "./supervisor-state.js";
import type { GaiaPublishedPreview } from "../tools/gaia/types.js";

export interface PreviewProcess {
  pid?: number;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number | null) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface PreviewSupervisorOptions {
  projectDir: string;
  projectId: string;
  branch: string;
  worktreeId?: string;
  previewSuffix: string;
  domain?: string;
  secrets?: readonly string[];
  pollIntervalMs?: number;
  maxBackoffMs?: number;
  spawnProcess?: () => PreviewProcess;
  discoverPorts?: (pid: number) => Promise<DiscoveredPreviewPort[]>;
  setTimer?: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  onStatusChange?: (status: PreviewStatus) => void;
}

export interface PreviewStatus {
  worktreeId: string;
  branch: string;
  snapshot: PreviewSupervisorSnapshot;
  logs: string;
  previews: GaiaPublishedPreview[];
}

async function descendants(
  pid: number,
  result = new Set<number>(),
): Promise<Set<number>> {
  if (result.has(pid)) return result;
  result.add(pid);
  try {
    const children = await readFile(
      `/proc/${pid}/task/${pid}/children`,
      "utf8",
    );
    for (const child of children.trim().split(/\s+/).filter(Boolean)) {
      await descendants(Number(child), result);
    }
  } catch {
    // A process may exit while /proc is being inspected.
  }
  return result;
}

/** Linux implementation kept behind the injected `discoverPorts` seam. */
export async function discoverProcessTreePorts(
  pid: number,
): Promise<DiscoveredPreviewPort[]> {
  const inodes = new Set<string>();
  for (const processId of await descendants(pid)) {
    let descriptors: string[];
    try {
      descriptors = await readdir(`/proc/${processId}/fd`);
    } catch {
      continue;
    }
    await Promise.all(
      descriptors.map(async (descriptor) => {
        try {
          const target = await readlink(`/proc/${processId}/fd/${descriptor}`);
          const match = /^socket:\[(\d+)\]$/.exec(target);
          if (match) inodes.add(match[1]);
        } catch {
          // Descriptor disappeared between readdir and readlink.
        }
      }),
    );
  }

  const tables = await Promise.all(
    (
      [
        ["ipv4", "/proc/net/tcp"],
        ["ipv6", "/proc/net/tcp6"],
      ] as const
    ).map(async ([family, path]) => ({
      family,
      text: await readFile(path, "utf8").catch(() => ""),
    })),
  );
  return discoverPreviewPorts(tables, inodes);
}

function defaultSpawn(projectDir: string): PreviewProcess {
  return spawn("mise", ["dev"], {
    cwd: projectDir,
    detached: true,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export class PreviewSupervisor {
  private readonly logs: RedactedLogBuffer;
  private readonly pollIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly spawnProcess: () => PreviewProcess;
  private readonly discoverPorts: (
    pid: number,
  ) => Promise<DiscoveredPreviewPort[]>;
  private readonly setTimer: NonNullable<PreviewSupervisorOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<
    PreviewSupervisorOptions["clearTimer"]
  >;
  private snapshot: PreviewSupervisorSnapshot = { status: "starting" };
  private child: PreviewProcess | undefined;
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;
  private everListened = false;
  private failures = 0;
  private generation = 0;
  private previews: GaiaPublishedPreview[] = [];
  private lastNotification = "";

  constructor(private readonly options: PreviewSupervisorOptions) {
    this.logs = new RedactedLogBuffer(options.secrets ?? []);
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.spawnProcess =
      options.spawnProcess ?? (() => defaultSpawn(options.projectDir));
    this.discoverPorts = options.discoverPorts ?? discoverProcessTreePorts;
    this.setTimer =
      options.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  start(): void {
    if (this.child || this.stopped) return;
    this.launch();
  }

  status(): PreviewStatus {
    return {
      worktreeId: this.options.worktreeId ?? "primary",
      branch: this.options.branch,
      snapshot: this.snapshot,
      logs: this.logs.tail(),
      previews: this.previews,
    };
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.snapshot = { status: "stopped" };
    this.previews = this.previews.map((preview) => ({
      ...preview,
      status: "stopped",
      error: "Preview server is stopped and will restart when requested.",
    }));
    this.notify();
    this.generation += 1;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = undefined;
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGTERM");
        return;
      } catch {
        // Fall back when the injected process is not a process-group leader.
      }
    }
    child.kill("SIGTERM");
  }

  private launch(): void {
    if (this.stopped) return;
    this.snapshot = { status: "starting" };
    this.everListened = false;
    const generation = ++this.generation;
    let child: PreviewProcess;
    try {
      child = this.spawnProcess();
    } catch (error) {
      this.handleFailure(error, generation);
      return;
    }
    this.child = child;
    child.stdout?.on("data", (chunk) => this.logs.append(String(chunk)));
    child.stderr?.on("data", (chunk) => this.logs.append(String(chunk)));
    child.on("error", (error) => this.handleFailure(error, generation));
    child.on("exit", (code) => this.handleExit(code, generation));
    this.schedulePoll(generation, 0);
  }

  private schedulePoll(generation: number, delay: number): void {
    this.timer = this.setTimer(() => void this.poll(generation), delay);
  }

  private async poll(generation: number): Promise<void> {
    const child = this.child;
    if (this.stopped || generation !== this.generation || !child?.pid) return;
    try {
      const ports = await this.discoverPorts(child.pid);
      if (this.stopped || generation !== this.generation) return;
      if (ports.length > 0) this.everListened = true;
      const reachable = ports.filter((port) => !port.loopbackOnly);
      if (ports.length > 0 && reachable.length === 0) {
        this.snapshot = {
          status: "failing",
          error:
            "Preview listens only on loopback. Bind the dev server to 0.0.0.0 or :: so Gaia can route it.",
        };
        this.markPreviewsFailing(this.snapshot.error);
      } else if (reachable.length > 0) {
        this.failures = 0;
        const assigned = assignPreviewOrdinals(
          reachable.map(({ port }) => port),
        );
        this.previews = assigned.map(({ port, ordinal }) => ({
          worktreeId: this.options.worktreeId ?? "primary",
          branch: this.options.branch,
          port,
          ordinal,
          status: "serving",
        }));
        const addresses = assigned.map(
          ({ ordinal }) =>
            `https://${previewLabel(this.options.projectId, this.options.branch, ordinal, this.options.previewSuffix)}.${this.options.domain ?? "preview.crepusculardiphthong.com"}`,
        );
        this.snapshot = { status: "serving", addresses };
      } else if (this.everListened) {
        this.snapshot = { status: "starting" };
      }
    } catch (error) {
      this.snapshot = {
        status: "failing",
        error: `Could not inspect preview listeners: ${error instanceof Error ? error.message : String(error)}`,
      };
      this.markPreviewsFailing(this.snapshot.error);
    }
    this.notify();
    this.schedulePoll(generation, this.pollIntervalMs);
  }

  private handleFailure(error: unknown, generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    this.generation += 1;
    if (this.timer) this.clearTimer(this.timer);
    this.logs.append(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    this.child = undefined;
    this.snapshot = {
      status: "failing",
      error: error instanceof Error ? error.message : String(error),
    };
    this.markPreviewsFailing(this.snapshot.error);
    this.notify();
    this.scheduleRestart(true);
  }

  private handleExit(code: number | null, generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    this.child = undefined;
    if (this.timer) this.clearTimer(this.timer);
    const decision = decidePreviewExit(code, this.everListened);
    if (decision.kind === "no-service") {
      this.snapshot = { status: "no-service" };
      this.previews = [];
      this.notify();
      return;
    }
    if (decision.kind === "backoff") {
      this.snapshot = {
        status: "failing",
        error:
          code === null
            ? "Preview process was terminated"
            : `Preview process exited with code ${code}`,
      };
      this.markPreviewsFailing(this.snapshot.error);
    }
    this.notify();
    this.scheduleRestart(decision.kind === "backoff");
  }

  private scheduleRestart(backoff: boolean): void {
    if (this.stopped) return;
    const delay = backoff
      ? Math.min(1_000 * 2 ** this.failures++, this.maxBackoffMs)
      : 0;
    this.timer = this.setTimer(() => this.launch(), delay);
  }

  private markPreviewsFailing(error: string): void {
    this.previews = this.previews.map((preview) => ({
      ...preview,
      status: "failing",
      error,
    }));
  }

  private notify(): void {
    const key = JSON.stringify({ snapshot: this.snapshot, previews: this.previews });
    if (key === this.lastNotification) return;
    this.lastNotification = key;
    this.options.onStatusChange?.(this.status());
  }
}
