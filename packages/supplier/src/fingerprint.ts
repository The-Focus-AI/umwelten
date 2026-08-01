/**
 * Deciding when a probe result has gone stale.
 *
 * ADR 0015 records that a probe is a snapshot of a whole serving path — client
 * integration, runtime, build, quantization, weights — and goes stale when any
 * layer in it changes. The layer least likely to prompt anyone to re-probe is
 * **our own code**, and that is exactly the layer measurement found dominating
 * the result: two rounds of fixing client bugs changed what the same weights
 * appeared able to do, twice.
 *
 * So the agent's own version is a trigger, first-class, alongside the ones an
 * operator would think of. A timer alone would be too slow for a runtime
 * upgrade and too eager for a machine that has not changed.
 *
 * The full policy is ADR 0022 — when a probe goes stale.
 */

import { createHash } from "node:crypto";

/** Everything a probe result depends on that we can observe cheaply. */
export interface ProbeInputs {
  /** Our own code. The layer nobody remembers to re-probe for. */
  agentVersion: string;
  /** The serving runtime's version, when it will tell us. */
  runtimeVersion?: string;
  /** Weights on disk: path, size, and mtime for each. */
  weights: { path: string; sizeBytes?: number; mtimeMs?: number }[];
  /** Pins that change what is being served rather than what is on the machine. */
  contextTokens?: number;
  parallel?: number;
  servingMode: string;
}

/**
 * Backstop interval for everything the fingerprint cannot see — a driver
 * update, a firmware change, thermal behaviour in a warmer room.
 */
export const DEFAULT_REPROBE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function fingerprint(inputs: ProbeInputs): string {
  const canonical = JSON.stringify({
    agentVersion: inputs.agentVersion,
    runtimeVersion: inputs.runtimeVersion ?? "unknown",
    servingMode: inputs.servingMode,
    contextTokens: inputs.contextTokens ?? null,
    parallel: inputs.parallel ?? null,
    weights: [...inputs.weights]
      .map((w) => [w.path, w.sizeBytes ?? 0, Math.floor(w.mtimeMs ?? 0)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export interface StalenessInput {
  previous?: { fingerprint: string; probedAt: string; inputs?: Partial<ProbeInputs> };
  current: ProbeInputs;
  now: number;
  intervalMs?: number;
}

/**
 * Why this machine should be re-probed, or undefined if it should not.
 *
 * Returning the *reason* rather than a boolean is deliberate: a re-probe that
 * changes an Offer has to be explicable to an operator, and "it was time" and
 * "you upgraded llama-server" are different answers.
 */
export function reprobeReason(input: StalenessInput): string | undefined {
  const { previous, current, now } = input;
  const intervalMs = input.intervalMs ?? DEFAULT_REPROBE_INTERVAL_MS;

  // No prior result, or one we cannot read. Probing on start is not an
  // optimization to skip — a restart that republishes a snapshot from before a
  // reboot is publishing a claim about a machine that no longer exists.
  if (!previous) return "no previous probe";

  const currentPrint = fingerprint(current);
  if (previous.fingerprint !== currentPrint) {
    return describeDifference(previous.inputs, current) ?? "the serving path changed";
  }

  const probedAt = Date.parse(previous.probedAt);
  if (!Number.isFinite(probedAt)) return "previous probe has no usable timestamp";
  if (now - probedAt >= intervalMs) {
    const hours = Math.round((now - probedAt) / 3_600_000);
    return `last probed ${hours}h ago`;
  }

  return undefined;
}

/** Name the layer that moved, when we recorded enough to tell. */
function describeDifference(
  previous: Partial<ProbeInputs> | undefined,
  current: ProbeInputs,
): string | undefined {
  if (!previous) return undefined;

  if (previous.agentVersion && previous.agentVersion !== current.agentVersion) {
    // Deliberately first. This is the layer measurement found dominating the
    // result and the one nobody thinks to re-probe for.
    return `agent upgraded (${previous.agentVersion} → ${current.agentVersion})`;
  }
  if (previous.runtimeVersion && previous.runtimeVersion !== current.runtimeVersion) {
    return `runtime upgraded (${previous.runtimeVersion} → ${current.runtimeVersion})`;
  }
  if (previous.servingMode && previous.servingMode !== current.servingMode) {
    return `serving mode changed (${previous.servingMode} → ${current.servingMode})`;
  }
  if (previous.contextTokens !== undefined && previous.contextTokens !== current.contextTokens) {
    return `context length changed (${previous.contextTokens} → ${current.contextTokens})`;
  }
  if (previous.parallel !== undefined && previous.parallel !== current.parallel) {
    return `concurrent slots changed (${previous.parallel} → ${current.parallel})`;
  }
  if (previous.weights) {
    const before = new Set(previous.weights.map((w) => w.path));
    const after = new Set(current.weights.map((w) => w.path));
    const added = [...after].filter((p) => !before.has(p));
    const removed = [...before].filter((p) => !after.has(p));
    if (added.length || removed.length) {
      return `weights changed (${added.length} added, ${removed.length} removed)`;
    }
    return "weights were modified in place";
  }
  return undefined;
}

/**
 * Did a re-probe actually find anything?
 *
 * A re-probe that finds nothing new must not churn the Exchange's records — a
 * republish is a write, and a daily write per Model per machine that says
 * exactly what the last one said is noise that makes the real changes harder
 * to see.
 */
export function capabilitiesChanged(
  before: { model: string; capabilities: string[] }[],
  after: { model: string; capabilities: string[] }[],
): { changed: boolean; summary: string[] } {
  const summary: string[] = [];
  const beforeByModel = new Map(before.map((o) => [o.model, [...o.capabilities].sort()]));
  const afterByModel = new Map(after.map((o) => [o.model, [...o.capabilities].sort()]));

  for (const [model, caps] of afterByModel) {
    const previous = beforeByModel.get(model);
    if (!previous) {
      summary.push(`+ ${model} (new)`);
      continue;
    }
    const gained = caps.filter((c) => !previous.includes(c));
    const lost = previous.filter((c) => !caps.includes(c));
    if (gained.length) summary.push(`  ${model} gained ${gained.join(", ")}`);
    if (lost.length) summary.push(`  ${model} lost ${lost.join(", ")}`);
  }
  for (const model of beforeByModel.keys()) {
    if (!afterByModel.has(model)) summary.push(`- ${model} (gone)`);
  }

  return { changed: summary.length > 0, summary };
}
