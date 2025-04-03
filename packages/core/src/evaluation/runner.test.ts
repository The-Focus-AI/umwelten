import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationRunner, EvaluationRunnerError } from './runner';
import { EvaluationConfig } from './types';
import type { ModelProvider } from '../models/models';

// Mock the getModelProvider function
vi.mock('../providers', () => ({
  getModelProvider: vi.fn((modelId: string) => {
    // Direct access models
    if (modelId === 'gemini-pro') {
      return Promise.resolve({
        modelId: 'gemini-pro',
        id: 'gemini-pro',
        provider: 'google',
        route: 'direct',
        capabilities: { streaming: true },
        execute: vi.fn().mockResolvedValue({
          content: 'Test response from Gemini',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { total: 100 },
            cost: 0.001,
            provider: 'google',
            model: 'gemini-pro'
          }
        }),
        calculateCost: vi.fn(),
        listModels: vi.fn()
      } as unknown as ModelProvider);
    }
    if (modelId === 'gpt-4-turbo-preview') {
      return Promise.resolve({
        modelId: 'gpt-4-turbo-preview',
        id: 'gpt-4-turbo-preview',
        provider: 'openai',
        route: 'direct',
        capabilities: { streaming: true },
        execute: vi.fn().mockResolvedValue({
          content: 'SCORE: 8\nREASONING: Good analysis of themes and technical implementation',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { total: 50 },
            cost: 0.002,
            provider: 'openai',
            model: 'gpt-4-turbo-preview'
          }
        }),
        calculateCost: vi.fn(),
        listModels: vi.fn()
      } as unknown as ModelProvider);
    }
    // OpenRouter models
    if (modelId === 'openrouter/anthropic/claude-3-opus') {
      return Promise.resolve({
        modelId: 'openrouter/anthropic/claude-3-opus',
        id: 'claude-3-opus',
        provider: 'openrouter',
        route: 'openrouter',
        capabilities: { streaming: true },
        execute: vi.fn().mockResolvedValue({
          content: 'Test response from Claude',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { total: 150 },
            cost: 0.003,
            provider: 'openrouter',
            model: 'claude-3-opus'
          }
        }),
        calculateCost: vi.fn(),
        listModels: vi.fn()
      } as unknown as ModelProvider);
    }
    return Promise.resolve(undefined);
  })
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
          provider: 'openai',
          route: 'direct',
          description: 'GPT-4 Turbo for evaluation',
          parameters: {
            temperature: 0.3,
            max_tokens: 500,
            top_p: 0.95
          }
        },
        models: [
          {
            modelId: 'gemini-pro',
            provider: 'google',
            route: 'direct',
            description: 'Test model - Direct access',
            parameters: {
              temperature: 0.7,
              max_tokens: 1000,
              top_p: 0.95
            }
          },
          {
            modelId: 'openrouter/anthropic/claude-3-opus',
            provider: 'anthropic',
            route: 'openrouter',
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
    expect(results.results[0].provider).toBe('anthropic');
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
    // 0.001 for Gemini + 0.003 for Claude + 0.002 for each evaluation = 0.008
    expect(results.metadata.totalCost).toBe(0.008);
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