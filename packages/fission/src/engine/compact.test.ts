import { describe, it, expect, beforeEach } from "vitest";
import type { ModelMessage } from "ai";
import { registerCompactionStrategy } from "@umwelten/core/context/registry.js";
import type { CompactionStrategy } from "@umwelten/core/context/types.js";
import type { ModelRunner } from "@umwelten/core/cognition/types.js";
import { planCompaction, runCompaction } from "./compact.js";
import { recentWindowStrategy } from "../compaction/recent-window.js";

const MODEL = { name: "test-model", provider: "test" };
const RUNNER = {} as ModelRunner;

function conversation(exchanges: number): ModelMessage[] {
  const messages: ModelMessage[] = [{ role: "system", content: "system prompt" }];
  for (let i = 0; i < exchanges; i++) {
    messages.push({ role: "user", content: `question ${i} about caching and tokens` });
    messages.push({ role: "assistant", content: `answer ${i} explaining caching in detail` });
  }
  return messages;
}

describe("planCompaction", () => {
  it("leaves the requested tail verbatim", () => {
    const messages = conversation(4); // 1 system + 8 messages
    const plan = planCompaction(messages, 4);
    expect(plan).toEqual({ segmentStart: 1, segmentEnd: 4 });
  });

  it("ends the segment on an assistant message", () => {
    const messages = conversation(4);
    const plan = planCompaction(messages, 3);
    // index 5 is a user message, so it steps back to the assistant at 4.
    expect((messages[plan!.segmentEnd] as { role: string }).role).toBe("assistant");
  });

  it("returns null when the tail covers everything", () => {
    expect(planCompaction(conversation(2), 10)).toBeNull();
  });

  it("returns null rather than re-summarizing a lone summary", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system prompt" },
      { role: "system", content: "Conversation state (rolling summary): …" },
      { role: "user", content: "next question" },
      { role: "assistant", content: "next answer" },
    ];
    expect(planCompaction(messages, 2)).toBeNull();
  });

  it("returns null for a bare system prompt", () => {
    expect(planCompaction([{ role: "system", content: "only" }], 0)).toBeNull();
  });
});

describe("runCompaction", () => {
  beforeEach(() => {
    registerCompactionStrategy(recentWindowStrategy);
  });

  it("splices the replacement in and measures the token delta", async () => {
    const messages = conversation(5);
    const outcome = await runCompaction({
      messages,
      strategyId: "recent-window",
      keepRecentMessages: 2,
      model: MODEL,
      runner: RUNNER,
      strategyOptions: { keepMessages: 2 },
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.record.error).toBeUndefined();
    expect(outcome!.messages.length).toBeLessThan(messages.length);
    expect(outcome!.record.tokensAfter).toBeLessThan(outcome!.record.tokensBefore);
    expect(outcome!.record.ratio).toBeLessThan(1);
    // The original array must not be mutated — the caller decides when to swap.
    expect(messages).toHaveLength(11);
  });

  it("records an error and returns the context untouched when a strategy throws", async () => {
    const exploding: CompactionStrategy = {
      id: "test-exploding",
      name: "Exploding",
      description: "always throws",
      async compact() {
        throw new Error("summarizer unavailable");
      },
    };
    registerCompactionStrategy(exploding);

    const messages = conversation(4);
    const outcome = await runCompaction({
      messages,
      strategyId: "test-exploding",
      keepRecentMessages: 2,
      model: MODEL,
      runner: RUNNER,
    });

    expect(outcome!.record.error).toBe("summarizer unavailable");
    expect(outcome!.record.ratio).toBe(1);
    expect(outcome!.messages).toBe(messages);
  });

  it("records an error for an unknown strategy id", async () => {
    const outcome = await runCompaction({
      messages: conversation(4),
      strategyId: "no-such-strategy",
      keepRecentMessages: 2,
      model: MODEL,
      runner: RUNNER,
    });
    expect(outcome!.record.error).toMatch(/Unknown compaction strategy/);
  });

  it("returns null when there is nothing to compact", async () => {
    const outcome = await runCompaction({
      messages: conversation(1),
      strategyId: "recent-window",
      keepRecentMessages: 10,
      model: MODEL,
      runner: RUNNER,
    });
    expect(outcome).toBeNull();
  });
});

describe("recentWindowStrategy", () => {
  it("keeps the tail verbatim and notes what it dropped", async () => {
    const messages = conversation(4);
    const result = await recentWindowStrategy.compact({
      messages,
      segmentStart: 1,
      segmentEnd: 8,
      options: { keepMessages: 2 },
    });
    expect(result.replacementMessages).toHaveLength(3);
    expect(result.replacementMessages[0].content).toMatch(/dropped without summarization/);
    expect(result.replacementMessages[2]).toBe(messages[8]);
  });

  it("hands the segment back unchanged when it is already short", async () => {
    const messages = conversation(1);
    const result = await recentWindowStrategy.compact({
      messages,
      segmentStart: 1,
      segmentEnd: 2,
      options: { keepMessages: 4 },
    });
    expect(result.replacementMessages).toEqual(messages.slice(1, 3));
  });
});
