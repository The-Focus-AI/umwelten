import { EvaluationResult, EvaluationMetadata } from '../types/evaluation-types.js';
import { ModelDetails } from '../../cognition/types.js';

export interface AnalysisMetrics {
  totalEvaluations: number;
  successfulEvaluations: number;
  failedEvaluations: number;
  successRate: number;
  averageDuration: number;
  averageTokens: number;
  totalCost: number;
  averageCost: number;
  cacheHitRate?: number;
  errorRate: number;
}

export interface ModelPerformance {
  model: ModelDetails;
  evaluations: number;
  successRate: number;
  averageDuration: number;
  averageTokens: number;
  totalCost: number;
  errors: string[];
}

export interface StimulusPerformance {
  stimulusId: string;
  evaluations: number;
  successRate: number;
  averageDuration: number;
  averageTokens: number;
  totalCost: number;
  models: ModelDetails[];
}

export interface EvaluationAnalysis {
  metrics: AnalysisMetrics;
  modelPerformance: ModelPerformance[];
  stimulusPerformance: StimulusPerformance[];
  errors: Array<{
    model: ModelDetails;
    stimulusId: string;
    error: string;
    timestamp: Date;
  }>;
  recommendations: string[];
}

export class ResultAnalyzer {
  analyze(results: EvaluationResult[]): EvaluationAnalysis {
    const metrics = this.calculateMetrics(results);
    const modelPerformance = this.analyzeModelPerformance(results);
    const stimulusPerformance = this.analyzeStimulusPerformance(results);
    const errors = this.extractErrors(results);
    const recommendations = this.generateRecommendations(metrics, modelPerformance, stimulusPerformance, errors);

    return {
      metrics,
      modelPerformance,
      stimulusPerformance,
      errors,
      recommendations
    };
  }

  private calculateMetrics(results: EvaluationResult[]): AnalysisMetrics {
    const total = results.length;
    const successful = results.filter(r => !r.metadata.error).length;
    const failed = results.filter(r => r.metadata.error).length;
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    const successfulResults = results.filter(r => !r.metadata.error);
    const averageDuration = successfulResults.length > 0 
      ? successfulResults.reduce((sum, r) => sum + r.metadata.duration, 0) / successfulResults.length 
      : 0;

    const averageTokens = successfulResults.length > 0
      ? successfulResults.reduce((sum, r) => sum + (r.response.metadata.tokenUsage.promptTokens + r.response.metadata.tokenUsage.completionTokens), 0) / successfulResults.length
      : 0;

    const totalCost = successfulResults.reduce((sum, r) => sum + (r.response.metadata.cost?.totalCost || 0), 0);
    const averageCost = successfulResults.length > 0 ? totalCost / successfulResults.length : 0;

    const errorRate = total > 0 ? (failed / total) * 100 : 0;

    return {
      totalEvaluations: total,
      successfulEvaluations: successful,
      failedEvaluations: failed,
      successRate,
      averageDuration,
      averageTokens,
      totalCost,
      averageCost,
      errorRate
    };
  }

