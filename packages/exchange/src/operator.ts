/**
 * The operator surface for supply.
 *
 * Registering a Supplier, granting the Guarantees it may be offered under,
 * taking an Offer out of rotation, pricing.
 *
 * **Guarantees are asserted by the operator, never self-declared** (ADR 0006).
 * The operator is liable for every Guarantee passed through to a buyer, so a
 * Supplier claiming one it was not granted is rejected outright rather than
 * silently downgraded. That rejection is what stops a compromised supplier
 * agent from promoting itself into eligibility for on-premise traffic.
 */

import { randomBytes } from "node:crypto";
import { hashCredential } from "./supply/handler.js";
import type { OfferPricing, Supplier } from "./types.js";
import type { ExchangeStore } from "./store/types.js";

export interface RegisterSupplierInput {
  id: string;
  displayName: string;
  baseUrl: string;
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

export class Operator {
  constructor(private readonly store: ExchangeStore) {}

  async registerSupplier(input: RegisterSupplierInput): Promise<RegisteredSupplier> {
    const credential = randomBytes(32).toString("base64url");
    const supplier: Supplier = {
      id: input.id,
      displayName: input.displayName,
      grantedGuarantees: input.grantedGuarantees ?? [],
      credentialHash: hashCredential(credential),
      baseUrl: input.baseUrl,
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
    const credential = randomBytes(32).toString("base64url");
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
}
