import type {
  ContainerHealthStatus,
  ContainerStatus,
  GaiaHabitatEntry,
} from "./types.js";
import type { HostResourceSnapshot } from "./host-resources.js";

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_FAILURE_THRESHOLD = 3;

export interface ChildHealthMonitorDeps {
  listEntries: () => GaiaHabitatEntry[];
  getStatus: (id: string) => Promise<ContainerStatus>;
  getHealthStatus: (id: string) => Promise<ContainerHealthStatus>;
  restart: (id: string) => Promise<unknown>;
  sampleHostResources?: () => Promise<HostResourceSnapshot>;
  intervalMs?: number;
  failureThreshold?: number;
  log?: (message: string) => void;
}

export class ChildHealthMonitor {
  private readonly failures = new Map<string, number>();
  private readonly activeWarnings = new Set<string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: ChildHealthMonitorDeps) {
    this.log = deps.log ?? ((message) => console.log(message));
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(
      () => void this.tick(),
      this.deps.intervalMs ?? DEFAULT_INTERVAL_MS,
    );
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all([
        ...this.deps.listEntries().map((entry) => this.checkChild(entry)),
        this.checkResources(),
      ]);
    } finally {
      this.running = false;
    }
  }

  private async checkChild(entry: GaiaHabitatEntry): Promise<void> {
    // No recorded port means an operator or the idle reaper deliberately
    // stopped it. Never turn dormant capacity back on from this monitor.
    if (!entry.containerPort) {
      this.failures.delete(entry.id);
      return;
    }

    let reason: string | undefined;
    try {
      const status = await this.deps.getStatus(entry.id);
      if (["created", "exited", "dead", "not-found"].includes(status)) {
        reason = `container is ${status}`;
      } else if (status === "running") {
        const health = await this.deps.getHealthStatus(entry.id);
        if (health === "unhealthy" || health === "not-found") {
          reason = `health check is ${health}`;
        }
      }
    } catch (error) {
      reason = `status probe failed: ${error instanceof Error ? error.message : String(error)}`;
    }

    if (!reason) {
      this.failures.delete(entry.id);
      return;
    }

    const failures = (this.failures.get(entry.id) ?? 0) + 1;
    this.failures.set(entry.id, failures);
    const threshold = this.deps.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.log(`[health] ${entry.id}: ${reason} (${failures}/${threshold})`);
    if (failures < threshold) return;

    try {
      await this.deps.restart(entry.id);
      this.failures.delete(entry.id);
      this.log(`[health] ${entry.id}: restarted after ${failures} failed checks`);
    } catch (error) {
      this.log(
        `[health] ${entry.id}: restart failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async checkResources(): Promise<void> {
    if (!this.deps.sampleHostResources) return;
    try {
      const snapshot = await this.deps.sampleHostResources();
      const current = new Map(
        snapshot.warnings.map((warning) => [warning.split(" is ", 1)[0], warning]),
      );
      for (const [key, warning] of current) {
        if (!this.activeWarnings.has(key)) {
          this.log(`[resources] WARNING: ${warning}`);
        }
      }
      if (this.activeWarnings.size && !current.size) {
        this.log("[resources] Host resource pressure recovered");
      }
      this.activeWarnings.clear();
      for (const key of current.keys()) this.activeWarnings.add(key);
    } catch (error) {
      this.log(
        `[resources] Probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
