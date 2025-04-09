import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { modelsCommand } from "./models";
import type { ModelDetails } from "@model-eval/core/src/models/types.js";
import type { ModelRoute } from "@model-eval/core/src/models/types.js";

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

  // Mock model data with complete interface
  const mockModels: ModelDetails[] = [
    {
      name: "openrouter/quasar-alpha",
      provider: "openrouter",
      contextLength: 1000000,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2025-03-16T02:47:18.952Z"),
      lastUpdated: new Date("2025-03-16T02:47:18.952Z"),
      details: {
        architecture: "text+image->text",
        tokenizer: "Other",
        instructType: null,
      },
    },
    {
      name: "meta-llama/llama-4-maverick:free",
      provider: "openrouter",
      contextLength: 256000,
      costs: {
        promptTokens: 0,
        completionTokens: 0,
      },
      addedDate: new Date("2025-03-16T02:47:18.952Z"),
      lastUpdated: new Date("2025-03-16T02:47:18.952Z"),
      details: {
        architecture: "text+image->text",
        tokenizer: "Other",
        instructType: null,
      },
    },
  ];

  // Mock the getAllModels and searchModels functions
  vi.mock("@model-eval/core/src/models/models.js", () => ({
    getAllModels: vi.fn().mockResolvedValue(mockModels),
    searchModels: vi
      .fn()
      .mockImplementation((query: string, models: ModelDetails[]) => {
        return models.filter(
          (m: ModelDetails) =>
            m.name?.toLowerCase().includes(query.toLowerCase()) ||
            (m.details &&
              typeof m.details.family === "string" &&
              m.details.family.toLowerCase().includes(query.toLowerCase()))
        );
      }),
  }));

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
      expect(output).toContain("meta-llama");

      // Check formatting
      expect(output).toContain("1M");
      expect(output).toContain("256K");
      expect(output).toContain("$0.0005"); // Cost formatting
      expect(output).toContain("$0.01");

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

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("openrouter/quasar-alpha");
      expect(parsed[0].provider).toBe("openrouter");

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
      vi.mock("@model-eval/core/src/models/models.js", () => ({
        getAllModels: vi.fn().mockRejectedValue(new Error("API Error")),
      }));

      const mockConsoleError = vi.spyOn(console, "error");

      await expect(modelsCommand.parseAsync(["node", "test"])).rejects.toThrow(
        "Process.exit called with code: 1"
      );

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("Error fetching models")
      );

      mockConsoleError.mockRestore();
    });

    it("should handle missing model ID gracefully", async () => {
      const mockConsoleError = vi.spyOn(console, "error");

      await expect(
        modelsCommand.parseAsync(["node", "test", "--view", "info"])
      ).rejects.toThrow("Process.exit called with code: 1");

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining("--id <model-id> is required")
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
        expect.stringContaining("not found")
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
