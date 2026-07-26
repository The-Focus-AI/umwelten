import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelMessage } from "ai";
import { registerCompactionStrategy } from "../../context/registry.js";
import type { CompactionStrategy } from "../../context/types.js";

const generateTextMock = vi.fn();

vi.mock("../core/interaction.js", () => {
  class FakeInteraction {
    messages: ModelMessage[] = [{ role: "system", content: "probe system" }];
    constructor(
      public modelDetails: { name: string; provider: string },
      public stimulus: unknown,
    ) {}
    addMessage(m: ModelMessage) {
      this.messages.push(m);
    }
    getMessages() {
      return this.messages;
    }
    async generateText() {
      return generateTextMock(this.messages);
    }
    getRunner() {
      return { generateText: async () => response("compacted") };
    }
  }
  return { Interaction: FakeInteraction };
});

function response(content: string) {
  return {
    content,
    metadata: {
      startTime: new Date(),
      endTime: new Date(),
      tokenUsage: { promptTokens: 500, completionTokens: 12, total: 512 },
      provider: "fake",
      model: "fake-model",
      cost: { promptCost: 0.001, completionCost: 0.0001, totalCost: 0.0011, usage: { promptTokens: 500, completionTokens: 12 } },
    },
  };
}

const { runFanout, DEFAULT_PROBES } = await import("./fanout.js");

const MODEL = { name: "fake-model", provider: "fake" };

const CONVERSATION: ModelMessage[] = [
  { role: "system", content: "You are a research assistant." },
  { role: "user", content: "How does prefix caching pick a slot?" },
  { role: "assistant", content: "It matches the longest common token prefix." },
  { role: "user", content: "And when every slot is busy?" },
  { role: "assistant", content: "It evicts the least useful slot first." },
];

beforeEach(() => {
  generateTextMock.mockReset();
  generateTextMock.mockImplementation(() => response("an answer"));
});

describe("runFanout annotations", () => {
  it("sends the conversation verbatim and appends the question", async () => {
    const [result] = await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [{ id: "title", label: "Title", kind: "annotation", question: "Title this." }],
    });

    expect(result.error).toBeUndefined();
    expect(result.sharedPrefix).toBe(true);

    const sent = generateTextMock.mock.calls[0][0] as ModelMessage[];
    // System swapped for the probe's own; everything after it is untouched.
    expect(sent.slice(1, -1)).toEqual(CONVERSATION.slice(1));
    expect(sent[sent.length - 1]).toEqual({ role: "user", content: "Title this." });
  });

  it("shares an identical prefix across every annotation probe", async () => {
    await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [
        { id: "a", label: "A", kind: "annotation", question: "Q1" },
        { id: "b", label: "B", kind: "annotation", question: "Q2" },
      ],
    });

    const [first] = generateTextMock.mock.calls[0] as [ModelMessage[]];
    const [second] = generateTextMock.mock.calls[1] as [ModelMessage[]];
    // Everything but the final question is byte-identical — that's what makes a
    // provider-side prefix cache apply across the whole fan-out.
    expect(first.slice(0, -1)).toEqual(second.slice(0, -1));
    expect(first[first.length - 1]).not.toEqual(second[second.length - 1]);
  });

  it("records usage and cost", async () => {
    const [result] = await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [{ id: "title", label: "Title", kind: "annotation", question: "Q" }],
    });
    expect(result.promptTokens).toBe(500);
    expect(result.costUsd).toBeCloseTo(0.0011, 6);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("runFanout baselines", () => {
  beforeEach(() => {
    const strategy: CompactionStrategy = {
      id: "test-summarize",
      name: "Test summarize",
      description: "test",
      async compact() {
        return {
          replacementMessages: [{ role: "system", content: "Summary of earlier turns." }],
        };
      },
    };
    registerCompactionStrategy(strategy);
  });

  it("returns a replacement context you could continue from", async () => {
    const [result] = await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [
        { id: "sum", label: "Compacted", kind: "baseline", strategyId: "test-summarize" },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(result.kind).toBe("baseline");
    expect(result.replacement).toBeDefined();
    // system + summary, with nothing trailing the last assistant message.
    expect(result.replacement).toHaveLength(2);
    expect(result.replacement![0]).toEqual(CONVERSATION[0]);
    expect(result.text).toContain("Summary of earlier turns");
    expect(result.resultTokens).toBeLessThan(
      CONVERSATION.reduce((n, m) => n + String(m.content).length / 4, 0),
    );
  });

  it("is marked as not sharing the prefix", async () => {
    // A strategy builds its own summarizer prompt, so a warm cache doesn't help.
    const [result] = await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [{ id: "sum", label: "C", kind: "baseline", strategyId: "test-summarize" }],
    });
    expect(result.sharedPrefix).toBe(false);
  });

  it("reports an unknown strategy as a failed probe, not a thrown error", async () => {
    const [result] = await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [{ id: "x", label: "X", kind: "baseline", strategyId: "nope" }],
    });
    expect(result.error).toMatch(/Unknown compaction strategy/);
    expect(result.text).toBe("");
  });

  it("reports having nothing to compact rather than throwing", async () => {
    const [result] = await runFanout({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }],
      model: MODEL,
      probes: [{ id: "sum", label: "C", kind: "baseline", strategyId: "test-summarize" }],
    });
    expect(result.error).toMatch(/Nothing to compact/);
  });
});

describe("runFanout as a whole", () => {
  it("keeps going when one probe fails", async () => {
    const results = await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [
        { id: "ok", label: "OK", kind: "annotation", question: "Q" },
        { id: "bad", label: "Bad", kind: "baseline", strategyId: "does-not-exist" },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.probeId === "ok")?.error).toBeUndefined();
    expect(results.find((r) => r.probeId === "bad")?.error).toBeDefined();
  });

  it("streams each result as it lands", async () => {
    const seen: string[] = [];
    await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [
        { id: "a", label: "A", kind: "annotation", question: "Q1" },
        { id: "b", label: "B", kind: "annotation", question: "Q2" },
      ],
      onResult: (r) => seen.push(r.probeId),
    });
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("lets a probe override the model, so a cheap model can do the fan-out", async () => {
    const cheap = { name: "cheap", provider: "local" };
    const [result] = await runFanout({
      messages: CONVERSATION,
      model: MODEL,
      probes: [{ id: "a", label: "A", kind: "annotation", question: "Q", model: cheap }],
    });
    expect(result.model).toEqual(cheap);
  });

  it("ships a default probe set covering both kinds", () => {
    expect(DEFAULT_PROBES.some((p) => p.kind === "annotation")).toBe(true);
    expect(DEFAULT_PROBES.some((p) => p.kind === "baseline")).toBe(true);
    expect(new Set(DEFAULT_PROBES.map((p) => p.id)).size).toBe(DEFAULT_PROBES.length);
  });
});
