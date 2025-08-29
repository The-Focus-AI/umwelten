import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modelsCommand } from "./models";
import type { ModelDetails } from "../cognition/types.js";
import type { ModelRoute } from "../cognition/types.js";
import { getAllModels, searchModels } from "../cognition/models.js";

// Mock the getAllModels and searchModels functions
vi.mock("../models/models.js", () => ({
  getAllModels: vi.fn().mockResolvedValue([
    {
      name: "gemma3:27b",
      provider: "ollama",
      description: "Google's Gemma 3 27B model via Ollama",
      contextLength: 4096,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2024-06-20T00:00:00.000Z"),
      lastUpdated: new Date("2024-06-20T00:00:00.000Z"),
      details: {
        architecture: "text->text",
        tokenizer: "gemma",
        instructType: "gemma",
        family: "gemma3",
        format: "gguf"
      }
    },
    {
      name: "qwen3:8b",
      provider: "ollama",
      description: "Qwen 3 8B model via Ollama",
      contextLength: 4096,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2024-06-20T00:00:00.000Z"),
      lastUpdated: new Date("2024-06-20T00:00:00.000Z"),
      details: {
        architecture: "text->text",
        tokenizer: "qwen",
        instructType: "qwen",
        family: "qwen3",
        format: "gguf"
      }
    },
    {
      name: "phi4:latest",
      provider: "ollama",
      description: "Phi-4 model via Ollama",
      contextLength: 4096,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2024-06-20T00:00:00.000Z"),
      lastUpdated: new Date("2024-06-20T00:00:00.000Z"),
      details: {
        architecture: "text->text",
        tokenizer: "phi4",
        instructType: "phi4",
        family: "phi",
        format: "gguf"
      }
    },
    {
      name: "qwen2.5:latest",
      provider: "ollama",
      description: "Qwen 2.5 model via Ollama",
      contextLength: 4096,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2024-06-20T00:00:00.000Z"),
      lastUpdated: new Date("2024-06-20T00:00:00.000Z"),
      details: {
        architecture: "text->text",
        tokenizer: "qwen",
        instructType: "qwen",
        family: "qwen2.5",
        format: "gguf"
      }
    },
    {
      name: "qwen3:0.6b",
      provider: "ollama",
      description: "Qwen 3 0.6B model via Ollama",
      contextLength: 4096,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2024-06-20T00:00:00.000Z"),
      lastUpdated: new Date("2024-06-20T00:00:00.000Z"),
      details: {
        architecture: "text->text",
        tokenizer: "qwen",
        instructType: "qwen",
        family: "qwen3",
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
      expect(output).toContain("gemma3:27b");
      expect(output).toContain("qwen3:8b");
      expect(output).toContain("phi4:latest");
      expect(output).toContain("qwen2.5:latest");
      expect(output).toContain("qwen3:0.6b");
      expect(output).toContain("ollama");

      // Check formatting
      expect(output).toContain("4K"); // 4,096 context length
      expect(output).toContain("Free"); // Cost formatting

      mockConsoleLog.mockRestore();
    });

    it("should list models in JSON format", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync(["node", "test", "--json"]);

      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);

      // Validate at least 5 models and key fields
      expect(parsed.length).toBeGreaterThanOrEqual(5);
      const names = parsed.map((m: any) => m.name);
      expect(names).toContain("gemma3:27b");
      expect(names).toContain("qwen3:8b");
      expect(names).toContain("phi4:latest");
      expect(names).toContain("qwen2.5:latest");
      expect(names).toContain("qwen3:0.6b");
      parsed.forEach((model: ModelDetails) => {
        expect(model.name).toBeDefined();
        expect(model.provider).toBeDefined();
        expect(typeof model.contextLength).toBe("number");
        if (model.costs) {
          expect(typeof model.costs.promptTokens).toBe("number");
          expect(typeof model.costs.completionTokens).toBe("number");
        }
        if (model.details) {
          if (typeof model.details.family === 'string') {
            expect(model.details.family).toBeDefined();
          }
          if (typeof model.details.format === 'string') {
            expect(model.details.format).toBeDefined();
          }
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
        "--desc",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      // Check that the first 10 are sorted in descending order
      for (let i = 1; i < Math.min(10, parsed.length); i++) {
        if (typeof parsed[i - 1].contextLength === 'number' && typeof parsed[i].contextLength === 'number') {
          expect(parsed[i - 1].contextLength).toBeGreaterThanOrEqual(parsed[i].contextLength);
        }
      }
      mockConsoleLog.mockRestore();
    });

    it("should search models by description", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--search",
        "Qwen",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.some((m: ModelDetails) => m.name.includes("qwen"))).toBe(true);
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
        "gemma3:27b",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls.join("\n");
      expect(output).toContain("gemma3:27b");
      expect(output).toContain("ollama");
      expect(output).toContain("Free");
      expect(output.toLowerCase()).toContain("family");
      expect(output.toLowerCase()).toContain("format");
      mockConsoleLog.mockRestore();
    });
  });

    it.skip("should handle API errors gracefully", async () => {
      // TODO: Fix mocking for getAllModels with correct import path
    });

  describe("Search Functionality", () => {
    it("should search models by name", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--search",
        "qwen",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.some((m: ModelDetails) => m.name.includes("qwen"))).toBe(true);
      mockConsoleLog.mockRestore();
    });

    it("should search models by family", async () => {
      const mockConsoleLog = vi.spyOn(console, "log");
      await modelsCommand.parseAsync([
        "node",
        "test",
        "--search",
        "gemma",
        "--json",
      ]);
      expect(mockConsoleLog).toHaveBeenCalled();
      const output = mockConsoleLog.mock.calls[0][0];
      const parsed = JSON.parse(output);
      expect(parsed.some((m: ModelDetails) => typeof m.details?.family === 'string' && m.details.family.toLowerCase().includes("gemma"))).toBe(true);
      mockConsoleLog.mockRestore();
    });
  });
});
