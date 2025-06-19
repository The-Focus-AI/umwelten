import { EvaluationScorer } from './scorer.js';
import { ModelResponse, ScoreResponse } from '../models/types.js';
import fs from 'fs';
import path from 'path';

/**
 * StructuredFeatureScorer: Standardized scorer for structured feature extraction tasks.
 * - Loads ground truth for each image
 * - Compares model output to ground truth for all features
 * - Produces ScoreResponse with { key, value, score } for each feature
 * - Handles 'unknown' and 'able_to_parse' gracefully
 */
export class StructuredFeatureScorer extends EvaluationScorer {
  groundTruth: Record<string, any>;

  constructor(evaluationId: string, groundTruthPath: string) {
    super(evaluationId);
    this.groundTruth = this.loadGroundTruth(groundTruthPath);
  }

  loadGroundTruth(groundTruthPath: string): Record<string, any> {
    if (!fs.existsSync(groundTruthPath)) {
      console.warn(`Ground truth file not found: ${groundTruthPath}`);
      return {};
    }
    return JSON.parse(fs.readFileSync(groundTruthPath, 'utf8'));
  }

  /**
   * Compares model response to ground truth for all features.
   * @param response ModelResponse
   * @returns ScoreResponse
   */
  async scoreResponse(response: ModelResponse): Promise<ScoreResponse> {
    // Use a robust way to get the image ID from metadata
    const imageId = (response.metadata as any).inputFile || (response.metadata as any).input_path || (response.metadata as any).filename || undefined;
    const gt = imageId ? this.groundTruth[imageId] || {} : {};
    const modelFeatures = JSON.parse(response.content); // assumes content is JSON string
    const evals: { key: string; value: string; score: number }[] = [];
    for (const key of Object.keys(gt)) {
      const gtValue = gt[key]?.value ?? gt[key];
      const modelValue = modelFeatures[key]?.value ?? modelFeatures[key];
      let score = 0;
      if (modelValue === 'unknown' || modelValue === undefined) {
        score = 0;
      } else if (gtValue === undefined) {
        score = 0; // or null if you want to skip
      } else if (modelValue === gtValue) {
        score = 1;
      } else {
        score = 0;
      }
      evals.push({ key, value: String(modelValue), score });
    }
    // Special handling for able_to_parse
    if ('able_to_parse' in modelFeatures) {
      evals.push({ key: 'able_to_parse', value: String(modelFeatures.able_to_parse.value), score: modelFeatures.able_to_parse.value ? 1 : 0 });
    }
    return {
      evals: evals,
      metadata: response.metadata,
    };
  }
} 