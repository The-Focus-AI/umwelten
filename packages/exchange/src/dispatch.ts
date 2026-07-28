/**
 * Dispatch: choosing which Offer serves one request.
 *
 * A filter followed by a ranking, and the order is the point. Eliminate Offers
 * lacking a required Guarantee, then those lacking a required Capability, then
 * rank whatever survives by Charge and take the cheapest.
 *
 * **Guarantees are hard filters. Price only orders what survives them.** An
 * Application requiring on-premise may find exactly one eligible Offer, and if
 * that Offer is unavailable the request fails rather than falling back to a
 * cheaper ineligible one. Silently serving from a Supplier that lacks a
 * required Guarantee is the worst outcome this system can produce, because the
 * operator is the party liable for that Guarantee (ADR 0006) — and the "fix"
 * for it looks like a resilience improvement, which is why this comment is here.
 *
 * Capabilities come from what was probed, never from what was declared
 * (ADR 0009).
 */

import type { CapabilityName, MicroDollars, Offer } from "./types.js";

export interface DispatchRequirements {
  model: string;
  /** Every one of these must be carried by the Offer's Supplier. */
  guarantees?: string[];
  /** Every one of these must have been probed true on the Offer. */
  capabilities?: CapabilityName[];
  /** When set, an Offer for a Model outside this list is never selected. */
  allowedModels?: string[];
}

export type RejectionReason =
  | "model-mismatch"
  | "model-not-allowed"
  | "offer-disabled"
  | "offer-stale"
  | "missing-guarantee"
  | "missing-capability";

export interface Considered {
  supplierId: string;
  model: string;
  eligible: boolean;
  reason?: RejectionReason;
  /** What this Offer would have charged, for the ones that were eligible. */
  rankingPrice?: MicroDollars;
}

export interface DispatchResult {
  offer?: Offer;
  /**
   * Every Offer weighed and why each was rejected. Recorded because "why did
   * this request go there" is otherwise unanswerable after the fact, and
   * because a request that fails needs to say more than "no".
   */
  considered: Considered[];
}

/**
 * A single number to rank an Offer by.
 *
 * Prompt and completion are priced separately but a request has to be ranked
 * before either token count is known, so this weights them by a rough
 * completion-heavy mix. Deliberately crude and deliberately in one place: when
 * metering lands (#297) and real token counts are available before dispatch,
 * this is what gets replaced.
 */
export function rankingPrice(offer: Offer): MicroDollars {
  return offer.retailPromptPerMillion + offer.retailCompletionPerMillion * 3;
}

/**
 * @param now  Injected so staleness is testable without waiting.
 */
export function dispatch(
  offers: Offer[],
  requirements: DispatchRequirements,
  opts: { staleAfterMs?: number; now?: Date } = {},
): DispatchResult {
  const now = opts.now ?? new Date();
  const considered: Considered[] = [];
  const eligible: Offer[] = [];

  for (const offer of offers) {
    const note = (reason: RejectionReason) => {
      considered.push({ supplierId: offer.supplierId, model: offer.model, eligible: false, reason });
    };

    if (offer.model !== requirements.model) {
      note("model-mismatch");
      continue;
    }
    if (requirements.allowedModels && !requirements.allowedModels.includes(offer.model)) {
      note("model-not-allowed");
      continue;
    }
    if (!offer.enabled) {
      note("offer-disabled");
      continue;
    }
    if (
      opts.staleAfterMs !== undefined &&
      now.getTime() - offer.publishedAt.getTime() > opts.staleAfterMs
    ) {
      // A Supplier that stopped reporting has probably gone. Its last known
      // capabilities are a guess, and dispatching on a guess is how a buyer
      // discovers an unplugged machine.
      note("offer-stale");
      continue;
    }

    const required = requirements.guarantees ?? [];
    if (required.some((g) => !offer.guarantees.includes(g))) {
      note("missing-guarantee");
      continue;
    }

    const needed = requirements.capabilities ?? [];
    if (needed.some((c) => !offer.capabilities.includes(c))) {
      note("missing-capability");
      continue;
    }

    considered.push({
      supplierId: offer.supplierId,
      model: offer.model,
      eligible: true,
      rankingPrice: rankingPrice(offer),
    });
    eligible.push(offer);
  }

  // Ties broken by supplier id so the choice is deterministic — otherwise the
  // tests are flaky and, worse, so is production behaviour under a price tie.
  eligible.sort(
    (a, b) => rankingPrice(a) - rankingPrice(b) || a.supplierId.localeCompare(b.supplierId),
  );

  return { offer: eligible[0], considered };
}
