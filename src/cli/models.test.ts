import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modelsCommand } from "./models";
import type { ModelDetails } from "../models/types.js";
import type { ModelRoute } from "../models/types.js";
import { getAllModels, searchModels } from "../models/models.js";

// Mock the getAllModels and searchModels functions
vi.mock("../models/models.js", () => ({
  getAllModels: vi.fn().mockResolvedValue([
    {
      name: "openrouter/quasar-alpha",
      provider: "openrouter",
      description: "OpenRouter's Quasar model",
      contextLength: 1000000,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2024-03-16T02:47:18.952Z"),
      lastUpdated: new Date("2024-03-16T02:47:18.952Z"),
      details: {
        architecture: "text->text",
        tokenizer: "tiktoken",
        instructType: "alpaca",
        family: "llama",
        format: "gguf"
      }
    },
    {
      name: "meta-llama/llama-4-maverick:free",
      provider: "openrouter",
      description: "Meta's Llama 4 model via OpenRouter",
      contextLength: 256000,
      costs: {
        promptTokens: 0.0000005,
        completionTokens: 0.000001,
      },
      addedDate: new Date("2024-03-15T00:00:00.000Z"),
      lastUpdated: new Date("2024-03-15T00:00:00.000Z"),
      details: {
        architecture: "text->text",
        tokenizer: "llama",
        instructType: "llama",
        family: "llama",
        format: "gguf"
      }
    }
  ]),
  searchModels: vi.fn().mockImplementation((query: string, models: ModelDetails[]) => {
    if (!models) return [];
    return models.filter(
      (m: ModelDetails) =>
        m.name?.toLowerCase().includes(query.toLowerCase()) ||
        m.provider?.toLowerCase().includes(query.toLowerCase()) ||
        (m.details &&
          typeof m.details.family === "string" &&
          m.details.family.toLowerCase().includes(query.toLowerCase())) ||
        (m.description &&
          m.description.toLowerCase().includes(query.toLowerCase()))
    );
  }),
}));

describe("Models Command", () => {
  // Mock process.exit
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
      await modelsCommand.parseAsync(["node", "test"]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.join("\n");

      // Check model information
      expect(output).toContain("openrouter/quasar-alpha");
      expect(output).toContain("meta-llama/llama-4-maverick:free");
      expect(output).toContain("openrouter");

      // Check formatting
      expect(output).toContain("1M"); // 1,000,000 context length
      expect(output).toContain("256K"); // 256,000 context length
      expect(output).toContain("$0.0005"); // Cost formatting

      mockConsoleLog.mockRestore();
    });

    it("should list models in JSON format", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync(["node", "test", "--json"]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      // Validate complete model interface
      expect(parsed).toHaveLength(2);
      parsed.forEach((model: ModelDetails) => {
        expect(model.name).toBeDefined();
        expect(model.provider).toBeDefined();
        expect(model.contextLength).toBeTypeOf("number");
        if (model.costs) {
          expect(model.costs.promptTokens).toBeTypeOf("number");
          expect(model.costs.completionTokens).toBeTypeOf("number");
        }
        if (model.details) {
          expect(model.details.family).toBeDefined();
          expect(model.details.format).toBeDefined();
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
        "openrouter",
        "--json",
      ]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toHaveLength(2); // Both models are from openrouter
      expect(parsed.every((m: ModelDetails) => m.provider === "openrouter")).toBe(true);

      mockConsoleLog.mockRestore();
    });

    it("should filter free models correctly", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync(["node", "test", "--free", "--json"]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      parsed.forEach((model: ModelDetails) => {
        if (model.costs) {
          expect(model.costs.promptTokens).toBe(0);
          expect(model.costs.completionTokens).toBe(0);
        }
      });

      mockConsoleLog.mockRestore();
    });

    it("should filter models by architecture type", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--architecture",
        "text->text",
        "--json",
      ]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      parsed.forEach((model: ModelDetails) => {
        expect(model.details?.architecture).toBe("text->text");
      });

      mockConsoleLog.mockRestore();
    });

    it("should sort models by context length", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--sort",
        "contextLength",
        "--json",
      ]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      // Verify models are sorted by context length in descending order
      for (let i = 1; i < parsed.length; i++) {
        expect(parsed[i - 1].contextLength).toBeGreaterThanOrEqual(parsed[i].contextLength);
      }

      mockConsoleLog.mockRestore();
    });

    it("should search models by description", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--search",
        "coding",
        "--json",
      ]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("qwen/qwen-2.5-coder-32b-instruct");

      mockConsoleLog.mockRestore();
    });
  });

  describe("Model Info", () => {
    it("should display detailed model information", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--view",
        "info",
        "--id",
        "openrouter/quasar-alpha",
      ]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.join("\n");

      // Check all model details are displayed
      expect(output).toContain("openrouter/quasar-alpha");
      expect(output).toContain("openrouter");
      expect(output).toContain("1M");
      expect(output).toContain("$0.0005");
      expect(output).toContain("Family: llama");
      expect(output).toContain("Format: gguf");

      mockConsoleLog.mockRestore();
    });
  });

  describe("Error Handling", () => {
    it("should handle API errors gracefully", async () => {
      const mockConsoleError = vi.spyOn(console, "error");
      
      // Override the mock for this test
      const getAllModelsMock = vi.fn().mockRejectedValue(new Error("API Error"));
      vi.mocked(getAllModels).mockImplementation(getAllModelsMock);

      await expect(modelsCommand.parseAsync(["node", "test"])).rejects.toThrow(
        "Process.exit called with code: 1"
      );

      expect(mockConsoleError).toHaveBeenCalledWith(
        "Error fetching models:",
        expect.any(Error)
      );

      mockConsoleError.mockRestore();
    });

    it("should handle missing model ID gracefully", async () => {
      const mockConsoleError = vi.spyOn(console, "error");

      await expect(
        modelsCommand.parseAsync(["node", "test", "--view", "info"])
      ).rejects.toThrow("Process.exit called with code: 1");

      expect(mockConsoleError).toHaveBeenCalledWith(
        "Error fetching models:",
        expect.any(Error)
      );

      mockConsoleError.mockRestore();
    });

    it("should handle invalid model ID gracefully", async () => {
      const mockConsoleError = vi.spyOn(console, "error");

      await expect(
        modelsCommand.parseAsync([
          "node",
          "test",
          "--view",
          "info",
          "--id",
          "invalid-model",
        ])
      ).rejects.toThrow("Process.exit called with code: 1");

      expect(mockConsoleError).toHaveBeenCalledWith(
        "Error fetching models:",
        expect.any(Error)
      );

      mockConsoleError.mockRestore();
    });
  });

  describe("Search Functionality", () => {
    it("should search models by name", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--search",
        "llama",
        "--json",
      ]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("openrouter/quasar-alpha");
      expect(parsed[1].name).toBe("meta-llama/llama-4-maverick:free");

      mockConsoleLog.mockRestore();
    });

    it("should search models by family", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--search",
        "llama",
        "--json",
      ]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      expect(parsed).toHaveLength(2);
      expect(parsed[0].name).toBe("openrouter/quasar-alpha");
      expect(parsed[1].name).toBe("meta-llama/llama-4-maverick:free");

      mockConsoleLog.mockRestore();
    });
  });
});
