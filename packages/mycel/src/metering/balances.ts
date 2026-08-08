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

/**
 * The Client that owns one or more Applications, and the party you invoice.
 *
 * Where a signup grant is funded from (ADR 0014): drawing it here rather than
 * from the Exchange makes abuse of an Application's signup flow that Client's
 * cost and that Client's problem to solve.
 */
export function clientOwner(clientId: string): BalanceOwner {
  return { kind: "client", key: clientId };
}

/**
 * Who pays for this request.
 *
 * Falls through **End User → Application → Client**, stopping at the first
 * owner that has ever had a ledger entry. The effect is the one a per-user
 * allowance is actually for:
 *
 *   - An unfunded End User draws from the pool behind it, so a new signup
 *     works without anyone granting it anything first.
 *   - Granting an End User *anything* opts it into being capped at that
 *     amount — and it stays capped once spent, because the test is existence
 *     rather than solvency. A user at zero is refused, not quietly promoted
 *     back to the pool.
 *
 * The resolved owner is also the one debited, which keeps the two consistent:
 * an unfunded user debits the Client, never gains an entry of its own, and so
 * keeps resolving to the Client.
 */
export async function resolveChargeOwner(
  caller: Caller,
  balances: Balances,
): Promise<BalanceOwner> {
  const user = endUserOwner(caller);
  if (await balances.exists(user)) return user;

  const application = applicationOwner(caller.application.id);
  if (await balances.exists(application)) return application;

  return clientOwner(caller.application.clientId);
}

export class Balances {
  constructor(private readonly store: ExchangeStore) {}

  get(owner: BalanceOwner): Promise<Balance> {
    return this.store.getBalance(owner.kind, owner.key);
  }

  /**
   * Has this owner ever had a ledger entry?
   *
   * Existence, not solvency. An End User who has spent to zero is still in
   * play — that is what being capped means — and must not fall through to the
   * pool behind them.
   */
  exists(owner: BalanceOwner): Promise<boolean> {
    return this.store.hasLedgerEntries(owner.kind, owner.key);
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
  /**
   * @param floor  How far below zero this owner may go. Zero is prepaid.
   *               Derived from the *resolved* owner rather than the caller,
   *               which is what keeps a capped End User capped (ADR 0028).
   */
  async canCover(
    owner: BalanceOwner,
    microDollars: MicroDollars,
    floor: MicroDollars = 0,
  ): Promise<boolean> {
    const balance = await this.get(owner);
    return balance.microDollars - microDollars >= -floor;
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

/**
 * How far the resolved owner may go negative.
 *
 * Only a Client gets a limit. A charge resolving to an End User or Application
 * balance stops at zero — granting one of those is how you cap it, and a cap
 * that can be exceeded is not a cap (ADR 0028).
 */
export async function creditFloorFor(
  owner: BalanceOwner,
  clientId: string,
  store: ExchangeStore,
): Promise<MicroDollars> {
  if (owner.kind !== "client") return 0;
  const client = await store.getClient(clientId);
  return client?.creditLimitMicroDollars ?? 0;
}
