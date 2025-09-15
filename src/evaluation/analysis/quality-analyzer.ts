import { EvaluationResult } from '../types/evaluation.js';
import { ModelResponse } from '../../cognition/types.js';

export interface QualityMetrics {
  averageLength: number;
  averageComplexity: number;
  coherenceScore: number;
  relevanceScore: number;
  creativityScore: number;
  technicalAccuracy: number;
  overallQuality: number;
}

export interface QualityAnalysis {
  overall: QualityMetrics;
  byModel: Record<string, QualityMetrics>;
  byTest: Record<string, QualityMetrics>;
  recommendations: string[];
  qualityTrends: {
    improving: string[];
    declining: string[];
    stable: string[];
  };
}

export class QualityAnalyzer {
  private results: EvaluationResult[];

  constructor(results: EvaluationResult[]) {
    this.results = results;
  }

  analyze(): QualityAnalysis {
    const overall = this.calculateOverallQuality();
    const byModel = this.calculateQualityByModel();
    const byTest = this.calculateQualityByTest();
    const recommendations = this.generateQualityRecommendations(overall, byModel);
    const qualityTrends = this.analyzeQualityTrends();

    return {
      overall,
      byModel,
      byTest,
      recommendations,
      qualityTrends
    };
  }

  private calculateOverallQuality(): QualityMetrics {
    const allResponses = this.results.flatMap(result => result.responses);
    
    if (allResponses.length === 0) {
      return this.getEmptyMetrics();
    }

    const averageLength = allResponses.reduce((sum, r) => sum + r.content.length, 0) / allResponses.length;
    const averageComplexity = this.calculateAverageComplexity(allResponses);
    const coherenceScore = this.calculateCoherenceScore(allResponses);
    const relevanceScore = this.calculateRelevanceScore(allResponses);
    const creativityScore = this.calculateCreativityScore(allResponses);
    const technicalAccuracy = this.calculateTechnicalAccuracy(allResponses);
    
    const overallQuality = (
      coherenceScore + 
      relevanceScore + 
      creativityScore + 
      technicalAccuracy
    ) / 4;

    return {
      averageLength,
      averageComplexity,
      coherenceScore,
      relevanceScore,
      creativityScore,
      technicalAccuracy,
      overallQuality
    };
  }

  private calculateQualityByModel(): Record<string, QualityMetrics> {
    const modelGroups = new Map<string, ModelResponse[]>();

    // Group responses by model
    for (const result of this.results) {
      for (const response of result.responses) {
        const key = `${response.metadata.model}:${response.metadata.provider}`;
        if (!modelGroups.has(key)) {
          modelGroups.set(key, []);
        }
        modelGroups.get(key)!.push(response);
      }
    }

    const qualityByModel: Record<string, QualityMetrics> = {};

    for (const [modelKey, responses] of modelGroups.entries()) {
      if (responses.length === 0) {
        qualityByModel[modelKey] = this.getEmptyMetrics();
        continue;
      }

      const averageLength = responses.reduce((sum, r) => sum + r.content.length, 0) / responses.length;
      const averageComplexity = this.calculateAverageComplexity(responses);
      const coherenceScore = this.calculateCoherenceScore(responses);
      const relevanceScore = this.calculateRelevanceScore(responses);
      const creativityScore = this.calculateCreativityScore(responses);
      const technicalAccuracy = this.calculateTechnicalAccuracy(responses);
      
      const overallQuality = (
        coherenceScore + 
        relevanceScore + 
        creativityScore + 
        technicalAccuracy
      ) / 4;

      qualityByModel[modelKey] = {
        averageLength,
        averageComplexity,
        coherenceScore,
        relevanceScore,
        creativityScore,
        technicalAccuracy,
        overallQuality
      };
    }

    return qualityByModel;
  }

  private calculateQualityByTest(): Record<string, QualityMetrics> {
    const testGroups = new Map<string, ModelResponse[]>();

    // Group responses by test case
    for (const result of this.results) {
      for (const response of result.responses) {
        const testId = response.metadata.testCaseId || 'unknown';
        if (!testGroups.has(testId)) {
          testGroups.set(testId, []);
        }
        testGroups.get(testId)!.push(response);
      }
    }

    const qualityByTest: Record<string, QualityMetrics> = {};

    for (const [testId, responses] of testGroups.entries()) {
      if (responses.length === 0) {
        qualityByTest[testId] = this.getEmptyMetrics();
        continue;
      }

      const averageLength = responses.reduce((sum, r) => sum + r.content.length, 0) / responses.length;
      const averageComplexity = this.calculateAverageComplexity(responses);
      const coherenceScore = this.calculateCoherenceScore(responses);
      const relevanceScore = this.calculateRelevanceScore(responses);
      const creativityScore = this.calculateCreativityScore(responses);
      const technicalAccuracy = this.calculateTechnicalAccuracy(responses);
      
      const overallQuality = (
        coherenceScore + 
        relevanceScore + 
        creativityScore + 
        technicalAccuracy
      ) / 4;

      qualityByTest[testId] = {
        averageLength,
        averageComplexity,
        coherenceScore,
        relevanceScore,
        creativityScore,
        technicalAccuracy,
        overallQuality
      };
    }

    return qualityByTest;
  }

