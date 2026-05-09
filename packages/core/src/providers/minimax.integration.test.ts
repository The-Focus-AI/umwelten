import { describe, it, expect } from "vitest";
import { generateText } from "ai";
import { createMiniMaxProvider } from "./minimax.js";
import type { ModelRoute } from "../cognition/types.js";
import { hasMinimaxKey } from "../test-utils/setup.js";

describe("MiniMax Provider", () => {
  const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY;

  if (!MINIMAX_API_KEY) {
    console.warn("⚠️ MINIMAX_API_KEY not found in environment, MiniMax tests will be skipped");
  }

  const itWithAuth = hasMinimaxKey() ? it : it.skip;

  const TEST_ROUTE: ModelRoute = {
    name: "MiniMax-M2.5",
    provider: "minimax",
  };

  describe("Provider Instance", () => {
    itWithAuth("should create a provider instance", () => {
      const provider = createMiniMaxProvider(MINIMAX_API_KEY!);
      expect(provider).toBeDefined();
      expect(typeof provider).toBe("object");
      expect(provider).not.toBeNull();
    });

    it("should fail without API key", () => {
      expect(() => createMiniMaxProvider("")).toThrow();
    });
  });

  describe("Model Listing", () => {
    itWithAuth("should list available MiniMax models", async () => {
      const provider = createMiniMaxProvider(MINIMAX_API_KEY!);
      const models = await provider.listModels();

      expect(models).toBeInstanceOf(Array);
      expect(models.length).toBeGreaterThan(0);

      const modelNames = models.map((model) => model.name);
      expect(modelNames).toContain("MiniMax-M2.5");
    }, 30000);
  });

  describe("Text Generation", () => {
    itWithAuth("should generate text using MiniMax", async () => {
      const provider = createMiniMaxProvider(MINIMAX_API_KEY!);
      const model = provider.getLanguageModel(TEST_ROUTE);

      const response = await generateText({
        model,
        prompt: 'Say "Hello from MiniMax" and nothing else.',
        temperature: 0,
      });

      expect(response.text).toBeTruthy();
      expect(typeof response.text).toBe("string");
      expect(response.text.length).toBeGreaterThan(0);
      expect(response.usage).toBeDefined();
    }, 30000);
  });
});
