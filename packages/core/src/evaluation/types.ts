import { z } from 'zod';
import { ModelRouteSchema } from '../models/types.js';

// Prompt Types and Schemas
export const PromptParametersSchema = z.object({
  max_tokens: z.number(),
  temperature: z.number().min(0).max(1),
  top_p: z.number().min(0).max(1)
});

export const PromptMetadataSchema = z.object({
  created: z.string(),
  version: z.string(),
  description: z.string(),
  expected_themes: z.array(z.string())
});

export const PromptConfigSchema = z.object({
  title: z.string(),
  question: z.string(),
  context: z.string(),
  parameters: PromptParametersSchema,
  metadata: PromptMetadataSchema
});

// Rubric Types and Schemas
export const ScoringCriterionSchema = z.object({
  description: z.string(),
  points: z.number(),
  key_aspects: z.array(z.string())
});

export const ScoringInstructionsSchema = z.object({
  method: z.string(),
  scale: z.string(),
  minimum_pass: z.number(),
  excellent_threshold: z.number()
});

export const RubricMetadataSchema = z.object({
  created: z.string(),
  version: z.string(),
  evaluator_model: z.string(),
  notes: z.string()
});

export const RubricConfigSchema = z.object({
  evaluation_prompt: z.string(),
  scoring_criteria: z.record(ScoringCriterionSchema),
  scoring_instructions: ScoringInstructionsSchema,
  metadata: RubricMetadataSchema
});

// Model Types and Schemas
export const ModelParametersSchema = z.object({
  temperature: z.number().min(0).max(1),
  top_p: z.number().min(0).max(1),
  max_tokens: z.number()
});

export const ModelConfigSchema = ModelRouteSchema.extend({
  description: z.string().optional(),
  parameters: ModelParametersSchema.optional()
});

export const ModelsMetadataSchema = z.object({
  created: z.string(),
  version: z.string(),
  notes: z.string().optional(),
  requirements: z.record(z.string()).optional()
});

export const ModelsConfigSchema = z.object({
  models: z.array(ModelConfigSchema),
  metadata: ModelsMetadataSchema.optional()
});

// Derived TypeScript types
export type PromptParameters = z.infer<typeof PromptParametersSchema>;
export type PromptMetadata = z.infer<typeof PromptMetadataSchema>;
export type PromptConfig = z.infer<typeof PromptConfigSchema>;

export type ScoringCriterion = z.infer<typeof ScoringCriterionSchema>;
export type ScoringInstructions = z.infer<typeof ScoringInstructionsSchema>;
export type RubricMetadata = z.infer<typeof RubricMetadataSchema>;
export type RubricConfig = z.infer<typeof RubricConfigSchema>;

export type ModelParameters = z.infer<typeof ModelParametersSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type ModelsMetadata = z.infer<typeof ModelsMetadataSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

// Evaluation Results Types
export interface EvaluationScore {
  criterion: string;
  score: number;
  maxPoints: number;
  reasoning: string;
}

export interface ModelEvaluationResult {
  modelId: string;
  provider: string;
  response: string;
  scores: EvaluationScore[];
  totalScore: number;
  metadata: {
    startTime: Date;
    endTime: Date;
    tokensUsed: number;
    cost: number;
  };
}

export interface EvaluationResults {
  promptConfig: PromptConfig;
  rubricConfig: RubricConfig;
  results: ModelEvaluationResult[];
  metadata: {
    evaluationId: string;
    startTime: Date;
    endTime: Date;
    totalCost: number;
  };
}

// Combined Configuration Type
export interface EvaluationConfig {
  prompt: PromptConfig;
  rubric: RubricConfig;
  models: ModelsConfig;
} 