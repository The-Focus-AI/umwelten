import { ModelDetails } from '../cognition/types.js';
import { getProjectSessions } from './session-store.js';
import { summarizeSession, parseSessionFile, extractToolCalls } from './session-parser.js';
import { analyzeSessionWithRetry } from './session-analyzer.js';
import type { SessionIndexEntry } from './types.js';
import type {
  SessionAnalysisIndex,
  SessionAnalysisEntry,
  IndexOptions,
  AnalysisModelDetails,
  SessionMetadata,
} from './analysis-types.js';
import {
  hasAnalysisIndex,
  readAnalysisIndex,
  saveAnalysisIndex,
} from './session-store.js';

/**
 * Check if a session needs reindexing
 */
export function needsReindexing(
  session: SessionIndexEntry,
  analysisIndex: SessionAnalysisIndex | null,
  force: boolean = false
): boolean {
  if (force) {
    return true; // Force reindexing
  }

  if (!analysisIndex) {
    return true; // No index exists yet
  }

  const existing = analysisIndex.entries.find(e => e.sessionId === session.sessionId);

  if (!existing) {
    return true; // New session
  }

  if (existing.sessionMtime !== session.fileMtime) {
    return true; // Session modified
  }

  return false; // Already indexed and up to date
}

/**
 * Discover sessions that need indexing
 */
export async function discoverNewSessions(
  projectPath: string,
  force: boolean = false
): Promise<{ allSessions: SessionIndexEntry[]; sessionsToIndex: SessionIndexEntry[] }> {
  // Get all sessions for the project
  const allSessions = await getProjectSessions(projectPath);

  // Load existing analysis index if it exists
  let analysisIndex: SessionAnalysisIndex | null = null;
  if (await hasAnalysisIndex(projectPath)) {
    try {
      analysisIndex = await readAnalysisIndex(projectPath);
    } catch (error) {
      console.warn('Failed to load existing analysis index, will create new one');
    }
  }

  // Filter sessions that need indexing
  const sessionsToIndex = allSessions.filter(session =>
    needsReindexing(session, analysisIndex, force)
  );

  return { allSessions, sessionsToIndex };
}

/**
 * Create metadata for a session
 */
async function createSessionMetadata(session: SessionIndexEntry): Promise<SessionMetadata> {
  const messages = await parseSessionFile(session.fullPath);
  const summary = summarizeSession(messages);
  const toolCalls = extractToolCalls(messages);

  return {
    firstPrompt: session.firstPrompt,
    gitBranch: session.gitBranch,
    created: session.created,
    duration: summary.duration,
    messageCount: session.messageCount,
    toolCallCount: toolCalls.length,
    estimatedCost: summary.estimatedCost,
  };
}

/**
 * Process a batch of sessions concurrently
 */
