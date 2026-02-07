import { z } from 'zod';
import type { SessionIndexEntry } from '../types/types.js';

/**
 * Analysis data extracted from a session by LLM
 */
export interface SessionAnalysis {
  topics: string[]; // 3-5 main subjects discussed
  tags: string[]; // 5-10 searchable keywords
  keyLearnings: string; // 2-3 sentences of insights/solutions
  summary: string; // 1-2 sentence description
  solutionType: 'bug-fix' | 'feature' | 'refactor' | 'exploration' | 'question' | 'other';
  codeLanguages: string[]; // Programming languages involved
  toolsUsed: string[]; // Tools/frameworks mentioned
  successIndicators: 'yes' | 'partial' | 'no' | 'unclear';
  relatedFiles: string[]; // Extracted from tool calls
}

/**
 * Metadata about a session for the analysis index
 */
export interface SessionMetadata {
  firstPrompt: string;
  gitBranch: string;
  created: string;
  duration?: number;
  messageCount: number;
  toolCallCount: number;
  estimatedCost: number;
}

/**
 * A single entry in the analysis index
 */
export interface SessionAnalysisEntry {
  sessionId: string;
  sessionMtime: number; // File modification time from sessions-index
  analyzedAt: string; // ISO timestamp when analysis was performed
  analysis: SessionAnalysis;
  metadata: SessionMetadata;
}

/**
 * Model details for the analysis
 */
export interface AnalysisModelDetails {
  provider: string;
  name: string;
}

/**
 * The complete analysis index for a project
 */
export interface SessionAnalysisIndex {
  version: number;
  projectPath: string;
  lastIndexed: string; // ISO timestamp
  modelUsed: AnalysisModelDetails;
  totalSessions: number;
  analyzedSessions: number;
  entries: SessionAnalysisEntry[];
}

/**
 * Zod schema for validating LLM analysis responses
 */
export const AnalysisSchema = z.object({
  topics: z.array(z.string()).min(3).max(5),
  tags: z.array(z.string()).min(5).max(10),
  keyLearnings: z.string(),
  summary: z.string(),
  solutionType: z.enum(['bug-fix', 'feature', 'refactor', 'exploration', 'question', 'other']),
  codeLanguages: z.array(z.string()),
  toolsUsed: z.array(z.string()),
  successIndicators: z.enum(['yes', 'partial', 'no', 'unclear']),
});

/**
 * Type for the validated LLM response
 */
export type AnalysisResponse = z.infer<typeof AnalysisSchema>;

/**
 * Options for indexing sessions
 */
export interface IndexOptions {
  projectPath: string;
  model?: string; // Format: "provider:model"
  force?: boolean; // Force reindexing all sessions
  batchSize?: number; // Number of sessions to process concurrently
  verbose?: boolean; // Show detailed progress
  /** When set, use this list instead of discovering from session-store (so index sees same sessions as list). */
  sessionsOverride?: SessionIndexEntry[];
}

/**
 * Options for searching sessions
 */
export interface SearchOptions {
  projectPath: string;
  tags?: string[]; // Filter by tags
  topic?: string; // Filter by topic
  tool?: string; // Filter by tool usage
  solutionType?: string; // Filter by solution type
  successIndicator?: string; // Filter by success
  branch?: string; // Filter by git branch
  limit?: number; // Max results
  json?: boolean; // Output as JSON
}

/**
 * A search result with relevance score
 */
export interface ScoredSearchResult {
  entry: SessionAnalysisEntry;
  score: number;
  matchedFields: string[]; // Which fields matched the query
}

/**
 * Options for analyzing sessions
 */
export interface AnalyzeOptions {
  projectPath: string;
  type: 'topics' | 'tools' | 'patterns' | 'timeline';
  json?: boolean;
}

/**
 * Type guard to check if an object is a valid SessionAnalysis
 */
export function isSessionAnalysis(obj: unknown): obj is SessionAnalysis {
  try {
    AnalysisSchema.parse(obj);
    return true;
  } catch {
    return false;
  }
}

/**
 * Type guard to check if an object is a valid SessionAnalysisIndex
 */
export function isSessionAnalysisIndex(obj: unknown): obj is SessionAnalysisIndex {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const index = obj as Partial<SessionAnalysisIndex>;

  return (
    typeof index.version === 'number' &&
    typeof index.projectPath === 'string' &&
    typeof index.lastIndexed === 'string' &&
    typeof index.modelUsed === 'object' &&
    typeof index.totalSessions === 'number' &&
    typeof index.analyzedSessions === 'number' &&
    Array.isArray(index.entries)
  );
}
