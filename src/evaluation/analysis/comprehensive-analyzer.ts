import { EvaluationResult } from '../types/index.js';
import { PerformanceAnalyzer, PerformanceAnalysis } from './performance-analyzer.js';
import { QualityAnalyzer, QualityAnalysis } from './quality-analyzer.js';

export interface ComprehensiveAnalysis {
  performance: PerformanceAnalysis;
  quality: QualityAnalysis;
  combined: {
    overallScore: number;
    efficiencyScore: number;
    costEffectiveness: number;
    recommendations: string[];
    priorityActions: string[];
  };
  summary: {
    totalEvaluations: number;
    totalResponses: number;
    averageQuality: number;
    averagePerformance: number;
    totalCost: number;
    bestModel: string;
    worstModel: string;
  };
}

export class ComprehensiveAnalyzer {
  private results: EvaluationResult[];
  private performanceAnalyzer: PerformanceAnalyzer;
  private qualityAnalyzer: QualityAnalyzer;

  constructor(results: EvaluationResult[]) {
    this.results = results;
    this.performanceAnalyzer = new PerformanceAnalyzer(results);
    this.qualityAnalyzer = new QualityAnalyzer(results);
  }

  analyze(): ComprehensiveAnalysis {
    const performance = this.performanceAnalyzer.analyze();
    const quality = this.qualityAnalyzer.analyze();
    const combined = this.calculateCombinedMetrics(performance, quality);
    const summary = this.generateSummary(performance, quality);

    return {
      performance,
      quality,
      combined,
      summary
    };
  }

  private calculateCombinedMetrics(
    performance: PerformanceAnalysis, 
    quality: QualityAnalysis
  ): ComprehensiveAnalysis['combined'] {
    // Calculate overall score (weighted combination of performance and quality)
    const performanceWeight = 0.4;
    const qualityWeight = 0.6;
    
    const performanceScore = this.normalizeScore(
      performance.overall.throughput * 0.3 + 
      (1 - performance.overall.errorRate) * 0.4 + 
      (1 - performance.overall.averageResponseTime / 30000) * 0.3
    );
    
    const qualityScore = quality.overall.overallQuality;
    
    const overallScore = (performanceScore * performanceWeight + qualityScore * qualityWeight) * 100;

    // Calculate efficiency score (quality per unit of time and cost)
    const efficiencyScore = this.calculateEfficiencyScore(performance, quality);

    // Calculate cost effectiveness (quality per dollar)
    const costEffectiveness = quality.overall.overallQuality / Math.max(performance.overall.totalCost, 0.001);

    // Generate combined recommendations
    const recommendations = this.generateCombinedRecommendations(performance, quality);
    
    // Identify priority actions
    const priorityActions = this.identifyPriorityActions(performance, quality);

    return {
      overallScore,
      efficiencyScore,
      costEffectiveness,
      recommendations,
      priorityActions
    };
  }

  private normalizeScore(score: number): number {
    return Math.max(0, Math.min(1, score));
  }

  private calculateEfficiencyScore(
    performance: PerformanceAnalysis, 
    quality: QualityAnalysis
  ): number {
    const qualityPerMinute = quality.overall.overallQuality / (performance.overall.averageResponseTime / 60000);
    const qualityPerDollar = quality.overall.overallQuality / Math.max(performance.overall.totalCost, 0.001);
    
    // Normalize and combine
    const normalizedTime = this.normalizeScore(qualityPerMinute * 10); // Scale factor
    const normalizedCost = this.normalizeScore(qualityPerDollar * 1000); // Scale factor
    
    return (normalizedTime + normalizedCost) / 2 * 100;
  }

  private generateCombinedRecommendations(
    performance: PerformanceAnalysis, 
    quality: QualityAnalysis
  ): string[] {
    const recommendations: string[] = [];

    // Performance-based recommendations
    if (performance.overall.averageResponseTime > 15000) {
      recommendations.push("🚀 Optimize response times by using faster models or parallel processing");
    }

    if (performance.overall.cacheHitRate < 0.3) {
      recommendations.push("💾 Implement aggressive caching to reduce costs and improve performance");
    }

    if (performance.overall.errorRate > 0.1) {
      recommendations.push("🔧 Improve error handling and model stability");
    }

    // Quality-based recommendations
    if (quality.overall.coherenceScore < 0.6) {
      recommendations.push("📝 Enhance prompt engineering to improve response coherence");
    }

    if (quality.overall.relevanceScore < 0.7) {
      recommendations.push("🎯 Refine prompts to increase relevance and accuracy");
    }

    if (quality.overall.creativityScore < 0.5) {
      recommendations.push("🎨 Encourage more creative responses with open-ended prompts");
    }

    // Combined recommendations
    const costPerQuality = performance.overall.totalCost / Math.max(quality.overall.overallQuality, 0.001);
    if (costPerQuality > 0.1) {
      recommendations.push("💰 Consider more cost-effective models for similar quality levels");
    }

    const qualityPerTime = quality.overall.overallQuality / (performance.overall.averageResponseTime / 1000);
    if (qualityPerTime < 0.01) {
      recommendations.push("⚡ Balance quality and speed - consider faster models with acceptable quality trade-offs");
    }

    return recommendations;
  }

