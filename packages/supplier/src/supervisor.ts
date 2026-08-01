/**
 * Keeping the Exchange's picture of this machine honest while it runs.
 *
 * Failure is a **withdrawal, not a silence**. An agent that simply stops
 * publishing leaves the Exchange holding stale Offers until they expire; an
 * agent that withdraws says so the moment it knows. Both mechanisms exist and
 * overlap on purpose, so neither is the single point of failure — the Exchange
 * expires Offers from a Supplier that has gone quiet, and this withdraws
 * immediately.
 *
 * Withdrawal is per-Offer. One Model failing to load must not take a machine's
 * other working Offers down with it.
 *
 * Pure state machine: feed it outcomes, ask it what to publish. No network, no
 * process, no clock of its own.
 */

import type { OfferDraft } from "./types.js";

/**
 * Consecutive failures before an Offer is withdrawn.
 *
 * Not one. A single timeout under momentary load would take an Offer out and
 * the next success would put it back, and an Offer that flaps in and out of the
 * pool is worse for Dispatch than one that is honestly down — routing keeps
 * selecting it during the up phases. Three consecutive failures across a
 * ~30 second check interval means roughly a minute and a half of being
 * genuinely unable to serve before the pool hears about it.
 *
 * Recovery is deliberately asymmetric: **one** success restores. Being slow to
 * withdraw costs a buyer a failed request; being slow to restore costs the
 * Supplier money for a machine that is working.
 */
export const WITHDRAW_AFTER_FAILURES = 3;

export interface OfferHealth {
  model: string;
  consecutiveFailures: number;
  withdrawn: boolean;
  /** Why it was withdrawn, kept so an operator never has to guess. */
  reason?: string;
  /** When the current state began. */
  since: string;
}

/** What changed, so a caller knows whether to republish and what to say. */
export interface SupervisorChange {
  changed: boolean;
  withdrawn: string[];
  restored: string[];
  notes: string[];
}

const NO_CHANGE: SupervisorChange = { changed: false, withdrawn: [], restored: [], notes: [] };

export class OfferSupervisor {
  private readonly drafts = new Map<string, OfferDraft>();
  private readonly health = new Map<string, OfferHealth>();

  constructor(
    drafts: OfferDraft[],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.replace(drafts);
  }

  /**
   * Install a fresh Offer set — a re-probe result.
   *
   * Health is carried across for Models that are still present, because a
   * re-probe is not a reason to forget that a Model has been failing.
   */
  replace(drafts: OfferDraft[]): void {
    this.drafts.clear();
    for (const draft of drafts) {
      this.drafts.set(draft.model, draft);
      if (!this.health.has(draft.model)) {
        this.health.set(draft.model, {
          model: draft.model,
          consecutiveFailures: 0,
          withdrawn: false,
          since: this.now(),
        });
      }
    }
    for (const model of [...this.health.keys()]) {
      if (!this.drafts.has(model)) this.health.delete(model);
    }
  }

  /**
   * One Model failed — would not load, or a probe that used to pass now fails.
   *
   * Only the threshold-crossing failure reports a change, so a caller that
   * republishes on every change does not republish on every hiccup.
   */
  recordFailure(model: string, reason: string): SupervisorChange {
    const health = this.health.get(model);
    if (!health) return NO_CHANGE;

    health.consecutiveFailures += 1;
    if (health.withdrawn || health.consecutiveFailures < WITHDRAW_AFTER_FAILURES) {
      return {
        ...NO_CHANGE,
        notes: [
          `${model}: ${reason} (${health.consecutiveFailures}/${WITHDRAW_AFTER_FAILURES})`,
        ],
      };
    }

    health.withdrawn = true;
    health.reason = reason;
    health.since = this.now();
    return {
      changed: true,
      withdrawn: [model],
      restored: [],
      notes: [`withdrew ${model}: ${reason}`],
    };
  }

  /** One Model answered. One success restores it — see the asymmetry above. */
  recordSuccess(model: string): SupervisorChange {
    const health = this.health.get(model);
    if (!health) return NO_CHANGE;

    const wasWithdrawn = health.withdrawn;
    health.consecutiveFailures = 0;
    if (!wasWithdrawn) return NO_CHANGE;

    health.withdrawn = false;
    health.reason = undefined;
    health.since = this.now();
    return {
      changed: true,
      withdrawn: [],
      restored: [model],
      notes: [`restored ${model}`],
    };
  }

  /**
   * The runtime died, so everything it was serving is gone at once.
   *
   * No threshold here: the failure is not per-Model and not in doubt, and
   * waiting three cycles to say so would route three cycles of traffic into a
   * process that is not running.
   */
  withdrawAll(reason: string): SupervisorChange {
    const withdrawn: string[] = [];
    for (const health of this.health.values()) {
      if (health.withdrawn) continue;
      health.withdrawn = true;
      health.reason = reason;
      health.since = this.now();
      health.consecutiveFailures = WITHDRAW_AFTER_FAILURES;
      withdrawn.push(health.model);
    }
    if (withdrawn.length === 0) return NO_CHANGE;
    return {
      changed: true,
      withdrawn,
      restored: [],
      notes: [`withdrew ${withdrawn.length} offer(s): ${reason}`],
    };
  }

  /** What should be published right now. */
  live(): OfferDraft[] {
    return [...this.drafts.values()].filter((d) => !this.health.get(d.model)?.withdrawn);
  }

  /** Every Model and its state, for an operator asking why. */
  status(): OfferHealth[] {
    return [...this.health.values()].sort((a, b) => a.model.localeCompare(b.model));
  }

  /** Models currently out of the pool, with the reason each left. */
  withdrawnOffers(): OfferHealth[] {
    return this.status().filter((h) => h.withdrawn);
  }
}
