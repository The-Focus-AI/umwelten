import { describe, it, expect, beforeEach } from 'vitest';
import { ResultAnalyzer } from './result-analyzer.js';
import { EvaluationResult, EvaluationMetadata } from '../types/evaluation-types.js';
import { ModelDetails } from '../../cognition/types.js';

describe('ResultAnalyzer', () => {
  let analyzer: ResultAnalyzer;
  let mockResults: EvaluationResult[];

  beforeEach(() => {
    analyzer = new ResultAnalyzer();
    
    mockResults = [
      {
        model: { name: 'model-a', provider: 'provider-x' },
        response: {
          content: 'Response 1',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { promptTokens: 10, completionTokens: 20 },
            provider: 'provider-x',
            model: 'model-a',
            cost: { total: 0.01, prompt: 0.005, completion: 0.005 }
          }
        },
        metadata: {
          stimulusId: 'stimulus-1',
          evaluationId: 'eval-1',
          timestamp: new Date(),
          duration: 1000,
          cached: false
        }
      },
      {
        model: { name: 'model-b', provider: 'provider-y' },
        response: {
          content: 'Response 2',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { promptTokens: 15, completionTokens: 25 },
            provider: 'provider-y',
            model: 'model-b',
            cost: { total: 0.02, prompt: 0.01, completion: 0.01 }
          }
        },
        metadata: {
          stimulusId: 'stimulus-1',
          evaluationId: 'eval-1',
          timestamp: new Date(),
          duration: 2000,
          cached: false
        }
      },
      {
        model: { name: 'model-a', provider: 'provider-x' },
        response: {
          content: '',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { promptTokens: 0, completionTokens: 0 },
            provider: 'provider-x',
            model: 'model-a',
            cost: { total: 0, prompt: 0, completion: 0 }
          }
        },
        metadata: {
          stimulusId: 'stimulus-2',
          evaluationId: 'eval-1',
          timestamp: new Date(),
          duration: 500,
          cached: false,
          error: 'Model error'
        }
      }
    ];
  });

  it('should calculate metrics correctly', () => {
    const analysis = analyzer.analyze(mockResults);

    expect(analysis.metrics.totalEvaluations).toBe(3);
    expect(analysis.metrics.successfulEvaluations).toBe(2);
    expect(analysis.metrics.failedEvaluations).toBe(1);
    expect(analysis.metrics.successRate).toBeCloseTo(66.67, 1);
    expect(analysis.metrics.averageDuration).toBe(1500); // (1000 + 2000) / 2
    expect(analysis.metrics.averageTokens).toBe(35); // (30 + 40) / 2
    expect(analysis.metrics.totalCost).toBe(0.03); // 0.01 + 0.02
    expect(analysis.metrics.averageCost).toBe(0.015); // 0.03 / 2
    expect(analysis.metrics.errorRate).toBeCloseTo(33.33, 1);
  });

  it('should analyze model performance correctly', () => {
    const analysis = analyzer.analyze(mockResults);

    expect(analysis.modelPerformance).toHaveLength(2);

    const modelA = analysis.modelPerformance.find(m => m.model.name === 'model-a');
    expect(modelA).toBeDefined();
    expect(modelA!.evaluations).toBe(2);
    expect(modelA!.successRate).toBe(50); // 1 success out of 2
    expect(modelA!.averageDuration).toBe(1000); // Only successful evaluations: 1000
    expect(modelA!.totalCost).toBe(0.01);
    expect(modelA!.errors).toHaveLength(1);
    expect(modelA!.errors[0]).toBe('Model error');

    const modelB = analysis.modelPerformance.find(m => m.model.name === 'model-b');
    expect(modelB).toBeDefined();
    expect(modelB!.evaluations).toBe(1);
    expect(modelB!.successRate).toBe(100);
    expect(modelB!.averageDuration).toBe(2000);
    expect(modelB!.totalCost).toBe(0.02);
    expect(modelB!.errors).toHaveLength(0);
  });

  it('should analyze stimulus performance correctly', () => {
    const analysis = analyzer.analyze(mockResults);

    expect(analysis.stimulusPerformance).toHaveLength(2);

    const stimulus1 = analysis.stimulusPerformance.find(s => s.stimulusId === 'stimulus-1');
    expect(stimulus1).toBeDefined();
    expect(stimulus1!.evaluations).toBe(2);
    expect(stimulus1!.successRate).toBe(100);
    expect(stimulus1!.averageDuration).toBe(1500);
    expect(stimulus1!.totalCost).toBe(0.03);
    expect(stimulus1!.models).toHaveLength(2);

    const stimulus2 = analysis.stimulusPerformance.find(s => s.stimulusId === 'stimulus-2');
    expect(stimulus2).toBeDefined();
    expect(stimulus2!.evaluations).toBe(1);
    expect(stimulus2!.successRate).toBe(0);
    expect(stimulus2!.averageDuration).toBe(0); // No successful evaluations
    expect(stimulus2!.totalCost).toBe(0);
    expect(stimulus2!.models).toHaveLength(1);
  });

  it('should extract errors correctly', () => {
    const analysis = analyzer.analyze(mockResults);

    expect(analysis.errors).toHaveLength(1);
    expect(analysis.errors[0].model.name).toBe('model-a');
    expect(analysis.errors[0].stimulusId).toBe('stimulus-2');
    expect(analysis.errors[0].error).toBe('Model error');
    expect(analysis.errors[0].timestamp).toBeInstanceOf(Date);
  });

  it('should generate recommendations for low success rate', () => {
    const analysis = analyzer.analyze(mockResults);

    expect(analysis.recommendations.some(rec => rec.includes('Low success rate'))).toBe(true);
  });

  it('should generate recommendations for common errors', () => {
    // Create test data with multiple identical errors
    const commonErrorResults = [
      ...mockResults,
      {
        model: { name: 'model-c', provider: 'provider-z' },
        response: {
          content: '',
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            tokenUsage: { promptTokens: 0, completionTokens: 0 },
            provider: 'provider-z',
            model: 'model-c',
            cost: { total: 0, prompt: 0, completion: 0 }
          }
        },
        metadata: {
          stimulusId: 'stimulus-3',
          evaluationId: 'eval-1',
          timestamp: new Date(),
          duration: 500,
          cached: false,
          error: 'Model error' // Same error as the existing one
        }
      }
    ];

    const analysis = analyzer.analyze(commonErrorResults);

    expect(analysis.recommendations.some(rec => rec.includes('Common errors'))).toBe(true);
  });

  it('should handle empty results', () => {
    const analysis = analyzer.analyze([]);

    expect(analysis.metrics.totalEvaluations).toBe(0);
    expect(analysis.metrics.successRate).toBe(0);
    expect(analysis.metrics.averageDuration).toBe(0);
    expect(analysis.metrics.totalCost).toBe(0);
    expect(analysis.modelPerformance).toHaveLength(0);
    expect(analysis.stimulusPerformance).toHaveLength(0);
    expect(analysis.errors).toHaveLength(0);
    expect(analysis.recommendations.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle all successful results', () => {
    const successfulResults = mockResults.filter(r => !r.metadata.error);
    const analysis = analyzer.analyze(successfulResults);

    expect(analysis.metrics.successRate).toBe(100);
    expect(analysis.metrics.errorRate).toBe(0);
    expect(analysis.errors).toHaveLength(0);
    expect(analysis.recommendations).not.toContain(
      expect.stringContaining('Low success rate')
    );
  });

  it('should handle high cost scenarios', () => {
    const highCostResults = mockResults.map(r => ({
      ...r,
      response: {
        ...r.response,
        metadata: {
          ...r.response.metadata,
          cost: { total: 2, prompt: 1, completion: 1 }
        }
      }
    }));

    const analysis = analyzer.analyze(highCostResults);

    expect(analysis.recommendations.some(rec => rec.includes('High total cost'))).toBe(true);
  });

  it('should handle high duration scenarios', () => {
    const slowResults = mockResults.map(r => ({
      ...r,
      metadata: {
        ...r.metadata,
        duration: 10000 // 10 seconds
      }
    }));

    const analysis = analyzer.analyze(slowResults);

    expect(analysis.recommendations.some(rec => rec.includes('High average duration'))).toBe(true);
  });
});
