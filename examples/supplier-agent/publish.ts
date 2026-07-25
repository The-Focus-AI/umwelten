/**
 * Stage 4 of the supplier agent: publish.
 *
 * Turn probe results into OfferDrafts and hand them to the exchange. Two
 * things this stage deliberately does not do:
 *
 *   - It does not set a price. The exchange sets Cost and Charge; letting a
 *     supplier price itself would hand away the exchange's routing lever.
 *   - It does not assert Guarantees. `SupplierProfile.guarantees` is echoed
 *     for confirmation only. The operator is liable for a Guarantee, so the
 *     operator is where it is recorded.
 *
 * Transport is plain HTTP POST, which is the bootstrap case from Q10: it
 * covers a box reachable over a tunnel, and it is the same shape a commercial
 * vendor presents. Dial-out — where the box holds an outbound connection and
 * never listens on a port — replaces this later, and is what makes the
 * "no inbound surface" claim sellable.
 */

import fs from "node:fs";
import path from "node:path";
import type { CapabilityName, OfferDraft, ProbedOffer, SupplierProfile } from "./types.js";

/** Drop failed probes; keep only capabilities that actually passed. */
export function toOfferDrafts(
  probed: ProbedOffer[],
  profile: SupplierProfile,
): OfferDraft[] {
  return probed
    .filter((p) => !p.failed)
    .map((p) => ({
      supplierId: profile.supplierId,
      provider: p.provider,
      model: p.model,
      probedAt: p.probedAt,
      capabilities: p.capabilities
        .filter((c) => c.supported)
        .map((c) => c.name as CapabilityName),
      throughput: p.throughput,
      contextChars: p.contextChars,
    }));
}

export interface PublishResult {
  written: string;
  posted: boolean;
  status?: number;
  error?: string;
}

/**
 * Write the drafts to disk, and POST them if an exchange URL is configured.
 * The file is written either way — a publish run that cannot reach the
 * exchange should still leave you something to inspect.
 */
export async function publishOffers(
  drafts: OfferDraft[],
  profile: SupplierProfile,
  opts: { outDir: string; exchangeUrl?: string; token?: string } = {
    outDir: "output/supplier-agent",
  },
): Promise<PublishResult> {
  const body = { profile, offers: drafts };

  fs.mkdirSync(opts.outDir, { recursive: true });
  const written = path.join(opts.outDir, `offers-${profile.supplierId}.json`);
  fs.writeFileSync(written, JSON.stringify(body, null, 2));

  if (!opts.exchangeUrl) return { written, posted: false };

  try {
    const res = await fetch(new URL("/suppliers/offers", opts.exchangeUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { written, posted: res.ok, status: res.status };
  } catch (error) {
    return {
      written,
      posted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
