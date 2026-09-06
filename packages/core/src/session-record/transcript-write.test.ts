import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import { coreMessagesToJSONL, toClaudeUsage } from "./transcript-write.js";
import type { AssistantMessageEntry } from "../interaction/types/types.js";

describe("toClaudeUsage", () => {
  it("moves cache tokens out of input_tokens (Claude wire semantics)", () => {
    expect(
      toClaudeUsage({
        promptTokens: 1000,
        completionTokens: 50,
        cacheReadTokens: 800,
        cacheWriteTokens: 100,
      }),
    ).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 100,
    });
  });

  it("omits cache keys when the provider reported none", () => {
    expect(toClaudeUsage({ promptTokens: 10, completionTokens: 5 })).toEqual({
      input_tokens: 10,
      output_tokens: 5,
    });
  });
});

describe("coreMessagesToJSONL usage", () => {
  const user: ModelMessage = { role: "user", content: "hi" };
  const a1: ModelMessage = { role: "assistant", content: "first" };
  const a2: ModelMessage = { role: "assistant", content: "second" };

  function parseAssistants(jsonl: string): AssistantMessageEntry[] {
    return jsonl
      .split("\n")
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === "assistant");
  }

  it("attaches model + usage only to assistant entries the lookup knows about", () => {
    const usage = new Map<ModelMessage, { model: string; usage: { promptTokens: number; completionTokens: number; cacheReadTokens?: number } }>();
    usage.set(a2, {
      model: "claude-sonnet-4",
      usage: { promptTokens: 300, completionTokens: 20, cacheReadTokens: 250 },
    });

    const out = coreMessagesToJSONL([user, a1, user, a2], undefined, undefined, (m) => usage.get(m));
    const [e1, e2] = parseAssistants(out);
    expect(e1.message.usage).toBeUndefined();
    expect(e1.message.model).toBeUndefined();
    expect(e2.message.model).toBe("claude-sonnet-4");
    expect(e2.message.usage).toEqual({
      input_tokens: 50,
      output_tokens: 20,
      cache_read_input_tokens: 250,
    });
  });

  it("is unchanged when no lookup is supplied", () => {
    const [e1] = parseAssistants(coreMessagesToJSONL([user, a1]));
    expect(e1.message).toEqual({ role: "assistant", content: "first" });
  });
});
