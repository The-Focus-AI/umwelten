/**
 * Suite Result Loader
 *
 * Reads evaluation results from disk, extracts scores using
 * dimension-specific extractors, and normalizes to percentages.
 * Preserves full raw data for detailed reporting.
 */

import fs from 'fs';
import path from 'path';
import type { EvalDimension, DimensionScore, ModelScorecard, SuiteResult, SuiteRunInfo, TaskResult } from './types.js';

/**
 * Find the latest (highest-numbered) run directory for an evaluation.
 */
export function findLatestRunDir(
  evalName: string,
  baseDir?: string
): { runDir: string; runNumber: number } | null {
  const evalDir = path.join(
    baseDir || path.join(process.cwd(), 'output', 'evaluations'),
    evalName,
    'runs'
  );

  if (!fs.existsSync(evalDir)) return null;

  const entries = fs.readdirSync(evalDir)
    .filter(d => fs.statSync(path.join(evalDir, d)).isDirectory())
    .map(d => parseInt(d, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a); // descending

  if (entries.length === 0) return null;

  const runNumber = entries[0];
  return {
    runDir: path.join(evalDir, String(runNumber).padStart(3, '0')),
    runNumber,
  };
}

/**
 * Load all task-level results for a dimension from a run directory.
 * Returns both aggregated DimensionScores and raw TaskResults.
 */
export function loadDimension(
  dimension: EvalDimension,
  runDir: string
): { scores: Map<string, DimensionScore>; taskResults: TaskResult[] } {
  const scores = new Map<string, DimensionScore>();
  const taskResults: TaskResult[] = [];

  if (!fs.existsSync(runDir)) return { scores, taskResults };

  // Each subdirectory is a task/puzzle/question
  const taskDirs = fs.readdirSync(runDir)
    .filter(d => fs.statSync(path.join(runDir, d)).isDirectory());

  for (const taskDir of taskDirs) {
    const resultsPath = dimension.hasResultsSubdir
      ? path.join(runDir, taskDir, 'results')
      : path.join(runDir, taskDir);

    if (!fs.existsSync(resultsPath)) continue;

    const jsonFiles = fs.readdirSync(resultsPath)
      .filter(f => f.endsWith('.json'));

    for (const file of jsonFiles) {
      const modelKey = file.replace('.json', '');

      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(resultsPath, file), 'utf8')
        );

        const score = dimension.extractScore(data);
        const cost = data.cost || 0;
        const durationMs = data.durationMs || 0;
        const perTaskMax =
          dimension.perTaskMaxScore !== undefined
            ? dimension.perTaskMaxScore
            : null;

        // Preserve full raw result
        taskResults.push({
          taskId: taskDir,
          modelKey,
          score,
          cost,
          durationMs,
          raw: data,
        });

        const existing = scores.get(modelKey);
        if (existing) {
          existing.rawScore += score;
          existing.totalCost += cost;
          existing.totalDurationMs += durationMs;
          existing.taskCount += 1;
          if (perTaskMax !== null) {
            existing.maxScore += perTaskMax;
          }
        } else {
          scores.set(modelKey, {
            rawScore: score,
            maxScore:
              perTaskMax !== null ? perTaskMax : dimension.maxScore,
            pct: 0, // calculated after all tasks
            totalCost: cost,
            totalDurationMs: durationMs,
            taskCount: 1,
            errorCount: 0,
          });
        }
      } catch {
        // Count errors but continue
        const existing = scores.get(modelKey);
        const perTaskMax =
          dimension.perTaskMaxScore !== undefined
            ? dimension.perTaskMaxScore
            : null;
        if (existing) {
          existing.errorCount += 1;
        } else {
          scores.set(modelKey, {
            rawScore: 0,
            maxScore:
              perTaskMax !== null ? perTaskMax : dimension.maxScore,
            pct: 0,
            totalCost: 0,
            totalDurationMs: 0,
            taskCount: 0,
            errorCount: 1,
          });
        }
      }
    }
  }

  // Calculate percentages
  for (const ds of scores.values()) {
    ds.pct = ds.maxScore > 0 ? (ds.rawScore / ds.maxScore) * 100 : 0;
  }

  return { scores, taskResults };
}

