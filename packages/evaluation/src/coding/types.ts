/**
 * Types for the isolated git-checkout coding-session benchmark built on
 * `@earendil-works/pi-durable` (`Harness` + `CodingTools` + extensions).
 */

import type { Extension } from "@earendil-works/pi-durable";
import type { ModelSpec, ResolvedPiInvocationTarget } from "@umwelten/pi";

export type CodingDifficulty = "easy" | "medium" | "hard";
export type CodingLanguage = "typescript" | "python";

export type BuiltinCodingExtensionName =
  | "pi-default"
  | "search-tools"
  | "tool-search"
  | "codemode"
  | "verify-on-yield";

export interface CodingTaskSpec {
  id: string;
  title: string;
  difficulty: CodingDifficulty;
  language: CodingLanguage;
  repoDir: string;
  hiddenTestsDir: string;
  prompt: string;
  visibleTestCommand: string;
  hiddenTestCommand: string;
  protectedPaths: string[];
  maxTurns?: number;
  timeoutMs?: number;
  tags?: string[];
}

export interface CodingTestCounts {
  passed: number;
  failed: number;
  total: number;
  exitCode: number;
  output: string;
}

export interface CodingExtensionContext {
  workspaceDir: string;
  task: CodingTaskSpec;
}

export type CodingSessionStatus =
  | "idle"
  | "running"
  | "grading"
  | "ready"
  | "chatting"
  | "aborted"
  | "error"
  | "closed";

export type CodingSessionEvent =
  | {
      type: "session_started";
      sessionId: string;
      taskId: string;
      title: string;
      model: string;
      provider: string;
      effort: string;
      extensionProfile: string;
      workspaceDir: string;
      timestamp: number;
    }
  | {
      type: "status";
      status: CodingSessionStatus;
      error?: string;
      timestamp: number;
    }
  | {
      type: "turn_start";
      turn: number;
      messageCount: number;
      timestamp: number;
    }
  | {
      type: "partial";
      turn: number;
      thinking: string;
      text: string;
      activeTools: Array<{
        callId: string;
        name: string;
        status: string;
        output?: string;
      }>;
      timestamp: number;
    }
  | {
      type: "assistant_turn";
      turn: number;
      thinking: string;
      text: string;
      toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
      costUsd: number;
      tokens: CodingSessionTokens;
      stopReason?: string;
      timestamp: number;
    }
  | {
      type: "tool_start";
      callId: string;
      name: string;
      arguments: Record<string, unknown>;
      timestamp: number;
    }
  | {
      type: "tool_end";
      callId: string;
      name: string;
      isError: boolean;
      outputPreview: string;
      timestamp: number;
    }
  | {
      type: "graded";
      record: CodingSessionRecord;
      isInitialEval: boolean;
      timestamp: number;
    }
  | {
      type: "followup_user";
      message: string;
      timestamp: number;
    }
  | {
      type: "followup_done";
      replyText: string;
      turns: number;
      costUsd: number;
      timestamp: number;
    };

export interface InteractiveCodingSessionOptions {
  id?: string;
  task: CodingTaskSpec;
  spec: ModelSpec;
  extensionNames?: string[];
  customExtensionPaths?: string[];
  extraExtensions?: Extension[];
  maxTurns?: number;
  timeoutMs?: number;
  outputDir?: string;
  overrideTarget?: ResolvedPiInvocationTarget;
  onEvent?: (event: CodingSessionEvent) => void;
}

export interface CodingFollowUpResult {
  replyText: string;
  turns: number;
  costUsd: number;
}

export interface CodingSessionTokens {
  prompt: number;
  completion: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
}

export interface CodingSessionRecord {
  taskId: string;
  title: string;
  difficulty: CodingDifficulty;
  language: CodingLanguage;
  model: string;
  provider: string;
  reasoningEffort?: string;
  effectiveThinkingLevel?: string;
  extensionProfile: string;
  taskHash: string;
  cacheKey: string;
  generatedAt: string;
  passed: boolean;
  score: number;
  maxScore: number;
  details: string;
  visibleTests: { passed: number; failed: number; total: number };
  hiddenTests: { passed: number; failed: number; total: number };
  cheatedProtectedFiles: boolean;
  stopReason: "completed" | "turn_limit" | "timeout" | "error";
  durationMs: number;
  turns: number;
  toolCallsTotal: number;
  toolCallsByName: Record<string, number>;
  toolErrors: number;
  costUsd: number;
  tokenUsage: CodingSessionTokens;
  tokPerSec: number | null;
  changedFiles: string[];
  gitDiffStat: string;
  gitDiff: string;
  gradingOutput: string;
  finalAssistantText: string;
  transcriptPath?: string;
  error?: string;
  cached?: boolean;
}

export interface RunCodingTaskOptions {
  task: CodingTaskSpec;
  spec: ModelSpec;
  extensionNames?: string[];
  customExtensionPaths?: string[];
  extraExtensions?: Extension[];
  maxTurns?: number;
  timeoutMs?: number;
  outputDir?: string;
  fresh?: boolean;
  keepWorkspace?: boolean;
  overrideTarget?: ResolvedPiInvocationTarget;
}

export interface RunCodingBenchmarkOptions {
  tasks: CodingTaskSpec[];
  models: ModelSpec[];
  extensionNames?: string[];
  customExtensionPaths?: string[];
  extraExtensions?: Extension[];
  maxTurns?: number;
  timeoutMs?: number;
  concurrency?: number;
  outputDir?: string;
  fresh?: boolean;
  keepWorkspace?: boolean;
  targetOverrides?: Map<string, ResolvedPiInvocationTarget>;
  onProgress?: (
    record: CodingSessionRecord,
    index: number,
    total: number,
  ) => void;
}
