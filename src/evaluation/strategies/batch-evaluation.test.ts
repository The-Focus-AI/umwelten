import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchEvaluation } from './batch-evaluation.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { Interaction } from '../../interaction/interaction.js';

// Mock dependencies
vi.mock('../../interaction/interaction.js');
vi.mock('../caching/cache-service.js');

describe('BatchEvaluation', () => {
  let mockStimulus: Stimulus;
  let mockModels: ModelDetails[];
  let mockPrompt: string;
  let mockCache: EvaluationCache;
  let mockInteractionInstance: Interaction;
  let mockItems: any[];

  beforeEach(() => {
    vi.clearAllMocks();

    mockStimulus = new Stimulus({ 
      id: 'test-stimulus', 
      name: 'Test Stimulus',
      role: 'analyst',
      objective: 'analyze data'
    });
    mockModels = [
      { name: 'model-a', provider: 'provider-x' },
      { name: 'model-b', provider: 'provider-y' },
    ];
    mockPrompt = 'Analyze the following data: {content}';

    mockItems = [
      {
        id: 'item-1',
        content: 'Data item 1',
        metadata: { type: 'sales' }
      },
      {
        id: 'item-2',
        content: 'Data item 2',
        metadata: { type: 'marketing' }
      }
    ];

    // Mock EvaluationCache
    mockCache = new EvaluationCache('test-eval-id');
    vi.mocked(mockCache.getCachedModelResponse).mockImplementation(async (model, stimulusId, fetch) => {
      return fetch();
    });
    vi.mocked(mockCache.getWorkdir).mockReturnValue('/test/workdir');

    // Mock Interaction
    mockInteractionInstance = new Interaction(mockModels[0], mockStimulus);
    vi.mocked(mockInteractionInstance.generateText).mockResolvedValue({
      content: 'Analysis result',
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        tokenUsage: { promptTokens: 10, completionTokens: 20 },
        provider: 'mock-provider',
        model: 'mock-model',
        cost: { total: 0.01, prompt: 0.005, completion: 0.005 },
      },
    });
    vi.mocked(Interaction).mockImplementation((modelDetails, stimulus) => {
      mockInteractionInstance.modelDetails = modelDetails;
      mockInteractionInstance.stimulus = stimulus;
      return mockInteractionInstance;
    });
  });

  it('should run evaluation for all item-model combinations', async () => {
    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { items: mockItems }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(4); // 2 items × 2 models
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(5); // 4 evaluations + 1 setup call

    // Check that all items are covered
    const itemIds = results.map(r => r.item.id);
    const uniqueItemIds = new Set(itemIds);
    expect(uniqueItemIds.size).toBe(2); // Should have 2 unique items

    // Check that all models are covered
    const models = results.map(r => r.model);
    const uniqueModels = new Set(models.map(m => `${m.provider}:${m.name}`));
    expect(uniqueModels.size).toBe(2); // Should have 2 unique models
  });

  it('should apply items to prompts correctly', async () => {
    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { items: mockItems }
    );

    const results = await evaluation.run();

    results.forEach(result => {
      expect(result.item).toBeDefined();
      expect(result.item.id).toBeDefined();
      expect(result.item.content).toBeDefined();
      expect(result.itemIndex).toBeGreaterThanOrEqual(0);
      expect(result.itemIndex).toBeLessThan(mockItems.length);
    });
  });

  it('should handle progress callbacks', async () => {
    const progressCallback = vi.fn();
    
    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { 
        items: mockItems,
        progressCallback
      }
    );

    await evaluation.run();

    expect(progressCallback).toHaveBeenCalledTimes(4); // Called for each evaluation
    expect(progressCallback).toHaveBeenCalledWith({
      completed: expect.any(Number),
      total: 4,
      currentModel: expect.any(String),
      currentItem: expect.any(String),
      percentage: expect.any(Number)
    });
  });

  it('should handle groupByModel option', async () => {
    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { 
        items: mockItems,
        groupByModel: true
      }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(4); // 2 items × 2 models
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(5); // 4 evaluations + 1 setup call
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(mockInteractionInstance.generateText).mockRejectedValue(new Error('Model error'));

    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { items: mockItems }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(4);
    results.forEach(result => {
      expect(result.metadata.error).toBeDefined();
      expect(result.metadata.error).toContain('Model error');
    });
  });

  it('should get items and total counts correctly', () => {
    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { items: mockItems }
    );

    expect(evaluation.getItems()).toEqual(mockItems);
    expect(evaluation.getTotalItems()).toBe(2);
    expect(evaluation.getTotalEvaluations()).toBe(4); // 2 items × 2 models
  });

  it('should work with single item', async () => {
    const singleItem = [mockItems[0]];

    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { items: singleItem }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(2); // 1 item × 2 models
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(3); // 2 evaluations + 1 setup call
  });

  it('should work with single model', async () => {
    const singleModel = [mockModels[0]];

    const evaluation = new BatchEvaluation(
      mockStimulus,
      singleModel,
      mockPrompt,
      mockCache,
      { items: mockItems }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(2); // 2 items × 1 model
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(3); // 2 evaluations + 1 setup call
  });

  it('should work with empty items', async () => {
    const evaluation = new BatchEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { items: [] }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(0);
    // Note: Interaction might be called during setup, so we just check results length
  });

  it('should replace placeholders in prompts correctly', async () => {
    const itemsWithMetadata = [
      {
        id: 'item-1',
        content: 'Sales data',
        metadata: { quarter: 'Q1', year: 2024 }
      }
    ];

    const promptWithPlaceholders = 'Analyze {content} for {quarter} {year}';
    
    const evaluation = new BatchEvaluation(
      mockStimulus,
      [mockModels[0]],
      promptWithPlaceholders,
      mockCache,
      { items: itemsWithMetadata }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(1);
    expect(results[0].item).toEqual(itemsWithMetadata[0]);
  });
});
