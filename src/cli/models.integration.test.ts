import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { modelsCommand } from "./models";
import type { ModelDetails } from "../cognition/types.js";
import { checkOllamaConnection, OLLAMA_INTEGRATION_MODEL } from "../test-utils/setup.js";

describe("Models Command", () => {
  beforeAll(async () => {
    const available = await checkOllamaConnection();
    if (!available) {
      throw new Error("Ollama is not running — these tests require a live Ollama instance");
    }
  });

  beforeEach(() => {
    vi.spyOn(process, "exit").mockImplementation(
      (code?: number | string | null): never => {
        throw new Error(`Process.exit called with code: ${code}`);
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("List Models", () => {
    it("should list all available models in table format", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync(["node", "test", "--provider", "ollama"]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.join("\n");

      expect(output).toContain("ollama");
      expect(output).toContain("gemma4");
      expect(output).toContain("Free");

      mockConsoleLog.mockRestore();
    });

    it("should list models in JSON format", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync(["node", "test", "--provider", "ollama", "--json"]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.length).toBeGreaterThanOrEqual(1);
      parsed.forEach((model: ModelDetails) => {
        expect(model.name).toBeDefined();
        expect(model.provider).toBe("ollama");
        expect(typeof model.contextLength).toBe("number");
        if (model.costs) {
          expect(typeof model.costs.promptTokens).toBe("number");
          expect(typeof model.costs.completionTokens).toBe("number");
        }
      });

      mockConsoleLog.mockRestore();
    });

    it("should filter models by provider", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--provider",
        "ollama",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.every((m: ModelDetails) => m.provider === "ollama")).toBe(true);
      mockConsoleLog.mockRestore();
    });

    it("should filter free models correctly", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync(["node", "test", "--provider", "ollama", "--free", "--json"]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed.length).toBeGreaterThanOrEqual(1);
      parsed.forEach((model: ModelDetails) => {
        if (model.costs) {
          expect(model.costs.promptTokens).toBe(0);
          expect(model.costs.completionTokens).toBe(0);
        }
      });

      mockConsoleLog.mockRestore();
    });

    it("should sort models by context length", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--provider",
        "ollama",
        "--sort",
        "contextLength",
        "--desc",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < parsed.length; i++) {
        if (typeof parsed[i - 1].contextLength === 'number' && typeof parsed[i].contextLength === 'number') {
          expect(parsed[i - 1].contextLength).toBeGreaterThanOrEqual(parsed[i].contextLength);
        }
      }
      mockConsoleLog.mockRestore();
    });

    it("should search models by name", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--provider",
        "ollama",
        "--search",
        "gemma",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.every((m: ModelDetails) => m.name.toLowerCase().includes("gemma"))).toBe(true);
      mockConsoleLog.mockRestore();
    });
  });

  describe("Model Info", () => {
    it("should display detailed model information", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--provider",
        "ollama",
        "--view",
        "info",
        "--id",
        OLLAMA_INTEGRATION_MODEL,
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.join("\n");
      expect(output).toContain(OLLAMA_INTEGRATION_MODEL);
      expect(output).toContain("ollama");
      expect(output).toContain("Free");
      expect(output.toLowerCase()).toContain("family");
      expect(output.toLowerCase()).toContain("format");
      mockConsoleLog.mockRestore();
    });
  });

  describe("Search Functionality", () => {
    it("should search models by name", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--provider",
        "ollama",
        "--search",
        "gemma",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.some((m: ModelDetails) => m.name.includes("gemma"))).toBe(true);
      mockConsoleLog.mockRestore();
    });

    it("should search models by family", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--provider",
        "ollama",
        "--search",
        "gemma",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(
        parsed.some(
          (m: ModelDetails) =>
            typeof m.details?.family === "string" &&
            m.details.family.toLowerCase().includes("gemma")
        )
      ).toBe(true);
      mockConsoleLog.mockRestore();
    });
  });
});
