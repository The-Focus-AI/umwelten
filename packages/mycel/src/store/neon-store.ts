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
  Application,
  Balance,
  BalanceOwnerKind,
  CapabilityName,
  Client,
  LedgerEntry,
  HeadroomSample,
  HeadroomMeta,
  Offer,
  OfferPricing,
  PublishedOffer,
  RequestRecord,
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
        headroom_meta JSONB,
        context_tokens INTEGER,
        quantization TEXT,
        enabled BOOLEAN NOT NULL DEFAULT true,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (supplier_id, model)
      )
    `;

    // Added after the table shipped. `CREATE TABLE IF NOT EXISTS` is a no-op on
    // a database that already has the older shape, so the columns need saying
    // twice — harmless on a fresh database, necessary on an existing one.
    await this.sql`ALTER TABLE exchange_offer ADD COLUMN IF NOT EXISTS headroom_meta JSONB`;
    await this.sql`ALTER TABLE exchange_offer ADD COLUMN IF NOT EXISTS quantization TEXT`;

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

    await this.sql`
      CREATE TABLE IF NOT EXISTS exchange_client (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    await this.sql`
      CREATE TABLE IF NOT EXISTS exchange_application (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES exchange_client(id) ON DELETE CASCADE,
        jwks_url TEXT NOT NULL,
        credential_hash TEXT,
        required_guarantees JSONB NOT NULL DEFAULT '[]'::jsonb,
        allowed_models JSONB,
        enabled BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await this.sql`ALTER TABLE exchange_application ADD COLUMN IF NOT EXISTS credential_hash TEXT`;

    // Resolving an Application by presented credential is on the hot path of
    // every request from a static-credential caller.
    await this.sql`
      CREATE INDEX IF NOT EXISTS exchange_application_credential_hash_idx
        ON exchange_application (credential_hash)
    `;

    // Append-only. A usage record is never rewritten — a disputed charge has
    // to be traceable to the request that caused it.
    await this.sql`
      CREATE TABLE IF NOT EXISTS exchange_request (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL,
        completion_tokens INTEGER NOT NULL,
        cost BIGINT NOT NULL,
        charge BIGINT NOT NULL,
        aborted BOOLEAN NOT NULL DEFAULT false,
        upstream_prompt_tokens INTEGER,
        upstream_completion_tokens INTEGER,
        started_at TIMESTAMPTZ NOT NULL,
        finished_at TIMESTAMPTZ NOT NULL
      )
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS exchange_request_application_subject_idx
        ON exchange_request (application_id, subject)
    `;

    // Append-only: no row is ever updated, and a Balance is SUM(micro_dollars).
    // Storing a running total instead would make a disputed charge
    // unreconstructable and invite exactly the lost-update race this avoids.
    await this.sql`
      CREATE TABLE IF NOT EXISTS exchange_ledger_entry (
        id TEXT PRIMARY KEY,
        owner_kind TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        micro_dollars BIGINT NOT NULL,
        request_id TEXT,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    await this.sql`
      CREATE INDEX IF NOT EXISTS exchange_ledger_owner_idx
        ON exchange_ledger_entry (owner_kind, owner_key)
    `;
  }

  // ── Money ─────────────────────────────────────────────────────────

  async appendLedgerEntry(entry: LedgerEntry): Promise<Balance> {
    // Insert and re-sum in one statement. Reading the balance in a second
    // round trip would let two concurrent requests each see credit only one of
    // them had.
    const rows = (await this.sql`
      WITH inserted AS (
        INSERT INTO exchange_ledger_entry
          (id, owner_kind, owner_key, micro_dollars, request_id, reason, created_at)
        VALUES (
          ${entry.id}, ${entry.ownerKind}, ${entry.ownerKey}, ${entry.microDollars},
          ${entry.requestId ?? null}, ${entry.reason}, ${entry.createdAt.toISOString()}
        )
        RETURNING owner_kind, owner_key
      )
      SELECT COALESCE(SUM(l.micro_dollars), 0) AS balance
      FROM exchange_ledger_entry l
      JOIN inserted i ON i.owner_kind = l.owner_kind AND i.owner_key = l.owner_key
    `) as Row[];

    return {
      ownerKind: entry.ownerKind,
      ownerKey: entry.ownerKey,
      microDollars: Number(rows[0]?.balance ?? 0),
    };
  }

  async hasLedgerEntries(ownerKind: BalanceOwnerKind, ownerKey: string): Promise<boolean> {
    // LIMIT 1 rather than a count: this runs on the hot path of every request,
    // and the question is existence, not how many.
    const rows = (await this.sql`
      SELECT 1 FROM exchange_ledger_entry
      WHERE owner_kind = ${ownerKind} AND owner_key = ${ownerKey}
      LIMIT 1
    `) as Row[];
    return rows.length > 0;
  }

  async getBalance(ownerKind: BalanceOwnerKind, ownerKey: string): Promise<Balance> {
    const rows = (await this.sql`
      SELECT COALESCE(SUM(micro_dollars), 0) AS balance
      FROM exchange_ledger_entry
      WHERE owner_kind = ${ownerKind} AND owner_key = ${ownerKey}
    `) as Row[];
    return { ownerKind, ownerKey, microDollars: Number(rows[0]?.balance ?? 0) };
  }

  async listLedgerEntries(
    ownerKind: BalanceOwnerKind,
    ownerKey: string,
  ): Promise<LedgerEntry[]> {
    const rows = (await this.sql`
      SELECT * FROM exchange_ledger_entry
      WHERE owner_kind = ${ownerKind} AND owner_key = ${ownerKey}
      ORDER BY created_at, id
    `) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      ownerKind: String(row.owner_kind) as BalanceOwnerKind,
      ownerKey: String(row.owner_key),
      microDollars: Number(row.micro_dollars),
      requestId: row.request_id === null ? undefined : String(row.request_id),
      reason: String(row.reason),
      createdAt: new Date(row.created_at as string),
    }));
  }

  // ── Usage ─────────────────────────────────────────────────────────

  async recordRequest(record: RequestRecord): Promise<void> {
    await this.sql`
      INSERT INTO exchange_request
        (id, application_id, subject, supplier_id, model, prompt_tokens,
         completion_tokens, cost, charge, aborted, upstream_prompt_tokens,
         upstream_completion_tokens, started_at, finished_at)
      VALUES (
        ${record.id}, ${record.applicationId}, ${record.subject}, ${record.supplierId},
        ${record.model}, ${record.promptTokens}, ${record.completionTokens},
        ${record.cost}, ${record.charge}, ${record.aborted},
        ${record.upstreamPromptTokens ?? null}, ${record.upstreamCompletionTokens ?? null},
        ${record.startedAt.toISOString()}, ${record.finishedAt.toISOString()}
      )
    `;
  }

  async listRequests(
    filter: { applicationId?: string; subject?: string } = {},
  ): Promise<RequestRecord[]> {
    const rows = (await this.sql`
      SELECT * FROM exchange_request
      WHERE (${filter.applicationId ?? null}::text IS NULL
             OR application_id = ${filter.applicationId ?? null})
        AND (${filter.subject ?? null}::text IS NULL OR subject = ${filter.subject ?? null})
      ORDER BY started_at
    `) as Row[];
    return rows.map(toRequestRecord);
  }

  // ── Demand ────────────────────────────────────────────────────────

  async createClient(client: Client): Promise<void> {
    await this.sql`
      INSERT INTO exchange_client (id, name) VALUES (${client.id}, ${client.name})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `;
  }

  async getClient(id: string): Promise<Client | null> {
    const rows = (await this.sql`SELECT * FROM exchange_client WHERE id = ${id}`) as Row[];
    return rows[0] ? { id: String(rows[0].id), name: String(rows[0].name) } : null;
  }

  async createApplication(application: Application): Promise<void> {
    await this.sql`
      INSERT INTO exchange_application
        (id, client_id, jwks_url, credential_hash, required_guarantees, allowed_models,
         enabled, created_at)
      VALUES (
        ${application.id}, ${application.clientId}, ${application.jwksUrl},
        ${application.credentialHash ?? null},
        ${JSON.stringify(application.requiredGuarantees)}::jsonb,
        ${application.allowedModels ? JSON.stringify(application.allowedModels) : null}::jsonb,
        ${application.enabled}, ${application.createdAt.toISOString()}
      )
      ON CONFLICT (id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        jwks_url = EXCLUDED.jwks_url,
        credential_hash = EXCLUDED.credential_hash,
        required_guarantees = EXCLUDED.required_guarantees,
        allowed_models = EXCLUDED.allowed_models,
        enabled = EXCLUDED.enabled
    `;
  }

  async getApplication(id: string): Promise<Application | null> {
    const rows = (await this.sql`SELECT * FROM exchange_application WHERE id = ${id}`) as Row[];
    return rows[0] ? toApplication(rows[0]) : null;
  }

  async getApplicationByCredentialHash(hash: string): Promise<Application | null> {
    // An empty hash must never match a row with a NULL credential.
    if (!hash) return null;
    const rows = (await this.sql`
      SELECT * FROM exchange_application WHERE credential_hash = ${hash}
    `) as Row[];
    return rows[0] ? toApplication(rows[0]) : null;
  }

  async listApplications(): Promise<Application[]> {
    const rows = (await this.sql`SELECT * FROM exchange_application ORDER BY id`) as Row[];
    return rows.map(toApplication);
  }

  async setApplicationEnabled(id: string, enabled: boolean): Promise<void> {
    await this.sql`UPDATE exchange_application SET enabled = ${enabled} WHERE id = ${id}`;
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
          (supplier_id, model, capabilities, serving_mode, headroom, headroom_meta,
           context_tokens, quantization, enabled)
        VALUES (
          ${supplierId}, ${offer.model},
          ${JSON.stringify(offer.capabilities)}::jsonb,
          ${offer.servingMode},
          ${JSON.stringify(offer.headroom ?? [])}::jsonb,
          ${offer.headroomMeta ? JSON.stringify(offer.headroomMeta) : null}::jsonb,
          ${offer.contextTokens ?? null},
          ${offer.quantization ?? null}, true
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

function toRequestRecord(row: Row): RequestRecord {
  return {
    id: String(row.id),
    applicationId: String(row.application_id),
    subject: String(row.subject),
    supplierId: String(row.supplier_id),
    model: String(row.model),
    promptTokens: Number(row.prompt_tokens),
    completionTokens: Number(row.completion_tokens),
    cost: Number(row.cost),
    charge: Number(row.charge),
    aborted: Boolean(row.aborted),
    upstreamPromptTokens:
      row.upstream_prompt_tokens === null ? undefined : Number(row.upstream_prompt_tokens),
    upstreamCompletionTokens:
      row.upstream_completion_tokens === null ? undefined : Number(row.upstream_completion_tokens),
    startedAt: new Date(row.started_at as string),
    finishedAt: new Date(row.finished_at as string),
  };
}

function toApplication(row: Row): Application {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    jwksUrl: String(row.jwks_url),
    credentialHash: row.credential_hash === null ? undefined : String(row.credential_hash),
    requiredGuarantees: (row.required_guarantees as string[]) ?? [],
    allowedModels: (row.allowed_models as string[] | null) ?? undefined,
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at as string),
  };
}

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
    headroomMeta: (row.headroom_meta as HeadroomMeta | null) ?? undefined,
    contextTokens: row.context_tokens === null ? undefined : Number(row.context_tokens),
    quantization: row.quantization === null ? undefined : String(row.quantization),
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
