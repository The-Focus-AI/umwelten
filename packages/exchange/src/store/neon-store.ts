/**
 * Neon Postgres implementation of ExchangeStore.
 *
 * Uses @neondatabase/serverless for HTTP-based queries, same as
 * `mcp-serve/neon-store.ts` — no WebSocket, so it works from short-lived
 * request handlers without connection pooling.
 *
 * Money columns are BIGINT micro-dollars. Never NUMERIC, never floating point:
 * a Balance is a sum of these and an amount that cannot be represented exactly
 * is an amount somebody eventually argues about.
 */

import { neon } from "@neondatabase/serverless";
import { DEFAULT_PRICING } from "../types.js";
import type {
  CapabilityName,
  HeadroomSample,
  Offer,
  OfferPricing,
  PublishedOffer,
  ServingMode,
  Supplier,
} from "../types.js";
import type { ExchangeStore } from "./types.js";

type Row = Record<string, unknown>;

export class NeonStore implements ExchangeStore {
  private sql;

  constructor(databaseUrl: string) {
    this.sql = neon(databaseUrl);
  }

  async setup(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS exchange_supplier (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        granted_guarantees JSONB NOT NULL DEFAULT '[]'::jsonb,
        credential_hash TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        upstream_credential_env TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // Looking a Supplier up by presented credential is on the hot path of
    // every publish.
    await this.sql`
      CREATE INDEX IF NOT EXISTS exchange_supplier_credential_hash_idx
        ON exchange_supplier (credential_hash)
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS exchange_offer (
        supplier_id TEXT NOT NULL REFERENCES exchange_supplier(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
        serving_mode TEXT NOT NULL,
        headroom JSONB NOT NULL DEFAULT '[]'::jsonb,
        context_tokens INTEGER,
        enabled BOOLEAN NOT NULL DEFAULT true,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (supplier_id, model)
      )
    `;

    // Pricing is a separate table on purpose: it is operator-owned and must
    // outlive the Offer it applies to, so that a re-probe — or a Model that
    // briefly disappears — does not silently reset an operator's prices.
    await this.sql`
      CREATE TABLE IF NOT EXISTS exchange_offer_pricing (
        supplier_id TEXT NOT NULL,
        model TEXT NOT NULL,
        wholesale_prompt_per_million BIGINT NOT NULL,
        wholesale_completion_per_million BIGINT NOT NULL,
        retail_prompt_per_million BIGINT NOT NULL,
        retail_completion_per_million BIGINT NOT NULL,
        PRIMARY KEY (supplier_id, model)
      )
    `;
  }

  // ── Suppliers ─────────────────────────────────────────────────────

  async createSupplier(supplier: Supplier): Promise<void> {
    await this.sql`
      INSERT INTO exchange_supplier
        (id, display_name, granted_guarantees, credential_hash, base_url,
         upstream_credential_env, enabled, created_at)
      VALUES (
        ${supplier.id}, ${supplier.displayName},
        ${JSON.stringify(supplier.grantedGuarantees)}::jsonb,
        ${supplier.credentialHash}, ${supplier.baseUrl},
        ${supplier.upstreamCredentialEnv ?? null},
        ${supplier.enabled}, ${supplier.createdAt.toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        granted_guarantees = EXCLUDED.granted_guarantees,
        credential_hash = EXCLUDED.credential_hash,
        base_url = EXCLUDED.base_url,
        upstream_credential_env = EXCLUDED.upstream_credential_env,
        enabled = EXCLUDED.enabled
    `;
  }

  async getSupplier(id: string): Promise<Supplier | null> {
    const rows = (await this.sql`
      SELECT * FROM exchange_supplier WHERE id = ${id}
    `) as Row[];
    return rows[0] ? toSupplier(rows[0]) : null;
  }

  async getSupplierByCredentialHash(hash: string): Promise<Supplier | null> {
    const rows = (await this.sql`
      SELECT * FROM exchange_supplier WHERE credential_hash = ${hash}
    `) as Row[];
    return rows[0] ? toSupplier(rows[0]) : null;
  }

  async listSuppliers(): Promise<Supplier[]> {
    const rows = (await this.sql`
      SELECT * FROM exchange_supplier ORDER BY id
    `) as Row[];
    return rows.map(toSupplier);
  }

  async setSupplierEnabled(id: string, enabled: boolean): Promise<void> {
    await this.sql`UPDATE exchange_supplier SET enabled = ${enabled} WHERE id = ${id}`;
  }

  // ── Offers ────────────────────────────────────────────────────────

  async replaceOffers(supplierId: string, published: PublishedOffer[]): Promise<void> {
    // Delete-then-insert rather than upsert-and-prune: "replace" is total, and
    // expressing it as one delete plus inserts means a partially-applied
    // publish can never leave a Model advertised that the Supplier dropped.
    await this.sql`DELETE FROM exchange_offer WHERE supplier_id = ${supplierId}`;

    for (const offer of published) {
      await this.sql`
        INSERT INTO exchange_offer
          (supplier_id, model, capabilities, serving_mode, headroom, context_tokens, enabled)
        VALUES (
          ${supplierId}, ${offer.model},
          ${JSON.stringify(offer.capabilities)}::jsonb,
          ${offer.servingMode},
          ${JSON.stringify(offer.headroom ?? [])}::jsonb,
          ${offer.contextTokens ?? null}, true
        )
      `;
    }
  }

  async listOffersBySupplier(supplierId: string): Promise<Offer[]> {
    const rows = (await this.sql`
      SELECT o.*, s.granted_guarantees, p.wholesale_prompt_per_million, p.wholesale_completion_per_million,
             p.retail_prompt_per_million, p.retail_completion_per_million
      FROM exchange_offer o
      JOIN exchange_supplier s ON s.id = o.supplier_id
      LEFT JOIN exchange_offer_pricing p
        ON p.supplier_id = o.supplier_id AND p.model = o.model
      WHERE o.supplier_id = ${supplierId}
      ORDER BY o.model
    `) as Row[];
    return rows.map(toOffer);
  }

  async listOffers(): Promise<Offer[]> {
    const rows = (await this.sql`
      SELECT o.*, s.granted_guarantees, p.wholesale_prompt_per_million, p.wholesale_completion_per_million,
             p.retail_prompt_per_million, p.retail_completion_per_million
      FROM exchange_offer o
      JOIN exchange_supplier s ON s.id = o.supplier_id
      LEFT JOIN exchange_offer_pricing p
        ON p.supplier_id = o.supplier_id AND p.model = o.model
      WHERE s.enabled = true
      ORDER BY o.supplier_id, o.model
    `) as Row[];
    return rows.map(toOffer);
  }

  async getOffer(supplierId: string, model: string): Promise<Offer | null> {
    const rows = (await this.sql`
      SELECT o.*, s.granted_guarantees, p.wholesale_prompt_per_million, p.wholesale_completion_per_million,
             p.retail_prompt_per_million, p.retail_completion_per_million
      FROM exchange_offer o
      JOIN exchange_supplier s ON s.id = o.supplier_id
      LEFT JOIN exchange_offer_pricing p
        ON p.supplier_id = o.supplier_id AND p.model = o.model
      WHERE o.supplier_id = ${supplierId} AND o.model = ${model}
    `) as Row[];
    return rows[0] ? toOffer(rows[0]) : null;
  }

  async setOfferEnabled(supplierId: string, model: string, enabled: boolean): Promise<void> {
    await this.sql`
      UPDATE exchange_offer SET enabled = ${enabled}
      WHERE supplier_id = ${supplierId} AND model = ${model}
    `;
  }

  async setOfferPricing(supplierId: string, model: string, pricing: OfferPricing): Promise<void> {
    await this.sql`
      INSERT INTO exchange_offer_pricing
        (supplier_id, model, wholesale_prompt_per_million, wholesale_completion_per_million,
         retail_prompt_per_million, retail_completion_per_million)
      VALUES (
        ${supplierId}, ${model},
        ${pricing.wholesalePromptPerMillion}, ${pricing.wholesaleCompletionPerMillion},
        ${pricing.retailPromptPerMillion}, ${pricing.retailCompletionPerMillion}
      )
      ON CONFLICT (supplier_id, model) DO UPDATE SET
        wholesale_prompt_per_million = EXCLUDED.wholesale_prompt_per_million,
        wholesale_completion_per_million = EXCLUDED.wholesale_completion_per_million,
        retail_prompt_per_million = EXCLUDED.retail_prompt_per_million,
        retail_completion_per_million = EXCLUDED.retail_completion_per_million
    `;
  }
}

// ── Row mapping ─────────────────────────────────────────────────────

function toSupplier(row: Row): Supplier {
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    grantedGuarantees: (row.granted_guarantees as string[]) ?? [],
    credentialHash: String(row.credential_hash),
    baseUrl: String(row.base_url ?? ""),
    upstreamCredentialEnv:
      row.upstream_credential_env === null || row.upstream_credential_env === undefined
        ? undefined
        : String(row.upstream_credential_env),
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * BIGINT comes back from the driver as a string. Number is safe here — micro-
 * dollar prices per million tokens are far below 2^53 — but a Balance sum is
 * not, so whatever adds those up must not reuse this.
 */
function money(value: unknown, fallback: number): number {
  return value === null || value === undefined ? fallback : Number(value);
}

function toOffer(row: Row): Offer {
  return {
    supplierId: String(row.supplier_id),
    model: String(row.model),
    capabilities: (row.capabilities as CapabilityName[]) ?? [],
    guarantees: (row.granted_guarantees as string[]) ?? [],
    servingMode: String(row.serving_mode) as ServingMode,
    headroom: (row.headroom as HeadroomSample[]) ?? [],
    contextTokens: row.context_tokens === null ? undefined : Number(row.context_tokens),
    wholesalePromptPerMillion: money(
      row.wholesale_prompt_per_million,
      DEFAULT_PRICING.wholesalePromptPerMillion,
    ),
    wholesaleCompletionPerMillion: money(
      row.wholesale_completion_per_million,
      DEFAULT_PRICING.wholesaleCompletionPerMillion,
    ),
    retailPromptPerMillion: money(
      row.retail_prompt_per_million,
      DEFAULT_PRICING.retailPromptPerMillion,
    ),
    retailCompletionPerMillion: money(
      row.retail_completion_per_million,
      DEFAULT_PRICING.retailCompletionPerMillion,
    ),
    enabled: Boolean(row.enabled),
    publishedAt: new Date(row.published_at as string),
  };
}
