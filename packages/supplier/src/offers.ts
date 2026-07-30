/**
 * Turning probe results into the Offers we publish.
 *
 * This is the seam. Feed it a described machine state and assert what comes
 * out — no GPU, no network, and no assertions about *how* the agent got there.
 * Everything decision-shaped lives here; only measurement needs metal.
 */

import type { CapabilityName, MachineState, OfferDraft, ProbedOffer } from "./types.js";

/** Every (runtime, model) pair worth probing, from a described machine. */
export function probeTargets(
  machine: MachineState,
  opts: { providers?: string[]; modelFilter?: string } = {},
): { provider: string; model: string }[] {
  return machine.runtimes
    .filter((r) => r.reachable)
    .filter((r) => !opts.providers?.length || opts.providers.includes(r.provider))
    .flatMap((r) => r.models.map((model) => ({ provider: r.provider, model })))
    .filter((t) => !opts.modelFilter || t.model.includes(opts.modelFilter));
}

/**
 * Probe results → Offers.
 *
 * A failed probe produces **no Offer**, rather than an Offer with a missing
 * Capability. Those are different claims: "we did not establish this" is not
 * "this machine cannot do it", and publishing the second when we only know the
 * first would have Dispatch route around a Model that works.
 *
 * Capabilities are carried through verbatim. Nothing is inferred, defaulted, or
 * added — an Offer's capability set is evidence (ADR 0015), and the moment
 * something is added here it stops being evidence.
 */
export function toOfferDrafts(
  probed: ProbedOffer[],
  opts: { servingMode: ProbedOffer extends never ? never : OfferDraft["servingMode"] },
): OfferDraft[] {
  return probed
    .filter((p) => !p.failed)
    .map((p) => ({
      model: p.model,
      capabilities: p.capabilities
        .filter((c) => c.supported)
        .map((c) => c.name as CapabilityName),
      servingMode: opts.servingMode,
      headroom: p.headroom,
      contextTokens: p.contextTokens,
    }));
}

/**
 * Models the same weights served two ways would collide on.
 *
 * The Exchange keys an Offer on (Supplier, Model), so one agent publishing the
 * same Model from two runtimes would have the second silently overwrite the
 * first. Surfacing it lets the operator pick rather than lose one at random.
 */
export function findDuplicateModels(drafts: OfferDraft[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const draft of drafts) {
    if (seen.has(draft.model)) duplicates.add(draft.model);
    seen.add(draft.model);
  }
  return [...duplicates].sort();
}
