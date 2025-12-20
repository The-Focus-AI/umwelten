import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatrixEvaluation } from './matrix-evaluation.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { Interaction } from '../../interaction/interaction.js';

// Mock dependencies
vi.mock('../../interaction/interaction.js');
vi.mock('../caching/cache-service.js');

describe('MatrixEvaluation', () => {
  let mockStimulus: Stimulus;
  let mockModels: ModelDetails[];
  let mockPrompt: string;
  let mockCache: EvaluationCache;
  let mockInteractionInstance: Interaction;
  let mockDimensions: any[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockStimulus = new Stimulus({ 
      id: 'test-stimulus', 
      name: 'Test Stimulus',
      role: 'writer',
      objective: 'write content'
    });
    mockModels = [
      { name: 'model-a', provider: 'provider-x' },
      { name: 'model-b', provider: 'provider-y' },
    ];
    mockPrompt = 'Write a {genre} story with {tone} tone about {topic}';

    mockDimensions = [
      {
        name: 'genre',
        values: ['fantasy', 'sci-fi']
      },
      {
        name: 'tone',
        values: ['serious', 'humorous']
      }
    ];

    // Mock EvaluationCache
    mockCache = new EvaluationCache('test-eval-id');
    vi.mocked(mockCache.getCachedModelResponse).mockImplementation(async (model, stimulusId, fetch) => {
      return fetch();
    });
    vi.mocked(mockCache.getWorkdir).mockReturnValue('/test/workdir');

    // Mock Interaction
    mockInteractionInstance = {
      modelDetails: mockModels[0],
      stimulus: mockStimulus,
      generateText: vi.fn().mockResolvedValue({
        content: 'Generated story content',
        metadata: {
          startTime: new Date(),
          endTime: new Date(),
          tokenUsage: { promptTokens: 10, completionTokens: 20 },
          provider: 'mock-provider',
          model: 'mock-model',
          cost: { total: 0.01, prompt: 0.005, completion: 0.005 },
        },
      }),
      addMessage: vi.fn(),
      getMessages: vi.fn().mockReturnValue([]),
      getVercelTools: vi.fn().mockReturnValue({}),
    } as any;

    // Use a class for proper constructor mocking in Vitest 4
    vi.mocked(Interaction).mockImplementation(function(this: any, modelDetails: any, stimulus: any) {
      mockInteractionInstance.modelDetails = modelDetails;
      mockInteractionInstance.stimulus = stimulus;
      return mockInteractionInstance;
    } as any);
  });

  it('should generate all combinations correctly', () => {
    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { dimensions: mockDimensions }
    );

    const combinations = evaluation.getCombinations();
    expect(combinations).toHaveLength(4); // 2 genres × 2 tones

    const expectedCombinations = [
      { genre: 'fantasy', tone: 'serious' },
      { genre: 'fantasy', tone: 'humorous' },
      { genre: 'sci-fi', tone: 'serious' },
      { genre: 'sci-fi', tone: 'humorous' }
    ];

    expectedCombinations.forEach(expected => {
      expect(combinations).toContainEqual(expected);
    });
  });

  it('should calculate total combinations correctly', () => {
    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { dimensions: mockDimensions }
    );

    expect(evaluation.getTotalCombinations()).toBe(8); // 4 combinations × 2 models
  });

  it('should run evaluation for all combinations', async () => {
    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { dimensions: mockDimensions }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(8); // 4 combinations × 2 models
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(8); // 8 evaluations

    // Check that all combinations are covered
    const combinations = results.map(r => r.combination);
    const uniqueCombinations = new Set(combinations.map(c => JSON.stringify(c)));
    expect(uniqueCombinations.size).toBe(4); // Should have 4 unique combinations

    // Check that all models are covered
    const models = results.map(r => r.model);
    const uniqueModels = new Set(models.map(m => `${m.provider}:${m.name}`));
    expect(uniqueModels.size).toBe(2); // Should have 2 unique models
  });

  it('should apply combinations to prompts correctly', async () => {
    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { dimensions: mockDimensions }
    );

    const results = await evaluation.run();

    // Check that prompts were modified with combination values
    results.forEach(result => {
      expect(result.metadata.stimulusId).toBe('test-stimulus');
      expect(result.combination).toBeDefined();
      expect(result.combination.genre).toBeDefined();
      expect(result.combination.tone).toBeDefined();
    });
  });

  it('should handle progress callbacks', async () => {
    const progressCallback = vi.fn();
    
    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { 
        dimensions: mockDimensions,
        progressCallback
      }
    );

    await evaluation.run();

    expect(progressCallback).toHaveBeenCalledTimes(8); // Called for each evaluation
    expect(progressCallback).toHaveBeenCalledWith({
      completed: expect.any(Number),
      total: 8,
      currentModel: expect.any(String),
      currentCombination: expect.any(Object),
      percentage: expect.any(Number)
    });
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(mockInteractionInstance.generateText).mockRejectedValue(new Error('Model error'));

    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { dimensions: mockDimensions }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(8);
    results.forEach(result => {
      expect(result.metadata.error).toBeDefined();
      expect(result.metadata.error).toContain('Model error');
    });
  });

  it('should work with single dimension', () => {
    const singleDimension = [
      {
        name: 'style',
        values: ['formal', 'casual']
      }
    ];

    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { dimensions: singleDimension }
    );

    const combinations = evaluation.getCombinations();
    expect(combinations).toHaveLength(2);
    expect(combinations).toEqual([
      { style: 'formal' },
      { style: 'casual' }
    ]);
  });

  it('should work with empty dimensions', () => {
    const evaluation = new MatrixEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { dimensions: [] }
    );

    const combinations = evaluation.getCombinations();
    expect(combinations).toHaveLength(1);
    expect(combinations).toEqual([{}]);
  });
});