export async function batchAnalyzeSessions(
  sessions: SessionIndexEntry[],
  model: ModelDetails,
  verbose: boolean = false
): Promise<SessionAnalysisEntry[]> {
  const results: SessionAnalysisEntry[] = [];

  // Process all sessions in parallel using Promise.all
  const promises = sessions.map(async (session) => {
    if (verbose) {
      console.log(`  Analyzing ${session.sessionId}...`);
    }

    try {
      // Analyze session with retry
      const analysisResult = await analyzeSessionWithRetry(session, model);

      if (!analysisResult) {
        // Analysis failed after retries
        return null;
      }

      // Create metadata
      const metadata = await createSessionMetadata(session);

      // Create analysis entry
      const entry: SessionAnalysisEntry = {
        sessionId: session.sessionId,
        sessionMtime: session.fileMtime,
        analyzedAt: new Date().toISOString(),
        analysis: analysisResult.analysis,
        metadata,
      };

      return entry;
    } catch (error) {
      console.error(`Failed to analyze session ${session.sessionId}:`, error);
      return null;
    }
  });

  // Wait for all analyses to complete
  const batchResults = await Promise.all(promises);

  // Filter out failed analyses
  for (const result of batchResults) {
    if (result !== null) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Merge new analysis results with existing index
 */
export function mergeAnalysisResults(
  existing: SessionAnalysisIndex | null,
  newEntries: SessionAnalysisEntry[],
  projectPath: string,
  modelUsed: AnalysisModelDetails
): SessionAnalysisIndex {
  if (!existing) {
    // Create new index
    return {
      version: 1,
      projectPath,
      lastIndexed: new Date().toISOString(),
      modelUsed,
      totalSessions: newEntries.length,
      analyzedSessions: newEntries.length,
      entries: newEntries,
    };
  }

  // Merge with existing index
  const mergedEntries: SessionAnalysisEntry[] = [...existing.entries];

  // Update or add new entries
  for (const newEntry of newEntries) {
    const existingIndex = mergedEntries.findIndex(
      e => e.sessionId === newEntry.sessionId
    );

    if (existingIndex >= 0) {
      // Update existing entry
      mergedEntries[existingIndex] = newEntry;
    } else {
      // Add new entry
      mergedEntries.push(newEntry);
    }
  }

  return {
    version: existing.version,
    projectPath,
    lastIndexed: new Date().toISOString(),
    modelUsed,
    totalSessions: mergedEntries.length,
    analyzedSessions: mergedEntries.length,
    entries: mergedEntries,
  };
}

/**
 * Main indexing function
 */
export async function indexProject(
  options: IndexOptions
): Promise<{ indexed: number; skipped: number; failed: number }> {
  const {
    projectPath,
    model: modelString = 'google:gemini-2.0-flash-exp',
    force = false,
    batchSize = 5,
    verbose = false,
  } = options;

  // Parse model details
  const [provider, ...modelParts] = modelString.split(':');
  const modelName = modelParts.join(':');

  if (!provider || !modelName) {
    throw new Error(`Invalid model format: ${modelString}. Expected "provider:model"`);
  }

  const model: ModelDetails = {
    name: modelName,
    provider: provider as any,
    temperature: 0.2,
  };

  const modelUsed: AnalysisModelDetails = {
    provider,
    name: modelName,
  };

  // Discover sessions to index
  if (verbose) {
    console.log('Discovering sessions to index...');
  }

  const { allSessions, sessionsToIndex } = await discoverNewSessions(projectPath, force);

  if (verbose) {
    console.log(`Found ${allSessions.length} total sessions, ${sessionsToIndex.length} to index`);
  }

  if (sessionsToIndex.length === 0) {
    if (verbose) {
      console.log('No sessions to index');
    }
    return { indexed: 0, skipped: allSessions.length, failed: 0 };
  }

  // Load existing index
  let existingIndex: SessionAnalysisIndex | null = null;
  if (await hasAnalysisIndex(projectPath)) {
    try {
      existingIndex = await readAnalysisIndex(projectPath);
    } catch (error) {
      console.warn('Failed to load existing index, creating new one');
    }
  }

  // Process sessions in batches
  const allNewEntries: SessionAnalysisEntry[] = [];
  let failedCount = 0;

  for (let i = 0; i < sessionsToIndex.length; i += batchSize) {
    const batch = sessionsToIndex.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(sessionsToIndex.length / batchSize);

    if (verbose) {
      console.log(`\nProcessing batch ${batchNum}/${totalBatches} (${batch.length} sessions)...`);
    }

    try {
      const batchResults = await batchAnalyzeSessions(batch, model, verbose);

      allNewEntries.push(...batchResults);

      // Calculate failures in this batch
      const batchFailed = batch.length - batchResults.length;
      failedCount += batchFailed;

      // Save intermediate results after each batch
      const mergedIndex = mergeAnalysisResults(
        existingIndex,
        allNewEntries,
        projectPath,
        modelUsed
      );
      await saveAnalysisIndex(projectPath, mergedIndex);

      if (verbose) {
        console.log(`  Batch ${batchNum} complete: ${batchResults.length} analyzed, ${batchFailed} failed`);
      }
    } catch (error) {
      console.error(`Batch ${batchNum} failed:`, error);
      failedCount += batch.length;
    }
  }

  // Final save
  const finalIndex = mergeAnalysisResults(
    existingIndex,
    allNewEntries,
    projectPath,
    modelUsed
  );
  await saveAnalysisIndex(projectPath, finalIndex);

  const indexed = allNewEntries.length;
  const skipped = allSessions.length - sessionsToIndex.length;

  return { indexed, skipped, failed: failedCount };
}
