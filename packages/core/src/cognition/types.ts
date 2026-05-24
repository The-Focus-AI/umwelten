import { z } from "zod";
import type { CoreMessage, LanguageModel } from "ai";
import { TokenUsage, TokenUsageSchema } from "../costs/costs.js";
import { CostBreakdown, CostBreakdownSchema } from "../costs/costs.js";

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface ModelRoute {
  name: string; // Base model identifier
  provider: string; // Original provider
  variant?: string; // Optional variant (e.g. "free")
  temperature?: number; // Optional temperature
  topP?: number; // Optional topP
  topK?: number; // Optional topK
  numCtx?: number; // Optional number of context tokens
  reasoningEffort?: ReasoningEffort; // Optional thinking/reasoning effort level
}

export const ModelRouteSchema = z.object({
  name: z.string(),
  provider: z.string(),
  variant: z.string().optional(),
  numCtx: z.number().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  reasoningEffort: z.enum(['none', 'low', 'medium', 'high']).optional(),
});

export interface ModelDetails extends ModelRoute {
  description?: string;
  contextLength?: number;
  costs?: {
    promptTokens: number;
    completionTokens: number;
  };
  addedDate?: Date;
  lastUpdated?: Date;
  details?: Record<string, unknown>;
  originalProvider?: string; // For OpenRouter models, the actual provider (e.g., 'openai', 'anthropic')
}

export const ModelDetailsSchema = ModelRouteSchema.extend({
  description: z.string().optional(),
  contextLength: z.number().optional(),
  costs: z
    .object({
      promptTokens: z.number(),
      completionTokens: z.number(),
    })
    .optional(),
  addedDate: z.date().optional(),
  lastUpdated: z.date().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  originalProvider: z.string().optional(),
});

export interface ModelConfig extends ModelRoute {
  description?: string;
  parameters?: Record<string, unknown>;
}

export const ModelConfigSchema = ModelRouteSchema.extend({
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

export interface ModelsConfig {
  models: ModelConfig[];
  metadata?: {
    created?: string;
    version?: string;
    notes?: string;
    requirements?: Record<string, string>;
  };
}

export const ModelsConfigSchema = z.object({
  models: z.array(ModelConfigSchema),
  metadata: z
    .object({
      created: z.string().optional(),
      version: z.string().optional(),
      notes: z.string().optional(),
      requirements: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export const ModelCapabilitiesSchema = z.object({
  maxTokens: z.number(),
  streaming: z.boolean(),
  functionCalling: z.boolean(),
});

export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelOptionsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().positive().optional(),
  stop: z.array(z.string()).optional(),
});

export type ModelOptions = z.infer<typeof ModelOptionsSchema>;

export const ResponseMetadataSchema = z.object({
  startTime: z.date(),
  endTime: z.date(),
  tokenUsage: TokenUsageSchema,
  provider: z.string(),
  model: z.string(),
  cost: CostBreakdownSchema,
});

export const ModelResponseSchema = z.object({
  content: z.string(),
  metadata: ResponseMetadataSchema,
  reasoning: z.string().optional(),
  reasoningDetails: z
    .array(
      z.object({
        type: z.enum(["text", "redacted"]),
        text: z.string().optional(),
        data: z.string().optional(),
        signature: z.string().optional(),
      }),
    )
    .optional(),
  /**
   * Full message transcript (system + user + assistant + any tool turns)
   * captured at end of generation. Snapshot of `interaction.getMessages()`
   * — sufficient to replay the conversation without re-running the model.
   * Cached to disk so 2-pass / multi-turn evals can pick up the thread.
   *
   * Typed as `z.unknown()` here because `CoreMessage` is a TS-only type
   * (not a Zod schema); the exported `ModelResponse` type narrows the
   * field to `CoreMessage[]` for callers.
   */
  messages: z.array(z.unknown()).optional(),
});

export type ModelResponse = Omit<z.infer<typeof ModelResponseSchema>, "messages"> & {
  messages?: CoreMessage[];
};

export const ScoreSchema = z.object({
  evals: z.array(
    z.object({
      key: z.string().describe("Key that we are looking for"),
      value: z.string().describe("Value that is found)"),
      score: z
        .number()
        .describe(
          "Score of 1 if the content was identified and 0 if it was not",
        ),
    }),
  ),
});

export const ScoreResponseSchema = z.object({
  evals: z.array(
    z.object({
      key: z.string().describe("Key that we are looking for"),
      value: z.string().describe("Value that is found)"),
      score: z
        .number()
        .describe(
          "Score of 1 if the content was identified and 0 if it was not",
        ),
    }),
  ),
  metadata: ResponseMetadataSchema,
});

export type ScoreResponse = z.infer<typeof ScoreResponseSchema>;

/**
 * StreamObserver — optional callbacks that receive stream events as they arrive.
 *
 * Passed to streamText() to let callers (web adapters, TUIs, etc.) react to
 * deltas without waiting for the final ModelResponse.
 *
 * All callbacks are optional. The runner will still return the final
 * ModelResponse unchanged; this is purely additive observation.
 */
export interface StreamObserver {
  /** A chunk of assistant text arrived. */
  onTextDelta?: (delta: string) => void;
  /** A chunk of reasoning/thinking text arrived. */
  onReasoningDelta?: (delta: string) => void;
  /** A tool call is fully assembled and about to execute. */
  onToolCall?: (call: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }) => void;
  /** A tool call returned a result. */
  onToolResult?: (result: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError: boolean;
  }) => void;
}

export interface ModelRunner {
  generateText(interaction: any, signal?: AbortSignal): Promise<ModelResponse>;
  streamText(
    interaction: any,
    signal?: AbortSignal,
    observer?: StreamObserver,
  ): Promise<ModelResponse>;
  generateObject(
    interaction: any,
    schema: z.ZodSchema,
    signal?: AbortSignal,
  ): Promise<ModelResponse>;
  streamObject(
    interaction: any,
    schema: z.ZodSchema,
    signal?: AbortSignal,
  ): Promise<ModelResponse>;
  // generateImage(interaction: any): Promise<ModelResponse>;
}

export interface ModelSearchOptions {
  query: string; // Search term
  provider?: "openrouter" | "ollama" | "google" | "github-models" | "fireworks" | "minimax" | "deepinfra" | "togetherai" | "lmstudio" | "llamabarn" | "all"; // Filter by provider
  sortBy?: "name" | "addedDate" | "contextLength" | "cost"; // Sort results
  sortOrder?: "asc" | "desc"; // Sort direction
  onlyFree?: boolean; // Only show free models
}
