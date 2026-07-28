/**
 * The supply surface: `POST /suppliers/offers`.
 *
 * A Supplier presents a bearer credential and sends the Offers it has probed.
 * Publishing is total — what arrives replaces that Supplier's entire Offer set,
 * so a Model it has stopped serving stops being advertised without anyone
 * deleting anything. That is what makes re-probing safe to repeat.
 *
 * Framework-free over node's IncomingMessage/ServerResponse so tests can drive
 * it with fabricated request and response objects and no network, the same way
 * `mcp-serve/mount.test.ts` drives the OAuth surface.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CAPABILITY_NAMES } from "../types.js";
import { GuaranteeNotGrantedError, Operator } from "../operator.js";
import type { CapabilityName, PublishedOffer, ServingMode } from "../types.js";
import type { ExchangeStore } from "../store/types.js";

export const SUPPLY_PATH = "/suppliers/offers";

/** Bodies larger than this are refused before parsing. */
const MAX_BODY_BYTES = 1_000_000;

export function hashCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

/**
 * Constant-time compare of two hex digests. Both are already hashes, so the
 * secret is not in play — but a length-independent compare keeps the lookup
 * from being a timing oracle for which Suppliers exist.
 */
function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface SupplyHandlerOptions {
  store: ExchangeStore;
}

export interface PublishRequest {
  offers: unknown;
  /**
   * Guarantees the Supplier believes it is offered under. Echoed for
   * confirmation, never authoritative — the operator's grant decides, and a
   * claim beyond it is rejected (ADR 0006).
   */
  guarantees?: unknown;
}

class PublishError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Validate a published Offer set.
 *
 * Rejects, rather than ignores, a payload carrying prices. A Supplier setting
 * its own price would take away the Exchange's routing lever (ADR 0007), and
 * silently dropping the field would let a Supplier believe it had been honored.
 */
export function parsePublishedOffers(input: unknown): PublishedOffer[] {
  if (!input || typeof input !== "object" || !Array.isArray((input as PublishRequest).offers)) {
    throw new PublishError(400, "invalid_body", "Expected an object with an `offers` array.");
  }

  const raw = (input as PublishRequest).offers as unknown[];
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new PublishError(400, "invalid_offer", `Offer at index ${index} is not an object.`);
    }
    const offer = entry as Record<string, unknown>;

    const priceKey = Object.keys(offer).find((k) => /price|wholesale|retail|cost|charge/i.test(k));
    if (priceKey) {
      throw new PublishError(
        400,
        "price_not_accepted",
        `Offer at index ${index} carries "${priceKey}". Suppliers do not set prices; the operator does.`,
      );
    }

    if (typeof offer.model !== "string" || offer.model.length === 0) {
      throw new PublishError(400, "invalid_offer", `Offer at index ${index} has no model.`);
    }
    if (offer.servingMode !== "managed" && offer.servingMode !== "adapted") {
      throw new PublishError(
        400,
        "invalid_offer",
        `Offer at index ${index} has an unknown servingMode.`,
      );
    }
    if (!Array.isArray(offer.capabilities)) {
      throw new PublishError(
        400,
        "invalid_offer",
        `Offer at index ${index} has no capabilities array.`,
      );
    }
    for (const capability of offer.capabilities) {
      if (!CAPABILITY_NAMES.includes(capability as CapabilityName)) {
        throw new PublishError(
          400,
          "unknown_capability",
          `Offer at index ${index} claims unknown capability "${String(capability)}".`,
        );
      }
    }

    return {
      model: offer.model,
      capabilities: offer.capabilities as CapabilityName[],
      servingMode: offer.servingMode as ServingMode,
      headroom: Array.isArray(offer.headroom) ? (offer.headroom as PublishedOffer["headroom"]) : [],
      contextTokens: typeof offer.contextTokens === "number" ? offer.contextTokens : undefined,
    };
  });
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";
    req.on("data", (chunk: Buffer | string) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new PublishError(413, "body_too_large", "Payload exceeds the size limit."));
        return;
      }
      raw += chunk;
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Returns a handler that reports whether it consumed the request, so a host
 * can mount it alongside other surfaces and fall through when it did not.
 */
export function createSupplyHandler(opts: SupplyHandlerOptions) {
  const { store } = opts;

  return async function handleSupply(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<boolean> {
    const path = (req.url ?? "").split("?")[0];
    if (path !== SUPPLY_PATH) return false;

    if (req.method !== "POST") {
      send(res, 405, { error: "method_not_allowed" });
      return true;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      send(res, 401, { error: "unauthorized" });
      return true;
    }

    const presented = hashCredential(auth.slice("Bearer ".length).trim());
    const supplier = await store.getSupplierByCredentialHash(presented);
    // The lookup is by hash, so this compare is belt-and-braces — but it keeps
    // the check honest if the lookup is ever loosened.
    if (!supplier || !hashesEqual(supplier.credentialHash, presented)) {
      send(res, 401, { error: "unauthorized" });
      return true;
    }
    if (!supplier.enabled) {
      // Distinct from unauthorized: the credential is real, the Supplier is
      // out of rotation. An operator debugging a silent machine needs to tell
      // "wrong key" from "you disabled me".
      send(res, 403, { error: "supplier_disabled" });
      return true;
    }

    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || "{}") as PublishRequest;

      // Rejected outright, not silently downgraded. A compromised agent must
      // not be able to promote itself into eligibility for on-premise traffic,
      // and a misconfigured one should hear about it rather than quietly serve
      // without the guarantee it thinks it has.
      const claimed = Array.isArray(parsed.guarantees) ? (parsed.guarantees as string[]) : [];
      try {
        Operator.assertGuaranteesGranted(supplier, claimed);
      } catch (error) {
        if (error instanceof GuaranteeNotGrantedError) {
          send(res, 403, {
            error: "guarantee_not_granted",
            guarantee: error.guarantee,
            message: error.message,
            granted: supplier.grantedGuarantees,
          });
          return true;
        }
        throw error;
      }

      const offers = parsePublishedOffers(parsed);
      await store.replaceOffers(supplier.id, offers);
      send(res, 200, {
        supplierId: supplier.id,
        offers: offers.length,
        guarantees: supplier.grantedGuarantees,
      });
    } catch (error) {
      if (error instanceof PublishError) {
        send(res, error.status, { error: error.code, message: error.message });
      } else if (error instanceof SyntaxError) {
        send(res, 400, { error: "invalid_json", message: "Body is not valid JSON." });
      } else {
        send(res, 500, { error: "internal_error" });
      }
    }
    return true;
  };
}
