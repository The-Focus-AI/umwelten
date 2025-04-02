import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EvaluationRunner, EvaluationRunnerError } from './runner';
import { EvaluationConfig } from './types';
import { ModelProvider } from '../models/models';

// Mock the getModelProvider function
vi.mock('../providers', () => ({
  getModelProvider: vi.fn((modelId: string) => {
    if (modelId === 'test-model-1') {
      return Promise.resolve({
        id: 'test-model-1',
        provider: 'google',
        execute: vi.fn().mockResolvedValue({
          content: 'Test response',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { total: 100 },
            cost: 0.001,
            provider: 'google',
            model: 'test-model-1'
          }
        })
      });
    }
    if (modelId === 'openai/gpt-4-turbo') {
      return Promise.resolve({
        id: 'gpt-4-turbo',
        provider: 'openrouter',
        execute: vi.fn().mockResolvedValue({
          content: 'SCORE: 8\nREASONING: Good analysis',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { total: 50 },
            cost: 0.002,
            provider: 'openrouter',
            model: 'gpt-4-turbo'
          }
        })
      });
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
        models: [
          {
            id: 'test-model-1',
            provider: 'google',
            description: 'Test model 1',
            parameters: {
              temperature: 0.7,
              top_p: 0.95,
              max_tokens: 1000
            }
          }
        ],
        metadata: {
          created: '2024-03-26',
          version: '1.0',
          notes: 'Test models',
          requirements: {
            google: 'TEST_API_KEY'
          }
        }
      }
    };
  });

  it('should run evaluation successfully', async () => {
    const results = await runner.runEvaluation(testConfig);

    expect(results).toBeDefined();
    expect(results.results).toHaveLength(1);
    expect(results.results[0].modelId).toBe('test-model-1');
    expect(results.results[0].response).toBe('Test response');
    expect(results.results[0].scores).toHaveLength(1);
    expect(results.results[0].scores[0].score).toBe(8);
  });

  it('should throw error for invalid model', async () => {
    testConfig.models.models[0].id = 'invalid-model';

    await expect(runner.runEvaluation(testConfig)).rejects.toThrow(
      EvaluationRunnerError
    );
  });

  it('should calculate total cost correctly', async () => {
    const results = await runner.runEvaluation(testConfig);

    expect(results.metadata.totalCost).toBe(0.003); // 0.001 for response + 0.002 for evaluation
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