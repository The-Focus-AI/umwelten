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

export const SUPPLIER_PATHS = [
  "/chat/completions",
  "/embeddings",
  "/audio/transcriptions",
  "/images/generations",
  "/videos/generations",
] as const;
export type SupplierPath = (typeof SUPPLIER_PATHS)[number];

export interface SupplierRequest {
  path: SupplierPath;
  contentType: string;
  body: Record<string, unknown> | Uint8Array;
  /** Exchange-owned correlation headers; never copied from arbitrary callers. */
  headers?: Record<string, string>;
}

export type SupplierTransportInput = SupplierRequest | Record<string, unknown>;

export function normalizeSupplierRequest(
  input: SupplierTransportInput,
): SupplierRequest {
  if (
    "path" in input &&
    "contentType" in input &&
    "body" in input &&
    typeof input.path === "string" &&
    typeof input.contentType === "string"
  ) {
    return input as SupplierRequest;
  }
  return {
    path: "/chat/completions",
    contentType: "application/json",
    body: input as Record<string, unknown>,
  };
}

/**
 * A request, already validated and metered at admission, on its way to a
 * Supplier. The body is the buyer's own OpenAI-shaped payload, forwarded
 * unmodified — the Exchange adds nothing to it.
 */
export type SupplierTransport = (
  request: SupplierTransportInput,
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

    return (input, signal) => {
      const request = normalizeSupplierRequest(input);
      return doFetch(`${supplier.baseUrl.replace(/\/$/, "")}${request.path}`, {
        method: "POST",
        headers: {
          "content-type": request.contentType,
          ...request.headers,
          ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        },
        body:
          request.body instanceof Uint8Array
            ? (request.body.buffer.slice(
                request.body.byteOffset,
                request.body.byteOffset + request.body.byteLength,
              ) as ArrayBuffer)
            : JSON.stringify(request.body),
        signal,
      });
    };
  };
}
