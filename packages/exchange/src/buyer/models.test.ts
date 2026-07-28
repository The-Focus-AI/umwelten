import { describe, it, expect } from "vitest";
import { summarizeOffers } from "./models.js";
import type { Offer } from "../types.js";

function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    supplierId: "a",
    model: "gemma-4-26b",
    capabilities: ["chat"],
    guarantees: [],
    servingMode: "managed",
    headroom: [],
    wholesalePromptPerMillion: 0,
    wholesaleCompletionPerMillion: 0,
    retailPromptPerMillion: 100_000,
    retailCompletionPerMillion: 400_000,
    enabled: true,
    publishedAt: new Date(),
    ...overrides,
  };
}

describe("summarizeOffers", () => {
  it("returns one entry per Model, not per Offer", () => {
    // Two Suppliers serving the same Model is one thing a buyer can ask for.
    // Exposing them separately leaks the supply side into a surface whose
    // whole point is to hide it.
    const entries = summarizeOffers([offer({ supplierId: "a" }), offer({ supplierId: "b" })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("gemma-4-26b");
  });

  it("quotes the cheapest Offer's retail price, in dollars per million", () => {
    const entries = summarizeOffers([
      offer({ supplierId: "dear", retailCompletionPerMillion: 900_000 }),
      offer({ supplierId: "cheap", retailPromptPerMillion: 50_000, retailCompletionPerMillion: 150_000 }),
    ]);
    expect(entries[0].pricing.completion).toBe(0.15);
    expect(entries[0].pricing.prompt).toBe(0.05);
  });

  it("unions capabilities across Offers", () => {
    // A buyer asking for tool calling can be served if *some* Offer has it,
    // and Dispatch picks that one.
    const entries = summarizeOffers([
      offer({ supplierId: "a", capabilities: ["chat"] }),
      offer({ supplierId: "b", capabilities: ["chat", "tool-calling"] }),
    ]);
    expect(entries[0].capabilities).toEqual(["chat", "tool-calling"]);
  });

  it("intersects guarantees across Offers", () => {
    // Advertising one that only some Offers carry would promise something a
    // request might not get.
    const entries = summarizeOffers([
      offer({ supplierId: "a", guarantees: ["on-premise", "no-training"] }),
      offer({ supplierId: "b", guarantees: ["no-training"] }),
    ]);
    expect(entries[0].guarantees).toEqual(["no-training"]);
  });

  it("reports the smallest context, so a buyer who fits fits everywhere", () => {
    const entries = summarizeOffers([
      offer({ supplierId: "a", contextTokens: 131072 }),
      offer({ supplierId: "b", contextTokens: 8192 }),
    ]);
    expect(entries[0].context_length).toBe(8192);
  });

  it("omits disabled Offers", () => {
    const entries = summarizeOffers([offer({ enabled: false })]);
    expect(entries).toEqual([]);
  });

  it("does not name a Supplier anywhere", () => {
    // A buyer names a Model; which machine serves it is Dispatch's business.
    const entries = summarizeOffers([offer({ supplierId: "very-secret-box" })]);
    expect(JSON.stringify(entries)).not.toContain("very-secret-box");
  });
});
