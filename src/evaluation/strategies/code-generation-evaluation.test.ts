import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CodeGenerationEvaluation } from './code-generation-evaluation.js';
import { EvaluationCache } from '../caching/cache-service.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { Interaction } from '../../interaction/interaction.js';

// Mock dependencies
vi.mock('../../interaction/interaction.js');
vi.mock('../caching/cache-service.js');
vi.mock('../typescript-code-extractor.js');
vi.mock('../docker-runner.js');
vi.mock('../code-scorer.js');

describe('CodeGenerationEvaluation', () => {
  let mockStimulus: Stimulus;
  let mockModels: ModelDetails[];
  let mockPrompt: string;
  let mockCache: EvaluationCache;
  let mockInteractionInstance: Interaction;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStimulus = new Stimulus({ 
      id: 'test-stimulus', 
      name: 'Test Stimulus',
      role: 'developer',
      objective: 'write code'
    });
    mockModels = [
      { name: 'model-a', provider: 'provider-x' },
      { name: 'model-b', provider: 'provider-y' },
    ];
    mockPrompt = 'Write a function that does something';

    // Mock EvaluationCache
    mockCache = new EvaluationCache('test-eval-id');
    vi.mocked(mockCache.getCachedModelResponse).mockImplementation(async (model, stimulusId, fetch) => {
      return fetch();
    });
    vi.mocked(mockCache.getCachedFile).mockImplementation(async (key, fetch) => {
      return fetch();
    });
    vi.mocked(mockCache.getCachedScore).mockImplementation(async (model, stimulusId, scoreType, fetch) => {
      return fetch();
    });
    vi.mocked(mockCache.getWorkdir).mockReturnValue('/test/workdir');

    // Mock Interaction
    mockInteractionInstance = new Interaction(mockModels[0], mockStimulus);
    vi.mocked(mockInteractionInstance.generateText).mockResolvedValue({
      content: 'function doSomething() { return "hello"; }',
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

    // Mock code extraction
    vi.mock('../typescript-code-extractor.js', () => ({
      extractTypeScriptCode: vi.fn().mockReturnValue('function doSomething() { return "hello"; }'),
      fixCommonTypeScriptErrors: vi.fn().mockReturnValue('function doSomething() { return "hello"; }'),
      ensureConsoleOutput: vi.fn().mockReturnValue('function doSomething() { return "hello"; }')
    }));

    // Mock Docker runner
    vi.mock('../docker-runner.js', () => ({
      DockerRunner: vi.fn().mockImplementation(() => ({
        runCode: vi.fn().mockResolvedValue({ success: true, output: 'hello', error: null })
      }))
    }));

    // Mock code scorer
    vi.mock('../code-scorer.js', () => ({
      CodeScorer: vi.fn().mockImplementation(() => ({
        scoreCode: vi.fn().mockResolvedValue({ overallScore: 0.8, details: {} })
      }))
    }));
  });

  it('should run evaluation with all features enabled', async () => {
    const evaluation = new CodeGenerationEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      {
        extractCode: true,
        runDocker: true,
        aiScoring: true,
        fixCommonErrors: true,
        ensureConsoleOutput: true,
        maxConcurrent: 2
      }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(mockModels.length);
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(mockModels.length + 1); // +1 for setup call
    expect(mockCache.getCachedModelResponse).toHaveBeenCalledTimes(mockModels.length);

    results.forEach((result, index) => {
      expect(result.model).toEqual(mockModels[index]);
      expect(result.response).toBeDefined();
      expect(result.extractedCode).toBeDefined();
      expect(result.dockerResult).toBeDefined();
      expect(result.codeScore).toBeDefined();
      expect(result.timing).toBeDefined();
      expect(result.timing!.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.timing!.extractionTime).toBeGreaterThanOrEqual(0);
      expect(result.timing!.dockerTime).toBeGreaterThanOrEqual(0);
      expect(result.timing!.scoringTime).toBeGreaterThanOrEqual(0);
    });
  });

  it('should run evaluation with minimal features', async () => {
    const evaluation = new CodeGenerationEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      {
        extractCode: false,
        runDocker: false,
        aiScoring: false,
        maxConcurrent: 1
      }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(mockModels.length);
    results.forEach(result => {
      expect(result.extractedCode).toBeUndefined();
      expect(result.dockerResult).toBeUndefined();
      expect(result.codeScore).toBeUndefined();
    });
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(mockInteractionInstance.generateText).mockRejectedValue(new Error('Model error'));

    const evaluation = new CodeGenerationEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(mockModels.length);
    results.forEach(result => {
      expect(result.metadata.error).toBeDefined();
      expect(result.metadata.error).toContain('Model error');
    });
  });

  it('should respect concurrency limits', async () => {
    const evaluation = new CodeGenerationEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache,
      { maxConcurrent: 1 }
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(mockModels.length);
    // With maxConcurrent: 1, models should be processed sequentially
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(mockModels.length + 1); // +1 for setup call
  });

  it('should use cached data when available', async () => {
    // Mock cache hits
    vi.mocked(mockCache.getCachedModelResponse).mockResolvedValue({
      content: 'cached function',
      metadata: {
        startTime: new Date(),
        endTime: new Date(),
        tokenUsage: { promptTokens: 5, completionTokens: 10 },
        provider: 'cached-provider',
        model: 'cached-model',
        cost: { total: 0.005, prompt: 0.002, completion: 0.003 },
      },
    });

    const evaluation = new CodeGenerationEvaluation(
      mockStimulus,
      mockModels,
      mockPrompt,
      mockCache
    );

    const results = await evaluation.run();

    expect(results).toHaveLength(mockModels.length);
    expect(vi.mocked(Interaction)).toHaveBeenCalledTimes(1); // Only setup call, no actual evaluations
    results.forEach(result => {
      expect(result.response.content).toBe('cached function');
    });
  });
});
