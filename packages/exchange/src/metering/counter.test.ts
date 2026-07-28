import { describe, it, expect } from "vitest";
import {
  StreamCounter,
  countCompletionTokens,
  countStreamedTokens,
  estimatePromptTokens,
  priceRequest,
} from "./counter.js";
import type { Offer } from "../types.js";

describe("estimatePromptTokens", () => {
  it("counts message content", () => {
    const tokens = estimatePromptTokens({
      messages: [{ role: "user", content: "a".repeat(400) }],
    });
    expect(tokens).toBeGreaterThan(90);
  });

  it("counts every message, not just the last", () => {
    const one = estimatePromptTokens({ messages: [{ role: "user", content: "a".repeat(400) }] });
    const three = estimatePromptTokens({
      messages: [
        { role: "user", content: "a".repeat(400) },
        { role: "assistant", content: "a".repeat(400) },
        { role: "user", content: "a".repeat(400) },
      ],
    });
    expect(three).toBeGreaterThan(one * 2);
  });

  it("counts text parts of multi-part content", () => {
    const tokens = estimatePromptTokens({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "b".repeat(200) },
            { type: "image_url", image_url: { url: "data:..." } },
          ],
        },
      ],
    });
    expect(tokens).toBeGreaterThan(45);
  });

  it("never returns zero for a request that was actually sent", () => {
    // A request with no countable content still occupied a Supplier. Charging
    // nothing for it is the hole this whole ticket exists to close.
    expect(estimatePromptTokens({})).toBeGreaterThan(0);
    expect(estimatePromptTokens({ messages: [] })).toBeGreaterThan(0);
  });
});

describe("countStreamedTokens", () => {
  const chunk = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  it("counts content deltas", () => {
    expect(countStreamedTokens(chunk("a".repeat(40)))).toBe(10);
  });

  it("counts reasoning as well as answer", () => {
    // Reasoning tokens are generated and billed by the upstream whether or not
    // the buyer reads them.
    const withReasoning = `data: ${JSON.stringify({
      choices: [{ delta: { reasoning_content: "r".repeat(40) } }],
    })}\n\n`;
    expect(countStreamedTokens(withReasoning)).toBe(10);
  });

  it("ignores the DONE sentinel", () => {
    expect(countStreamedTokens("data: [DONE]\n\n")).toBe(0);
  });

  it("does not throw on a malformed payload", () => {
    expect(countStreamedTokens("data: {oops\n\n")).toBe(0);
  });
});

describe("StreamCounter", () => {
  const chunk = (content: string) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

  it("accumulates across pushes", () => {
    const counter = new StreamCounter();
    counter.push(chunk("a".repeat(40)));
    counter.push(chunk("a".repeat(40)));
    expect(counter.completionTokens).toBe(20);
  });

  it("counts a payload split across chunk boundaries", () => {
    // A chunk boundary can land mid-JSON. Dropping those undercounts exactly
    // the long responses worth the most.
    const whole = chunk("c".repeat(80));
    const counter = new StreamCounter();
    counter.push(whole.slice(0, 20));
    counter.push(whole.slice(20));
    expect(counter.completionTokens).toBe(20);
  });

  it("reports a usable total mid-stream, before any terminator", () => {
    // This is what makes an abort chargeable rather than free.
    const counter = new StreamCounter();
    counter.push(chunk("a".repeat(40)));
    expect(counter.completionTokens).toBeGreaterThan(0);
  });
});

describe("countCompletionTokens", () => {
  it("counts a non-streamed message", () => {
    const body = JSON.stringify({
      choices: [{ message: { role: "assistant", content: "d".repeat(40) } }],
    });
    expect(countCompletionTokens(body)).toBe(10);
  });

  it("returns zero rather than throwing on junk", () => {
    expect(countCompletionTokens("not json")).toBe(0);
  });
});

describe("priceRequest", () => {
  const offer = (overrides: Partial<Offer> = {}): Offer => ({
    supplierId: "s",
    model: "m",
    capabilities: [],
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
  });

  it("charges for owned hardware that costs nothing", () => {
    // ADR 0007 made concrete: Cost zero, Charge not. That gap is what rations
    // a box that is free in dollars and scarce in capacity.
    const { cost, charge } = priceRequest(offer(), 1_000_000, 1_000_000);
    expect(cost).toBe(0);
    expect(charge).toBe(500_000);
  });

  it("computes cost and charge independently", () => {
    const { cost, charge } = priceRequest(
      offer({ wholesalePromptPerMillion: 10_000, wholesaleCompletionPerMillion: 20_000 }),
      1_000_000,
      1_000_000,
    );
    expect(cost).toBe(30_000);
    expect(charge).toBe(500_000);
  });

  it("stays in integers", () => {
    // Money is never held in a float. A fractional micro-dollar is a rounding
    // argument waiting to happen.
    const { cost, charge } = priceRequest(offer(), 137, 41);
    expect(Number.isInteger(cost)).toBe(true);
    expect(Number.isInteger(charge)).toBe(true);
  });

  it("prices a prompt-only request", () => {
    const { charge } = priceRequest(offer(), 1_000_000, 0);
    expect(charge).toBe(100_000);
  });
});
