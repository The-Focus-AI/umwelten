/**
 * How the Exchange reaches one Supplier for one request.
 *
 * The relay calls a transport and gets a `Response`. Everything downstream —
 * prompt counting at admission, per-chunk completion counting, Balance
 * enforcement mid-flight, buyer-abort handling, and recording on every exit
 * path — operates on that `Response` and does not know what produced it.
 *
 * Today there is one transport: an HTTP request to a vendor's `baseUrl`. A
 * machine Supplier's will be a frame pushed down its held Connection (ADR
 * 0023), returning a `Response` whose body streams the token frames back. The
 * point of this seam is that the money path does not change to accommodate
 * that — a dropped Connection mid-stream becomes a body that ends, which the
 * relay already records as `supply-failed`.
 */

import type { Supplier } from "../types.js";

/**
 * A request, already validated and metered at admission, on its way to a
 * Supplier. The body is the buyer's own OpenAI-shaped payload, forwarded
 * unmodified — the Exchange adds nothing to it.
 */
export type SupplierTransport = (
  body: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<Response>;

/**
 * Resolve the transport for a Supplier. Injectable so a test — or a Connection
 * — can supply its own without the relay knowing the difference.
 */
export type ResolveTransport = (supplier: Supplier) => SupplierTransport;

/**
 * The vendor transport: an OpenAI-compatible POST to the Supplier's `baseUrl`.
 *
 * The credential is resolved by name from the environment at request time, so
 * a database compromise hands over nothing that can spend — a Supplier record
 * stores the *name* of an environment variable, never the key.
 */
export function createHttpTransport(opts: {
  fetchImpl?: typeof fetch;
  readCredential: (envName: string | undefined) => string | undefined;
}): ResolveTransport {
  const doFetch = opts.fetchImpl ?? fetch;

  return (supplier: Supplier): SupplierTransport => {
    const credential = opts.readCredential(supplier.upstreamCredentialEnv);
    const url = `${supplier.baseUrl.replace(/\/$/, "")}/chat/completions`;

    return (body, signal) =>
      doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
  };
}
