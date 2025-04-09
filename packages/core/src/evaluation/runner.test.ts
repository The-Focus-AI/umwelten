import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationRunner, EvaluationRunnerError } from './runner';
import { EvaluationConfig } from './types';
import type { LanguageModelV1 } from 'ai'; // Import LanguageModelV1

// Update the mock data to use models from the CLI output
vi.mock('../providers', () => ({
  getModelProvider: vi.fn((modelId: string) => {
    if (modelId === 'openrouter/quasar-alpha') {
      return Promise.resolve({
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Test response from Quasar Alpha',
          usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
        }),
        specificationVersion: 'v1',
        doStream: vi.fn(),
        modelId: 'openrouter/quasar-alpha',
        provider: 'openrouter',
        defaultObjectGenerationMode: 'json',
      } as LanguageModelV1);
    }
    if (modelId === 'google/gemini-2.5-pro-exp-03-25:free') {
      return Promise.resolve({
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Test response from Gemini 2.5 Pro',
          usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
        }),
        specificationVersion: 'v1',
        doStream: vi.fn(),
        modelId: 'google/gemini-2.5-pro-exp-03-25:free',
        provider: 'google',
        defaultObjectGenerationMode: 'json',
      } as LanguageModelV1);
    }
    return Promise.resolve(undefined);
  }),
}));

describe('EvaluationRunner', () => {
  let runner: EvaluationRunner;
  let testConfig: EvaluationConfig;

  beforeEach(() => {
    runner = new EvaluationRunner();
    testConfig = {
      prompt: {
        title: "Frankenstein Analysis",
        question: "What are the key themes and moral implications in Mary Shelley's Frankenstein regarding the relationship between creator and creation?",
        context: "Consider the dynamic between Victor Frankenstein and his creation, focusing on themes of responsibility, ambition, and the consequences of scientific advancement without ethical consideration.",
        parameters: {
          max_tokens: 1000,
          temperature: 0.7,
          top_p: 0.95
        },
        metadata: {
          created: "2024-03-26",
          version: "1.0",
          description: "Analysis of creator-creation relationship in Frankenstein",
          expected_themes: [
            "scientific responsibility",
            "hubris",
            "abandonment",
            "ethical boundaries"
          ]
        }
      },
      rubric: {
        evaluation_prompt: "Evaluate the response based on the following criteria, considering depth of analysis, textual evidence, and clarity of reasoning.",
        scoring_criteria: {
          thematic_analysis: {
            description: "Understanding and analysis of key themes",
            points: 10,
            key_aspects: [
              "identification of major themes",
              "depth of analysis",
              "connection between themes"
            ]
          },
          moral_implications: {
            description: "Analysis of moral and ethical implications",
            points: 10,
            key_aspects: [
              "ethical considerations",
              "responsibility discussion",
              "consequences analysis"
            ]
          }
        },
        scoring_instructions: {
          method: "Points-based scoring with detailed reasoning",
          scale: "0-10 per criterion",
          minimum_pass: 6,
          excellent_threshold: 8
        },
        metadata: {
          created: "2024-03-26",
          version: "1.0",
          evaluator_model: "gpt-4",
          notes: "Focus on depth of analysis and ethical understanding"
        }
      },
      models: {
        evaluator: {
          modelId: "google/gemini-2.5-pro-exp-03-25:free",
          provider: "google",
          route: "direct",
          description: "Gemini 2.5 Pro for evaluation"
        },
        models: [
          {
            modelId: "openrouter/quasar-alpha",
            provider: "openrouter",
            route: "openrouter",
            description: "Quasar Alpha model",
            parameters: {
              temperature: 0.7,
              max_tokens: 1000,
              top_p: 0.95
            }
          }
        ],
        metadata: {
          created: "2024-03-26",
          version: "1.0",
          notes: "Using Quasar Alpha for analysis",
          requirements: {
            google: "GOOGLE_GENERATIVE_AI_API_KEY",
            OPENAI_API_KEY: "Required for openai models",
            GOOGLE_GENERATIVE_AI_API_KEY: "Required for google models"
          }
        }
      }
    };
  });

  it('should run evaluation successfully with direct access model', async () => {
    // Use only the Gemini model for this test
    testConfig.models.models = [testConfig.models.models[0]];
    const results = await runner.runEvaluation(testConfig);

    expect(results).toBeDefined();
    expect(results.results).toHaveLength(1);
    expect(results.results[0].modelId).toBe('gemini-1.5-pro');
    expect(results.results[0].provider).toBe('google');
    expect(results.results[0].response).toBe('Test response from Gemini');
    expect(results.results[0].scores).toHaveLength(2);
    expect(results.results[0].scores[0].score).toBe(8);
    expect(results.results[0].scores[1].score).toBe(8);
  });

  it('should run evaluation successfully with OpenRouter model', async () => {
    // Use only the Claude model for this test
    testConfig.models.models = [testConfig.models.models[1]];
    const results = await runner.runEvaluation(testConfig);

    expect(results).toBeDefined();
    expect(results.results).toHaveLength(1);
    expect(results.results[0].modelId).toBe('openrouter/anthropic/claude-3-opus');
    expect(results.results[0].provider).toBe('openrouter'); // Provider comes from the mock response metadata now
    expect(results.results[0].response).toBe('Test response from Claude');
    expect(results.results[0].scores).toHaveLength(2);
    expect(results.results[0].scores[0].score).toBe(8);
    expect(results.results[0].scores[1].score).toBe(8);
  });

  it('should throw error for invalid model', async () => {
    testConfig.models.models[0].modelId = 'invalid-model';
    await expect(runner.runEvaluation(testConfig)).rejects.toThrow(
      EvaluationRunnerError
    );
  });

  it('should calculate total cost correctly for multiple models', async () => {
    const results = await runner.runEvaluation(testConfig);
    // Cost calculation relies on ModelDetails which are not mocked here.
    // The BaseModelRunner mock returns 0 cost. The evaluator cost is also 0 from the mock.
    expect(results.metadata.totalCost).toBe(0);
  });

  it('should include all required metadata', async () => {
    const results = await runner.runEvaluation(testConfig);

    expect(results.metadata.evaluationId).toBeDefined();
    expect(results.metadata.startTime).toBeInstanceOf(Date);
    expect(results.metadata.endTime).toBeInstanceOf(Date);
    expect(results.promptConfig).toEqual(testConfig.prompt);
    expect(results.rubricConfig).toEqual(testConfig.rubric);
  });
}); 