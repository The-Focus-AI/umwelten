/**
 * The operator surface for supply.
 *
 * Registering a Supplier, granting the Guarantees it may be offered under,
 * taking an Offer out of rotation, pricing.
 *
 * **Guarantees are asserted by the operator, never self-declared** (ADR 0012).
 * The operator is liable for every Guarantee passed through to a buyer, so a
 * Supplier claiming one it was not granted is rejected outright rather than
 * silently downgraded. That rejection is what stops a compromised supplier
 * agent from promoting itself into eligibility for on-premise traffic.
 */

import { hashCredential, issueCredential } from "./auth/credentials.js";
import { Balances, applicationOwner, clientOwner } from "./metering/balances.js";
import type {
  Application,
  Client,
  MicroDollars,
  OfferPricing,
  PublishedOffer,
  Supplier,
  SupplierKind,
} from "./types.js";
import type { ExchangeStore } from "./store/types.js";

export interface RegisterSupplierInput {
  id: string;
  displayName: string;
  /**
   * Where the Exchange sends work. Meaningful for a vendor; an agent dials in
   * and has no address to register (ADR 0023), so it may be omitted.
   */
  baseUrl?: string;
  /** Defaults to `vendor` — the behaviour every Supplier had before dial-in. */
  kind?: SupplierKind;
  grantedGuarantees?: string[];
  upstreamCredentialEnv?: string;
}

export interface RegisteredSupplier {
  supplier: Supplier;
  /**
   * Shown once and never recoverable — only its hash is stored. An operator
   * who loses it rotates rather than looks it up.
   */
  credential: string;
}

export class GuaranteeNotGrantedError extends Error {
  constructor(readonly guarantee: string) {
    super(
      `Supplier is not granted the guarantee "${guarantee}". ` +
        `Guarantees are granted by the operator, who is liable for them.`,
    );
    this.name = "GuaranteeNotGrantedError";
  }
}

export interface RegisteredApplication {
  application: Application;
  /**
   * Present only for an Application authenticating with a static credential.
   * Shown once and never recoverable — only its hash is stored.
   */
  credential?: string;
}

export class Operator {
  private readonly balances: Balances;

  constructor(private readonly store: ExchangeStore) {
    this.balances = new Balances(store);
  }

  // ── Demand ────────────────────────────────────────────────────────

  /**
   * An organization you invoice. There is no signup: a Client is the record of
   * a commercial relationship that already exists, which is what a closed
   * membership means (ADR 0012).
   */
  async createClient(id: string, name: string): Promise<Client> {
    const client: Client = { id, name };
    await this.store.createClient(client);
    return client;
  }

  /**
   * A product built on the Exchange.
   *
   * Authenticates one of two ways. Given a `jwksUrl` it mints short-lived
   * tokens the Exchange verifies against its published keys — the preferred
   * path, and the one the habitats SaaS already satisfies. Otherwise it gets a
   * static credential, for callers that cannot serve a JWKS: a habitat, a
   * script, a small client.
   */
  async createApplication(input: {
    id: string;
    clientId: string;
    jwksUrl?: string;
    requiredGuarantees?: string[];
    allowedModels?: string[];
  }): Promise<RegisteredApplication> {
    const client = await this.store.getClient(input.clientId);
    // Refused rather than created orphaned: an Application with no Client has
    // nobody to invoice and nowhere to draw a grant from.
    if (!client) throw new Error(`Unknown client "${input.clientId}".`);

    const credential = input.jwksUrl ? undefined : issueCredential();
    const application: Application = {
      id: input.id,
      clientId: input.clientId,
      jwksUrl: input.jwksUrl ?? "",
      credentialHash: credential ? hashCredential(credential) : undefined,
      requiredGuarantees: input.requiredGuarantees ?? [],
      allowedModels: input.allowedModels,
      enabled: true,
      createdAt: new Date(),
    };
    await this.store.createApplication(application);
    return { application, credential };
  }

  /** Issue a new static credential, invalidating the old one. */
  async rotateApplicationCredential(applicationId: string): Promise<string> {
    const application = await this.store.getApplication(applicationId);
    if (!application) throw new Error(`Unknown application "${applicationId}".`);
    const credential = issueCredential();
    await this.store.createApplication({
      ...application,
      credentialHash: hashCredential(credential),
    });
    return credential;
  }

  async setApplicationEnabled(id: string, enabled: boolean): Promise<void> {
    await this.store.setApplicationEnabled(id, enabled);
  }

  // ── Money ─────────────────────────────────────────────────────────

