import { LanguageModelV1 } from 'ai'
import { z } from 'zod'
import { TokenUsage, TokenUsageSchema } from '../costs/costs.js'
import { createOpenRouterProvider } from '../providers/openrouter.js'
import { createOllamaProvider } from '../providers/ollama.js'
import { createGoogleProvider } from '../providers/google.js'
import { ModelRoute, ModelRouteSchema } from './types.js'

export interface ModelCosts {
  promptTokens: number  // Cost per 1K prompt tokens in USD
  completionTokens: number  // Cost per 1K completion tokens in USD
}

export interface ModelDetails extends ModelRoute {
  name?: string;
  description?: string;
  contextLength?: number;
  costs?: {
    promptTokens: number;
    completionTokens: number;
  };
  addedDate?: Date;
  lastUpdated?: Date;
  details?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  originalProvider?: string; // For OpenRouter models, the actual provider (e.g., 'openai', 'anthropic')
}

export const ModelDetailsSchema = ModelRouteSchema.extend({
  name: z.string().optional(),
  description: z.string().optional(),
  contextLength: z.number().optional(),
  costs: z.object({
    promptTokens: z.number(),
    completionTokens: z.number()
  }).optional(),
  addedDate: z.date().optional(),
  lastUpdated: z.date().optional(),
  details: z.record(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
  originalProvider: z.string().optional()
});

export interface ModelConfig extends ModelRoute {
  description?: string;
  parameters?: Record<string, unknown>;
}

export const ModelConfigSchema = ModelRouteSchema.extend({
  description: z.string().optional(),
  parameters: z.record(z.unknown()).optional()
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
  metadata: z.object({
    created: z.string().optional(),
    version: z.string().optional(),
    notes: z.string().optional(),
    requirements: z.record(z.string()).optional()
  }).optional()
});

export interface ModelProvider extends ModelRoute {
  capabilities: ModelCapabilities;
  calculateCost(usage: TokenUsage): number;
  listModels(): Promise<ModelDetails[]>;
}

// Function to get all available models from all providers
export async function getAllModels(): Promise<ModelDetails[]> {
  try {
    const providers = [
      createOllamaProvider(),
      ...(process.env.OPENROUTER_API_KEY ? [createOpenRouterProvider(process.env.OPENROUTER_API_KEY)] : []),
      ...(process.env.GOOGLE_GENERATIVE_AI_API_KEY ? [createGoogleProvider(process.env.GOOGLE_GENERATIVE_AI_API_KEY)] : [])
    ]

    const modelLists = await Promise.allSettled(
      providers.map(provider => provider.listModels())
    )
    
    return modelLists
      .filter((result): result is PromiseFulfilledResult<ModelDetails[]> => result.status === 'fulfilled')
      .flatMap(result => result.value)
  } catch (error) {
    console.error('Error fetching models:', error)
    return []
  }
} 


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
    cost: z.number(),
  }),
});

export type ModelResponse = z.infer<typeof ModelResponseSchema>;

export interface ModelRunner {
  execute(params: {
    prompt: string;
    model: LanguageModelV1;
    options?: ModelOptions;
  }): Promise<ModelResponse>;
}

export interface ModelSearchOptions {
  query: string              // Search term
  provider?: 'openrouter' | 'ollama' | 'google' | 'all'  // Filter by provider
  sortBy?: 'name' | 'addedDate' | 'contextLength' | 'cost'  // Sort results
  sortOrder?: 'asc' | 'desc'  // Sort direction
  onlyFree?: boolean        // Only show free models
}

/**
 * Search through available models using various criteria
 */
export async function searchModels(query: string, models: ModelDetails[]): Promise<ModelDetails[]> {
  const searchTerms = query.toLowerCase().split(/\s+/);
  return models.filter(model => {
    const searchText = `${model.modelId} ${model.name || ''} ${model.description || ''}`.toLowerCase();
    return searchTerms.every(term => searchText.includes(term));
  });
} 

export function findModelById(models: ModelDetails[], modelId: string): ModelDetails | undefined {
  return models.find(model => model.modelId === modelId);
}

export function sortModelsByName(models: ModelDetails[]): ModelDetails[] {
  return [...models].sort((a, b) => {
    const nameA = a.name || a.modelId;
    const nameB = b.name || b.modelId;
    return nameA.localeCompare(nameB);
  });
}

export function sortModelsByContextLength(models: ModelDetails[]): ModelDetails[] {
  return [...models].sort((a, b) => {
    const lengthA = a.contextLength || 0;
    const lengthB = b.contextLength || 0;
    return lengthB - lengthA;
  });
} 