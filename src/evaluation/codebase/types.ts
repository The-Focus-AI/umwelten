/**
 * Types for codebase evaluation - testing LLM ability to modify real codebases
 */

import { ModelDetails, ModelResponse } from '../../cognition/types.js';
import { EvaluationResult, EvaluationMetadata } from '../types/evaluation-types.js';

/**
 * Configuration for a codebase that will be evaluated
 */
export interface CodebaseConfig {
  /** Path to the codebase root directory */
  path: string;

  /** Project type (auto-detected if not specified) */
  projectType?: 'npm' | 'pip' | 'cargo' | 'go' | 'maven' | 'gradle' | 'unknown';

  /** Glob patterns for files to include (default: common source patterns) */
  include?: string[];

  /** Glob patterns for files to exclude (default: node_modules, etc.) */
  exclude?: string[];

  /** Maximum total file size to include in context (bytes) */
  maxContextSize?: number;

  /** Whether to include the file tree structure in context */
  includeFileTree?: boolean;

  /** Custom setup commands to run before validation (e.g., npm install) */
  setupCommands?: string[];
}

/**
 * A coding task to be performed on the codebase
 */
export interface CodingTask {
  /** Unique identifier for this task */
  id: string;

  /** Human-readable description of the task */
  description: string;

  /** The prompt to send to the model */
  prompt: string;

  /** Files that are specifically relevant to this task */
  relevantFiles?: string[];

  /** Expected files to be modified (for validation hints) */
  expectedChangedFiles?: string[];

  /** Validation commands to run after changes are applied */
  validation: ValidationCommand[];

  /** Tags for categorizing the task */
  tags?: string[];

  /** Difficulty level */
  difficulty?: 'easy' | 'medium' | 'hard';
}

/**
 * A command to run for validating changes
 */
export interface ValidationCommand {
  /** Human-readable name for this validation step */
  name: string;

  /** The command to run (e.g., "npm test", "npm run build") */
  command: string;

  /** Working directory relative to codebase root */
  workdir?: string;

  /** Timeout in seconds (default: 60) */
  timeout?: number;

  /** Weight of this validation in scoring (default: 1.0) */
  weight?: number;

  /** Whether this validation must pass for overall success (default: true) */
  required?: boolean;

  /** Expected exit code (default: 0) */
  expectedExitCode?: number;

  /** Regex patterns that output must match */
  outputMustMatch?: string[];

  /** Regex patterns that output must not match */
  outputMustNotMatch?: string[];
}

/**
 * Represents changes extracted from a model response
 */
export interface ExtractedChanges {
  /** Whether changes were successfully extracted */
  success: boolean;

  /** Individual file changes */
  files: FileChange[];

  /** Format the changes were in (diff, patch, code blocks, etc.) */
  format: 'unified-diff' | 'git-patch' | 'code-block' | 'mixed' | 'unknown';

  /** Raw extracted content before parsing */
  rawContent?: string;

  /** Any errors encountered during extraction */
  errors?: string[];
}

/**
 * A change to a single file
 */
export interface FileChange {
  /** Path relative to codebase root */
  path: string;

  /** Type of change */
  type: 'create' | 'modify' | 'delete' | 'rename';

  /** New file path (for rename operations) */
  newPath?: string;

  /** The new content (for create operations or full replacements) */
  content?: string;

  /** Unified diff content (for modify operations) */
  diff?: string;

  /** Line-by-line hunks (parsed from diff) */
  hunks?: DiffHunk[];
}

/**
 * A hunk from a unified diff
 */
export interface DiffHunk {
  /** Starting line in old file */
  oldStart: number;

  /** Number of lines in old file */
  oldLines: number;

  /** Starting line in new file */
  newStart: number;

  /** Number of lines in new file */
  newLines: number;

  /** The actual diff lines (with +/-/space prefixes) */
  lines: string[];
}

/**
 * Result of applying changes to a codebase copy
 */
export interface ApplicationResult {
  /** Whether all changes were applied successfully */
  success: boolean;

  /** Path to the modified codebase copy */
  workdir: string;

  /** Results for each file */
  files: FileApplicationResult[];

  /** Overall error message if application failed */
  error?: string;
}

/**
 * Result of applying changes to a single file
 */
export interface FileApplicationResult {
  /** Path relative to codebase root */
  path: string;

  /** Whether this file's changes were applied */
  success: boolean;

  /** Type of operation performed */
  operation: 'created' | 'modified' | 'deleted' | 'renamed' | 'skipped';

  /** Error message if failed */
  error?: string;

  /** Number of hunks applied (for diffs) */
  hunksApplied?: number;

  /** Number of hunks that failed (for diffs) */
  hunksFailed?: number;
}

/**
 * Result of running a validation command
 */
export interface ValidationResult {
  /** Name of the validation */
  name: string;

