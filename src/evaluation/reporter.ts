import fs from 'fs';
import path from 'path';
import { ModelResponse, ScoreResponse } from '../models/types.js';

/**
 * EvaluationReporter: Standardized reporting utility for evaluation results.
 * - Loads model responses, scores, and ground truth
 * - Generates tables (Markdown, HTML, CSV) for each feature, per-image, and per-model
 * - Computes summary statistics (accuracy, confidence, unknown counts, etc.)
 * - Handles missing ground truth gracefully
 */
export class EvaluationReporter {
  responses: ModelResponse[];
  scores: ScoreResponse[];
  groundTruth: Record<string, any>;

  constructor({ responsesDir, scoresDir, groundTruthPath }: { responsesDir: string, scoresDir?: string, groundTruthPath?: string }) {
    this.responses = this.loadResponses(responsesDir);
    this.scores = scoresDir ? this.loadScores(scoresDir) : [];
    this.groundTruth = groundTruthPath && fs.existsSync(groundTruthPath)
      ? JSON.parse(fs.readFileSync(groundTruthPath, 'utf8'))
      : {};
  }

  loadResponses(responsesDir: string): ModelResponse[] {
    if (!fs.existsSync(responsesDir)) return [];
    return fs.readdirSync(responsesDir)
      .map(f => JSON.parse(fs.readFileSync(path.join(responsesDir, f), 'utf8')) as ModelResponse);
  }

  loadScores(scoresDir: string): ScoreResponse[] {
    if (!fs.existsSync(scoresDir)) return [];
    return fs.readdirSync(scoresDir)
      .map(f => JSON.parse(fs.readFileSync(path.join(scoresDir, f), 'utf8')) as ScoreResponse);
  }

  /**
   * Helper: Get all unique image IDs from responses.
   */
  getImageIds(): string[] {
    const ids = new Set<string>();
    for (const resp of this.responses) {
      const id = (resp.metadata as any).inputFile || (resp.metadata as any).input_path || (resp.metadata as any).filename;
      if (id) ids.add(id);
    }
    return Array.from(ids);
  }

  /**
   * Helper: Get all unique model names from responses.
   */
  getModelNames(): string[] {
    const names = new Set<string>();
    for (const resp of this.responses) {
      names.add(resp.metadata.model);
    }
    return Array.from(names);
  }

  /**
   * Helper: Get feature value/confidence for a given image, model, and feature.
   */
  getFeatureFor(imageId: string, model: string, feature: string): { value: string, confidence?: number } | undefined {
    const resp = this.responses.find(r => {
      const id = (r.metadata as any).inputFile || (r.metadata as any).input_path || (r.metadata as any).filename;
      return id === imageId && r.metadata.model === model;
    });
    if (!resp) return undefined;
    try {
      const obj = JSON.parse(resp.content);
      if (obj && feature in obj) {
        return {
          value: String(obj[feature]?.value ?? obj[feature]),
          confidence: typeof obj[feature]?.confidence === 'number' ? obj[feature].confidence : undefined,
        };
      }
    } catch {}
    return undefined;
  }

  /**
   * Generate a Markdown table for a given feature across all images and models.
   */
  generateFeatureTableMarkdown(feature: string): string {
    const imageIds = this.getImageIds();
    const modelNames = this.getModelNames();
    let md = `| Image | Ground Truth |`;
    for (const model of modelNames) {
      md += ` ${model} Value | ${model} Conf |`;
    }
    md += '\n|-------|--------------|';
    for (const _ of modelNames) {
      md += '-------|------|';
    }
    md += '\n';
    for (const imageId of imageIds) {
      const gt = this.groundTruth[imageId]?.[feature]?.value ?? this.groundTruth[imageId]?.[feature] ?? 'N/A';
      md += `| ${imageId} | ${gt} |`;
      for (const model of modelNames) {
        const feat = this.getFeatureFor(imageId, model, feature);
        md += ` ${feat ? feat.value : 'N/A'} | ${feat && feat.confidence !== undefined ? feat.confidence.toFixed(2) : 'N/A'} |`;
      }
      md += '\n';
    }
    return md;
  }

  /**
   * Generate an HTML table for a given feature.
   * TODO: Implement HTML table generation.
   */
  generateFeatureTableHTML(feature: string): string {
    // TODO: Build HTML table
    return `<table><thead><tr><th>Image</th><th>Ground Truth</th><th>Model</th><th>Value</th><th>Confidence</th></tr></thead><tbody>...</tbody></table>`;
  }

  /**
   * Generate a CSV for a given feature.
   * TODO: Implement CSV generation.
   */
  generateFeatureTableCSV(feature: string): string {
    // TODO: Build CSV
    return `Image,Ground Truth,Model,Value,Confidence\n...`;
  }

  /**
   * Generate summary statistics (accuracy, confidence, unknown counts, etc.)
   * TODO: Implement summary computation.
   */
  generateSummary(): Record<string, any> {
    // TODO: Compute per-feature, per-model accuracy/confidence if ground truth is present
    return {};
  }

  // Add more methods as needed for per-image tables, aggregate reports, etc.
} 