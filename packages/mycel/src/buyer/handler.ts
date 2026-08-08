/**
 * The buyer surface: `POST /v1/chat/completions`.
 *
 * OpenAI-compatible on purpose. That is the decision that lets an existing
 * client — including umwelten's own provider layer — reach the Exchange by
 * changing a base URL and a key, rather than adopting anything new.
 *
 * Every request is authenticated: the Application signs a short-lived token and
 * the Exchange verifies it against that Application's published keys (ADR
 * 0008). Dispatch then filters on Guarantees and Capabilities and ranks by
 * Charge.
 *
 * Every request is metered at our own boundary (ADR 0017): the prompt is
 * counted at admission, before anything is forwarded, and completion tokens are
 * counted as chunks are relayed. Because the count lives on our side of the
 * wire it survives an aborted stream by construction.
 *
 * Balances are enforced *during* generation, not after: the prompt must be
 * covered before anything is forwarded, and a stream is cut when credit runs
 * out mid-flight. That is only possible because the count is incremental and
 * ours — a count that only arrives at the end can detect an overdraft but
 * never prevent one.
 */

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CapabilityName, RequestOutcome } from "../types.js";
import { dispatch, type DispatchRequirements } from "../dispatch.js";
import {
  AuthError,
  END_USER_HEADER,
  createIdentityVerifier,
  type Caller,
} from "../auth/identity.js";
import {
  StreamCounter,
  countCompletionTokens,
  estimatePromptTokens,
  priceRequest,
} from "../metering/counter.js";
import {
  Balances,
  creditFloorFor,
  resolveChargeOwner,
  type BalanceOwner,
} from "../metering/balances.js";
import type { ExchangeStore } from "../store/types.js";

export const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

const MAX_BODY_BYTES = 10_000_000;

/**
 * How many relayed chunks between Balance checks. Per-chunk would put a store
 * round trip between every token; never would make the Balance a suggestion.
 */
const BALANCE_CHECK_INTERVAL = 16;

export interface BuyerHandlerOptions {
  store: ExchangeStore;
  /**
   * Resolves a Supplier's upstream credential from its declared env var name.
   * Injectable so tests do not have to mutate process.env.
   */
  readCredential?: (envName: string | undefined) => string | undefined;
  fetchImpl?: typeof fetch;
  /** Offers not republished within this window stop being dispatched to. */
  staleAfterMs?: number;
  /** Injectable so tests need not stand up a real JWKS endpoint. */
  verifyCaller?: (authorization: string | undefined, endUser?: string) => Promise<Caller>;
}

/**
 * Per-request requirements, added on top of the Application's own. Headers
 * rather than body fields so the request stays a plain OpenAI payload that any
 * client can send unmodified. These can only narrow eligibility, never widen it.
 */
export const REQUIRE_GUARANTEE_HEADER = "x-exchange-require-guarantee";
export const REQUIRE_CAPABILITY_HEADER = "x-exchange-require-capability";

