/**
 * Types for multi-step tool conversation evaluation
 */

import { Stimulus } from '../../stimulus/stimulus.js';
import { ModelDetails, ModelResponse } from '../../cognition/types.js';

/**
 * Represents a tool call made during a conversation
 */
export interface ToolCall {
  toolName: string;
  toolCallId: string;
  args: Record<string, any>;
  result?: any;
}

/**
 * Expected tool call specification
 */
export interface ExpectedToolCall {
  /** Name of the tool that should be called */
  toolName: string;

  /**
   * Expected parameters - can be exact match object or predicate function
   * If a function, receives the actual parameters and returns true if valid
   */
  parameters?: Record<string, any> | ((params: any) => boolean);

  /**
   * Expected result - can be exact match or predicate function
   * If a function, receives the actual result and returns true if valid
   */
  result?: any | ((result: any) => boolean);

  /**
   * Whether this tool call is required (default: true)
   */
  required?: boolean;
}

/**
 * Validation rules for a conversation step
 */
export interface StepValidation {
  /** Response content should contain all of these strings */
  contentContains?: string[];

  /** Response content should match this regex */
  contentMatches?: RegExp;

  /** Expected number of tool calls */
  toolCallCount?: { min?: number; max?: number };

  /** Custom validation function */
  custom?: (response: ModelResponse, toolCalls: ToolCall[]) => boolean;
}

/**
 * A single step in a conversation test scenario
 */
export interface ConversationStep {
  /** Role for this step - currently only 'user' is used for inputs */
  role: 'user';

  /** The message content to send */
  content: string;

  /** Expected tool calls for this step (optional) */
  expectedToolCalls?: ExpectedToolCall[];

  /** Validation rules for the response */
  validation?: StepValidation;
}

/**
 * Result of validating a single step
 */
export interface StepValidationResult {
  /** Whether all validations passed */
  passed: boolean;

  /** Specific validation failures */
  failures: string[];

  /** Tool calls that were made */
  toolCalls: ToolCall[];

  /** The model's response */
  response: ModelResponse;

  /** Time taken for this step in ms */
  duration: number;
}

/**
 * Complete test scenario for evaluating tool usage
 */
export interface ToolTestScenario {
  /** Unique name for this scenario */
  name: string;

  /** Description of what's being tested */
  description?: string;

  /** The stimulus defining tools and prompt context */
  stimulus: Stimulus;

  /** Conversation steps to execute */
  steps: ConversationStep[];

  /** Models to test against */
  models: ModelDetails[];

  /** Timeout per step in ms (default: 30000) */
  timeout?: number;
}

/**
 * Result of running a scenario against a single model
 */
export interface ToolTestResult {
  /** Scenario name */
  scenario: string;

  /** Model that was tested */
  model: ModelDetails;

  /** Results for each step */
  steps: StepValidationResult[];

  /** Whether all steps passed */
  passed: boolean;

  /** Overall score (0-100) */
  score?: number;

  /** Timing information */
  timing: {
    total: number;
    perStep: number[];
  };

  /** Any errors encountered */
  errors: string[];
}

/**
 * Scoring breakdown for tool usage
 */
export interface ToolScore {
  /** Overall score 0-100 */
  total: number;

  /** Score components */
  breakdown: {
    /** Correct tools called (0-100) */
    toolSelection: number;

    /** Parameter accuracy (0-100) */
    parameterAccuracy: number;

    /** Response quality/coherence (0-100) */
    responseQuality: number;

    /** Conversation flow handling (0-100) */
    conversationFlow: number;
  };

  /** Weights used for each component */
  weights: {
    toolSelection: number;
    parameterAccuracy: number;
    responseQuality: number;
    conversationFlow: number;
  };

  /** AI evaluation details (if performed) */
  aiEvaluation?: {
    summary: string;
    rating: number; // 1-5
  };
}

/**
 * Configuration for the conversation runner
 */
export interface ConversationConfig {
  /** Maximum concurrent model evaluations */
  maxConcurrent?: number;

  /** Default timeout per step in ms */
  defaultTimeout?: number;

  /** Whether to enable caching */
  enableCaching?: boolean;

  /** Cache directory for results */
  cacheDir?: string;

  /** Whether to perform AI scoring */
  enableAIScoring?: boolean;

  /** Model to use for AI evaluation */
  evaluatorModel?: ModelDetails;

  /** Verbose logging */
  verbose?: boolean;
}