/**
 * Extract provider from a model key like "gemini-3-flash-preview-google"
 * or "anthropic-claude-haiku-4.5-openrouter".
 */
function parseModelKey(modelKey: string): { model: string; provider: string } {
  // Common provider suffixes
  const providers = ['openrouter', 'google', 'deepinfra', 'togetherai', 'ollama', 'lmstudio', 'llamabarn', 'github-models'];
  for (const p of providers) {
    if (modelKey.endsWith(`-${p}`)) {
      return {
        model: modelKey.slice(0, -(p.length + 1)),
        provider: p,
      };
    }
  }
  return { model: modelKey, provider: 'unknown' };
}

/**
 * Load a full suite of evaluations and combine into scorecards.
 */
export function loadSuite(
  dimensions: EvalDimension[],
  options?: { baseDir?: string }
): SuiteResult {
  const baseDir = options?.baseDir;
  const runInfo: SuiteRunInfo[] = [];
  const allTaskResults = new Map<string, TaskResult[]>();

  // dimensionName → Map<modelKey, DimensionScore>
  const allDimensionScores = new Map<string, Map<string, DimensionScore>>();

  for (const dim of dimensions) {
    let runResult: { runDir: string; runNumber: number } | null;

    if (dim.runNumber !== undefined) {
      const runDir = path.join(
        baseDir || path.join(process.cwd(), 'output', 'evaluations'),
        dim.evalName,
        'runs',
        String(dim.runNumber).padStart(3, '0')
      );
      runResult = fs.existsSync(runDir) ? { runDir, runNumber: dim.runNumber } : null;
    } else {
      runResult = findLatestRunDir(dim.evalName, baseDir);
    }

    if (!runResult) {
      console.warn(`⚠️  No runs found for ${dim.evalName}, skipping`);
      continue;
    }

    const { scores, taskResults } = loadDimension(dim, runResult.runDir);
    allDimensionScores.set(dim.evalName, scores);
    allTaskResults.set(dim.evalName, taskResults);

    // Count unique tasks by looking at subdirs
    const taskCount = fs.readdirSync(runResult.runDir)
      .filter(d => fs.statSync(path.join(runResult.runDir, d)).isDirectory())
      .length;

    runInfo.push({
      evalName: dim.evalName,
      label: dim.label,
      runDir: runResult.runDir,
      runNumber: runResult.runNumber,
      modelCount: scores.size,
      taskCount,
    });
  }

  // Collect all model keys across all dimensions
  const allModelKeys = new Set<string>();
  for (const scores of allDimensionScores.values()) {
    for (const key of scores.keys()) {
      allModelKeys.add(key);
    }
  }

  // Build scorecards — only for models present in ALL dimensions
  const scorecards: ModelScorecard[] = [];

  for (const modelKey of allModelKeys) {
    const dimensionMap = new Map<string, DimensionScore>();
    let missingDimensions = false;

    for (const [evalName, scores] of allDimensionScores) {
      const ds = scores.get(modelKey);
      if (!ds) {
        missingDimensions = true;
        break;
      }
      dimensionMap.set(evalName, ds);
    }

    if (missingDimensions) continue;

    // Calculate combined percentage (mean of dimension pcts)
    const pcts = Array.from(dimensionMap.values()).map(ds => ds.pct);
    const combinedPct = pcts.length > 0
      ? pcts.reduce((a, b) => a + b, 0) / pcts.length
      : 0;

    // Sum costs and durations
    let totalCost = 0;
    let totalDurationMs = 0;
    for (const ds of dimensionMap.values()) {
      totalCost += ds.totalCost;
      totalDurationMs += ds.totalDurationMs;
    }

    const { model, provider } = parseModelKey(modelKey);

    scorecards.push({
      modelKey,
      model,
      provider,
      dimensions: dimensionMap,
      combinedPct,
      totalCost,
      totalDurationMs,
    });
  }

  // Sort by combinedPct descending
  scorecards.sort((a, b) => b.combinedPct - a.combinedPct);

  return {
    scorecards,
    runInfo,
    taskResults: allTaskResults,
    timestamp: new Date(),
  };
}
