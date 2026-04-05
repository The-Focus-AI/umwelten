/**
 * Types for multi-evaluation aggregation and combined reporting.
 */

/** Configuration for one evaluation in a suite */
export interface EvalDimension {
  /** Evaluation name (maps to output/evaluations/{name}/) */
  evalName: string;
  /** Human-readable label for this dimension */
  label: string;
  /** Max score for this evaluation (full run — used for docs and legacy single-bucket mode) */
  maxScore: number;
  /**
   * When set, each loaded result file adds this many points to the model’s denominator for this
   * dimension (sum of per-file maxima). Use for multi-task evals so partial runs show e.g. 28/28
   * instead of 28/126. When omitted, the model’s maxScore stays `dimension.maxScore` after the
   * first file (legacy).
   */
  perTaskMaxScore?: number;
  /** Extract score from a single result JSON file */
  extractScore: (result: any) => number;
  /** Does this eval have a results/ subdirectory under each task? */
  hasResultsSubdir?: boolean;
  /** Optional: specific run number to use (default: latest) */
  runNumber?: number;
}

/** A single result for one model on one task — preserves all raw data */
export interface TaskResult {
  taskId: string;
  modelKey: string;
  score: number;
  cost: number;
  durationMs: number;
  /** Full raw JSON from the result file */
  raw: Record<string, any>;
}

/** Per-model score for one dimension */
export interface DimensionScore {
  rawScore: number;
  maxScore: number;
  pct: number;           // 0-100
  totalCost: number;
  totalDurationMs: number;
  taskCount: number;
  errorCount: number;
}

/** Combined per-model scorecard */
export interface ModelScorecard {
  modelKey: string;       // filesystem-safe key (from filename)
  model: string;          // display name (cleaned up)
  provider: string;
  dimensions: Map<string, DimensionScore>;  // keyed by evalName
  combinedPct: number;    // mean of available dimension pcts
  totalCost: number;
  totalDurationMs: number;
}

/** Metadata about what was loaded */
export interface SuiteRunInfo {
  evalName: string;
  label: string;
  runDir: string;
  runNumber: number;
  modelCount: number;
  taskCount: number;
}

/** Full suite result */
export interface SuiteResult {
  scorecards: ModelScorecard[];   // sorted by combinedPct desc
  runInfo: SuiteRunInfo[];
  /** All raw task-level results, keyed by evalName */
  taskResults: Map<string, TaskResult[]>;
  timestamp: Date;
}
