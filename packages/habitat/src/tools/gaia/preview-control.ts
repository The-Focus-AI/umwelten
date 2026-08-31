import type { CredentialAuditLogger } from "./credential-audit.js";
import type { GaiaRegistryManager } from "./registry.js";
import type { HabitatWaker, WakeOutcome } from "./waker.js";

export interface PreviewControlOptions {
  registry: GaiaRegistryManager;
  waker: HabitatWaker;
  audit: CredentialAuditLogger;
  wakeKey?: string;
  activityKey?: string;
  wakeIntervalMs?: number;
  now?: () => Date;
  touchHabitat?: (id: string, worktreeId: string) => Promise<void>;
}

export class PreviewControl {
  private readonly lastWakeAt = new Map<string, number>();
  private readonly now: () => Date;

  constructor(private readonly options: PreviewControlOptions) {
    this.now = options.now ?? (() => new Date());
  }

  authorizesWake(token: string | undefined): boolean {
    return !!this.options.wakeKey && token === this.options.wakeKey;
  }

  authorizesActivity(token: string | undefined): boolean {
    return !!this.options.activityKey && token === this.options.activityKey;
  }

  async wake(id: string): Promise<WakeOutcome & { rateLimited?: boolean }> {
    const now = this.now();
    const last = this.lastWakeAt.get(id);
    const interval = this.options.wakeIntervalMs ?? 10_000;
    if (!this.options.waker.isPending(id) && last !== undefined && now.getTime() - last < interval) {
      await this.audit("preview_wake_rate_limited", id, { interval });
      return {
        id,
        action: "failed",
        detail: `Wake for "${id}" is rate-limited; retry shortly.`,
        rateLimited: true,
      };
    }
    this.lastWakeAt.set(id, now.getTime());
    // Enter the waker's in-flight map before awaiting audit I/O, so another
    // first hit joins this start rather than being mistaken for a later retry.
    const outcome = this.options.waker.wake(id);
    await this.audit("preview_wake_attempt", id);
    return outcome;
  }

  async activity(id: string, worktreeId: string): Promise<boolean> {
    const entry = this.options.registry.get(id);
    if (!entry) return false;
    const observed = this.now();
    const previous = entry.lastPreviewActivityAt
      ? new Date(entry.lastPreviewActivityAt)
      : undefined;
    const timestamp =
      previous && previous.getTime() > observed.getTime()
        ? previous.toISOString()
        : observed.toISOString();
    await this.options.registry.update(id, { lastPreviewActivityAt: timestamp });
    await this.options.touchHabitat?.(id, worktreeId).catch(() => {});
    return true;
  }

  private audit(
    operation: "preview_wake_attempt" | "preview_wake_rate_limited",
    habitatId: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    return this.options.audit.log({
      timestamp: this.now().toISOString(),
      operation,
      habitatId,
      details,
    });
  }
}
