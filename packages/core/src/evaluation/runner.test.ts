import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EvaluationRunner } from './runner';
import { createOllamaProvider } from '../providers/ollama';
import { createOpenRouterProvider } from '../providers/openrouter';
import { EvaluationConfig } from './types';

const mockOllamaProvider = createOllamaProvider();

const mockConfig: EvaluationConfig = {
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
      expected_themes: ['theme1', 'theme2']
    }
  },
  rubric: {
    evaluation_prompt: 'Evaluate the response',
    scoring_criteria: {
      criterion1: {
        description: 'Criterion 1',
        points: 5,
        key_aspects: ['aspect1', 'aspect2']
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
      modelDetails: {
        name: 'gemma3:latest',
        provider: 'ollama'
      },
      parameters: {
        temperature: 0.7,
        top_p: 0.95,
        max_tokens: 1000
      }
    },
    models: [
      {
        modelDetails: {
          name: 'gemma3:latest',
          provider: 'ollama'
        },
        parameters: {
          temperature: 0.7,
          top_p: 0.95,
          max_tokens: 1000
        }
      }
    ]
  }
};

describe('EvaluationRunner', () => {
  let runner: EvaluationRunner;

  beforeEach(() => {
    runner = new EvaluationRunner();
  });

  it('should validate model access', async () => {
    await expect(runner.runEvaluation(mockConfig)).resolves.not.toThrow();
  });

  it('should run evaluation and return results', async () => {
    const results = await runner.runEvaluation(mockConfig);
    expect(results).toBeDefined();
    expect(results.results).toHaveLength(1);
  });

  it('should convert model parameters correctly', () => {
    const runner = new EvaluationRunner();
    const params = { temperature: 0.5, max_tokens: 500, top_p: 0.9 };
    const converted = runner['convertModelParameters'](params);
    expect(converted).toEqual({ temperature: 0.5, maxTokens: 500 });
  });

  it('should build prompt correctly', () => {
    const runner = new EvaluationRunner();
    const prompt = runner['buildPrompt'](mockConfig);
    expect(prompt).toBe('Test question?\n\nTest context');
  });

  it('should handle missing evaluator model error', async () => {
    const runner = new EvaluationRunner();
    const invalidConfig = { ...mockConfig, models: { ...mockConfig.models, evaluator: { modelDetails: { name: 'invalid-model', provider: 'unknown' }, parameters: { max_tokens: 1000, temperature: 0.7, top_p: 0.95 } } } };
    await expect(runner.runEvaluation(invalidConfig)).rejects.toThrow('One or more required models are not accessible');
  });
}); 