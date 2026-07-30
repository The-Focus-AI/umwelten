/**
 * Counting what a request consumed, at our own boundary.
 *
 * Per ADR 0017 this is **not** read from the upstream's response. Prompt tokens
 * are counted at admission, before anything is forwarded. Completion tokens are
 * counted incrementally as chunks are relayed to the caller. Because the count
 * lives on our side of the wire it survives an aborted stream by construction.
 *
 * Measured, not assumed
 * (`reports/2026-07-26-can-the-exchange-bill-what-it-sold.md`): two of three
 * realistic situations produced a request that looked free while real tokens
 * were served. An upstream reporting no usage yields zero tokens and no cost.
 * An aborted stream reports zero prompt tokens despite the whole prompt having
 * been processed and paid for.
 *
 * **The abort policy is load-bearing.** The prompt Charge is always collected;
 * completion is charged on our relayed count. Do not "fix" this into refunding
 * aborted requests — that is the exploit, not a courtesy: submit a long prompt,
 * abort near the end of generation, and the Exchange pays its Supplier for
 * nearly all of it while recording nothing.
 */

import type { MicroDollars, Offer } from "../types.js";

/**
 * Estimate the tokens in a chat-completions payload.
 *
 * Deliberately crude and deliberately ours. It must be the *same* estimator for
 * every Supplier so Charges are comparable, which guarantees it disagrees with
 * each upstream's own tokenizer — that disagreement is the reconciliation
 * signal (ADR 0017), not an error.
 *
 * Four characters per token is the standard rough ratio. Swapping in a real
 * tokenizer is a drop-in replacement here and changes no caller.
 */
export function estimatePromptTokens(body: Record<string, unknown>): number {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let characters = 0;

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string") {
      characters += content.length;
    } else if (Array.isArray(content)) {
      // Multi-part content: count the text parts, ignore images and audio.
      // Undercounting a modality we cannot price is better than inventing a
      // number for it.
      for (const part of content) {
        const text = (part as { text?: unknown })?.text;
        if (typeof text === "string") characters += text.length;
      }
    }
    // Every message carries role and framing overhead beyond its content.
    characters += 8;
  }

  if (typeof body.system === "string") characters += body.system.length;

  return Math.max(1, Math.ceil(characters / 4));
}

/** Count completion tokens from a relayed SSE fragment. */
export function countStreamedTokens(fragment: string): number {
  let characters = 0;
  for (const line of fragment.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as {
        choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[];
      };
      for (const choice of parsed.choices ?? []) {
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string") characters += delta.content.length;
        // Reasoning tokens are generated and billed by the upstream, so they
        // are consumed whether or not the buyer reads them.
        if (typeof delta.reasoning_content === "string") {
          characters += delta.reasoning_content.length;
        }
      }
    } catch {
      // A partial chunk split across reads. It will be counted when the rest
      // arrives, because the accumulator below re-splits on the boundary.
    }
  }
  return characters === 0 ? 0 : Math.max(1, Math.ceil(characters / 4));
}

/** Count completion tokens from a non-streamed response body. */
export function countCompletionTokens(responseBody: string): number {
  try {
    const parsed = JSON.parse(responseBody) as {
      choices?: { message?: { content?: unknown; reasoning_content?: unknown } }[];
    };
    let characters = 0;
    for (const choice of parsed.choices ?? []) {
      const message = choice.message ?? {};
      if (typeof message.content === "string") characters += message.content.length;
      if (typeof message.reasoning_content === "string") {
        characters += message.reasoning_content.length;
      }
    }
    return characters === 0 ? 0 : Math.max(1, Math.ceil(characters / 4));
  } catch {
    return 0;
  }
}

/**
 * Accumulates completion tokens across relayed chunks.
 *
 * Holds a partial trailing line between reads: a chunk boundary can land in the
 * middle of a JSON payload, and dropping those would undercount exactly the
 * long responses worth the most.
 */
export class StreamCounter {
  private pending = "";
  private tokens = 0;

  push(fragment: string): void {
    this.pending += fragment;
    const lastBreak = this.pending.lastIndexOf("\n");
    if (lastBreak === -1) return;
    const complete = this.pending.slice(0, lastBreak + 1);
    this.pending = this.pending.slice(lastBreak + 1);
    this.tokens += countStreamedTokens(complete);
  }

  /** Total so far. Valid at any moment, including mid-abort. */
  get completionTokens(): number {
    return this.tokens + countStreamedTokens(this.pending);
  }
}

export interface Amounts {
  cost: MicroDollars;
  charge: MicroDollars;
}

/**
 * The least a served request can be charged.
 *
 * Without a floor, a short prompt at a low rate rounds to zero and the request
 * is free — which means an End User with an empty Balance can be served
 * indefinitely, and owned hardware priced to be rationed is not rationed at
 * all. Cost has no floor: zero is the honest answer for a machine we own.
 */
export const MINIMUM_CHARGE: MicroDollars = 1;

/**
 * What the Supplier is owed and what the buyer is charged, as two independent
 * numbers (ADR 0013). Cost is zero for hardware the operator owns; Charge is
 * not, and that gap is what rations the box.
 */
export function priceRequest(
  offer: Offer,
  promptTokens: number,
  completionTokens: number,
): Amounts {
  const per = (perMillion: number, tokens: number) =>
    Math.round((perMillion * tokens) / 1_000_000);

  const charge =
    per(offer.retailPromptPerMillion, promptTokens) +
    per(offer.retailCompletionPerMillion, completionTokens);

  return {
    cost:
      per(offer.wholesalePromptPerMillion, promptTokens) +
      per(offer.wholesaleCompletionPerMillion, completionTokens),
    charge: Math.max(charge, MINIMUM_CHARGE),
  };
}
