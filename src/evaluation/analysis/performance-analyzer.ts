import { EvaluationResult } from '../types/evaluation.js';
import { ModelResponse } from '../../cognition/types.js';

export interface PerformanceMetrics {
  averageResponseTime: number;
  totalTokens: number;
  totalCost: number;
  tokensPerSecond: number;
  costPerToken: number;
  cacheHitRate: number;
  errorRate: number;
  throughput: number; // responses per minute
}

export interface ModelPerformance {
  model: string;
  provider: string;
  metrics: PerformanceMetrics;
  responses: ModelResponse[];
}

export interface PerformanceAnalysis {
  overall: PerformanceMetrics;
  byModel: ModelPerformance[];
  recommendations: string[];
  bottlenecks: string[];
  costAnalysis: {
    totalCost: number;
    costPerModel: Record<string, number>;
    costEfficiency: Record<string, number>; // cost per quality unit
  };
}

export class PerformanceAnalyzer {
  private results: EvaluationResult[];

  constructor(results: EvaluationResult[]) {
    this.results = results;
  }

  analyze(): PerformanceAnalysis {
    const overall = this.calculateOverallMetrics();
    const byModel = this.calculateModelMetrics();
    const recommendations = this.generateRecommendations(overall, byModel);
    const bottlenecks = this.identifyBottlenecks(overall, byModel);
    const costAnalysis = this.analyzeCosts(byModel);

    return {
      overall,
      byModel,
      recommendations,
      bottlenecks,
      costAnalysis
    };
  }

  private calculateOverallMetrics(): PerformanceMetrics {
    const totalResponses = this.results.length;
    const totalTime = this.results.reduce((sum, result) => sum + (result.metadata.duration || 0), 0);
    const totalTokens = this.results.reduce((sum, result) => sum + (result.response.metadata?.tokenUsage?.total || 0), 0);
    const totalCost = this.results.reduce((sum, result) => sum + (result.response.metadata?.cost?.total || 0), 0);
    const totalCacheHits = this.results.reduce((sum, result) => sum + (result.metadata.cached ? 1 : 0), 0);
    const totalCacheRequests = totalResponses;

    const errorCount = this.results.reduce((sum, result) => {
      return sum + (result.metadata.error ? 1 : 0);
    }, 0);

    return {
      averageResponseTime: totalTime / totalResponses,
      totalTokens,
      totalCost,
      tokensPerSecond: totalTokens / (totalTime / 1000),
      costPerToken: totalCost / totalTokens,
      cacheHitRate: totalCacheRequests > 0 ? totalCacheHits / totalCacheRequests : 0,
      errorRate: totalResponses > 0 ? errorCount / totalResponses : 0,
      throughput: totalResponses / (totalTime / 60000) // responses per minute
    };
  }

  private calculateModelMetrics(): ModelPerformance[] {
    const modelGroups = new Map<string, { responses: ModelResponse[], model: string, provider: string }>();

    // Group responses by model
    for (const result of this.results) {
      const key = `${result.model.name}:${result.model.provider}`;
      if (!modelGroups.has(key)) {
        modelGroups.set(key, {
          responses: [],
          model: result.model.name,
          provider: result.model.provider
        });
      }
      modelGroups.get(key)!.responses.push(result.response);
    }

    // Calculate metrics for each model
    return Array.from(modelGroups.entries()).map(([key, data]) => {
      const responses = data.responses;
      const totalTime = responses.reduce((sum, r) => sum + (r.metadata.endTime - r.metadata.startTime), 0);
      const totalTokens = responses.reduce((sum, r) => sum + (r.metadata.tokenUsage?.total || 0), 0);
      const totalCost = responses.reduce((sum, r) => sum + (r.metadata.cost?.total || 0), 0);
      const errorCount = responses.filter(r => r.metadata.error).length;

      return {
        model: data.model,
        provider: data.provider,
        metrics: {
          averageResponseTime: totalTime / responses.length,
          totalTokens,
          totalCost,
          tokensPerSecond: totalTokens / (totalTime / 1000),
          costPerToken: totalCost / totalTokens,
          cacheHitRate: 0, // Would need cache data per model
          errorRate: errorCount / responses.length,
          throughput: responses.length / (totalTime / 60000)
        },
        responses
      };
    });
  }

  private generateRecommendations(overall: PerformanceMetrics, byModel: ModelPerformance[]): string[] {
    const recommendations: string[] = [];

    // Performance recommendations
    if (overall.averageResponseTime > 10000) {
      recommendations.push("Consider using faster models or optimizing prompts to reduce response time");
    }

    if (overall.cacheHitRate < 0.3) {
      recommendations.push("Enable caching to reduce redundant API calls and improve performance");
    }

    if (overall.errorRate > 0.1) {
      recommendations.push("High error rate detected - review model configurations and error handling");
    }

    // Cost recommendations
    if (overall.costPerToken > 0.0001) {
      recommendations.push("Consider using more cost-effective models for non-critical tasks");
    }

    // Model-specific recommendations
    const slowestModel = byModel.reduce((slowest, current) => 
      current.metrics.averageResponseTime > slowest.metrics.averageResponseTime ? current : slowest
    );

    if (slowestModel.metrics.averageResponseTime > overall.averageResponseTime * 1.5) {
      recommendations.push(`Model ${slowestModel.model} is significantly slower - consider alternatives`);
    }

    const mostExpensiveModel = byModel.reduce((expensive, current) =>
      current.metrics.costPerToken > expensive.metrics.costPerToken ? current : expensive
    );

    if (mostExpensiveModel.metrics.costPerToken > overall.costPerToken * 1.5) {
      recommendations.push(`Model ${mostExpensiveModel.model} is significantly more expensive - consider alternatives`);
    }

    return recommendations;
  }

