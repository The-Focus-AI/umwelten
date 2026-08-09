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
 * operator is the party liable for that Guarantee (ADR 0012) — and the "fix"
 * for it looks like a resilience improvement, which is why this comment is here.
 *
 * Capabilities come from what was probed, never from what was declared
 * (ADR 0015).
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
  /**
   * Requirable, not mandatory (ADR 0027). A buyer who knows they need Q8 says
   * so and gets a refusal rather than a quiet downgrade; one who does not care
   * gets whatever wins. The same weights served two ways expose different
   * capabilities, which is why the Offer carries this at all.
   */
  quantization?: string;
  /** Smallest context this request needs the Offer to actually accept. */
  minContextTokens?: number;
}

export type RejectionReason =
  | "model-mismatch"
  | "model-not-allowed"
  | "offer-disabled"
  | "offer-stale"
  | "missing-guarantee"
  | "missing-capability"
  | "wrong-quantization"
  | "insufficient-context";

/** Why an eligible Offer scored the way it did. */
export interface ScoreTerms {
  price: number;
  throughput: number;
  timeToFirstToken: number;
  concurrency: number;
}

export interface Considered {
  supplierId: string;
  model: string;
  eligible: boolean;
  reason?: RejectionReason;
  /** What this Offer would have charged, for the ones that were eligible. */
  rankingPrice?: MicroDollars;
  /** Higher wins. Only meaningful relative to the others in this request. */
  score?: number;
  /**
   * The terms that produced it. A weighted function stops being explicable the
   * moment nobody writes down what went into it, and "why did this request go
   * there" has to stay answerable (ADR 0027).
   */
  terms?: ScoreTerms;
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
 * What a request would cost, as one number.
 *
 * Prompt and completion are priced separately but a request has to be ranked
 * before either token count is known, so this weights them by a rough
 * completion-heavy mix. Still crude, still in one place — but it is now one
 * term in a score rather than the whole decision (ADR 0027).
 */
export function rankingPrice(offer: Offer): MicroDollars {
  return offer.retailPromptPerMillion + offer.retailCompletionPerMillion * 3;
}

/**
 * How much each term moves the score. Constants in one place, tunable per
 * deployment, and deliberately *not* per-Application: a buyer expressing a
 * preference does it through a requirement, which is a filter and therefore
 * explicable, rather than by nudging a scoring function.
 */
export interface ScoreWeights {
  price: number;
  throughput: number;
  timeToFirstToken: number;
  concurrency: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  // Price still dominates — the Exchange exists to buy tokens well, and owned
  // hardware being cheap is a real advantage rather than an accident to correct.
  price: 1,
  throughput: 0.4,
  timeToFirstToken: 0.4,
  // A binary, and worth its own weight: an Offer that serves requests one at a
  // time cannot take a second customer, which is a different kind of fact from
  // being somewhat slower.
  concurrency: 0.3,
};

/** The best sample an Offer published, by concurrency level. */
function bestSample(offer: Offer) {
  return [...offer.headroom].sort((a, b) => b.concurrency - a.concurrency)[0];
}

/**
 * Map a value into 0..1 across the range present in this request's eligible
 * set, so a score only ever means "compared to the alternatives here".
 *
 * A single eligible Offer scores 1 on every term, which is correct: there is
 * nothing to prefer it over.
 */
function normalize(value: number, min: number, max: number, higherIsBetter: boolean): number {
  if (!Number.isFinite(value) || max === min) return 1;
  const scaled = (value - min) / (max - min);
  return higherIsBetter ? scaled : 1 - scaled;
}

/**
 * Score every eligible Offer against the others.
 *
 * **This is capacity, not utilization.** Headroom was measured at probe time,
 * not read from the machine now, so an Offer that batches well and is currently
 * serving six requests looks exactly like an idle one. The score prefers an
 * Offer that is characteristically fast and concurrent; it does not avoid a
 * busy one. Live load becomes observable under ADR 0023, and that is when this
 * becomes real load balancing.
 *
 * An Offer with no Headroom scores on price alone — neither rewarded nor
 * punished for a measurement nobody asked it for, which is the normal case for
 * a vendor catalogue.
 */
export function scoreOffers(
  offers: Offer[],
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): { offer: Offer; score: number; terms: ScoreTerms }[] {
  const prices = offers.map(rankingPrice);
  const samples = offers.map(bestSample);
  const throughputs = samples.map((s) => s?.tokensPerSecond ?? 0).filter((n) => n > 0);
  const ttfts = samples.map((s) => s?.ttftMs ?? 0).filter((n) => n > 0);

  const range = (values: number[]) => ({
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  });
  const priceRange = range(prices);
  const throughputRange = range(throughputs);
  const ttftRange = range(ttfts);

  return offers.map((offer, index) => {
    const sample = samples[index];
    const measured = sample !== undefined;

    const terms: ScoreTerms = {
      price: normalize(prices[index], priceRange.min, priceRange.max, false),
      // Unmeasured terms score 1 rather than 0: a missing measurement is not
      // evidence of being slow, and scoring it as such would make every vendor
      // Offer lose to any probed one on grounds nobody established.
      throughput: measured
        ? normalize(sample.tokensPerSecond, throughputRange.min, throughputRange.max, true)
        : 1,
      timeToFirstToken: measured
        ? normalize(sample.ttftMs, ttftRange.min, ttftRange.max, false)
        : 1,
      concurrency: offer.headroomMeta?.saturation === "batches" ? 1 : measured ? 0 : 1,
    };

    const score =
      terms.price * weights.price +
      terms.throughput * weights.throughput +
      terms.timeToFirstToken * weights.timeToFirstToken +
      terms.concurrency * weights.concurrency;

    return { offer, score: Number(score.toFixed(4)), terms };
  });
}

/**
 * How long an Offer stays dispatchable without being republished.
 *
 * A supplier agent heartbeats every five minutes, so fifteen is three chances
 * to be heard — one missed publish over a flaky link does not take a working
 * machine out of the pool, and a machine that has genuinely been unplugged is
 * out of it within a quarter of an hour.
 *
 * This is the half of withdrawal that survives an agent it cannot run: a live
 * agent withdraws the moment it knows, and this catches everything that killed
 * the agent before it could say anything. Neither is the single point of
 * failure, which is only true because both are on by default.
 */
export const DEFAULT_STALE_AFTER_MS = 15 * 60_000;

/**
 * @param now  Injected so staleness is testable without waiting.
 */
export function dispatch(
  offers: Offer[],
  requirements: DispatchRequirements,
  opts: { staleAfterMs?: number; now?: Date; weights?: ScoreWeights } = {},
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
    // Defaulted rather than opt-in. An expiry window nobody remembered to
    // configure is an expiry window that never fires, and then the two
    // mechanisms that were supposed to overlap are one.
    const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    if (staleAfterMs > 0 && now.getTime() - offer.publishedAt.getTime() > staleAfterMs) {
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

    // An Offer with no recorded quantization does not satisfy a quantization
    // requirement. An adapted Offer resells a configuration its Supplier does
    // not control (ADR 0016) and cannot honestly claim one.
    if (requirements.quantization && offer.quantization !== requirements.quantization) {
      note("wrong-quantization");
      continue;
    }

    if (
      requirements.minContextTokens !== undefined &&
      (offer.contextTokens ?? 0) < requirements.minContextTokens
    ) {
      note("insufficient-context");
      continue;
    }

    eligible.push(offer);
  }

  // Scored against each other, not in isolation — a term only means anything
  // relative to the alternatives for this request (ADR 0027).
  const scored = scoreOffers(eligible, opts.weights);
  for (const { offer, score, terms } of scored) {
    considered.push({
      supplierId: offer.supplierId,
      model: offer.model,
      eligible: true,
      rankingPrice: rankingPrice(offer),
      score,
      terms,
    });
  }

  // Highest score wins. Ties broken by supplier id so the choice is
  // deterministic — otherwise the tests are flaky and, worse, so is production
  // routing under a tie.
  scored.sort((a, b) => b.score - a.score || a.offer.supplierId.localeCompare(b.offer.supplierId));

  return { offer: scored[0]?.offer, considered };
}