  private calculateAverageComplexity(responses: ModelResponse[]): number {
    // Simple complexity metric based on sentence length and vocabulary diversity
    let totalComplexity = 0;
    
    for (const response of responses) {
      const sentences = response.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const avgSentenceLength = sentences.reduce((sum, s) => sum + s.split(' ').length, 0) / sentences.length;
      
      const words = response.content.toLowerCase().split(/\s+/);
      const uniqueWords = new Set(words);
      const vocabularyDiversity = uniqueWords.size / words.length;
      
      totalComplexity += (avgSentenceLength * 0.7 + vocabularyDiversity * 0.3);
    }
    
    return totalComplexity / responses.length;
  }

  private calculateCoherenceScore(responses: ModelResponse[]): number {
    // Simple coherence metric based on text structure and flow
    let totalCoherence = 0;
    
    for (const response of responses) {
      let coherence = 0.5; // Base score
      
      // Check for paragraph structure
      const paragraphs = response.content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      if (paragraphs.length > 1) coherence += 0.1;
      
      // Check for transition words
      const transitionWords = ['however', 'therefore', 'furthermore', 'moreover', 'additionally', 'consequently'];
      const hasTransitions = transitionWords.some(word => 
        response.content.toLowerCase().includes(word)
      );
      if (hasTransitions) coherence += 0.1;
      
      // Check for logical structure (intro, body, conclusion)
      const hasIntro = response.content.toLowerCase().includes('introduction') || 
                      response.content.toLowerCase().includes('overview');
      const hasConclusion = response.content.toLowerCase().includes('conclusion') || 
                           response.content.toLowerCase().includes('summary');
      if (hasIntro && hasConclusion) coherence += 0.2;
      
      // Check for repetition (penalty)
      const words = response.content.toLowerCase().split(/\s+/);
      const wordCounts = new Map<string, number>();
      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      }
      const maxRepetition = Math.max(...Array.from(wordCounts.values()));
      if (maxRepetition > words.length * 0.1) coherence -= 0.1;
      
      totalCoherence += Math.max(0, Math.min(1, coherence));
    }
    
