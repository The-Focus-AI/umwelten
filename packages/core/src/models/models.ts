import { LanguageModelV1 } from 'ai'
import { z } from 'zod'
import { TokenUsage, TokenUsageSchema } from '../costs/costs.ts'
import { getOpenRouterModels } from '../providers/openrouter.ts'
import { getOllamaModels } from '../providers/ollama.ts'

export interface ModelCosts {
  promptTokens: number  // Cost per 1K prompt tokens in USD
  completionTokens: number  // Cost per 1K completion tokens in USD
}

export interface ModelDetails {
  id: string
  name: string
  contextLength: number
  costs?: ModelCosts  // Optional since Ollama models are free
  provider: 'openrouter' | 'ollama'
  details?: {
    format?: string
    family?: string
    parameterSize?: string
    quantizationLevel?: string
  }
}

export interface ModelProvider {
  listModels(): Promise<ModelDetails[]>
  createModel(modelId: string): LanguageModelV1
}



// Function to get all available models from all providers
export async function getAllModels(): Promise<ModelDetails[]> {
  try {
    const [openRouterModels, ollamaModels] = await Promise.allSettled([
      getOpenRouterModels(),
      getOllamaModels()
    ])
    
    const models: ModelDetails[] = []
    
    if (openRouterModels.status === 'fulfilled') {
      models.push(...openRouterModels.value)
    }
    
    if (ollamaModels.status === 'fulfilled') {
      models.push(...ollamaModels.value)
    }
    
    return models
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

export interface ModelProvider {
  id: string;
  capabilities: ModelCapabilities;
  execute(prompt: string, options?: ModelOptions): Promise<ModelResponse>;
  calculateCost(usage: TokenUsage): number;
}

export interface ModelRunner {
  execute(params: {
    prompt: string;
    model: ModelProvider;
    options?: ModelOptions;
  }): Promise<ModelResponse>;
} 