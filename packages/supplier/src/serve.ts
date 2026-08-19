/**
 * The long-running agent.
 *
 * `probe → publish` is a snapshot; this is the thing that keeps the snapshot
 * true. It watches the runtime it started, withdraws Offers that stop working,
 * restores them when they come back, and re-probes when the serving path
 * underneath has moved.
 *
 * Effects are injected so the entire loop is testable against a fabricated
 * machine: no runtime, no Exchange, no clock.
 */

import { OfferSupervisor, type SupervisorChange } from "./supervisor.js";
import {
  DEFAULT_REPROBE_INTERVAL_MS,
  capabilitiesChanged,
  fingerprint,
  reprobeReason,
  type ProbeInputs,
} from "./fingerprint.js";
import type { OfferDraft, ProbedOffer } from "./types.js";

/**
 * How often the agent checks that what it published still works.
 *
 * Combined with `WITHDRAW_AFTER_FAILURES`, this sets how long a genuinely
 * broken Offer keeps receiving traffic: three checks at 30 seconds is about a
 * minute and a half.
 */
export const HEALTH_INTERVAL_MS = 30_000;

/*
 * There was a HEARTBEAT_INTERVAL_MS here, and it is gone (ADR 0023, #382).
 *
 * A healthy agent republished an unchanged Offer set every five minutes so
 * that *silence* would mean something to an Exchange that expired Offers after
 * fifteen. That is inferred liveness, and it only ever existed because the
 * Exchange could not see whether a machine was alive. It can: the machine
 * holds a Connection, and the Connection ending is the withdrawal.
 *
 * What remains below is health checking, which answers a different question —
 * "is this Model still serving?" — and still publishes the moment the answer
 * changes. That is a report of a real event, not a periodic proof of life.
 */

export interface ServeEffects {
  /** Is the runtime we started still answering? */
  runtimeAlive(): Promise<boolean>;
  /** Cheap liveness check for one Model — does it still load and answer? */
  checkModel(model: string): Promise<{ ok: boolean; reason?: string }>;
  /** Full re-probe. Expensive; only called when something says it is stale. */
  reprobe(reason: string): Promise<{ probed: ProbedOffer[]; drafts: OfferDraft[] }>;
  /** Publish the live set. Total — what is sent replaces everything. */
  publish(offers: OfferDraft[]): Promise<{ ok: boolean; detail?: string }>;
  /** Restart the runtime after it died. Undefined when we do not own one. */
  restartRuntime?: () => Promise<boolean>;
  /** Persist a probe result so a restart does not have to redo it. */
  persist(probed: ProbedOffer[], print: string): void;
  now(): number;
  sleep(ms: number): Promise<void>;
  log(line: string): void;
}

export interface ServeOptions {
  healthIntervalMs?: number;
  reprobeIntervalMs?: number;
  /** Stops the loop. */
  signal?: AbortSignal;
  probeInputs: ProbeInputs;
  /** The last probe, when one survived a restart. */
  previous?: { fingerprint: string; probedAt: string; inputs?: Partial<ProbeInputs> };
}

/**
 * Run until aborted.
 *
 * Returns the supervisor so a caller can report final state; the caller is
 * responsible for the withdraw-everything on the way out, because releasing
 * the machine is a shutdown concern rather than a loop concern.
 */
export async function runServeLoop(
  supervisor: OfferSupervisor,
  effects: ServeEffects,
  opts: ServeOptions,
): Promise<void> {
  const healthMs = opts.healthIntervalMs ?? HEALTH_INTERVAL_MS;
  const reprobeMs = opts.reprobeIntervalMs ?? DEFAULT_REPROBE_INTERVAL_MS;
  let lastProbe = opts.previous;

  const report = (change: SupervisorChange) => {
    for (const note of change.notes) effects.log(note);
    return change.changed;
  };

  while (!opts.signal?.aborted) {
    await effects.sleep(healthMs);
    if (opts.signal?.aborted) break;

    let dirty = false;

    // The runtime first: if it is gone, nothing it served is serveable, and
    // checking each Model individually would just be the same news five times.
    if (!(await effects.runtimeAlive())) {
      dirty = report(supervisor.withdrawAll("the runtime stopped answering")) || dirty;
      if (dirty) await republish(supervisor, effects);

      if (effects.restartRuntime) {
        effects.log("restarting the runtime…");
        const restarted = await effects.restartRuntime();
        effects.log(restarted ? "runtime is back" : "runtime did not come back");
      }
      continue;
    }

    for (const health of supervisor.status()) {
      if (opts.signal?.aborted) break;
      const result = await effects.checkModel(health.model);
      dirty = report(
        result.ok
          ? supervisor.recordSuccess(health.model)
          : supervisor.recordFailure(health.model, result.reason ?? "check failed"),
      ) || dirty;
    }

    // Only when something actually changed. Publishing on a timer was the
    // heartbeat, and nothing needs proof of life from a machine whose
    // Connection the Exchange is holding — but a Model that just started
    // failing is news, and news travels immediately rather than at the next
    // scheduled publish.
    if (dirty) await republish(supervisor, effects);

    const reason = reprobeReason({
      previous: lastProbe,
      current: opts.probeInputs,
      now: effects.now(),
      intervalMs: reprobeMs,
    });
    if (!reason) continue;

    effects.log(`re-probing: ${reason}`);
    const before = supervisor.live().map((d) => ({ model: d.model, capabilities: d.capabilities }));
    const { probed, drafts } = await effects.reprobe(reason);
    const after = drafts.map((d) => ({ model: d.model, capabilities: d.capabilities }));

    const print = fingerprint(opts.probeInputs);
    lastProbe = {
      fingerprint: print,
      probedAt: new Date(effects.now()).toISOString(),
      inputs: opts.probeInputs,
    };
    effects.persist(probed, print);

    const diff = capabilitiesChanged(before, after);
    if (!diff.changed) {
      // A daily write per Model that says exactly what the last one said is
      // noise, and it makes the real changes harder to see.
      effects.log("re-probe found no change; nothing republished");
      continue;
    }

    for (const line of diff.summary) effects.log(line);
    supervisor.replace(drafts);
    await republish(supervisor, effects);
  }
}

/** Send the live set. Returns whether the Exchange accepted it. */
async function republish(supervisor: OfferSupervisor, effects: ServeEffects): Promise<boolean> {
  const live = supervisor.live();
  const result = await effects.publish(live);
  effects.log(
    result.ok
      ? `published ${live.length} offer(s)`
      : `publish failed: ${result.detail ?? "unknown"}`,
  );
  return result.ok;
}
