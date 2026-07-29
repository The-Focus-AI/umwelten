/**
 * Talking to the Exchange.
 *
 * Publishing is total: what we send replaces this Supplier's entire Offer set,
 * so a Model the machine stopped serving stops being advertised without anyone
 * deleting anything. An empty publish is therefore a clean withdrawal, which is
 * what shutdown uses.
 */

import type { OfferDraft } from "./types.js";

export interface PublishResult {
  ok: boolean;
  status: number;
  /** What the Exchange says this Supplier is actually granted. */
  guarantees?: string[];
  offers?: number;
  error?: string;
  message?: string;
}

export interface ExchangeClientOptions {
  exchangeUrl: string;
  credential: string;
  fetchImpl?: typeof fetch;
}

export class ExchangeClient {
  private readonly doFetch: typeof fetch;

  constructor(private readonly opts: ExchangeClientOptions) {
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private get base(): string {
    return this.opts.exchangeUrl.replace(/\/$/, "");
  }

  /**
   * Send the Offer set. Guarantees are echoed for confirmation — the Exchange's
   * grant decides, and a claim beyond it is rejected rather than downgraded
   * (ADR 0012), which is why the rejection is surfaced rather than swallowed.
   */
  async publish(offers: OfferDraft[], guarantees: string[]): Promise<PublishResult> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.base}/suppliers/offers`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.credential}`,
        },
        body: JSON.stringify({ offers, guarantees }),
      });
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: "unreachable",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: response.ok,
      status: response.status,
      guarantees: body.guarantees as string[] | undefined,
      offers: body.offers as number | undefined,
      error: body.error as string | undefined,
      message: body.message as string | undefined,
    };
  }

  /**
   * Publish an empty set.
   *
   * Because publishing is total this removes everything, and it is why a clean
   * shutdown says so immediately rather than leaving the Exchange to notice a
   * machine has gone quiet.
   */
  withdraw(): Promise<PublishResult> {
    return this.publish([], []);
  }
}
