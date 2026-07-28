/**
 * Moving money.
 *
 * A Balance is the sum of its ledger entries, never a stored total. No figure
 * is overwritten, so history is always reconstructable and a disputed charge
 * traces back to the request that caused it.
 *
 * Enforcement happens **during** generation, not after. That is only possible
 * because #297 counts incrementally on our side of the wire — with a count that
 * only arrives at the end, an overdraft can be discovered but never prevented.
 */

import { randomUUID } from "node:crypto";
import type { Balance, BalanceOwnerKind, LedgerEntry, MicroDollars } from "../types.js";
import type { ExchangeStore } from "../store/types.js";
import type { Caller } from "../auth/identity.js";

/** Who pays for a given request. */
export interface BalanceOwner {
  kind: BalanceOwnerKind;
  key: string;
}

/**
 * The End User of an Application.
 *
 * Keyed on the pair because "user-1" at two Applications is two different
 * people — and because an Application's own Balance must stay separate from
 * any of its users', so internal jobs never spend a user's credit.
 */
export function endUserOwner(caller: Caller): BalanceOwner {
  return { kind: "end-user", key: `${caller.application.id}:${caller.subject}` };
}

export function applicationOwner(applicationId: string): BalanceOwner {
  return { kind: "application", key: applicationId };
}

export class Balances {
  constructor(private readonly store: ExchangeStore) {}

  get(owner: BalanceOwner): Promise<Balance> {
    return this.store.getBalance(owner.kind, owner.key);
  }

  entries(owner: BalanceOwner): Promise<LedgerEntry[]> {
    return this.store.listLedgerEntries(owner.kind, owner.key);
  }

  /**
   * Add credit. A grant is a ledger entry like any other — there is no
   * privileged path that writes a total directly, so an operator's grant is as
   * auditable as a debit.
   */
  grant(owner: BalanceOwner, microDollars: MicroDollars, reason = "grant"): Promise<Balance> {
    return this.store.appendLedgerEntry(entry(owner, microDollars, reason));
  }

  /** Debit for a request. Amount is positive; the entry is stored negative. */
  debit(
    owner: BalanceOwner,
    microDollars: MicroDollars,
    requestId: string,
    reason = "request",
  ): Promise<Balance> {
    return this.store.appendLedgerEntry({
      ...entry(owner, -Math.abs(microDollars), reason),
      requestId,
    });
  }

  /** Whether there is enough to cover an amount before committing to it. */
  async canCover(owner: BalanceOwner, microDollars: MicroDollars): Promise<boolean> {
    const balance = await this.get(owner);
    return balance.microDollars >= microDollars;
  }
}

function entry(owner: BalanceOwner, microDollars: MicroDollars, reason: string): LedgerEntry {
  return {
    id: randomUUID(),
    ownerKind: owner.kind,
    ownerKey: owner.key,
    microDollars,
    reason,
    createdAt: new Date(),
  };
}
