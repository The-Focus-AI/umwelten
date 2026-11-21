/**
 * Direct `@earendil-works/pi-ai` model resolution, uncapped turn execution,
 * structured output, and Mycel Exchange HTTP helpers.
 *
 * Replaces legacy `cognition/`, `Stimulus`, `Interaction`, and `BaseModelRunner`
 * with a thin helper layer directly on `@earendil-works/pi-ai`.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import {
  calculateCost as piCalculateCost,
  createModels,
  createProvider,
  envApiKeyAuth,
  type Api as PiApi,
  type AssistantMessage as PiAssistantMessage,
  type Context as PiContext,
  type Message as PiMessage,
  type Model as PiModel,
  type MutableModels,
  type OpenAICompletionsCompat,
  type Provider as PiProvider,
  type StreamOptions as PiStreamOptions,
  type Tool as PiAiTool,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Schema as TSchema } from "@earendil-works/pi-schema";
import { Agent, setGlobalDispatcher } from "undici";

// ── .env loader ──────────────────────────────────────────────────────────────

let envLoaded = false;

export function findNearestEnvFile(
  startDir: string = process.cwd(),
): string | undefined {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function loadEnv(startDir: string = process.cwd()): string | undefined {
  let loadedPath: string | undefined;
  if (!envLoaded) {
    const envPath = findNearestEnvFile(startDir);
    if (envPath) {
      dotenv.config({ path: envPath, quiet: true });
      loadedPath = envPath;
    }
    envLoaded = true;
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }
  return loadedPath;
}

loadEnv();

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModelSpec {
  provider: string;
  name: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  contextLength?: number;
  costs?: {
    promptTokens: number;
    completionTokens: number;
    cachedInputTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface ExecutableTool<TInput = any, TOutput = any> {
  description: string;
  inputSchema: z.ZodType<TInput> | Record<string, unknown>;
  execute: (
    args: TInput,
    ctx: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<TOutput> | TOutput;
}

export function tool<TInput = any, TOutput = any>(
  def: ExecutableTool<TInput, TOutput>,
): ExecutableTool<TInput, TOutput> {
  return def;
}

export interface ExecutedToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  isError: boolean;
}

export interface PiTurnResult {
  content: string;
  reasoning?: string;
  messages: PiMessage[];
  toolCalls: ExecutedToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    total: number;
  };
  costUsd: number;
  durationMs: number;
  stopReason?: string;
}

export interface RunPiTurnInput {
  model: ModelSpec;
  systemPrompt?: string;
  prompt?: string;
  messages?: PiMessage[];
  temperature?: number;
  /**
   * Explicit token cap ONLY when the caller sets one (`JudgeTask`, short probe).
   * Omit (`undefined`) for benchmarks so `models.stream()` leaves generation uncapped.
   */
  maxTokens?: number;
  tools?: Record<string, ExecutableTool>;
  maxToolSteps?: number;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
}

// ── Pi `builtinModels()` + `~/.pi/agent/models.json` ─────────────────────────

const VARIANT_SUFFIX_RE = /:(thinking|free|extended|nitro|floor)$/;
const DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

let localDispatcherInstalled = false;
function ensureLocalFetchDispatcher(): void {
  if (localDispatcherInstalled) return;
  localDispatcherInstalled = true;
  setGlobalDispatcher(
    new Agent({
      headersTimeout: 10 * 60 * 1000,
      bodyTimeout: 30 * 60 * 1000,
    }),
  );
}

interface LocalEndpointDefaults {
  baseUrl: () => string;
  apiKey?: () => string | undefined;
  headers?: () => Record<string, string>;
  extraBody?: Record<string, unknown>;
}

