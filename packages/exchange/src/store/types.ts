/**
 * The persistence contract for the Exchange.
 *
 * Two implementations sit behind this: `MemoryStore` for tests and dev, and
 * `NeonStore` for anything that must survive a deploy. One conformance suite
 * runs against both, so the memory implementation is a real implementation
 * rather than a convenient lie — the same pattern `mcp-serve` already uses.
 */

import type {
  Application,
  Client,
  Offer,
  OfferPricing,
  PublishedOffer,
  Supplier,
} from "../types.js";

export interface ExchangeStore {
  /** Idempotent schema creation. A no-op for stores that need none. */
  setup(): Promise<void>;

  // ── Suppliers ─────────────────────────────────────────────────────

  createSupplier(supplier: Supplier): Promise<void>;
  getSupplier(id: string): Promise<Supplier | null>;
  /**
   * Resolve a presented bearer credential to a Supplier. Takes the hash rather
   * than the credential so no implementation is tempted to store the secret.
   */
  getSupplierByCredentialHash(hash: string): Promise<Supplier | null>;
  listSuppliers(): Promise<Supplier[]>;
  setSupplierEnabled(id: string, enabled: boolean): Promise<void>;

  // ── Offers ────────────────────────────────────────────────────────

  /**
   * Replace this Supplier's entire Offer set with what it just published.
   *
   * Atomic and total: Offers the Supplier no longer lists are removed, not
   * left behind. That is what makes re-probing safe to repeat — a Supplier
   * that loses a Model stops advertising it without anyone deleting anything.
   *
   * Prices are not part of the published payload. Existing operator-set prices
   * for a (Supplier, Model) pair survive a republish; new pairs take
   * `DEFAULT_PRICING`.
   */
  replaceOffers(supplierId: string, offers: PublishedOffer[]): Promise<void>;

  listOffersBySupplier(supplierId: string): Promise<Offer[]>;
  /** Every Offer from every enabled Supplier. What Dispatch selects from. */
  listOffers(): Promise<Offer[]>;
  getOffer(supplierId: string, model: string): Promise<Offer | null>;
  setOfferEnabled(supplierId: string, model: string, enabled: boolean): Promise<void>;
  setOfferPricing(supplierId: string, model: string, pricing: OfferPricing): Promise<void>;

  // ── Demand ────────────────────────────────────────────────────────

  createClient(client: Client): Promise<void>;
  getClient(id: string): Promise<Client | null>;

  createApplication(application: Application): Promise<void>;
  getApplication(id: string): Promise<Application | null>;
  listApplications(): Promise<Application[]>;
  setApplicationEnabled(id: string, enabled: boolean): Promise<void>;
}
