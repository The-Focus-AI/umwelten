/**
 * Exchange domain types.
 *
 * Vocabulary follows `CONTEXT.md` in this package. Two rules from the ADRs are
 * encoded structurally here rather than left to convention:
 *
 *   - **Capabilities belong to the Offer, not the Model** (ADR 0015). The same
 *     Model served two ways is two Offers with two capability sets, because
 *     the whole serving path — client, runtime, build, quantization — decides
 *     what it can do.
 *   - **Money is integer micro-dollars** (ADR 0013). No amount is ever held in
 *     a float, and Cost and Charge are independent fields rather than one
 *     derived from the other.
 */

/** One millionth of a dollar. The only denomination in this package. */
export type MicroDollars = number;

/**
 * Something an Offer can do. Established by probing the serving path, never
 * declared — see ADR 0015 and the supplier agent's probe battery.
 */
export type CapabilityName =
  | "chat"
  | "streaming"
  | "tool-calling"
  | "structured-output"
  | "reasoning";

export const CAPABILITY_NAMES: readonly CapabilityName[] = [
  "chat",
  "streaming",
  "tool-calling",
  "structured-output",
  "reasoning",
];

/**
 * Whether the Supplier controls the runtime behind an Offer, or is reselling
 * one it does not control. Only managed Offers can commit to resource
 * properties like context size and quantization (ADR 0016).
 */
export type ServingMode = "managed" | "adapted";

/** One throughput measurement. Always measured, never declared. */
export interface HeadroomSample {
  concurrency: number;
  ttftMs: number;
  tokensPerSecond: number;
  decodeTokensPerSecond: number;
}

/**
 * A party that produces model tokens — hardware the operator owns, a partner's
 * on-premise machine, or a commercial vendor. Google and a DGX are the same
 * kind of thing here (ADR 0012).
 */
export interface Supplier {
  id: string;
  displayName: string;
  /**
   * Guarantees this Supplier may publish under. Granted by the operator, who
   * is the party liable for them — never self-declared (ADR 0012). Enforcing
   * the grant on publish is #299.
   */
  grantedGuarantees: string[];
  /** sha256 of the bearer credential. The credential itself is never stored. */
  credentialHash: string;
  /**
   * Where the Exchange sends work. An OpenAI-compatible base URL, which covers
   * a commercial vendor and a tunnelled on-prem box identically — the point of
   * unifying them as one concept (ADR 0012).
   */
  baseUrl: string;
  /**
   * Name of the environment variable holding the credential we present *to*
   * this Supplier. The name, not the secret: keeping upstream keys out of
   * Postgres means a database compromise does not hand over every Supplier
   * we buy from.
   */
  upstreamCredentialEnv?: string;
  enabled: boolean;
  createdAt: Date;
}

/** A commitment by one Supplier to serve one Model. */
export interface Offer {
  supplierId: string;
  model: string;
  capabilities: CapabilityName[];
  /**
   * Inherited from the Supplier, never published by it. Guarantees are granted
   * by the operator because the operator is liable for them (ADR 0012); an
   * Offer carries a copy so Dispatch can filter without a second lookup.
   */
  guarantees: string[];
  servingMode: ServingMode;
  headroom: HeadroomSample[];
  /** Context length this Offer actually accepts, when the Supplier probed it. */
  contextTokens?: number;
  /**
   * What the Supplier is owed per million tokens. Zero for hardware the
   * operator owns. Set by the operator, never by the Supplier.
   */
  wholesalePromptPerMillion: MicroDollars;
  wholesaleCompletionPerMillion: MicroDollars;
  /**
   * What the Exchange charges per million tokens. Deliberately independent of
   * wholesale (ADR 0013) — this is the routing lever.
   */
  retailPromptPerMillion: MicroDollars;
  retailCompletionPerMillion: MicroDollars;
  enabled: boolean;
  publishedAt: Date;
}

/**
 * What a Supplier sends when it publishes. Note what is absent: prices, and
 * the enabled flag. A Supplier that could price itself would take away the
 * Exchange's routing lever (ADR 0013).
 */