    return totalCoherence / responses.length;
  }

  private calculateRelevanceScore(responses: ModelResponse[]): number {
    // Simple relevance metric based on keyword matching and topic consistency
    let totalRelevance = 0;
    
    for (const response of responses) {
      let relevance = 0.5; // Base score
      
      // Check for prompt keywords in response
      const prompt = response.metadata.prompt || '';
      const promptWords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const responseWords = response.content.toLowerCase().split(/\s+/);
      
      const keywordMatches = promptWords.filter(word => 
        responseWords.some(rw => rw.includes(word) || word.includes(rw))
      ).length;
      
      if (promptWords.length > 0) {
        relevance += (keywordMatches / promptWords.length) * 0.3;
      }
      
      // Check for topic consistency (simple heuristic)
      const sentences = response.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 1) {
        const firstSentenceWords = sentences[0].toLowerCase().split(/\s+/);
        const lastSentenceWords = sentences[sentences.length - 1].toLowerCase().split(/\s+/);
        const commonWords = firstSentenceWords.filter(w => lastSentenceWords.includes(w));
        if (commonWords.length > 0) relevance += 0.1;
      }
      
      totalRelevance += Math.max(0, Math.min(1, relevance));
    }
    
    return totalRelevance / responses.length;
  }

  private calculateCreativityScore(responses: ModelResponse[]): number {
    // Simple creativity metric based on vocabulary diversity and originality
    let totalCreativity = 0;
    
    for (const response of responses) {
      let creativity = 0.5; // Base score
      
      // Vocabulary diversity
      const words = response.content.toLowerCase().split(/\s+/);
      const uniqueWords = new Set(words);
      const vocabularyDiversity = uniqueWords.size / words.length;
      creativity += vocabularyDiversity * 0.2;
      
      // Use of creative language (metaphors, adjectives, etc.)
      const creativeWords = ['imagine', 'vivid', 'striking', 'remarkable', 'extraordinary', 'unique'];
      const hasCreativeLanguage = creativeWords.some(word => 
        response.content.toLowerCase().includes(word)
      );
      if (hasCreativeLanguage) creativity += 0.1;
      
      // Sentence variety
      const sentences = response.content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 1) {
        const sentenceLengths = sentences.map(s => s.split(' ').length);
        const lengthVariance = this.calculateVariance(sentenceLengths);
        creativity += Math.min(0.2, lengthVariance / 100);
      }
      
      totalCreativity += Math.max(0, Math.min(1, creativity));
    }
    
    return totalCreativity / responses.length;
  }

  private calculateTechnicalAccuracy(responses: ModelResponse[]): number {
    // Simple technical accuracy metric based on code quality and technical terms
    let totalAccuracy = 0;
    
    for (const response of responses) {
      let accuracy = 0.5; // Base score
      
      // Check for code quality indicators
      if (response.content.includes('function') || response.content.includes('def ')) {
        accuracy += 0.1;
      }
      
      if (response.content.includes('try:') || response.content.includes('catch')) {
        accuracy += 0.1; // Error handling
      }
      
      if (response.content.includes('//') || response.content.includes('#')) {
        accuracy += 0.1; // Comments
      }
      
      // Check for technical terminology
      const technicalTerms = ['algorithm', 'implementation', 'optimization', 'efficiency', 'complexity'];
      const hasTechnicalTerms = technicalTerms.some(term => 
        response.content.toLowerCase().includes(term)
      );
      if (hasTechnicalTerms) accuracy += 0.1;
      
      // Check for proper formatting
      if (response.content.includes('\n') && response.content.length > 100) {
        accuracy += 0.1; // Structured formatting
      }
      
      totalAccuracy += Math.max(0, Math.min(1, accuracy));
    }
    
    return totalAccuracy / responses.length;
  }

  private calculateVariance(numbers: number[]): number {
    const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / numbers.length;
  }

  private generateQualityRecommendations(
    overall: QualityMetrics, 
    byModel: Record<string, QualityMetrics>
  ): string[] {
    const recommendations: string[] = [];

    if (overall.coherenceScore < 0.6) {
      recommendations.push("Improve response coherence by using better prompts and providing more context");
    }

    if (overall.relevanceScore < 0.7) {
      recommendations.push("Enhance relevance by refining prompts and adding specific requirements");
    }

    if (overall.creativityScore < 0.5) {
      recommendations.push("Increase creativity by using more open-ended prompts and encouraging creative thinking");
    }

    if (overall.technicalAccuracy < 0.6) {
      recommendations.push("Improve technical accuracy by providing more detailed technical requirements");
    }

    // Model-specific recommendations
    for (const [model, metrics] of Object.entries(byModel)) {
      if (metrics.overallQuality < overall.overallQuality * 0.8) {
        recommendations.push(`Model ${model} shows lower quality - consider prompt optimization or model replacement`);
      }
    }

    return recommendations;
  }

  private analyzeQualityTrends(): QualityAnalysis['qualityTrends'] {
    // This is a simplified implementation
    // In a real system, you'd analyze quality over time
    return {
      improving: [],
      declining: [],
      stable: ['Overall quality is stable across evaluations']
    };
  }

  private getEmptyMetrics(): QualityMetrics {
    return {
      averageLength: 0,
      averageComplexity: 0,
      coherenceScore: 0,
      relevanceScore: 0,
      creativityScore: 0,
      technicalAccuracy: 0,
      overallQuality: 0
    };
  }

  generateReport(): string {
    const analysis = this.analyze();
    
    let report = "# Quality Analysis Report\n\n";
    
    // Overall quality
    report += "## Overall Quality\n";
    report += `- **Average Length**: ${analysis.overall.averageLength.toFixed(0)} characters\n`;
    report += `- **Average Complexity**: ${analysis.overall.averageComplexity.toFixed(2)}\n`;
    report += `- **Coherence Score**: ${(analysis.overall.coherenceScore * 100).toFixed(1)}%\n`;
    report += `- **Relevance Score**: ${(analysis.overall.relevanceScore * 100).toFixed(1)}%\n`;
    report += `- **Creativity Score**: ${(analysis.overall.creativityScore * 100).toFixed(1)}%\n`;
    report += `- **Technical Accuracy**: ${(analysis.overall.technicalAccuracy * 100).toFixed(1)}%\n`;
    report += `- **Overall Quality**: ${(analysis.overall.overallQuality * 100).toFixed(1)}%\n\n`;

    // Model comparison
    report += "## Quality by Model\n";
    for (const [model, metrics] of Object.entries(analysis.byModel)) {
      report += `### ${model}\n`;
      report += `- Overall Quality: ${(metrics.overallQuality * 100).toFixed(1)}%\n`;
      report += `- Coherence: ${(metrics.coherenceScore * 100).toFixed(1)}%\n`;
      report += `- Relevance: ${(metrics.relevanceScore * 100).toFixed(1)}%\n`;
      report += `- Creativity: ${(metrics.creativityScore * 100).toFixed(1)}%\n`;
      report += `- Technical Accuracy: ${(metrics.technicalAccuracy * 100).toFixed(1)}%\n\n`;
    }

    // Recommendations
    if (analysis.recommendations.length > 0) {
      report += "## Quality Recommendations\n";
      analysis.recommendations.forEach(rec => {
        report += `- ${rec}\n`;
      });
      report += "\n";
    }

    return report;
  }
}
