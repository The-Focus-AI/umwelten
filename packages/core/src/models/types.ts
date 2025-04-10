import { z } from "zod";
import { LanguageModelV1 } from "ai";
import { TokenUsage, TokenUsageSchema } from "../costs/costs.js";
import { CostBreakdown, CostBreakdownSchema } from "../costs/costs.js";

export interface ModelRoute {
  name: string; // Base model identifier
  provider: string; // Original provider
  variant?: string; // Optional variant (e.g. "free")
}

export const ModelRouteSchema = z.object({
  name: z.string(),
  provider: z.string(),
  variant: z.string().optional(),
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
  details: z.record(z.unknown()).optional(),
  originalProvider: z.string().optional(),
});

export interface ModelConfig extends ModelRoute {
  description?: string;
  parameters?: Record<string, unknown>;
}

export const ModelConfigSchema = ModelRouteSchema.extend({
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional(),
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
      requirements: z.record(z.string()).optional(),
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

export const ModelResponseSchema = z.object({
  content: z.string(),
  metadata: z.object({
    startTime: z.date(),
    endTime: z.date(),
    tokenUsage: TokenUsageSchema,
    provider: z.string(),
    model: z.string(),
    cost: CostBreakdownSchema.optional(),
  }),
});

export type ModelResponse = z.infer<typeof ModelResponseSchema>;

export interface ModelRunner {
  execute(params: {
    prompt: string;
    modelDetails: ModelDetails;
    options?: ModelOptions;
  }): Promise<ModelResponse>;
}

export interface ModelSearchOptions {
  query: string; // Search term
  provider?: "openrouter" | "ollama" | "google" | "all"; // Filter by provider
  sortBy?: "name" | "addedDate" | "contextLength" | "cost"; // Sort results
  sortOrder?: "asc" | "desc"; // Sort direction
  onlyFree?: boolean; // Only show free models
}
