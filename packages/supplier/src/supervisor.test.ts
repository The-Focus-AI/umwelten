/**
 * Withdrawal, from a fabricated machine state.
 *
 * No runtime, no Exchange, no clock. Feed the supervisor outcomes and assert
 * what it says should be published.
 */

import { describe, it, expect } from "vitest";
import { OfferSupervisor, WITHDRAW_AFTER_FAILURES } from "./supervisor.js";
import type { OfferDraft } from "./types.js";

const draft = (model: string, capabilities: OfferDraft["capabilities"] = ["chat"]): OfferDraft => ({
  model,
  capabilities,
  servingMode: "managed",
  headroom: [],
});

const OFFERS = [draft("gemma-4-26b"), draft("qwen-4-32b"), draft("llama-9-8b")];

const fail = (s: OfferSupervisor, model: string, times: number, reason = "would not load") => {
  let last;
  for (let i = 0; i < times; i += 1) last = s.recordFailure(model, reason);
  return last!;
};

describe("OfferSupervisor", () => {
  it("publishes everything to begin with", () => {
    const supervisor = new OfferSupervisor(OFFERS);
    expect(supervisor.live()).toHaveLength(3);
  });

  it("withdraws only the Model that broke", () => {
    // One Model failing to load must not take a machine's other working
    // Offers down with it.
    const supervisor = new OfferSupervisor(OFFERS);
    fail(supervisor, "qwen-4-32b", WITHDRAW_AFTER_FAILURES);

    expect(supervisor.live().map((o) => o.model)).toEqual(["gemma-4-26b", "llama-9-8b"]);
  });

  it("does not flap on a transient failure", () => {
    // A single timeout under momentary load taking an Offer out, and the next
    // success putting it back, is worse for Dispatch than an Offer that is
    // honestly down — routing keeps selecting it during the up phases.
    const supervisor = new OfferSupervisor(OFFERS);

    for (let i = 0; i < WITHDRAW_AFTER_FAILURES - 1; i += 1) {
      const change = supervisor.recordFailure("qwen-4-32b", "timed out");
      expect(change.changed).toBe(false);
      expect(supervisor.live()).toHaveLength(3);
    }

    // And a success in between resets the count rather than leaving it primed.
    supervisor.recordSuccess("qwen-4-32b");
    fail(supervisor, "qwen-4-32b", WITHDRAW_AFTER_FAILURES - 1);
    expect(supervisor.live()).toHaveLength(3);
  });

  it("reports the change only on the failure that crosses the threshold", () => {
    // So a caller that republishes on every change does not republish on every
    // hiccup.
    const supervisor = new OfferSupervisor(OFFERS);
    const changes = Array.from({ length: WITHDRAW_AFTER_FAILURES }, () =>
      supervisor.recordFailure("qwen-4-32b", "timed out"),
    );
    expect(changes.filter((c) => c.changed)).toHaveLength(1);
    expect(changes[changes.length - 1].withdrawn).toEqual(["qwen-4-32b"]);
  });

  it("stays withdrawn without reporting a change on every subsequent failure", () => {
    const supervisor = new OfferSupervisor(OFFERS);
    fail(supervisor, "qwen-4-32b", WITHDRAW_AFTER_FAILURES);
    expect(supervisor.recordFailure("qwen-4-32b", "still broken").changed).toBe(false);
  });

  it("restores on a single success", () => {
    // Asymmetric on purpose: being slow to withdraw costs a buyer a failed
    // request, being slow to restore costs the Supplier money for a machine
    // that is working.
    const supervisor = new OfferSupervisor(OFFERS);
    fail(supervisor, "qwen-4-32b", WITHDRAW_AFTER_FAILURES);

    const change = supervisor.recordSuccess("qwen-4-32b");
    expect(change.changed).toBe(true);
    expect(change.restored).toEqual(["qwen-4-32b"]);
    expect(supervisor.live()).toHaveLength(3);
  });

  it("says why an Offer was withdrawn", () => {
    const supervisor = new OfferSupervisor(OFFERS);
    fail(supervisor, "qwen-4-32b", WITHDRAW_AFTER_FAILURES, "out of memory");

    const withdrawn = supervisor.withdrawnOffers();
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0].reason).toBe("out of memory");
    expect(withdrawn[0].since).toBeTruthy();
  });

  it("takes everything down at once when the runtime dies", () => {
    // Not per-Model and not in doubt. Waiting three cycles to say so would
    // route three cycles of traffic into a process that is not running.
    const supervisor = new OfferSupervisor(OFFERS);
    const change = supervisor.withdrawAll("the runtime stopped answering");

    expect(change.changed).toBe(true);
    expect(change.withdrawn).toHaveLength(3);
    expect(supervisor.live()).toEqual([]);
  });

  it("reports nothing when the runtime dies twice", () => {
    const supervisor = new OfferSupervisor(OFFERS);
    supervisor.withdrawAll("gone");
    expect(supervisor.withdrawAll("still gone").changed).toBe(false);
  });

  it("brings Offers back one at a time as the runtime recovers", () => {
    const supervisor = new OfferSupervisor(OFFERS);
    supervisor.withdrawAll("the runtime stopped answering");

    supervisor.recordSuccess("gemma-4-26b");
    expect(supervisor.live().map((o) => o.model)).toEqual(["gemma-4-26b"]);
  });

  it("keeps failure history across a re-probe", () => {
    // A re-probe is not a reason to forget that a Model has been failing —
    // otherwise a scheduled re-probe would silently reset the flap threshold.
    const supervisor = new OfferSupervisor(OFFERS);
    fail(supervisor, "qwen-4-32b", WITHDRAW_AFTER_FAILURES);

    supervisor.replace(OFFERS);
    expect(supervisor.live().map((o) => o.model)).not.toContain("qwen-4-32b");
  });

  it("forgets a Model a re-probe no longer finds", () => {
    const supervisor = new OfferSupervisor(OFFERS);
    supervisor.replace([draft("gemma-4-26b")]);

    expect(supervisor.status().map((h) => h.model)).toEqual(["gemma-4-26b"]);
  });

  it("ignores outcomes for a Model it does not know about", () => {
    const supervisor = new OfferSupervisor(OFFERS);
    expect(supervisor.recordFailure("never-heard-of-it", "?").changed).toBe(false);
    expect(supervisor.recordSuccess("never-heard-of-it").changed).toBe(false);
  });
});
