import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationRunner, EvaluationRunnerError } from './runner';
import { EvaluationConfig } from './types';
import type { LanguageModelV1 } from 'ai'; // Import LanguageModelV1

// Mock the getModelProvider function
vi.mock('../providers', () => ({
  getModelProvider: vi.fn((modelId: string) => {
    // Direct access models
    if (modelId === 'gemini-pro' || modelId === 'google/gemini-pro') { // Handle potential ID format
      return Promise.resolve({
        // Mock the doGenerate method expected by the AI SDK
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Test response from Gemini',
          usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
          // Add other relevant fields if needed by the runner's cost calculation mock
        }),
        // Add missing required properties for LanguageModelV1
        specificationVersion: 'v1',
        doStream: vi.fn(), // Basic mock for doStream
        // Include other necessary LanguageModelV1 properties if required by tests
        modelId: 'gemini-pro',
        provider: 'google',
        defaultObjectGenerationMode: 'json',
        // Remove unnecessary mock methods like calculateCost, listModels
      } as LanguageModelV1); // Cast to the correct type
    }
    if (modelId === 'gpt-4-turbo-preview' || modelId === 'openai/gpt-4-turbo-preview') { // Handle potential ID format
      return Promise.resolve({
        doGenerate: vi.fn().mockResolvedValue({
          text: 'SCORE: 8\nREASONING: Good analysis of themes and technical implementation',
          usage: { promptTokens: 25, completionTokens: 25, totalTokens: 50 },
        }),
        specificationVersion: 'v1',
        doStream: vi.fn(),
        modelId: 'gpt-4-turbo-preview',
        provider: 'openai',
        defaultObjectGenerationMode: 'json',
      } as LanguageModelV1);
    }
    // OpenRouter models
    if (modelId === 'openrouter/anthropic/claude-3-opus' || modelId === 'anthropic/claude-3-opus') { // Handle potential ID format
      return Promise.resolve({
        doGenerate: vi.fn().mockResolvedValue({
          text: 'Test response from Claude',
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        }),
        specificationVersion: 'v1',
        doStream: vi.fn(),
        modelId: 'openrouter/anthropic/claude-3-opus',
        provider: 'openrouter',
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
        title: 'Test Evaluation',
        question: 'Test question?',
        context: 'Test context',
        parameters: {
          max_tokens: 1000,
          temperature: 0.7,
          top_p: 0.95
        },
        metadata: {
          created: '2024-03-26',
          version: '1.0',
          description: 'Test description',
          expected_themes: ['theme1']
        }
      },
      rubric: {
        evaluation_prompt: 'Test evaluation prompt',
        scoring_criteria: {
          criterion1: {
            description: 'Test criterion 1',
            points: 5,
            key_aspects: ['aspect1']
          }
        },
        scoring_instructions: {
          method: 'Test method',
          scale: '0-10',
          minimum_pass: 6,
          excellent_threshold: 8
        },
        metadata: {
          created: '2024-03-26',
          version: '1.0',
          evaluator_model: 'gpt-4',
          notes: 'Test notes'
        }
      },
      models: {
        evaluator: {
          modelId: 'gpt-4-turbo-preview',
          parameters: {
            temperature: 0.3,
            max_tokens: 500,
            top_p: 0.95
          }
        },
        models: [
          {
            modelId: 'gemini-pro',
            description: 'Test model - Direct access',
            parameters: {
              temperature: 0.7,
              max_tokens: 1000,
              top_p: 0.95
            }
          },
          {
            modelId: 'openrouter/anthropic/claude-3-opus',
            description: 'Test model - OpenRouter access',
            parameters: {
              temperature: 0.7,
              max_tokens: 1000,
              top_p: 0.95
            }
          }
        ],
        metadata: {
          created: '2024-03-26',
          version: '1.0',
          notes: 'Test models',
          requirements: {
            GOOGLE_GENERATIVE_AI_API_KEY: 'Required for Google models',
            OPENROUTER_API_KEY: 'Required for OpenRouter models'
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
    expect(results.results[0].modelId).toBe('gemini-pro');
    expect(results.results[0].provider).toBe('google');
    expect(results.results[0].response).toBe('Test response from Gemini');
    expect(results.results[0].scores).toHaveLength(1);
    expect(results.results[0].scores[0].score).toBe(8);
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
    expect(results.results[0].scores).toHaveLength(1);
    expect(results.results[0].scores[0].score).toBe(8);
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