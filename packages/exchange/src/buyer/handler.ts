/**
 * The buyer surface: `POST /v1/chat/completions`.
 *
 * OpenAI-compatible on purpose. That is the decision that lets an existing
 * client — including umwelten's own provider layer — reach the Exchange by
 * changing a base URL and a key, rather than adopting anything new.
 *
 * This ticket is the thinnest complete path: find an Offer for the requested
 * Model, forward, relay the answer back. There is no authentication yet (#295)
 * and no metering (#297), so nothing from this stage should reach a public
 * address before those land. Dispatch here picks the first eligible Offer;
 * filtering on Guarantees and ranking by Charge is #296.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Offer } from "../types.js";
import type { ExchangeStore } from "../store/types.js";

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

const MAX_BODY_BYTES = 10_000_000;

export interface BuyerHandlerOptions {
  store: ExchangeStore;
  /**
   * Resolves a Supplier's upstream credential from its declared env var name.
   * Injectable so tests do not have to mutate process.env.
   */
  readCredential?: (envName: string | undefined) => string | undefined;
  fetchImpl?: typeof fetch;
}

/** Error codes a caller can branch on. Stable, and worth keeping that way. */
export const BuyerError = {
  /** Nothing can serve this Model. Distinct from every other failure. */
  NO_ELIGIBLE_OFFER: "no_eligible_offer",
  INVALID_BODY: "invalid_body",
  INVALID_JSON: "invalid_json",
  UPSTREAM_ERROR: "upstream_error",
  METHOD_NOT_ALLOWED: "method_not_allowed",
  BODY_TOO_LARGE: "body_too_large",
} as const;

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (chunk: Buffer | string) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(BuyerError.BODY_TOO_LARGE));
        return;
      }
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Pick an Offer for a Model.
 *
 * Deliberately naive: first enabled Offer wins. #296 replaces this with a
 * Guarantee filter, a Capability filter, and a ranking by Charge. Keeping it
 * a separate function means that change touches one place.
 */
export function selectOffer(offers: Offer[], model: string): Offer | undefined {
  return offers.find((offer) => offer.model === model && offer.enabled);
}

export function createBuyerHandler(opts: BuyerHandlerOptions) {
  const { store } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const readCredential =
    opts.readCredential ?? ((envName?: string) => (envName ? process.env[envName] : undefined));

  return async function handleChatCompletions(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const path = (req.url ?? "").split("?")[0];
    if (path !== CHAT_COMPLETIONS_PATH) return false;

    if (req.method !== "POST") {
      sendJson(res, 405, { error: BuyerError.METHOD_NOT_ALLOWED });
      return true;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch (error) {
      const code =
        error instanceof Error && error.message === BuyerError.BODY_TOO_LARGE
          ? BuyerError.BODY_TOO_LARGE
          : BuyerError.INVALID_JSON;
      sendJson(res, code === BuyerError.BODY_TOO_LARGE ? 413 : 400, { error: code });
      return true;
    }

    const model = typeof body.model === "string" ? body.model : undefined;
    if (!model) {
      sendJson(res, 400, { error: BuyerError.INVALID_BODY, message: "`model` is required." });
      return true;
    }

    const offer = selectOffer(await store.listOffers(), model);
    if (!offer) {
      // Its own status and code. A caller must be able to tell "nothing can
      // serve this" from an upstream failure — and later, from being out of
      // credit (#298). Conflating them makes every one of those undebuggable.
      sendJson(res, 503, {
        error: BuyerError.NO_ELIGIBLE_OFFER,
        message: `No enabled Offer for model "${model}".`,
      });
      return true;
    }

    const supplier = await store.getSupplier(offer.supplierId);
    if (!supplier) {
      sendJson(res, 503, { error: BuyerError.NO_ELIGIBLE_OFFER });
      return true;
    }

    // The caller hanging up must stop generation upstream, not leave a Supplier
    // burning GPU seconds nobody will read.
    //
    // Aborting the fetch signal alone is not enough once the response body is
    // already streaming: the body reader holds the socket open, so the upstream
    // keeps generating and never sees the disconnect. The relay installs a
    // cancel here as soon as it has a reader.
    const upstream = new AbortController();
    let cancelBody: (() => void) | undefined;
    const clientGone = () => {
      upstream.abort();
      cancelBody?.();
    };
    // Only `res` close means the caller left. `req` emits "close" as soon as
    // the request body has been read, which is before the response is even
    // sent — listening to it aborts the controller immediately and leaves the
    // real disconnect with nothing to fire.
    req.on("aborted", clientGone);
    res.on("close", () => {
      if (!res.writableEnded) clientGone();
    });

    const credential = readCredential(supplier.upstreamCredentialEnv);
    const streaming = body.stream === true;

    let upstreamRes: Response;
    try {
      upstreamRes = await doFetch(`${supplier.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(body),
        signal: upstream.signal,
      });
    } catch (error) {
      if (upstream.signal.aborted) {
        // The caller left. Nothing to report to.
        if (!res.writableEnded) res.end();
        return true;
      }
      sendJson(res, 502, {
        error: BuyerError.UPSTREAM_ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }

    if (!upstreamRes.ok) {
      // Surface it rather than dressing a failure up as a success. The status
      // is preserved so a caller can tell a rate limit from a bad request.
      const text = await upstreamRes.text().catch(() => "");
      sendJson(res, upstreamRes.status, {
        error: BuyerError.UPSTREAM_ERROR,
        supplierId: supplier.id,
        upstreamStatus: upstreamRes.status,
        body: text.slice(0, 2000),
      });
      return true;
    }

    if (!streaming || !upstreamRes.body) {
      const text = await upstreamRes.text();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(text);
      return true;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    // Relay chunk by chunk rather than buffering. #297 counts completion
    // tokens right here, which is what makes the count survive an abort.
    const reader = upstreamRes.body.getReader();
    cancelBody = () => void reader.cancel().catch(() => {});
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (res.writableEnded) break;
        res.write(Buffer.from(value));
      }
    } catch {
      // An upstream that dies mid-stream leaves the caller with a truncated
      // response and no way to signal an error — headers are already sent.
    } finally {
      if (!res.writableEnded) res.end();
    }
    return true;
  };
}