const LOCAL_AND_EXCHANGE_ENDPOINTS: Record<string, LocalEndpointDefaults> = {
  ollama: {
    baseUrl: () =>
      `${(process.env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/$/, "")}/v1`,
  },
  lmstudio: { baseUrl: () => "http://localhost:1234/v1" },
  vllm: {
    baseUrl: () =>
      (process.env.VLLM_BASE_URL ?? "http://localhost:8000/v1").replace(
        /\/$/,
        "",
      ),
    apiKey: () => process.env.VLLM_API_KEY,
  },
  llamaswap: {
    baseUrl: () =>
      (process.env.LLAMASWAP_HOST ?? "http://localhost:8080/v1").replace(
        /\/$/,
        "",
      ),
  },
  "llamaswap-nothink": {
    baseUrl: () =>
      (process.env.LLAMASWAP_HOST ?? "http://localhost:8080/v1").replace(
        /\/$/,
        "",
      ),
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
  },
  llamabarn: {
    baseUrl: () =>
      (process.env.LLAMABARN_HOST ?? "http://localhost:2276/v1").replace(
        /\/$/,
        "",
      ),
  },
  "llamabarn-nothink": {
    baseUrl: () =>
      (process.env.LLAMABARN_HOST ?? "http://localhost:2276/v1").replace(
        /\/$/,
        "",
      ),
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
  },
  mycel: {
    baseUrl: () =>
      `${(process.env.MYCEL_URL ?? "http://localhost:7438").replace(/\/$/, "")}/v1`,
    apiKey: () => process.env.MYCEL_API_KEY,
    headers: () => {
      const endUser =
        process.env.MYCEL_END_USER?.trim() ||
        process.env.HABITAT_ID?.trim() ||
        process.env.USER ||
        "pi-user";
      return { "X-Mycel-End-User": endUser };
    },
  },
};

export function loadPiModelsJsonInto(
  models: MutableModels,
  modelsJsonPath?: string,
): void {
  const agentDir =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  const candidate = modelsJsonPath ?? join(agentDir, "models.json");
  if (!existsSync(candidate)) return;

  try {
    const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
      providers?: Record<
        string,
        {
          name?: string;
          baseUrl?: string;
          apiKey?: string;
          api?: string;
          headers?: Record<string, string>;
          compat?: OpenAICompletionsCompat;
          models?: Array<{
            id: string;
            name?: string;
            contextWindow?: number;
            maxTokens?: number;
            reasoning?: boolean;
            input?: ("text" | "image")[];
            cost?: typeof DEFAULT_COST;
          }>;
        }
      >;
    };
    if (!parsed?.providers || typeof parsed.providers !== "object") return;

    for (const [id, cfg] of Object.entries(parsed.providers)) {
      if (!cfg?.baseUrl) continue;
      const baseUrl = cfg.baseUrl.replace(/\/$/, "");
      const apiName = (cfg.api ?? "openai-completions") as
        | "openai-completions"
        | "anthropic-messages"
        | "google-generative-ai";
      const keyRef = cfg.apiKey?.trim();
      const auth =
        keyRef && /^[A-Z0-9_]+$/.test(keyRef) && process.env[keyRef] !== undefined
          ? { apiKey: envApiKeyAuth(`${id} API key`, [keyRef]) }
          : {
              apiKey: {
                name: `${id} API key`,
                resolve: async () => ({
                  source: "explicit" as const,
                  auth: {
                    apiKey:
                      (keyRef ? process.env[keyRef] ?? keyRef : undefined) ||
                      "local-keyless",
                    baseUrl,
                    ...(cfg.headers ? { headers: cfg.headers } : {}),
                  },
                }),
              },
            };

      const declaredModels = (cfg.models ?? []).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        api: apiName,
        provider: id,
        baseUrl,
        input: m.input ?? (["text", "image"] as ("text" | "image")[]),
        cost: m.cost ?? DEFAULT_COST,
        reasoning: m.reasoning ?? true,
        contextWindow: m.contextWindow ?? 131072,
        maxTokens: m.maxTokens ?? 32768,
        ...(cfg.compat ? { compat: cfg.compat } : {}),
        ...(cfg.headers ? { headers: cfg.headers } : {}),
      }));

      const apiImpl =
        apiName === "anthropic-messages"
          ? anthropicMessagesApi()
          : apiName === "google-generative-ai"
            ? googleGenerativeAIApi()
            : openAICompletionsApi();

      models.setProvider(
        createProvider({
          id,
          name: cfg.name ?? id,
          baseUrl,
          headers: cfg.headers,
          auth,
          models: declaredModels as PiModel<PiApi>[],
          api: apiImpl,
        }),
      );
    }
  } catch {
    // Ignore malformed user models.json
  }
}