  private analyzeModelPerformance(results: EvaluationResult[]): ModelPerformance[] {
    const modelGroups = this.groupByModel(results);
    
    return Object.entries(modelGroups).map(([modelKey, modelResults]) => {
      const model = modelResults[0].model;
      const total = modelResults.length;
      const successful = modelResults.filter(r => !r.metadata.error).length;
      const successRate = total > 0 ? (successful / total) * 100 : 0;

      const successfulResults = modelResults.filter(r => !r.metadata.error);
      const averageDuration = successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + r.metadata.duration, 0) / successfulResults.length
        : 0;

      const averageTokens = successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + (r.response.metadata.tokenUsage.promptTokens + r.response.metadata.tokenUsage.completionTokens), 0) / successfulResults.length
        : 0;

      const totalCost = successfulResults.reduce((sum, r) => sum + (r.response.metadata.cost?.totalCost || 0), 0);

      const errors = modelResults
        .filter(r => r.metadata.error)
        .map(r => r.metadata.error!);

      return {
        model,
        evaluations: total,
        successRate,
        averageDuration,
        averageTokens,
        totalCost,
        errors
      };
    });
  }

  private analyzeStimulusPerformance(results: EvaluationResult[]): StimulusPerformance[] {
    const stimulusGroups = this.groupByStimulus(results);
    
    return Object.entries(stimulusGroups).map(([stimulusId, stimulusResults]) => {
      const total = stimulusResults.length;
      const successful = stimulusResults.filter(r => !r.metadata.error).length;
      const successRate = total > 0 ? (successful / total) * 100 : 0;

      const successfulResults = stimulusResults.filter(r => !r.metadata.error);
      const averageDuration = successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + r.metadata.duration, 0) / successfulResults.length
        : 0;

      const averageTokens = successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + (r.response.metadata.tokenUsage.promptTokens + r.response.metadata.tokenUsage.completionTokens), 0) / successfulResults.length
        : 0;

      const totalCost = successfulResults.reduce((sum, r) => sum + (r.response.metadata.cost?.totalCost || 0), 0);

      const models = [...new Set(stimulusResults.map(r => r.model))];

      return {
        stimulusId,
        evaluations: total,
        successRate,
        averageDuration,
        averageTokens,
        totalCost,
        models
      };
    });
  }

  private extractErrors(results: EvaluationResult[]): Array<{
    model: ModelDetails;
    stimulusId: string;
    error: string;
    timestamp: Date;
  }> {
    return results
      .filter(r => r.metadata.error)
      .map(r => ({
        model: r.model,
        stimulusId: r.metadata.stimulusId,
        error: r.metadata.error!,
        timestamp: r.metadata.timestamp
      }));
  }

  private generateRecommendations(
    metrics: AnalysisMetrics,
    modelPerformance: ModelPerformance[],
    stimulusPerformance: StimulusPerformance[],
    errors: Array<{ model: ModelDetails; stimulusId: string; error: string; timestamp: Date }>
  ): string[] {
    const recommendations: string[] = [];

    // Success rate recommendations
    if (metrics.successRate < 80) {
      recommendations.push(`Low success rate (${metrics.successRate.toFixed(1)}%). Consider investigating common error patterns.`);
    }

    // Performance recommendations
    if (metrics.averageDuration > 5000) {
      recommendations.push(`High average duration (${(metrics.averageDuration / 1000).toFixed(1)}s). Consider optimizing prompts or using faster models.`);
    }

    // Cost recommendations
    if (metrics.totalCost > 1) {
      recommendations.push(`High total cost ($${metrics.totalCost.toFixed(2)}). Consider using more cost-effective models for simple tasks.`);
    }

    // Model-specific recommendations
    const underperformingModels = modelPerformance.filter(m => m.successRate < 50);
    if (underperformingModels.length > 0) {
      recommendations.push(`Models with low success rates: ${underperformingModels.map(m => m.model.name).join(', ')}. Consider removing or investigating these models.`);
    }

    // Error pattern recommendations
    const errorCounts = this.countErrors(errors);
    const commonErrors = Object.entries(errorCounts)
      .filter(([_, count]) => count > 1)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    if (commonErrors.length > 0) {
      recommendations.push(`Common errors: ${commonErrors.map(([error, count]) => `${error} (${count} times)`).join(', ')}. Consider addressing these issues.`);
    }

    // Stimulus-specific recommendations
    const underperformingStimuli = stimulusPerformance.filter(s => s.successRate < 50);
    if (underperformingStimuli.length > 0) {
      recommendations.push(`Stimuli with low success rates: ${underperformingStimuli.map(s => s.stimulusId).join(', ')}. Consider revising these stimuli.`);
    }

    return recommendations;
  }

  private groupByModel(results: EvaluationResult[]): Record<string, EvaluationResult[]> {
    return results.reduce((groups, result) => {
      const key = `${result.model.provider}:${result.model.name}`;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(result);
      return groups;
    }, {} as Record<string, EvaluationResult[]>);
  }

  private groupByStimulus(results: EvaluationResult[]): Record<string, EvaluationResult[]> {
    return results.reduce((groups, result) => {
      const key = result.metadata.stimulusId;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(result);
      return groups;
    }, {} as Record<string, EvaluationResult[]>);
  }

  private countErrors(errors: Array<{ model: ModelDetails; stimulusId: string; error: string; timestamp: Date }>): Record<string, number> {
    return errors.reduce((counts, error) => {
      counts[error.error] = (counts[error.error] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);
  }
}
