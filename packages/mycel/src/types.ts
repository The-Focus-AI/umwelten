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
  /** How long generation ran. A short window understates, so it is published. */
  decodeSeconds?: number;
  /** Whether the sample met the Supplier's stated sampling policy. */
  meetsPolicy?: boolean;
  errors?: number;
}

/**
 * What a set of samples says about concurrent work.
 *
 * A flat aggregate with rising time-to-first-token is queueing; a falling
 * aggregate is contention. Dispatch cares about the difference: a Supplier
 * that queues cannot take a second customer without the first one noticing.
 */
export type SaturationVerdict = "batches" | "queues" | "contends" | "inconclusive";

/**
 * How a Headroom was measured, published alongside it.
 *
 * Carried rather than assumed, so two Suppliers' numbers can be compared
 * knowing they were taken the same way — and so it is visible when one of them
 * was not.
 */
export interface HeadroomMeta {
  sampledAt: string;
  /** Time to first token when the Model was not already resident. */
  coldStartMs?: number;
  coldStartFirstTouch?: boolean;
  policy?: {
    levels: number[];
    minDecodeSeconds: number;
    maxSampleSeconds: number;
    cooldownMs: number;
    resampleAfterSeconds: number;
    countTo: number;
  };
  saturation?: SaturationVerdict;
  /** Set when sampling failed. The Offer is still live, with the gap visible. */
  failed?: string;
}

/**
 * A party that produces model tokens — hardware the operator owns, a partner's
 * on-premise machine, or a commercial vendor. Google and a DGX are the same
 * kind of thing here (ADR 0012).
 */
/**
 * How the Exchange reaches a Supplier, and the difference is real rather than
 * incidental (ADR 0023).
 *
 * A **vendor** is dialled out to, because a public API is reachable by
 * definition. A **machine** — a DGX on a desk, a laptop, anything someone owns
 * — dials in and holds a Connection; the Exchange never connects to it, and it
 * accepts no inbound connections at all.
 *
 * Defaults to `vendor` everywhere, so a Supplier registered before this existed
 * keeps behaving exactly as it did.
 */
export type SupplierKind = "agent" | "vendor";

export interface Supplier {
  id: string;
  displayName: string;
  /** Whether this Supplier dials in or is dialled out to (ADR 0023). */
  kind: SupplierKind;
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
  /**
   * Inherited from the Supplier, never published by it — the same arrangement
   * as `guarantees` below, and for the same reason: Dispatch receives Offers
   * and no Supplier records, so it must be able to tell a machine from a vendor
   * without a second lookup (ADR 0023).
   */
  supplierKind: SupplierKind;
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
  /** How the Headroom was sampled, and whether sampling succeeded. */
  headroomMeta?: HeadroomMeta;
  /** Context length this Offer actually accepts, when the Supplier probed it. */
  contextTokens?: number;
  /**
   * The quantization behind this Offer. Only a managed Offer can say — an
   * adapted one is reselling a configuration its Supplier does not control
   * (ADR 0016).
   */
  quantization?: string;
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
  headroomMeta?: HeadroomMeta;
  contextTokens?: number;
  quantization?: string;
}

/** An organization invoiced for the usage of the Applications it owns. */
export interface Client {
  id: string;
  name: string;
  /**
   * How far this Client's own Balance may go negative before requests are
   * refused (ADR 0028). Zero is prepaid — a hard stop at nothing left.
   *
   * Applies **only** to the Client's own Balance. A charge that resolves to an
   * End User or Application balance still stops at zero, because granting one
   * of those is how you cap it and a cap that can be exceeded is not one.
   */
  creditLimitMicroDollars?: MicroDollars;
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
  /**
   * Where the Exchange fetches this Application's public keys. Empty when the
   * Application authenticates with a static credential instead.
   */
  jwksUrl: string;
  /**
   * sha256 of a static bearer credential, for an Application that cannot run a
   * JWKS endpoint — a habitat, a script, a small client.
   *
   * Not the weakening it looks like. **The JWT never authenticated the End
   * User**: ADR 0014 has the Exchange trust the Application's assertion of the
   * subject either way, so a signature only ever proved *which Application* was
   * calling, which a hashed bearer proves too. What the JWT genuinely buys is
   * short expiry and no spendable secret at rest here — which is why JWKS stays
   * the recommended path for anyone able to serve one.
   *
   * The credential itself is never stored, only its hash, matching Suppliers.
   */
  credentialHash?: string;
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
/**
 * Why a Connection ended. Recorded rather than inferred, because an operator
 * debugging a quiet machine needs to tell a laptop that closed from an agent
 * that crashed from one this Exchange hung up on itself.
 */
export type DisconnectReason =
  /** The agent said goodbye — Ctrl-C, or a clean shutdown. */
  | "closed"
  /** The socket died. What a lid closing looks like from here. */
  | "transport-error"
  /** The same Supplier dialled in again, so this one is the older of two. */
  | "displaced"
  /** The Exchange is going down and is hanging up on purpose. */
  | "shutdown";

/**
 * A connect or disconnect, appended and never rewritten.
 *
 * Current state is the in-memory map — this is the record of what happened,
 * which a boolean column structurally cannot be. A boolean can only say *now*,
 * and the questions worth asking of an Exchange are about *then*: was that
 * machine up at 03:00, how often does it flap, what was its real uptime.
 * Joins to `RequestRecord` on `supplierId`, so "every request that failed while
 * thor was disconnected" is one query (ADR 0023).
 */
export interface ConnectionEvent {
  id: string;
  supplierId: string;
  event: "connected" | "disconnected";
  /** Only on a disconnect. */
  reason?: DisconnectReason;
  at: Date;
}

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
/**
 * Why a request stopped producing tokens.
 *
 * The distinction that matters is *who chose*: a buyer who hangs up chose to,
 * and we who picked the Supplier chose that. Both leave a truncated stream and
 * before this they were indistinguishable after the fact.
 */
export type RequestOutcome =
  /** The upstream finished the response. */
  | "completed"
  /** The caller hung up. The prompt was still submitted, so it is still owed. */
  | "buyer-aborted"
  /** The Supplier dropped, died, or errored partway. Our choice, our problem. */
  | "supply-failed"
  /** We cut the stream off because the Balance ran out mid-flight. */
  | "credit-exhausted";

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
  /**
   * How the request ended. A truncated stream has more than one cause and they
   * are not each other's fault (ADR 0025 — the Exchange bears its own supply
   * failures), so the cause is recorded rather than inferred from the fact of
   * truncation.
   *
   * Recorded, not yet acted on: every outcome is still debited. Skipping the
   * debit on `supply-failed` is the second half of ADR 0025 and is deliberately
   * not done here.
   */
  outcome: RequestOutcome;
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