let sharedModels: MutableModels | undefined;
const registeredPlugins = new Map<string, PiProvider>();

export function getPiModels(): MutableModels {
  loadEnv();
  if (!sharedModels) {
    sharedModels = builtinModels({
      identity: { userAgent: { custom: "umwelten/0.6.0" }, attribution: null },
    });
    loadPiModelsJsonInto(sharedModels);
    for (const p of registeredPlugins.values()) {
      sharedModels.setProvider(p);
    }
  }
  return sharedModels;
}

export function registerPiProvider(provider: PiProvider): void {
  registeredPlugins.set(provider.id, provider);
  getPiModels().setProvider(provider);
}

export async function registerMycelProviderOn(
  targetModels: MutableModels = getPiModels(),
  options?: {
    apiKey?: string;
    baseUrl?: string;
    endUser?: string;
    extraModelIds?: string[];
  },
): Promise<void> {
  const rawBase = (
    options?.baseUrl ??
    process.env.MYCEL_URL ??
    "http://localhost:7438"
  ).replace(/\/$/, "");
  const baseUrl = rawBase.endsWith("/v1") ? rawBase : `${rawBase}/v1`;
  const apiKey = options?.apiKey ?? process.env.MYCEL_API_KEY;
  const endUser =
    options?.endUser?.trim() ||
    process.env.MYCEL_END_USER?.trim() ||
    process.env.HABITAT_ID?.trim() ||
    "gaia-host";

  const headers = { "X-Mycel-End-User": endUser };
  const discovered = new Map<string, typeof DEFAULT_COST>();
  discovered.set("default", DEFAULT_COST);
  for (const id of options?.extraModelIds ?? []) {
    discovered.set(id, DEFAULT_COST);
  }

  if (apiKey || process.env.MYCEL_URL) {
    try {
      const cat = await listMycelModels(apiKey, rawBase);
      for (const entry of cat) {
        discovered.set(entry.name, {
          input: entry.costs?.promptTokens ?? 0,
          output: entry.costs?.completionTokens ?? 0,
          cacheRead: entry.costs?.promptTokens ?? 0,
          cacheWrite: 0,
        });
      }
    } catch {
      // Keep seed model IDs when catalogue is temporarily unreachable at boot
    }
  }

  const piModelList: PiModel<"openai-completions">[] = Array.from(
    discovered.entries(),
  ).map(([id, cost]) => ({
    id,
    name: id,
    api: "openai-completions",
    provider: "mycel",
    baseUrl,
    input: ["text", "image"],
    cost,
    reasoning: true,
    contextWindow: 131072,
    maxTokens: 32768,
    compat: {
      supportsUsageInStreaming: true,
      maxTokensField: "max_tokens",
    },
    headers,
  }));

  targetModels.setProvider(
    createProvider({
      id: "mycel",
      name: "Mycel Exchange",
      baseUrl,
      headers,
      auth: {
        apiKey: {
          name: "Mycel API key",
          resolve: async () => ({
            source: "explicit",
            auth: {
              apiKey: apiKey || "local-keyless",
              baseUrl,
              headers,
            },
          }),
        },
      },
      models: piModelList as PiModel<PiApi>[],
      api: openAICompletionsApi(),
    }),
  );
}