export interface PublishedOffer {
  model: string;
  capabilities: CapabilityName[];
  servingMode: ServingMode;
  headroom?: HeadroomSample[];
  contextTokens?: number;
}

/** An organization invoiced for the usage of the Applications it owns. */
export interface Client {
  id: string;
  name: string;
}

/**
 * A product built on the Exchange.
 *
 * Holds a signing key (published as a JWKS the Exchange fetches), the
 * Guarantees every one of its requests requires, and the Models it may reach.
 * It does not hold a Balance field — Balances are their own records, keyed on
 * the Application or on an (Application, subject) pair (#298).
 */
export interface Application {
  id: string;
  clientId: string;
  /** Where the Exchange fetches this Application's public keys. */
  jwksUrl: string;
  /**
   * Applied to every request from this Application, whether or not the request
   * asks. An Application that must stay on-premise cannot opt out per-request.
   */
  requiredGuarantees: string[];
  /** When set, a request for a Model outside this list is refused. */
  allowedModels?: string[];
  enabled: boolean;
  createdAt: Date;
}

/** Who a Balance belongs to. The same mechanism serves all three. */
export type BalanceOwnerKind = "client" | "application" | "end-user";

/**
 * Money available to be spent.
 *
 * A Balance is the **sum of its ledger entries**, never a mutated total. No
 * figure is ever overwritten, so history is always reconstructable and a
 * disputed charge can be traced to the request that caused it.
 */
export interface Balance {
  ownerKind: BalanceOwnerKind;
  /**
   * Client id, Application id, or `applicationId:subject` for an End User.
   * The pair matters: "user-1" at two Applications is two different people.
   */
  ownerKey: string;
  microDollars: MicroDollars;
}

/** One append-only movement. Positive is a grant, negative is a debit. */
export interface LedgerEntry {
  id: string;
  ownerKind: BalanceOwnerKind;
  ownerKey: string;
  /** Signed. The Balance is the sum of these. */
  microDollars: MicroDollars;
  /** The request that caused it, when there was one. */
  requestId?: string;
  reason: string;
  createdAt: Date;
}

/**
 * What one request consumed and what it was worth, both directions.
 *
 * Cost and Charge are recorded independently (ADR 0013) — Client invoices read
 * Cost, End User balances read Charge, and every report must say which. Getting
 * that backwards bills a customer for GPU time we never paid for.
 */
export interface RequestRecord {
  id: string;
  applicationId: string;
  /** The End User subject the Application asserted. */
  subject: string;
  supplierId: string;
  model: string;
  /** Counted at admission, on our side of the wire. */
  promptTokens: number;
  /** Counted as chunks were relayed. Survives an abort by construction. */
  completionTokens: number;
  cost: MicroDollars;
  charge: MicroDollars;
  /** True when the caller hung up. The prompt is charged regardless. */
  aborted: boolean;
  /**
   * What the upstream said it used, when it said anything. Recorded for
   * reconciliation against our own count, never used to compute a Charge.
   */
  upstreamPromptTokens?: number;
  upstreamCompletionTokens?: number;
  startedAt: Date;
  finishedAt: Date;
}

/** Prices for one (Supplier, Model) pair, set by the operator. */
export interface OfferPricing {
  wholesalePromptPerMillion: MicroDollars;
  wholesaleCompletionPerMillion: MicroDollars;
  retailPromptPerMillion: MicroDollars;
  retailCompletionPerMillion: MicroDollars;
}

/**
 * Applied to any Offer with no operator-set price. Zero wholesale is correct
 * for owned hardware; a non-zero retail is what rations it — a free-to-serve
 * Offer priced at zero would be defenceless (ADR 0013).
 */
export const DEFAULT_PRICING: OfferPricing = {
  wholesalePromptPerMillion: 0,
  wholesaleCompletionPerMillion: 0,
  retailPromptPerMillion: 100_000,
  retailCompletionPerMillion: 400_000,
};
