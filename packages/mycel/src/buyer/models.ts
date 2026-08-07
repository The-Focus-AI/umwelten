/**
 * `GET /v1/models` — what this Exchange can serve.
 *
 * OpenAI-compatible, so an existing client can enumerate without knowing
 * anything about Offers or Suppliers. A buyer names a Model; which machine
 * serves it is Dispatch's business (ADR 0012).
 *
 * One entry per Model, not per Offer. Two Suppliers serving `gemma-4-26b` are
 * one thing a buyer can ask for, and exposing them separately would leak the
 * supply side into a surface whose whole point is to hide it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Offer } from "../types.js";
import type { ExchangeStore } from "../store/types.js";

export const MODELS_PATH = "/v1/models";

export interface ModelEntry {
  id: string;
  object: "model";
  owned_by: string;
  /** Dollars per million tokens, at the cheapest eligible Offer. */
  pricing: { prompt: number; completion: number };
  /** The union of what any Offer for this Model can do. */
  capabilities: string[];
  /** Guarantees carried by *every* Offer for this Model, so a buyer can rely on them. */
  guarantees: string[];
  context_length?: number;
}

/** Micro-dollars per million tokens → dollars per million tokens. */
function toDollarsPerMillion(microDollars: number): number {
  return microDollars / 1_000_000;
}

export function summarizeOffers(offers: Offer[]): ModelEntry[] {
  const byModel = new Map<string, Offer[]>();
  for (const offer of offers) {
    if (!offer.enabled) continue;
    byModel.set(offer.model, [...(byModel.get(offer.model) ?? []), offer]);
  }

  return [...byModel.entries()]
    .map(([model, group]): ModelEntry => {
      const cheapest = group.reduce((a, b) =>
        a.retailCompletionPerMillion <= b.retailCompletionPerMillion ? a : b,
      );

      // Capabilities are a union: a buyer asking for tool calling can be served
      // if *some* Offer has it, and Dispatch will pick that one.
      const capabilities = [...new Set(group.flatMap((o) => o.capabilities))].sort();

      // Guarantees are an intersection: advertising one that only some Offers
      // carry would promise something a request might not get.
      const guarantees = group
        .map((o) => o.guarantees)
        .reduce((acc, next) => acc.filter((g) => next.includes(g)));

      const contexts = group.map((o) => o.contextTokens).filter((c): c is number => c !== undefined);

      return {
        id: model,
        object: "model",
        owned_by: "exchange",
        pricing: {
          prompt: toDollarsPerMillion(cheapest.retailPromptPerMillion),
          completion: toDollarsPerMillion(cheapest.retailCompletionPerMillion),
        },
        capabilities,
        guarantees: [...guarantees].sort(),
        // The smallest, so a buyer who fits within it fits on every Offer.
        context_length: contexts.length ? Math.min(...contexts) : undefined,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function createModelsHandler(opts: { store: ExchangeStore }) {
  return async function handleModels(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    if ((req.url ?? "").split("?")[0] !== MODELS_PATH) return false;
    if (req.method !== "GET") {
      res.writeHead(405, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return true;
    }

    // Deliberately unauthenticated: the catalogue is not secret, and requiring
    // a token to list models would mean a client cannot discover what it may
    // ask for before it asks. Nothing here reveals a Supplier.
    const data = summarizeOffers(await opts.store.listOffers());
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ object: "list", data }));
    return true;
  };
}
