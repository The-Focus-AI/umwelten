import { describe, it, expect } from "vitest";
import { estimateContextSize } from "./estimate-size.js";

describe("estimateContextSize", () => {
  it("returns message count and estimated tokens", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful." },
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
    ];
    const size = estimateContextSize(messages);
    expect(size.messageCount).toBe(3);
    expect(size.characterCount).toBeGreaterThan(0);
    expect(size.estimatedTokens).toBeGreaterThan(0);
  });

  it("handles empty messages", () => {
    const size = estimateContextSize([]);
    expect(size.messageCount).toBe(0);
    expect(size.characterCount).toBe(0);
    expect(size.estimatedTokens).toBe(0);
  });
});