export interface ResolvedPiInvocationTarget {
  models: MutableModels;
  piModel: PiModel<PiApi>;
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
}

export async function resolvePiModel(
  spec: ModelSpec,
): Promise<ResolvedPiInvocationTarget> {
  loadEnv();
  const piModels = getPiModels();
  const providerId = spec.provider === "togetherai" ? "together" : spec.provider;

  const piProvider = piModels.getProvider(providerId);
  if (piProvider) {
    const authCheck = await piModels.checkAuth(providerId);
    if (!authCheck) {
      throw new Error(`No credentials configured for provider "${providerId}"`);
    }
    const exact = piModels.getModel(providerId, spec.name);
    if (exact) return { models: piModels, piModel: exact };

    if (VARIANT_SUFFIX_RE.test(spec.name)) {
      const base = piModels.getModel(
        providerId,
        spec.name.replace(VARIANT_SUFFIX_RE, ""),
      );
      if (base) {
        return {
          models: piModels,
          piModel: { ...base, id: spec.name, name: spec.name },
        };
      }
    }

    // Unlisted / day-0 model slug on a configured Pi provider
    const resolvedAuth = await piModels.getAuth(providerId);
    const apiKey = resolvedAuth?.auth.apiKey ?? "";
    const baseUrl = (
      resolvedAuth?.auth.baseUrl ??
      piProvider.baseUrl ??
      ""
    ).replace(/\/$/, "");
    return createAdHocTarget({
      providerId,
      modelId: spec.name,
      baseUrl,
      apiKey,
      api:
        providerId === "google"
          ? "google-generative-ai"
          : providerId === "anthropic" ||
              providerId === "minimax" ||
              providerId === "minimax-cn"
            ? "anthropic-messages"
            : "openai-completions",
      headers: resolvedAuth?.auth.headers as Record<string, string> | undefined,
    });
  }

  const endpoint = LOCAL_AND_EXCHANGE_ENDPOINTS[spec.provider];
  if (endpoint) {
    if (spec.provider !== "mycel") ensureLocalFetchDispatcher();
    if (spec.provider === "mycel" && !process.env.MYCEL_API_KEY && !process.env.MYCEL_URL) {
      throw new Error("MYCEL_API_KEY or MYCEL_URL is required for Mycel calls");
    }
    const headers = endpoint.headers?.();
    let cost = DEFAULT_COST;
    if (spec.costs) {
      cost = {
        input: spec.costs.promptTokens,
        output: spec.costs.completionTokens,
        cacheRead: spec.costs.cachedInputTokens ?? spec.costs.promptTokens,
        cacheWrite: spec.costs.cacheWriteTokens ?? 0,
      };
    } else if (spec.provider === "mycel") {
      try {
        const catalogue = await listMycelModels(
          process.env.MYCEL_API_KEY,
          process.env.MYCEL_URL,
        );
        const entry = catalogue.find((m) => m.name === spec.name);
        if (entry?.costs) {
          cost = {
            input: entry.costs.promptTokens,
            output: entry.costs.completionTokens,
            cacheRead: entry.costs.promptTokens,
            cacheWrite: 0,
          };
        }
      } catch {
        // Proceed with zero cost metadata when /v1/models is unreachable
      }
    }

    return createAdHocTarget({
      providerId: spec.provider,
      modelId: spec.name,
      baseUrl: endpoint.baseUrl(),
      apiKey: endpoint.apiKey?.(),
      api: "openai-completions",
      headers,
      extraBody: endpoint.extraBody,
      cost,
    });
  }

  throw new Error(
    `Unsupported provider "${spec.provider}". Configure it in ~/.pi/agent/models.json or use a built-in Pi provider.`,
  );
}

