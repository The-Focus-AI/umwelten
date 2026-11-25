import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
  type Api,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import {
  createMycelAI,
  extractStepCostUsd,
  formatModelSpecString,
  getCatalogModelInfo,
  getPiModels,
  listMycelModels,
  loadPiModelsJsonInto,
  parseModelSpecString,
  registerPiProvider,
  resolvePiModel,
  resolveThinkingStreamOptions,
  runPiStructuredObject,
  runPiTurn,
  tool,
} from "./models.js";

describe("@umwelten/pi direct Pi-AI helpers", () => {
  const savedEnv = { ...process.env };
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    for (const k of Object.keys(process.env)) {
      if (!(k in savedEnv)) delete process.env[k];
    }
    Object.assign(process.env, savedEnv);
  });

  it("leaves maxTokens undefined on uncapped turns and passes explicit maxTokens when specified", async () => {
    const seenMaxTokens: Array<number | undefined> = [];
    const faux = fauxProvider({
      provider: "faux-cap-check",
      models: [{ id: "m1" }],
    });
    faux.setResponses([
      (_ctx, opts) => {
        seenMaxTokens.push(opts?.maxTokens);
        return fauxAssistantMessage("uncapped");
      },
      (_ctx, opts) => {
        seenMaxTokens.push(opts?.maxTokens);
        return fauxAssistantMessage("capped");
      },
    ]);
    registerPiProvider(faux.provider);

    await runPiTurn({
      model: { provider: "faux-cap-check", name: "m1" },
      prompt: "first",
    });
    await runPiTurn({
      model: { provider: "faux-cap-check", name: "m1" },
      prompt: "second",
      maxTokens: 250,
    });

    expect(seenMaxTokens).toEqual([undefined, 250]);
  });

  it("executes multi-step tool loops and constrained structured objects over pi-ai", async () => {
    const faux = fauxProvider({
      provider: "faux-tools",
      models: [{ id: "t1" }],
    });
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("add", { a: 19, b: 23 })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("42"),
      fauxAssistantMessage(
        [fauxToolCall("__structured_output", { city: "Tokyo", pop: 14 })],
        { stopReason: "toolUse" },
      ),
    ]);
    registerPiProvider(faux.provider);

    const turn = await runPiTurn({
      model: { provider: "faux-tools", name: "t1" },
      prompt: "19 + 23",
      tools: {
        add: tool({
          description: "Add two numbers",
          inputSchema: z.object({ a: z.number(), b: z.number() }),
          execute: ({ a, b }) => ({ sum: a + b }),
        }),
      },
    });
    expect(turn.content).toBe("42");
    expect(turn.toolCalls).toHaveLength(1);

    const structured = await runPiStructuredObject({
      model: { provider: "faux-tools", name: "t1" },
      schema: z.object({ city: z.string(), pop: z.number() }),
      prompt: "Tokyo stats",
    });
    expect(structured.object).toEqual({ city: "Tokyo", pop: 14 });
  });

  it("loads ~/.pi/agent/models.json and talks to Mycel Exchange HTTP endpoints", async () => {
    expect(getPiModels().getProvider("minimax")).toBeDefined();
    expect(getPiModels().getProvider("openrouter")).toBeDefined();

    const dir = mkdtempSync(join(tmpdir(), "pi-models-cfg-"));
    try {
      const cfgPath = join(dir, "models.json");
      writeFileSync(
        cfgPath,
        JSON.stringify({
          providers: {
            "custom-gw": {
              baseUrl: "http://127.0.0.1:9999/v1",
              models: [{ id: "gw-1", contextWindow: 32768 }],
            },
          },
        }),
      );
      const m = createModels();
      loadPiModelsJsonInto(m, cfgPath);
      expect(m.getModel("custom-gw", "gw-1")?.contextWindow).toBe(32768);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    server = createServer((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "m-1", pricing: { prompt: 0.1, completion: 0.4 } }],
          }),
        );
        return;
      }
      if (req.url === "/v1/embeddings") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ embedding: [0.5, 0.25] }], model: "m-1" }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const listed = await listMycelModels("sk-1", baseUrl);
    expect(listed[0]?.name).toBe("m-1");

    const mycel = createMycelAI({ apiKey: "sk-1", endUser: "u-1", baseUrl });
    const emb = await mycel.embed("m-1", "hi");
    expect(emb.embedding).toEqual([0.5, 0.25]);
  });

  it("parses and formats provider:model[@effort] specs including Ollama tags", () => {
    const p1 = parseModelSpecString("ollama:gemma4:26b@off");
    expect(p1).toEqual({
      provider: "ollama",
      name: "gemma4:26b",
      reasoningEffort: "off",
    });
    expect(formatModelSpecString(p1)).toBe("ollama:gemma4:26b@off");

    const p2 = parseModelSpecString("google:gemini-3.8-flash@none");
    expect(p2.reasoningEffort).toBe("off");
    expect(formatModelSpecString(p2)).toBe("google:gemini-3.8-flash@off");

    const p3 = parseModelSpecString("openrouter:deepseek/deepseek-v4.1-flash");
    expect(p3).toEqual({
      provider: "openrouter",
      name: "deepseek/deepseek-v4.1-flash",
    });
    expect(formatModelSpecString(p3)).toBe("openrouter:deepseek/deepseek-v4.1-flash");

    expect(() => parseModelSpecString("no-colon")).toThrow();
    expect(() => parseModelSpecString("google:gemini-3.8-flash@turbo")).toThrow();
  });

  it("translates ThinkingEffort across APIs without injecting maxTokens", () => {
    const bm = getPiModels();

    // Google discrete thinking levels clamp xhigh/max -> HIGH
    const gemini4 = bm.getModel("google", "gemini-4-hydrogen")!;
    const gHigh = resolveThinkingStreamOptions(gemini4, "google", "xhigh");
    expect(gHigh.streamOptionsPatch).toEqual({
      thinking: { enabled: true, level: "HIGH" },
    });
    expect(gHigh.streamOptionsPatch).not.toHaveProperty("maxTokens");
    expect(gHigh.effectiveEffort).toBe("high");

    const gOff = resolveThinkingStreamOptions(gemini4, "google", "off");
    expect(gOff.streamOptionsPatch).toEqual({ thinking: { enabled: false } });
    // gemini-4-hydrogen has thinkingLevelMap.off = null, clamps to lowest supported ("low")
    expect(gOff.effectiveEffort).toBe("low");

    // Legacy Google budget model
    const legacyGoogle: Model<Api> = {
      ...gemini4,
      id: "gemini-2.5-pro",
      name: "gemini-2.5-pro",
      thinkingLevelMap: undefined,
    };
    const gBudget = resolveThinkingStreamOptions(legacyGoogle, "google", "medium");
    expect(gBudget.streamOptionsPatch).toEqual({
      thinking: { enabled: true, budgetTokens: 8192 },
    });
    expect(gBudget.streamOptionsPatch).not.toHaveProperty("maxTokens");

    // Anthropic adaptive thinking vs budget thinking
    const haiku55 = bm.getModel("anthropic", "claude-haiku-5-5")!;
    const aAdaptive = resolveThinkingStreamOptions(haiku55, "anthropic", "minimal");
    expect(aAdaptive.streamOptionsPatch).toEqual({
      thinkingEnabled: true,
      effort: "low",
    });
    const aOff = resolveThinkingStreamOptions(haiku55, "anthropic", "off");
    expect(aOff.streamOptionsPatch).toEqual({ thinkingEnabled: false });

    const legacyClaude: Model<Api> = {
      ...haiku55,
      compat: { forceAdaptiveThinking: false },
    };
    const aBudget = resolveThinkingStreamOptions(legacyClaude, "anthropic", "high");
    expect(aBudget.streamOptionsPatch).toEqual({
      thinkingEnabled: true,
      thinkingBudgetTokens: 16384,
    });

    // OpenAI responses
    const gpt6 = bm.getModel("openai", "gpt-6-luna")!;
    const oaiHigh = resolveThinkingStreamOptions(gpt6, "openai", "high");
    expect(oaiHigh.streamOptionsPatch).toEqual({ reasoningEffort: "high" });

    // Local runtimes: ollama, llamaswap, mlx
    const localAdHoc: Model<Api> = {
      id: "gemma4:26b",
      name: "gemma4:26b",
      api: "openai-completions",
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: true,
      contextWindow: 131072,
      maxTokens: 32768,
    };
    const ollamaOff = resolveThinkingStreamOptions(localAdHoc, "ollama", "off");
    expect(ollamaOff.extraPayloadPatch).toEqual({
      think: false,
      reasoning_effort: "none",
    });
    expect(ollamaOff.effectiveEffort).toBe("off");

    const ollamaHigh = resolveThinkingStreamOptions(localAdHoc, "ollama", "high");
    expect(ollamaHigh.extraPayloadPatch).toEqual({
      think: true,
      reasoning_effort: "high",
    });
    expect(ollamaHigh.streamOptionsPatch).toEqual({ reasoningEffort: "high" });

    const llamaOff = resolveThinkingStreamOptions(localAdHoc, "llamaswap", "off");
    expect(llamaOff.extraPayloadPatch).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });

    const mlxOff = resolveThinkingStreamOptions(localAdHoc, "mlx", "off");
    expect(mlxOff.extraPayloadPatch).toEqual({
      enable_thinking: false,
      reasoning_effort: "none",
    });
    const mlxHigh = resolveThinkingStreamOptions(localAdHoc, "mlx", "high");
    expect(mlxHigh.extraPayloadPatch).toEqual({
      enable_thinking: true,
      reasoning_effort: "high",
    });
    expect(mlxHigh.streamOptionsPatch).toEqual({ reasoningEffort: "high" });
    expect(mlxHigh.streamOptionsPatch).not.toHaveProperty("maxTokens");
  });

  it("preserves OpenRouter totalFromProvider cost without clobbering it", () => {
    const bm = getPiModels();
    const deepseek = bm.getModel("openrouter", "deepseek/deepseek-v4.1-flash")!;
    const usageWithProviderCost: AssistantMessage["usage"] & {
      cost: AssistantMessage["usage"]["cost"] & { totalFromProvider?: boolean };
    } = {
      input: 1000,
      output: 1000,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2000,
      cost: {
        input: 0.0001,
        output: 0.0002,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.00042,
        totalFromProvider: true,
      },
    };
    const cost = extractStepCostUsd(deepseek, usageWithProviderCost);
    expect(cost).toBeCloseTo(0.00042);
    expect(usageWithProviderCost.cost.totalFromProvider).toBe(true);
    expect(usageWithProviderCost.cost.total).toBeCloseTo(0.00042);

    const computedUsage: AssistantMessage["usage"] = {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2_000_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    };
    const fallbackCost = extractStepCostUsd(deepseek, computedUsage);
    expect(fallbackCost).toBeCloseTo(deepseek.cost.input + deepseek.cost.output);
  });

  it("accumulates reasoningTokens and resolves custom baseUrl + mlx endpoints", async () => {
    const faux = fauxProvider({
      provider: "faux-thinking-usage",
      models: [
        {
          id: "reasoner",
          reasoning: true,
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });
    faux.setResponses([
      fauxAssistantMessage([
        fauxThinking("Step one: inspect constraints carefully."),
        { type: "text", text: "final answer" },
      ]),
    ]);
    registerPiProvider(faux.provider);

    const turn = await runPiTurn({
      model: {
        provider: "faux-thinking-usage",
        name: "reasoner",
        reasoningEffort: "high",
      },
      prompt: "think and answer",
    });
    expect(turn.content).toBe("final answer");
    expect(turn.reasoning).toContain("Step one");
    expect(turn.usage.reasoningTokens).toBeGreaterThan(0);
    expect(turn.effectiveThinkingLevel).toBe("high");

    const custom = await resolvePiModel({
      provider: "mlx",
      name: "inkling-2-mini-mlx-nvfp4",
      baseUrl: "http://127.0.0.1:8000",
      extraBody: { enable_thinking: false },
    });
    expect(custom.piModel.baseUrl).toBe("http://127.0.0.1:8000/v1");
    expect(custom.extraBody).toEqual({ enable_thinking: false });

    const mlxNothink = await resolvePiModel({
      provider: "mlx-nothink",
      name: "qwen3.8-27b-mlx-4bit",
    });
    expect(mlxNothink.extraBody).toEqual({
      enable_thinking: false,
      reasoning_effort: "none",
    });

    const cat = getCatalogModelInfo({
      provider: "google",
      name: "gemini-3.8-flash",
    });
    expect(cat.found).toBe(true);
    expect(cat.supportedThinkingLevels).toContain("high");

    // Day-0 OpenRouter model gets openrouter thinkingFormat and explicit costs
    const prevKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = prevKey || "test-key";
    try {
      const day0 = await resolvePiModel({
        provider: "openrouter",
        name: "thinkingmachines/inkling-2-mini-unlisted-test",
        costs: { promptTokens: 0.07, completionTokens: 0.3 },
      });
      expect(day0.piModel.compat).toMatchObject({
        thinkingFormat: "openrouter",
        supportsUsageInStreaming: true,
      });
      expect(day0.piModel.cost).toMatchObject({
        input: 0.07,
        output: 0.3,
      });
    } finally {
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prevKey;
    }
  });
});
