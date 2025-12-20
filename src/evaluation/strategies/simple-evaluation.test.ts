import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SimpleEvaluation } from './simple-evaluation.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { EvaluationConfig, EvaluationProgress } from '../types/evaluation-types.js';
import { Interaction } from '../../interaction/interaction.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Mock the Interaction module at the top level
vi.mock('../../interaction/interaction.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Shared mock for Interaction - reset in beforeEach
let mockInteraction: {
  addMessage: ReturnType<typeof vi.fn>;
  generateText: ReturnType<typeof vi.fn>;
};

describe('SimpleEvaluation', () => {
  let evaluation: SimpleEvaluation;
  let cache: EvaluationCache;
  let stimulus: Stimulus;
  let models: ModelDetails[];
  let testDir: string;
  let progressCallback: vi.MockedFunction<(progress: EvaluationProgress) => void>;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create a unique test directory for each test
    testDir = path.join(__dirname, '..', '..', '..', 'test-output', `simple-eval-test-${Date.now()}`);

    // Create test stimulus
    stimulus = new Stimulus({
      id: 'test-stimulus',
      name: 'Test Stimulus',
      description: 'Test stimulus for unit testing',
      role: 'test assistant',
      objective: 'complete test tasks',
      temperature: 0.5,
      maxTokens: 100,
      runnerType: 'base'
    });

    // Create test models
    models = [
      {
        name: 'test-model-1',
        provider: 'test-provider',
        contextLength: 4096,
        costs: { promptTokens: 0.001, completionTokens: 0.002 },
      },
      {
        name: 'test-model-2',
        provider: 'test-provider',
        contextLength: 4096,
        costs: { promptTokens: 0.001, completionTokens: 0.002 },
      },
    ];

    // Create cache
    cache = new EvaluationCache('test-evaluation', {
      baseDir: testDir,
      verbose: false,
    });

    // Create progress callback mock
    progressCallback = vi.fn();

    // Setup Interaction mock - shared across tests
    mockInteraction = {
      addMessage: vi.fn(),
      generateText: vi.fn().mockResolvedValue({
        content: 'Test response',
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          tokenUsage: { promptTokens: 10, completionTokens: 20 },
          provider: 'test-provider',
          model: 'test-model',
          cost: { promptTokens: 0.01, completionTokens: 0.02, total: 0.03 },
        },
      }),
    };

    vi.mocked(Interaction).mockImplementation(function(this: any, modelDetails: any, stimulus: any) {
      return mockInteraction as any;
    } as any);

    // Create evaluation
    evaluation = new SimpleEvaluation(
      stimulus,
      models,
      'Test prompt',
      cache,
      {
        evaluationId: 'test-evaluation',
        useCache: true,
        concurrent: false,
        showProgress: true,
      },
      progressCallback
    );
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create evaluation with required parameters', () => {
      expect(evaluation).toBeDefined();
    });

    it('should create evaluation with default config', () => {
      const defaultEvaluation = new SimpleEvaluation(
        stimulus,
        models,
        'Test prompt',
        cache
      );
      expect(defaultEvaluation).toBeDefined();
    });
  });

  describe('run', () => {
    it('should run evaluation for all models sequentially', async () => {
      const results = await evaluation.run();

      expect(results).toHaveLength(2);
      expect(results[0].model.name).toBe('test-model-1');
      expect(results[1].model.name).toBe('test-model-2');
      expect(results[0].response.content).toBe('Test response');
      expect(results[1].response.content).toBe('Test response');
    });

    it('should run evaluation concurrently when configured', async () => {
      const concurrentEvaluation = new SimpleEvaluation(
        stimulus,
        models,
        'Test prompt',
        cache,
        {
          evaluationId: 'test-evaluation',
          useCache: true,
          concurrent: true,
          maxConcurrency: 2,
          showProgress: true,
        },
        progressCallback
      );

      const results = await concurrentEvaluation.run();

      expect(results).toHaveLength(2);
      expect(mockInteraction.addMessage).toHaveBeenCalledTimes(2);
      expect(mockInteraction.generateText).toHaveBeenCalledTimes(2);
    });

    it('should handle model errors gracefully', async () => {
      // Reset mock to throw an error
      mockInteraction.generateText.mockRejectedValue(new Error('Model error'));

      const results = await evaluation.run();

      expect(results).toHaveLength(2);
      expect(results[0].metadata.error).toBe('Model error');
      expect(results[1].metadata.error).toBe('Model error');
      expect(results[0].response.content).toBe('');
      expect(results[1].response.content).toBe('');
    });

    it('should call progress callback for each model', async () => {
      await evaluation.run();

      // Check that progress callback was called for each model
      expect(progressCallback).toHaveBeenCalledWith({
        modelName: 'test-provider:test-model-1',
        status: 'starting',
      });
      expect(progressCallback).toHaveBeenCalledWith({
        modelName: 'test-provider:test-model-1',
        status: 'completed',
        content: 'Test response',
        metadata: expect.any(Object),
      });
      expect(progressCallback).toHaveBeenCalledWith({
        modelName: 'test-provider:test-model-2',
        status: 'starting',
      });
      expect(progressCallback).toHaveBeenCalledWith({
        modelName: 'test-provider:test-model-2',
        status: 'completed',
        content: 'Test response',
        metadata: expect.any(Object),
      });
    });

    it('should not call progress callback when showProgress is false', async () => {
      const noProgressEvaluation = new SimpleEvaluation(
        stimulus,
        models,
        'Test prompt',
        cache,
        {
          evaluationId: 'test-evaluation',
          useCache: true,
          concurrent: false,
          showProgress: false,
        },
        progressCallback
      );

      await noProgressEvaluation.run();

      expect(progressCallback).not.toHaveBeenCalled();
    });

    it('should use caching when enabled', async () => {
      // First run
      await evaluation.run();
      expect(mockInteraction.generateText).toHaveBeenCalledTimes(2);

      // Second run should use cache
      await evaluation.run();
      expect(mockInteraction.generateText).toHaveBeenCalledTimes(2); // Should not be called again
    });

    it('should not use caching when disabled', async () => {
      const noCacheEvaluation = new SimpleEvaluation(
        stimulus,
        models,
        'Test prompt',
        cache,
        {
          evaluationId: 'test-evaluation',
          useCache: false,
          concurrent: false,
          showProgress: false,
        }
      );

      // First run
      await noCacheEvaluation.run();
      expect(mockInteraction.generateText).toHaveBeenCalledTimes(2);

      // Second run should not use cache
      await noCacheEvaluation.run();
      expect(mockInteraction.generateText).toHaveBeenCalledTimes(4); // Should be called again
    });
  });

  describe('result structure', () => {
    it('should return properly structured results', async () => {
      const results = await evaluation.run();

      expect(results).toHaveLength(2);

      results.forEach((result, index) => {
        expect(result).toHaveProperty('model');
        expect(result).toHaveProperty('response');
        expect(result).toHaveProperty('metadata');

        expect(result.model).toEqual(models[index]);
        expect(result.response).toHaveProperty('content');
        expect(result.response).toHaveProperty('metadata');

        expect(result.metadata).toHaveProperty('stimulusId');
        expect(result.metadata).toHaveProperty('evaluationId');
        expect(result.metadata).toHaveProperty('timestamp');
        expect(result.metadata).toHaveProperty('duration');
        expect(result.metadata).toHaveProperty('cached');
        expect(result.metadata).toHaveProperty('strategy');

        expect(result.metadata.stimulusId).toBe('test-assistant-complete-test-tasks');
        expect(result.metadata.evaluationId).toBe('test-evaluation');
        expect(result.metadata.strategy).toBe('SimpleEvaluation');
        expect(typeof result.metadata.duration).toBe('number');
        expect(typeof result.metadata.cached).toBe('boolean');
      });
    });
  });
});