function createAdHocTarget(input: {
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  api: "openai-completions" | "google-generative-ai" | "anthropic-messages";
  headers?: Record<string, string>;
  extraBody?: Record<string, unknown>;
  cost?: typeof DEFAULT_COST;
}): ResolvedPiInvocationTarget {
  const piModel: PiModel<typeof input.api> = {
    id: input.modelId,
    name: input.modelId,
    api: input.api,
    provider: input.providerId,
    baseUrl: input.baseUrl,
    input: ["text", "image"],
    cost: input.cost ?? DEFAULT_COST,
    reasoning: true,
    contextWindow: input.api === "google-generative-ai" ? 1048576 : 131072,
    maxTokens: input.api === "anthropic-messages" ? 64000 : 32768,
    ...(input.api === "openai-completions"
      ? {
          compat: {
            supportsUsageInStreaming: true,
            maxTokensField: "max_tokens" as const,
          },
        }
      : {}),
    ...(input.headers ? { headers: input.headers } : {}),
  };

  const apiImpl =
    input.api === "anthropic-messages"
      ? anthropicMessagesApi()
      : input.api === "google-generative-ai"
        ? googleGenerativeAIApi()
        : openAICompletionsApi();

  const models = createModels({
    identity: { userAgent: { custom: "umwelten/0.6.0" }, attribution: null },
  });
  models.setProvider(
    createProvider({
      id: input.providerId,
      name: input.providerId,
      baseUrl: input.baseUrl,
      headers: input.headers,
      auth: {
        apiKey: {
          name: `${input.providerId} API key`,
          resolve: async () => ({
            source: "explicit",
            auth: {
              apiKey: input.apiKey || "local-keyless",
              baseUrl: input.baseUrl,
              ...(input.headers ? { headers: input.headers } : {}),
            },
          }),
        },
      },
      models: [piModel as PiModel<PiApi>],
      api: apiImpl,
    }),
  );

  return {
    models,
    piModel: piModel as PiModel<PiApi>,
    headers: input.headers,
    extraBody: input.extraBody,
  };
}

// ── Direct Pi Turn & Constrained-Sampling Execution ──────────────────────────

export function zodOrJsonToSchema(
  schema: z.ZodType | Record<string, unknown>,
): Record<string, unknown> {
  const maybeZod = schema as unknown as { safeParse?: unknown };
  if ("_zod" in schema || typeof maybeZod.safeParse === "function") {
    const js = z.toJSONSchema(schema as unknown as z.ZodType, {
      target: "draft-2020-12",
    }) as Record<string, unknown>;
    const { $schema: _ignored, ...rest } = js;
    return rest;
  }
  return schema as Record<string, unknown>;
}

function toPiTools(
  tools?: Record<string, ExecutableTool>,
  constrained?: boolean,
): PiAiTool[] | undefined {
  if (!tools || Object.keys(tools).length === 0) return undefined;
  return Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: zodOrJsonToSchema(def.inputSchema) as unknown as TSchema,
    ...(constrained
      ? { constrainedSampling: { type: "json_schema" as const, strict: "prefer" as const } }
      : {}),
  }));
}

function splitThinkTags(
  text: string,
  existingReasoning?: string,
): { content: string; reasoning?: string } {
  const thinkRe = /<think>([\s\S]*?)<\/think>/gi;
  const extracted: string[] = [];
  const cleaned = text.replace(thinkRe, (_m, inner: string) => {
    if (inner.trim()) extracted.push(inner.trim());
    return "";
  });
  if (extracted.length === 0) return { content: text, reasoning: existingReasoning };
  return {
    content: cleaned.trimStart(),
    reasoning: [existingReasoning, ...extracted].filter(Boolean).join("\n") || undefined,
  };
}