function headerList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Error codes a caller can branch on. Stable, and worth keeping that way. */
export const BuyerError = {
  /** Nothing can serve this Model. Distinct from every other failure. */
  NO_ELIGIBLE_OFFER: "no_eligible_offer",
  /** Out of credit. Deliberately distinct from having nowhere to route. */
  INSUFFICIENT_BALANCE: "insufficient_balance",
  INVALID_BODY: "invalid_body",
  INVALID_JSON: "invalid_json",
  UPSTREAM_ERROR: "upstream_error",
  UNAUTHORIZED: "unauthorized",
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

/**
 * Pull whatever usage the upstream volunteered. Recorded for reconciliation
 * against our own count (ADR 0017) and never used to compute a Charge — two of
 * three realistic upstreams report nothing usable, and one of those reports a
 * shape whose every field is undefined.
 */
function readUpstreamUsage(responseBody: string): { prompt?: number; completion?: number } {
  try {
    const parsed = JSON.parse(responseBody) as {
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const prompt = parsed.usage?.prompt_tokens;
    const completion = parsed.usage?.completion_tokens;
    return {
      prompt: typeof prompt === "number" ? prompt : undefined,
      completion: typeof completion === "number" ? completion : undefined,
    };
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

export function createBuyerHandler(opts: BuyerHandlerOptions) {
  const { store } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const readCredential =
    opts.readCredential ?? ((envName?: string) => (envName ? process.env[envName] : undefined));
  const verifyCaller = opts.verifyCaller ?? createIdentityVerifier({ store });
  const balances = new Balances(store);

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

    // Identity first: nothing else should run for a caller we cannot name.
    let caller: Caller;
    try {
      caller = await verifyCaller(
        req.headers.authorization,
        req.headers[END_USER_HEADER] as string | undefined,
      );
    } catch (error) {
      // One opaque body for every failure. The specific reason is precise in
      // logs and vague on the wire — a caller that can tell "unknown
      // application" from "bad signature" has an oracle for which Applications
      // exist and which keys are current.
      const reason = error instanceof AuthError ? error.reason : "invalid_signature";
      sendJson(res, 401, { error: BuyerError.UNAUTHORIZED });
      void reason;
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

    // An Application's required Guarantees apply to every one of its requests.
    // A per-request header may *add* to them and can never remove one — an
    // Application pinned to on-premise must not be able to opt out by omitting
    // a header, or the pin is decoration.
    const requirements: DispatchRequirements = {
      model,
      guarantees: [
        ...new Set([
          ...caller.application.requiredGuarantees,
          ...headerList(req.headers[REQUIRE_GUARANTEE_HEADER] as string | undefined),
        ]),
      ],
      capabilities: headerList(
        req.headers[REQUIRE_CAPABILITY_HEADER] as string | undefined,
      ) as CapabilityName[],
      allowedModels: caller.application.allowedModels,
    };

    const decision = dispatch(await store.listOffers(), requirements, {
      staleAfterMs: opts.staleAfterMs,
    });

    if (!decision.offer) {
      // Its own status and code. A caller must be able to tell "nothing can
      // serve this" from an upstream failure — and later, from being out of
      // credit (#298). Conflating them makes every one of those undebuggable.
      //
      // The considered list ships with the failure: an Application that
      // required on-premise and got nothing needs to see *why* rather than
      // guess, and "everything eligible was rejected for missing-guarantee" is
      // a different problem from "no Supplier serves this model at all".
      sendJson(res, 503, {
        error: BuyerError.NO_ELIGIBLE_OFFER,
        message: `No eligible Offer for model "${model}".`,
        considered: decision.considered,
      });
      return true;
    }
    const offer = decision.offer;

    const supplier = await store.getSupplier(offer.supplierId);
    if (!supplier) {
      sendJson(res, 503, { error: BuyerError.NO_ELIGIBLE_OFFER });
      return true;
    }

    // Counted before anything is forwarded. This is the number that survives an
    // abort: the prompt was submitted and processed whatever happens next, so
    // it is always chargeable (ADR 0017).
    const startedAt = new Date();
    const promptTokens = estimatePromptTokens(body);
    const counter = new StreamCounter();
    // First cause wins. A caller who hangs up and *then* trips the read loop
    // would otherwise be recorded as a supply failure, which inverts the whole
    // point of separating them.
    let outcome: RequestOutcome | undefined;
    const settle = (cause: RequestOutcome) => {
      outcome ??= cause;
    };
    let recorded = false;
    let upstreamUsage: { prompt?: number; completion?: number } = {};
    // End User → Application → Client, stopping at the first that has ever
    // had a ledger entry. Resolved once and then both checked and debited, so
    // an unfunded user never accidentally acquires an entry of its own.
    const owner: BalanceOwner = await resolveChargeOwner(caller, balances);
    // Only a Client's own Balance may go negative, and only to the limit the
    // operator gave it (ADR 0028). A capped End User still stops at zero.
    const floor = await creditFloorFor(owner, caller.application.clientId, store);

    // Refuse before forwarding when the prompt alone cannot be covered. There
    // is no point buying tokens the buyer cannot pay for, and this is the only
    // moment nothing has been consumed yet.
    const promptCharge = priceRequest(offer, promptTokens, 0).charge;
    if (!(await balances.canCover(owner, promptCharge, floor))) {
      sendJson(res, 402, {
        error: BuyerError.INSUFFICIENT_BALANCE,
        message: "Balance does not cover this request.",
      });
      return true;
    }

    const record = async (completionTokens: number) => {
      if (recorded) return;
      recorded = true;
      const requestId = randomUUID();
      const { cost, charge } = priceRequest(offer, promptTokens, completionTokens);
      await store.recordRequest({
        id: requestId,
        applicationId: caller.application.id,
        subject: caller.subject,
        supplierId: offer.supplierId,
        model: offer.model,
        promptTokens,
        completionTokens,
        cost,
        charge,
        outcome: outcome ?? "completed",
        upstreamPromptTokens: upstreamUsage.prompt,
        upstreamCompletionTokens: upstreamUsage.completion,
        startedAt,
        finishedAt: new Date(),
      });
      // Debited whatever happened — including an abort, where the prompt was
      // still submitted and paid for upstream (ADR 0017).
      await balances.debit(owner, charge, requestId);
    };

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
      settle("buyer-aborted");
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
        // The caller left before the upstream answered. The prompt was still
        // submitted, so it is still charged.
        await record(0);
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
      upstreamUsage = readUpstreamUsage(text);
      await record(countCompletionTokens(text));
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
    let chunksSinceCheck = 0;
    let creditExhausted = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (res.writableEnded) break;
        const fragment = Buffer.from(value).toString();
        // Counted before it is written out, so a caller that vanishes between
        // the count and the write does not lose the tokens we already bought.
        counter.push(fragment);
        res.write(fragment);

        // Enforce the Balance mid-flight rather than discovering an overdraft
        // afterwards. Checked every few chunks: per-chunk would put a store
        // round trip between every token, and never would make the Balance a
        // suggestion.
        chunksSinceCheck += 1;
        if (chunksSinceCheck >= BALANCE_CHECK_INTERVAL) {
          chunksSinceCheck = 0;
          const running = priceRequest(offer, promptTokens, counter.completionTokens).charge;
          // Same floor as the pre-flight check. Cutting a postpaid Client off
          // at zero mid-response would make its limit apply only to requests
          // that never started.
          if (!(await balances.canCover(owner, running, floor))) {
            creditExhausted = true;
            settle("credit-exhausted");
            upstream.abort();
            cancelBody?.();
            break;
          }
        }
      }
    } catch {
      // An upstream that dies mid-stream leaves the caller with a truncated
      // response and no way to signal an error — headers are already sent.
      //
      // So the only place it can be said is the record. Under ADR 0023 this
      // stops being an exception: a dial-in Supplier is a laptop whose lid
      // closes, and this is the path that fires when it does.
      settle("supply-failed");
    } finally {
      // Runs on every path out of the relay — normal completion, an upstream
      // that died mid-stream, and a caller that hung up. That is the point:
      // there is no exit from here that does not record what was consumed.
      await record(counter.completionTokens);
      if (!res.writableEnded) {
        if (creditExhausted) {
          // Headers are long gone, so this is the only way to tell a caller
          // why their stream stopped short.
          res.write(
            `data: ${JSON.stringify({ error: BuyerError.INSUFFICIENT_BALANCE })}\n\n`,
          );
        }
        res.end();
      }
    }
    return true;
  };
}