  private identifyPriorityActions(
    performance: PerformanceAnalysis, 
    quality: QualityAnalysis
  ): string[] {
    const actions: string[] = [];

    // High priority issues
    if (performance.overall.errorRate > 0.2) {
      actions.push("🔴 URGENT: Fix high error rate - review model configurations and retry logic");
    }

    if (quality.overall.overallQuality < 0.3) {
      actions.push("🔴 URGENT: Improve response quality - review prompts and model selection");
    }

    if (performance.overall.totalCost > 1.0 && quality.overall.overallQuality < 0.7) {
      actions.push("🔴 URGENT: High cost with low quality - consider model replacement");
    }

    // Medium priority issues
    if (performance.overall.averageResponseTime > 20000) {
      actions.push("🟡 MEDIUM: Optimize response times for better user experience");
    }

    if (performance.overall.cacheHitRate < 0.2) {
      actions.push("🟡 MEDIUM: Implement caching to reduce costs");
    }

    if (quality.overall.coherenceScore < 0.5) {
      actions.push("🟡 MEDIUM: Improve response coherence and structure");
    }

    // Low priority optimizations
    if (performance.overall.throughput < 5) {
      actions.push("🟢 LOW: Consider parallel processing to increase throughput");
    }

    if (quality.overall.creativityScore < 0.4) {
      actions.push("🟢 LOW: Enhance creativity in responses");
    }

    return actions;
  }

  private generateSummary(
    performance: PerformanceAnalysis, 
    quality: QualityAnalysis
  ): ComprehensiveAnalysis['summary'] {
    const totalEvaluations = this.results.length;
    const totalResponses = this.results.length;
    const averageQuality = quality.overall.overallQuality * 100;
    const averagePerformance = this.calculateAveragePerformance(performance);
    const totalCost = performance.overall.totalCost;
    
    const { bestModel, worstModel } = this.identifyBestWorstModels(performance, quality);

    return {
      totalEvaluations,
      totalResponses,
      averageQuality,
      averagePerformance,
      totalCost,
      bestModel,
      worstModel
    };
  }

  private calculateAveragePerformance(performance: PerformanceAnalysis): number {
    const normalizedTime = 1 - (performance.overall.averageResponseTime / 30000);
    const normalizedThroughput = performance.overall.throughput / 10;
    const normalizedErrorRate = 1 - performance.overall.errorRate;
    
    return ((normalizedTime + normalizedThroughput + normalizedErrorRate) / 3) * 100;
  }

  private identifyBestWorstModels(
    performance: PerformanceAnalysis, 
    quality: QualityAnalysis
  ): { bestModel: string; worstModel: string } {
    let bestScore = -1;
    let worstScore = 1;
    let bestModel = 'N/A';
    let worstModel = 'N/A';

    for (const model of performance.byModel) {
      const modelKey = `${model.model}:${model.provider}`;
      const qualityMetrics = quality.byModel[modelKey];
      
      if (qualityMetrics) {
        const combinedScore = (
          model.metrics.throughput * 0.2 +
          (1 - model.metrics.errorRate) * 0.3 +
          qualityMetrics.overallQuality * 0.5
        );

        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestModel = model.model;
        }

        if (combinedScore < worstScore) {
          worstScore = combinedScore;
          worstModel = model.model;
        }
      }
    }