export async function runPiTurn(input: RunPiTurnInput): Promise<PiTurnResult> {
  const started = Date.now();
  const target = await resolvePiModel(input.model);
  const piTools = toPiTools(input.tools);
  const maxSteps = piTools ? (input.maxToolSteps ?? 12) : 1;

  const messages: PiMessage[] = input.messages
    ? [...input.messages]
    : input.prompt !== undefined
      ? [{ role: "user", content: input.prompt, timestamp: Date.now() }]
      : [];

  const toolCalls: ExecutedToolCall[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let costUsd = 0;
  let finalText = "";
  let finalReasoning: string | undefined;
  let stopReason: string | undefined;

  for (let step = 0; step < maxSteps; step++) {
    if (input.signal?.aborted) {
      const err =
        input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    }

    const piContext: PiContext = {
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      messages,
      ...(piTools ? { tools: piTools } : {}),
    };

    const extraPayload: Record<string, unknown> = {
      ...(target.extraBody ?? {}),
    };
    if (input.model.provider === "ollama" && input.model.reasoningEffort) {
      extraPayload.think = input.model.reasoningEffort !== "none";
    }

    const streamOpts: PiStreamOptions & Record<string, unknown> = {
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      // CRITICAL: Only pass maxTokens when explicitly set by the caller!
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(target.headers ? { headers: target.headers } : {}),
      ...(input.model.reasoningEffort &&
      input.model.reasoningEffort !== "none" &&
      input.model.provider !== "ollama"
        ? { reasoningEffort: input.model.reasoningEffort }
        : {}),
      ...(Object.keys(extraPayload).length > 0
        ? {
            onPayload: (payload: unknown) =>
              payload && typeof payload === "object" && !Array.isArray(payload)
                ? { ...extraPayload, ...(payload as Record<string, unknown>) }
                : undefined,
          }
        : {}),
    };

    // Always invoke raw models.stream() — never streamSimple(), which clamps maxTokens!
    const eventStream = target.models.stream(target.piModel, piContext, streamOpts);
    let assistantMsg: PiAssistantMessage | undefined;

    for await (const ev of eventStream) {
      if (ev.type === "text_delta") input.onTextDelta?.(ev.delta);
      else if (ev.type === "thinking_delta") input.onReasoningDelta?.(ev.delta);
      else if (ev.type === "error") {
        throw new Error(ev.error.errorMessage || `Stream ended with ${ev.reason}`);
      } else if (ev.type === "done") {
        assistantMsg = ev.message;
      }
    }
    if (!assistantMsg) assistantMsg = await eventStream.result();

    if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
      throw new Error(
        assistantMsg.errorMessage || `Model stopped with ${assistantMsg.stopReason}`,
      );
    }

    stopReason = assistantMsg.stopReason;
    promptTokens += assistantMsg.usage.input ?? 0;
    completionTokens += assistantMsg.usage.output ?? 0;
    cacheReadTokens += assistantMsg.usage.cacheRead ?? 0;
    cacheWriteTokens += assistantMsg.usage.cacheWrite ?? 0;
    const computedCost = piCalculateCost(target.piModel, assistantMsg.usage);
    costUsd += computedCost?.total ?? assistantMsg.usage.cost?.total ?? 0;

    messages.push(assistantMsg);

    const rawText = assistantMsg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    const rawThinking = assistantMsg.content
      .filter((b): b is Extract<typeof b, { type: "thinking" }> => b.type === "thinking")
      .map((b) => b.thinking)
      .join("\n");
    const split =
      input.model.provider === "google"
        ? { content: rawText, reasoning: rawThinking || undefined }
        : splitThinkTags(rawText, rawThinking || undefined);

    finalText = split.content;
    if (split.reasoning) finalReasoning = split.reasoning;

    const pendingCalls = assistantMsg.content.filter(
      (b): b is Extract<typeof b, { type: "toolCall" }> => b.type === "toolCall",
    );
    if (pendingCalls.length === 0 || !input.tools) break;

    for (const tc of pendingCalls) {
      const def = input.tools[tc.name];
      if (!def) {
        const msg = `Tool "${tc.name}" is not registered`;
        toolCalls.push({
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.arguments,
          output: msg,
          isError: true,
        });
        messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: msg }],
          isError: true,
          timestamp: Date.now(),
        });
        continue;
      }

      try {
        const maybeZod = def.inputSchema as unknown as {
          parse?: (v: unknown) => unknown;
        };
        const parsedArgs =
          typeof maybeZod.parse === "function"
            ? maybeZod.parse(tc.arguments ?? {})
            : (tc.arguments ?? {});
        const out = await def.execute(parsedArgs, {
          toolCallId: tc.id,
          abortSignal: input.signal,
        });
        const text = typeof out === "string" ? out : JSON.stringify(out);
        toolCalls.push({
          toolCallId: tc.id,
          toolName: tc.name,
          input: parsedArgs,
          output: out,
          isError: false,
        });
        messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text }],
          isError: false,
          timestamp: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toolCalls.push({
          toolCallId: tc.id,
          toolName: tc.name,
          input: tc.arguments,
          output: msg,
          isError: true,
        });
        messages.push({
          role: "toolResult",
          toolCallId: tc.id,
          toolName: tc.name,
          content: [{ type: "text", text: msg }],
          isError: true,
          timestamp: Date.now(),
        });
      }
    }
  }

  return {
    content: finalText,
    ...(finalReasoning ? { reasoning: finalReasoning } : {}),
    messages,
    toolCalls,
    usage: {
      promptTokens,
      completionTokens,
      cacheReadTokens,
      cacheWriteTokens,
      total: promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens,
    },
    costUsd,
    durationMs: Date.now() - started,
    stopReason,
  };
}

function extractFirstJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error(`No valid JSON object in output: ${trimmed.slice(0, 160)}`);
  }
}

export async function runPiStructuredObject<T>(input: {
  model: ModelSpec;
  schema: z.ZodType<T>;
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<{ object: T; rawText: string; turn: PiTurnResult }> {
  const jsonSchema = zodOrJsonToSchema(input.schema);
  let capturedArgs: unknown = undefined;

  const target = await resolvePiModel(input.model);
  const submitTool: PiAiTool = {
    name: "__structured_output",
    description:
      "Submit the structured JSON object matching the required schema.",
    parameters: jsonSchema as unknown as TSchema,
    constrainedSampling: { type: "json_schema", strict: "prefer" },
  };

  const sys = [
    input.systemPrompt,
    `Return a valid JSON object matching this JSON Schema by calling \`__structured_output\` (or outputting raw JSON):\n${JSON.stringify(jsonSchema)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const started = Date.now();
  const messages: PiMessage[] = [
    { role: "user", content: input.prompt, timestamp: Date.now() },
  ];

  const eventStream = target.models.stream(
    target.piModel,
    { systemPrompt: sys, messages, tools: [submitTool] },
    {
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(target.headers ? { headers: target.headers } : {}),
    },
  );
  const assistantMsg = await eventStream.result();
  if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
    throw new Error(
      assistantMsg.errorMessage || `Model stopped with ${assistantMsg.stopReason}`,
    );
  }

  const tc = assistantMsg.content.find(
    (b): b is Extract<typeof b, { type: "toolCall" }> =>
      b.type === "toolCall" && b.name === "__structured_output",
  );
  if (tc) capturedArgs = tc.arguments;

  const rawText = assistantMsg.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const candidate =
    capturedArgs !== undefined ? capturedArgs : extractFirstJson(rawText);
  const object = input.schema.parse(candidate);
  const serialized = JSON.stringify(object);
  const computedCost = piCalculateCost(target.piModel, assistantMsg.usage);

  return {
    object,
    rawText: serialized,
    turn: {
      content: serialized,
      messages: [...messages, assistantMsg],
      toolCalls: [],
      usage: {
        promptTokens: assistantMsg.usage.input ?? 0,
        completionTokens: assistantMsg.usage.output ?? 0,
        cacheReadTokens: assistantMsg.usage.cacheRead ?? 0,
        cacheWriteTokens: assistantMsg.usage.cacheWrite ?? 0,
        total: assistantMsg.usage.totalTokens ?? 0,
      },
      costUsd: computedCost?.total ?? assistantMsg.usage.cost?.total ?? 0,
      durationMs: Date.now() - started,
      stopReason: assistantMsg.stopReason,
    },
  };
}

// ── Mycel Exchange HTTP Helpers ──────────────────────────────────────────────

export interface MycelAIOptions {
  apiKey: string;
  endUser: string;
  baseUrl?: string;
  requiredCapabilities?: string[];
  requiredGuarantees?: string[];
  fetch?: typeof fetch;
}

export async function listMycelModels(
  apiKey?: string,
  baseUrl?: string,
): Promise<ModelSpec[]> {
  const base = (
    baseUrl ??
    process.env.MYCEL_URL ??
    "http://localhost:7438"
  ).replace(/\/$/, "");
  const res = await fetch(`${base}/v1/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  const data = (await res.json()) as {
    data?: Array<{
      id: string;
      pricing?: { prompt?: number; completion?: number };
      context_length?: number;
    }>;
    error?: unknown;
  };
  if (!res.ok || !Array.isArray(data?.data)) {
    throw new Error(
      `Exchange API error: ${String(data?.error ?? res.statusText ?? "unexpected response format")}`,
    );
  }
  return data.data.map((m) => ({
    provider: "mycel",
    name: m.id,
    contextLength: m.context_length,
    costs: {
      promptTokens: m.pricing?.prompt ?? 0,
      completionTokens: m.pricing?.completion ?? 0,
    },
  }));
}

export function createMycelAI(options: MycelAIOptions) {
  const base = (
    options.baseUrl ??
    process.env.MYCEL_URL ??
    "http://localhost:7438"
  ).replace(/\/$/, "");
  if (!options.apiKey) throw new Error("Mycel requires an Application credential.");
  if (!options.endUser.trim()) throw new Error("Mycel requires a stable End User.");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.apiKey}`,
    "X-Mycel-End-User": options.endUser,
    ...(options.requiredCapabilities?.length
      ? { "X-Exchange-Require-Capability": options.requiredCapabilities.join(",") }
      : {}),
    ...(options.requiredGuarantees?.length
      ? { "X-Exchange-Require-Guarantee": options.requiredGuarantees.join(",") }
      : {}),
  };

  const fn = options.fetch ?? globalThis.fetch;

  return {
    async embed(modelId: string, value: string) {
      const res = await fn(`${base}/v1/embeddings`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ model: modelId, input: value }),
      });
      if (!res.ok) {
        throw new Error(`Mycel embeddings failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding: number[] }>;
        model?: string;
      };
      return {
        embedding: json.data?.[0]?.embedding ?? [],
        model: json.model ?? modelId,
      };
    },
    async generateImage(modelId: string, prompt: string) {
      const res = await fn(`${base}/v1/images/generations`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          model: modelId,
          prompt,
          response_format: "b64_json",
        }),
      });
      if (!res.ok) {
        throw new Error(`Mycel image generation failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      return { image: { base64: json.data?.[0]?.b64_json ?? "" } };
    },
    async transcribe(
      modelId: string,
      audio: Uint8Array,
      filename = "audio.wav",
    ) {
      const form = new FormData();
      form.append("model", modelId);
      form.append(
        "file",
        new Blob([audio.slice().buffer], { type: "audio/wav" }),
        filename,
      );
      const res = await fn(`${base}/v1/audio/transcriptions`, {
        method: "POST",
        headers,
        body: form,
      });
      if (!res.ok) {
        throw new Error(`Mycel transcription failed (${res.status}): ${await res.text()}`);
      }
      return (await res.json()) as {
        text: string;
        language?: string;
        duration?: number;
      };
    },
  };
}
