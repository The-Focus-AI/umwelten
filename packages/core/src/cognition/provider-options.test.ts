import { describe, it, expect } from "vitest";
import { buildReasoningProviderOptions } from "./provider-options.js";

describe("buildReasoningProviderOptions — ollama", () => {
  it("sends nothing when no effort is set, leaving existing behavior intact", () => {
    // Load-bearing: benchmark data collected before the ollama branch existed
    // must stay comparable, which requires the default request to be unchanged.
    expect(buildReasoningProviderOptions("ollama", undefined)).toBeUndefined();
  });

  it("enables thinking for any non-none effort", () => {
    // Ollama's think is a boolean, so all three levels collapse to true.
    for (const effort of ["low", "medium", "high"] as const) {
      expect(buildReasoningProviderOptions("ollama", effort)).toEqual({
        ollama: { think: true },
      });
    }
  });

  it("disables thinking explicitly on 'none', for models that think by default", () => {
    expect(buildReasoningProviderOptions("ollama", "none")).toEqual({
      ollama: { think: false },
    });
  });

  it("does not disturb other providers", () => {
    expect(buildReasoningProviderOptions("openrouter", "high")).toEqual({
      openrouter: { reasoning: { effort: "high" } },
    });
    expect(buildReasoningProviderOptions("llamaswap", "high")).toBeUndefined();
  });
});