    return { bestModel, worstModel };
  }

  generateComprehensiveReport(): string {
    const analysis = this.analyze();
    
    let report = "# Comprehensive Analysis Report\n\n";
    
    // Executive Summary
    report += "## Executive Summary\n";
    report += `- **Overall Score**: ${analysis.combined.overallScore.toFixed(1)}/100\n`;
    report += `- **Efficiency Score**: ${analysis.combined.efficiencyScore.toFixed(1)}/100\n`;
    report += `- **Total Evaluations**: ${analysis.summary.totalEvaluations}\n`;
    report += `- **Total Responses**: ${analysis.summary.totalResponses}\n`;
    report += `- **Average Quality**: ${analysis.summary.averageQuality.toFixed(1)}%\n`;
    report += `- **Average Performance**: ${analysis.summary.averagePerformance.toFixed(1)}%\n`;
    report += `- **Total Cost**: $${analysis.summary.totalCost.toFixed(6)}\n`;
    report += `- **Best Model**: ${analysis.summary.bestModel}\n`;
    report += `- **Worst Model**: ${analysis.summary.worstModel}\n\n`;

    // Priority Actions
    if (analysis.combined.priorityActions.length > 0) {
      report += "## Priority Actions\n";
      analysis.combined.priorityActions.forEach(action => {
        report += `${action}\n`;
      });
      report += "\n";
    }

    // Key Recommendations
    if (analysis.combined.recommendations.length > 0) {
      report += "## Key Recommendations\n";
      analysis.combined.recommendations.forEach(rec => {
        report += `${rec}\n`;
      });
      report += "\n";
    }

    // Performance Analysis
    report += "## Performance Analysis\n";
    report += `- **Average Response Time**: ${analysis.performance.overall.averageResponseTime.toFixed(2)}ms\n`;
    report += `- **Throughput**: ${analysis.performance.overall.throughput.toFixed(2)} responses/min\n`;
    report += `- **Error Rate**: ${(analysis.performance.overall.errorRate * 100).toFixed(1)}%\n`;
    report += `- **Cache Hit Rate**: ${(analysis.performance.overall.cacheHitRate * 100).toFixed(1)}%\n`;
    report += `- **Cost per Token**: $${analysis.performance.overall.costPerToken.toFixed(8)}\n\n`;

    // Quality Analysis
    report += "## Quality Analysis\n";
    report += `- **Overall Quality**: ${(analysis.quality.overall.overallQuality * 100).toFixed(1)}%\n`;
    report += `- **Coherence**: ${(analysis.quality.overall.coherenceScore * 100).toFixed(1)}%\n`;
    report += `- **Relevance**: ${(analysis.quality.overall.relevanceScore * 100).toFixed(1)}%\n`;
    report += `- **Creativity**: ${(analysis.quality.overall.creativityScore * 100).toFixed(1)}%\n`;
    report += `- **Technical Accuracy**: ${(analysis.quality.overall.technicalAccuracy * 100).toFixed(1)}%\n\n`;

    // Model Comparison
    report += "## Model Comparison\n";
    for (const model of analysis.performance.byModel) {
      const modelKey = `${model.model}:${model.provider}`;
      const qualityMetrics = analysis.quality.byModel[modelKey];
      
      report += `### ${model.model} (${model.provider})\n`;
      report += `- **Performance Score**: ${this.calculateModelPerformanceScore(model).toFixed(1)}/100\n`;
      if (qualityMetrics) {
        report += `- **Quality Score**: ${(qualityMetrics.overallQuality * 100).toFixed(1)}%\n`;
      }
      report += `- **Response Time**: ${model.metrics.averageResponseTime.toFixed(2)}ms\n`;
      report += `- **Cost**: $${model.metrics.totalCost.toFixed(6)}\n`;
      report += `- **Error Rate**: ${(model.metrics.errorRate * 100).toFixed(1)}%\n\n`;
    }

    // Cost Analysis
    report += "## Cost Analysis\n";
    report += `- **Total Cost**: $${analysis.performance.costAnalysis.totalCost.toFixed(6)}\n`;
    report += `- **Cost by Model**:\n`;
    for (const [model, cost] of Object.entries(analysis.performance.costAnalysis.costPerModel)) {
      report += `  - ${model}: $${cost.toFixed(6)}\n`;
    }
    report += `- **Cost Efficiency (tokens per dollar)**:\n`;
    for (const [model, efficiency] of Object.entries(analysis.performance.costAnalysis.costEfficiency)) {
      report += `  - ${model}: ${efficiency.toFixed(0)} tokens/$\n`;
    }

    return report;
  }

  private calculateModelPerformanceScore(model: any): number {
    const timeScore = Math.max(0, 1 - (model.metrics.averageResponseTime / 30000));
    const throughputScore = Math.min(1, model.metrics.throughput / 10);
    const errorScore = 1 - model.metrics.errorRate;
    
    return ((timeScore + throughputScore + errorScore) / 3) * 100;
  }
}