  /**
   * Add credit, as a ledger entry like any other. There is no privileged path
   * that writes a total, so an operator's grant is as auditable as a charge.
   */
  async grantToClient(clientId: string, microDollars: MicroDollars, reason = "grant") {
    return this.balances.grant(clientOwner(clientId), microDollars, reason);
  }

  async grantToApplication(applicationId: string, microDollars: MicroDollars, reason = "grant") {
    return this.balances.grant(applicationOwner(applicationId), microDollars, reason);
  }

  // ── Supply ────────────────────────────────────────────────────────

  async registerSupplier(input: RegisterSupplierInput): Promise<RegisteredSupplier> {
    const credential = issueCredential();
    const supplier: Supplier = {
      id: input.id,
      displayName: input.displayName,
      grantedGuarantees: input.grantedGuarantees ?? [],
      credentialHash: hashCredential(credential),
      baseUrl: input.baseUrl ?? "",
      kind: input.kind ?? "vendor",
      upstreamCredentialEnv: input.upstreamCredentialEnv,
      enabled: true,
      createdAt: new Date(),
    };
    await this.store.createSupplier(supplier);
    return { supplier, credential };
  }

  /** Replace a Supplier's grant. Narrowing takes effect on its next publish. */
  async grantGuarantees(supplierId: string, guarantees: string[]): Promise<void> {
    const supplier = await this.store.getSupplier(supplierId);
    if (!supplier) throw new Error(`Unknown supplier "${supplierId}".`);
    await this.store.createSupplier({ ...supplier, grantedGuarantees: [...guarantees] });
  }

  /**
   * Throws unless every claimed Guarantee is granted. Called on publish, and
   * exported so the check has exactly one implementation.
   */
  static assertGuaranteesGranted(supplier: Supplier, claimed: string[]): void {
    for (const guarantee of claimed) {
      if (!supplier.grantedGuarantees.includes(guarantee)) {
        throw new GuaranteeNotGrantedError(guarantee);
      }
    }
  }

  async rotateCredential(supplierId: string): Promise<string> {
    const supplier = await this.store.getSupplier(supplierId);
    if (!supplier) throw new Error(`Unknown supplier "${supplierId}".`);
    const credential = issueCredential();
    await this.store.createSupplier({ ...supplier, credentialHash: hashCredential(credential) });
    return credential;
  }

  /** Take a whole Supplier out of rotation without losing its history. */
  async setSupplierEnabled(supplierId: string, enabled: boolean): Promise<void> {
    await this.store.setSupplierEnabled(supplierId, enabled);
  }

  /** Take one Offer out of rotation. Restorable, and its history is kept. */
  async setOfferEnabled(supplierId: string, model: string, enabled: boolean): Promise<void> {
    await this.store.setOfferEnabled(supplierId, model, enabled);
  }

  async setPricing(supplierId: string, model: string, pricing: OfferPricing): Promise<void> {
    await this.store.setOfferPricing(supplierId, model, pricing);
  }

  /**
   * Publish a Supplier's Offers on its behalf.
   *
   * For a machine, the agent publishes what it probed. A commercial vendor runs
   * no agent, so the operator lists what it is willing to resell.
   *
   * **These Capabilities are declared, not probed**, which is the one place
   * ADR 0015 bends. A vendor's catalogue is somebody else's claim about
   * somebody else's serving path, so the honest treatment is to keep the list
   * short enough to stand behind and to mark every Offer `adapted` — which is
   * exactly what reselling a runtime you do not control means (ADR 0016).
   *
   * Publishing is total, as it is for an agent: this replaces the Supplier's
   * whole Offer set, so a Model dropped from the list stops being advertised
   * without anyone deleting anything.
   */
  /**
   * Publish on a Supplier's behalf.
   *
   * `servingMode` used to be forced to `adapted` here, which was right for the
   * only case that existed — reselling a vendor's API, a configuration nobody
   * on this side controls. It is wrong for hardware the operator owns and
   * configured, and it silently cost that hardware the ability to commit to a
   * context size or a quantization at all (ADR 0016), so a 128k NVFP4 box
   * published as though it could promise neither.
   *
   * So the caller says, and the default stays `adapted` — the honest answer
   * when nobody has claimed otherwise.
   */
  async publishOffersFor(supplierId: string, offers: PublishedOffer[]): Promise<void> {
    const supplier = await this.store.getSupplier(supplierId);
    if (!supplier) throw new Error(`Unknown supplier "${supplierId}".`);
    await this.store.replaceOffers(
      supplierId,
      offers.map((offer) => ({ ...offer, servingMode: offer.servingMode ?? "adapted" })),
    );
  }
}