  private identifyBottlenecks(overall: PerformanceMetrics, byModel: ModelPerformance[]): string[] {
    const bottlenecks: string[] = [];

    if (overall.averageResponseTime > 15000) {
      bottlenecks.push("Slow response times - consider model optimization or parallel processing");
    }

    if (overall.throughput < 10) {
      bottlenecks.push("Low throughput - consider batch processing or parallel execution");
    }

    if (overall.errorRate > 0.2) {
      bottlenecks.push("High error rate - review model stability and retry logic");
    }

    const slowModels = byModel.filter(m => m.metrics.averageResponseTime > overall.averageResponseTime * 2);
    if (slowModels.length > 0) {
      bottlenecks.push(`Slow models detected: ${slowModels.map(m => m.model).join(', ')}`);
    }

    return bottlenecks;
  }

  private analyzeCosts(byModel: ModelPerformance[]): PerformanceAnalysis['costAnalysis'] {
    const totalCost = byModel.reduce((sum, model) => sum + model.metrics.totalCost, 0);
    
    const costPerModel = byModel.reduce((acc, model) => {
      acc[model.model] = model.metrics.totalCost;
      return acc;
    }, {} as Record<string, number>);

    const costEfficiency = byModel.reduce((acc, model) => {
      // Simple efficiency metric: tokens per dollar
      acc[model.model] = model.metrics.totalTokens / model.metrics.totalCost;
      return acc;
    }, {} as Record<string, number>);

    return {
      totalCost,
      costPerModel,
      costEfficiency
    };
  }

  generateReport(): string {
    const analysis = this.analyze();
    
    let report = "# Performance Analysis Report\n\n";
    
    // Overall metrics
    report += "## Overall Performance\n";
    report += `- **Average Response Time**: ${analysis.overall.averageResponseTime.toFixed(2)}ms\n`;
    report += `- **Total Tokens**: ${analysis.overall.totalTokens.toLocaleString()}\n`;
    report += `- **Total Cost**: $${analysis.overall.totalCost.toFixed(6)}\n`;
    report += `- **Tokens per Second**: ${analysis.overall.tokensPerSecond.toFixed(2)}\n`;
    report += `- **Cost per Token**: $${analysis.overall.costPerToken.toFixed(8)}\n`;
    report += `- **Cache Hit Rate**: ${(analysis.overall.cacheHitRate * 100).toFixed(1)}%\n`;
    report += `- **Error Rate**: ${(analysis.overall.errorRate * 100).toFixed(1)}%\n`;
    report += `- **Throughput**: ${analysis.overall.throughput.toFixed(2)} responses/min\n\n`;

    // Model comparison
    report += "## Model Performance\n";
    for (const model of analysis.byModel) {
      report += `### ${model.model} (${model.provider})\n`;
      report += `- Response Time: ${model.metrics.averageResponseTime.toFixed(2)}ms\n`;
      report += `- Total Cost: $${model.metrics.totalCost.toFixed(6)}\n`;
      report += `- Cost per Token: $${model.metrics.costPerToken.toFixed(8)}\n`;
      report += `- Error Rate: ${(model.metrics.errorRate * 100).toFixed(1)}%\n\n`;
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      report += "## Recommendations\n";
      analysis.recommendations.forEach(rec => {
        report += `- ${rec}\n`;
      });
      report += "\n";
    }

    // Bottlenecks
    if (analysis.bottlenecks.length > 0) {
      report += "## Identified Bottlenecks\n";
      analysis.bottlenecks.forEach(bottleneck => {
        report += `- ${bottleneck}\n`;
      });
      report += "\n";
    }

    // Cost analysis
    report += "## Cost Analysis\n";
    report += `- **Total Cost**: $${analysis.costAnalysis.totalCost.toFixed(6)}\n`;
    report += "- **Cost by Model**:\n";
    for (const [model, cost] of Object.entries(analysis.costAnalysis.costPerModel)) {
      report += `  - ${model}: $${cost.toFixed(6)}\n`;
    }
    report += "- **Cost Efficiency (tokens per dollar)**:\n";
    for (const [model, efficiency] of Object.entries(analysis.costAnalysis.costEfficiency)) {
      report += `  - ${model}: ${efficiency.toFixed(0)} tokens/$\n`;
    }

    return report;
  }
}