  /** The command that was run */
  command: string;

  /** Whether validation passed */
  passed: boolean;

  /** Exit code from the command */
  exitCode: number;

  /** Standard output */
  stdout: string;

  /** Standard error */
  stderr: string;

  /** Execution time in milliseconds */
  duration: number;

  /** Whether the command timed out */
  timedOut: boolean;

  /** Detailed failure reasons */
  failures?: string[];
}

/**
 * Scores for a codebase evaluation
 */
export interface CodebaseScores {
  /** Overall score (0-100) */
  overall: number;

  /** Score breakdown by category */
  breakdown: {
    /** Did the model produce parseable changes? (0-100) */
    changeExtraction: number;

    /** Were the changes applied successfully? (0-100) */
    changeApplication: number;

    /** Did validation commands pass? (0-100) */
    validation: number;

    /** Code quality aspects (syntax, style, etc.) (0-100) */
    codeQuality: number;

    /** Does the solution address the task correctly? (0-100) */
    correctness: number;
  };

  /** Weights used for each category */
  weights: {
    changeExtraction: number;
    changeApplication: number;
    validation: number;
    codeQuality: number;
    correctness: number;
  };

  /** Individual validation scores */
  validationScores: {
    name: string;
    passed: boolean;
    weight: number;
    score: number;
  }[];

  /** AI evaluation details (if performed) */
  aiEvaluation?: {
    summary: string;
    rating: number; // 1-5
    strengths?: string[];
    weaknesses?: string[];
  };
}

/**
 * Complete result of evaluating a model on a codebase task
 */
export interface CodebaseEvaluationResult extends EvaluationResult {
  /** The task that was evaluated */
  task: CodingTask;

  /** Codebase configuration used */
  codebaseConfig: CodebaseConfig;

  /** Changes extracted from model response */
  extractedChanges?: ExtractedChanges;

  /** Result of applying changes */
  applicationResult?: ApplicationResult;

  /** Validation results */
  validationResults?: ValidationResult[];

  /** Computed scores */
  scores?: CodebaseScores;

  /** Timing breakdown */
  timing?: CodebaseEvaluationTiming;
}

/**
 * Timing information for codebase evaluation stages
 */
export interface CodebaseEvaluationTiming {
  /** Time to generate model response */
  responseTime: number;

  /** Time to extract changes from response */
  extractionTime: number;

  /** Time to apply changes to codebase copy */
  applicationTime: number;

  /** Time to run all validations */
  validationTime: number;

  /** Time for AI scoring (if enabled) */
  scoringTime: number;

  /** Total end-to-end time */
  totalTime: number;
}

/**
 * Configuration for codebase evaluation strategy
 */
export interface CodebaseEvaluationConfig {
  /** Whether to extract changes from model responses */
  extractChanges?: boolean;

  /** Whether to apply changes to a codebase copy */
  applyChanges?: boolean;

  /** Whether to run validation commands */
  runValidation?: boolean;

  /** Whether to perform AI-based scoring */
  aiScoring?: boolean;

  /** Model to use for AI evaluation */
  evaluatorModel?: ModelDetails;

  /** Maximum concurrent model evaluations */
  maxConcurrent?: number;

  /** Default timeout for validation commands (seconds) */
  validationTimeout?: number;

  /** Whether to keep working directories after evaluation */
  keepWorkdirs?: boolean;

  /** Base directory for working copies */
  workdirBase?: string;

  /** Dagger-specific configuration */
  dagger?: {
    /** Timeout for Dagger operations (seconds) */
    timeout?: number;

    /** Whether to use cached container builds */
    useCache?: boolean;
  };
}

/**
 * Summary statistics for a codebase evaluation run
 */
export interface CodebaseEvaluationStats {
  /** Total models evaluated */
  totalModels: number;

  /** Models that produced valid changes */
  modelsWithValidChanges: number;

  /** Models that passed all validations */
  modelsPassingValidation: number;

  /** Average overall score */
  averageScore: number;

  /** Score distribution */
  scoreDistribution: {
    min: number;
    max: number;
    median: number;
    stdDev: number;
  };

  /** Validation pass rates by command */
  validationPassRates: {
    name: string;
    passRate: number;
    averageDuration: number;
  }[];

  /** Total time for all evaluations */
  totalDuration: number;

  /** Total API cost */
  totalCost: number;
}

/**
 * Context loaded from a codebase for inclusion in prompts
 */
export interface CodebaseContext {
  /** The codebase configuration */
  config: CodebaseConfig;

  /** Detected project type */
  projectType: string;

  /** File tree representation */
  fileTree?: string;

  /** Content of included files */
  files: {
    path: string;
    content: string;
    language?: string;
  }[];

  /** Total size of context in characters */
  totalSize: number;

  /** Files that were excluded due to size limits */
  truncatedFiles?: string[];
}
