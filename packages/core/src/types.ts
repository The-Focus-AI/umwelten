import { z } from 'zod';

export const TokenUsageSchema = z.object({
  prompt: z.number(),
  completion: z.number(),
  total: z.number(),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

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