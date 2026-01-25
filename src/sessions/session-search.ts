import type {
  SessionAnalysisIndex,
  SessionAnalysisEntry,
  SearchOptions,
  ScoredSearchResult,
} from './analysis-types.js';
import { readAnalysisIndex } from './session-store.js';

/**
 * Filter entries by tags
 */
export function filterByTags(
  entries: SessionAnalysisEntry[],
  tags: string[]
): SessionAnalysisEntry[] {
  return entries.filter(entry =>
    tags.some(tag =>
      entry.analysis.tags.some(
        entryTag => entryTag.toLowerCase() === tag.toLowerCase()
      )
    )
  );
}

/**
 * Filter entries by topic
 */
export function filterByTopic(
  entries: SessionAnalysisEntry[],
  topic: string
): SessionAnalysisEntry[] {
  const lowerTopic = topic.toLowerCase();
  return entries.filter(entry =>
    entry.analysis.topics.some(t => t.toLowerCase().includes(lowerTopic))
  );
}

/**
 * Filter entries by tool usage
 */
export function filterByTool(
  entries: SessionAnalysisEntry[],
  tool: string
): SessionAnalysisEntry[] {
  const lowerTool = tool.toLowerCase();
  return entries.filter(entry =>
    entry.analysis.toolsUsed.some(t => t.toLowerCase().includes(lowerTool))
  );
}

/**
 * Filter entries by solution type
 */
export function filterBySolutionType(
  entries: SessionAnalysisEntry[],
  solutionType: string
): SessionAnalysisEntry[] {
  return entries.filter(
    entry => entry.analysis.solutionType === solutionType
  );
}

/**
 * Filter entries by success indicator
 */
export function filterBySuccess(
  entries: SessionAnalysisEntry[],
  successIndicator: string
): SessionAnalysisEntry[] {
  return entries.filter(
    entry => entry.analysis.successIndicators === successIndicator
  );
}

/**
 * Filter entries by git branch
 */
export function filterByBranch(
  entries: SessionAnalysisEntry[],
  branch: string
): SessionAnalysisEntry[] {
  return entries.filter(entry => entry.metadata.gitBranch === branch);
}

/**
 * Rank search results by relevance
 */
export function rankResults(
  query: string,
  entries: SessionAnalysisEntry[]
): ScoredSearchResult[] {
  const lowerQuery = query.toLowerCase();
  const now = Date.now();

  return entries.map(entry => {
    let score = 0;
    const matchedFields: string[] = [];

    // Exact tag match: +10 points
    if (entry.analysis.tags.some(tag => tag.toLowerCase() === lowerQuery)) {
      score += 10;
      matchedFields.push('tag (exact)');
    }

    // Partial tag match: +7 points
    if (entry.analysis.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
      score += 7;
      matchedFields.push('tag');
    }

    // Topic match: +5 points
    if (entry.analysis.topics.some(topic => topic.toLowerCase().includes(lowerQuery))) {
      score += 5;
      matchedFields.push('topic');
    }

    // Summary match: +3 points
    if (entry.analysis.summary.toLowerCase().includes(lowerQuery)) {
      score += 3;
      matchedFields.push('summary');
    }

    // Key learnings match: +3 points
    if (entry.analysis.keyLearnings.toLowerCase().includes(lowerQuery)) {
      score += 3;
      matchedFields.push('learnings');
    }

    // Tool match: +2 points
    if (entry.analysis.toolsUsed.some(tool => tool.toLowerCase().includes(lowerQuery))) {
      score += 2;
      matchedFields.push('tool');
    }

    // First prompt match: +1 point
    if (entry.metadata.firstPrompt.toLowerCase().includes(lowerQuery)) {
      score += 1;
      matchedFields.push('prompt');
    }

    // Recency bonus: +5 decaying over 30 days
    const daysOld = (now - new Date(entry.metadata.created).getTime()) / (1000 * 60 * 60 * 24);
    const recencyBonus = Math.max(0, 5 - (daysOld / 30) * 5);
    score += recencyBonus;
    if (recencyBonus > 1) {
      matchedFields.push('recent');
    }

    // Success indicator bonus: +2 for "yes"
    if (entry.analysis.successIndicators === 'yes') {
      score += 2;
      matchedFields.push('success');
    }

    return {
      entry,
      score,
      matchedFields,
    };
  }).sort((a, b) => b.score - a.score); // Sort by score descending
}

/**
 * Search sessions with optional query and filters
 */
export async function searchSessions(
  query: string | undefined,
  options: SearchOptions
): Promise<ScoredSearchResult[]> {
  // Load analysis index
  const analysisIndex = await readAnalysisIndex(options.projectPath);

  let results = analysisIndex.entries;

  // Apply filters
  if (options.tags && options.tags.length > 0) {
    results = filterByTags(results, options.tags);
  }

  if (options.topic) {
    results = filterByTopic(results, options.topic);
  }

  if (options.tool) {
    results = filterByTool(results, options.tool);
  }

  if (options.solutionType) {
    results = filterBySolutionType(results, options.solutionType);
  }

  if (options.successIndicator) {
    results = filterBySuccess(results, options.successIndicator);
  }

  if (options.branch) {
    results = filterByBranch(results, options.branch);
  }

  // Rank results if query is provided
  let scoredResults: ScoredSearchResult[];

  if (query) {
    scoredResults = rankResults(query, results);
  } else {
    // No query - just score by recency and success
    scoredResults = rankResults('', results);
  }

  // Apply limit
  const limit = options.limit || 10;
  return scoredResults.slice(0, limit);
}

/**
 * Format search results as text
 */
export function formatSearchResults(results: ScoredSearchResult[]): string {
  if (results.length === 0) {
    return 'No results found.';
  }

  const lines: string[] = [];
  lines.push(`Results (${results.length} found):`);
  lines.push('');

  for (let i = 0; i < results.length; i++) {
    const { entry, score, matchedFields } = results[i];

    // Format success indicator
    let successIcon = '';
    switch (entry.analysis.successIndicators) {
      case 'yes':
        successIcon = '⭐ Success';
        break;
      case 'partial':
        successIcon = '⚠️  Partial';
        break;
      case 'no':
        successIcon = '❌ Failed';
        break;
      case 'unclear':
        successIcon = '❓ Unclear';
        break;
    }

    // Format date
    const createdDate = new Date(entry.metadata.created);
    const now = new Date();
    const daysAgo = Math.floor((now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
    let timeStr: string;
    if (daysAgo === 0) {
      timeStr = 'today';
    } else if (daysAgo === 1) {
      timeStr = '1 day ago';
    } else if (daysAgo < 7) {
      timeStr = `${daysAgo} days ago`;
    } else if (daysAgo < 30) {
      const weeksAgo = Math.floor(daysAgo / 7);
      timeStr = weeksAgo === 1 ? '1 week ago' : `${weeksAgo} weeks ago`;
    } else {
      const monthsAgo = Math.floor(daysAgo / 30);
      timeStr = monthsAgo === 1 ? '1 month ago' : `${monthsAgo} months ago`;
    }

    lines.push(`${i + 1}. Session: ${entry.sessionId} (${timeStr}) ${successIcon}`);
    lines.push(`   Branch: ${entry.metadata.gitBranch}`);
    lines.push(`   Summary: ${entry.analysis.summary}`);
    lines.push(`   Tags: ${entry.analysis.tags.join(', ')}`);

    // Show key learnings if available
    if (entry.analysis.keyLearnings) {
      const learnings = entry.analysis.keyLearnings
        .split('\n')
        .map(l => `            ${l.trim()}`)
        .join('\n');
      lines.push(`   Key Learning: ${entry.analysis.keyLearnings}`);
    }

    // Show match info if verbose
    if (matchedFields.length > 0) {
      lines.push(`   Matched: ${matchedFields.join(', ')} (score: ${score.toFixed(1)})`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format search results as JSON
 */
export function formatSearchResultsJSON(results: ScoredSearchResult[]): string {
  const formatted = results.map(({ entry, score, matchedFields }) => ({
    sessionId: entry.sessionId,
    score,
    matchedFields,
    branch: entry.metadata.gitBranch,
    created: entry.metadata.created,
    summary: entry.analysis.summary,
    topics: entry.analysis.topics,
    tags: entry.analysis.tags,
    keyLearnings: entry.analysis.keyLearnings,
    solutionType: entry.analysis.solutionType,
    successIndicators: entry.analysis.successIndicators,
    toolsUsed: entry.analysis.toolsUsed,
    relatedFiles: entry.analysis.relatedFiles,
  }));

  return JSON.stringify(formatted, null, 2);
}

/**
 * Aggregate analysis - get top topics
 */
export async function getTopTopics(
  projectPath: string,
  limit: number = 10
): Promise<{ topic: string; count: number }[]> {
  const analysisIndex = await readAnalysisIndex(projectPath);

  const topicCounts = new Map<string, number>();

  for (const entry of analysisIndex.entries) {
    for (const topic of entry.analysis.topics) {
      const count = topicCounts.get(topic) || 0;
      topicCounts.set(topic, count + 1);
    }
  }

  const sorted = Array.from(topicCounts.entries())
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);

  return sorted.slice(0, limit);
}

/**
 * Aggregate analysis - get top tools
 */
export async function getTopTools(
  projectPath: string,
  limit: number = 10
): Promise<{ tool: string; count: number }[]> {
  const analysisIndex = await readAnalysisIndex(projectPath);

  const toolCounts = new Map<string, number>();

  for (const entry of analysisIndex.entries) {
    for (const tool of entry.analysis.toolsUsed) {
      const count = toolCounts.get(tool) || 0;
      toolCounts.set(tool, count + 1);
    }
  }

  const sorted = Array.from(toolCounts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  return sorted.slice(0, limit);
}

/**
 * Aggregate analysis - get patterns
 */
export async function getPatterns(
  projectPath: string
): Promise<{
  totalSessions: number;
  solutionTypes: { type: string; count: number }[];
  successRates: { indicator: string; count: number; percentage: number }[];
  languages: { language: string; count: number }[];
}> {
  const analysisIndex = await readAnalysisIndex(projectPath);

  const total = analysisIndex.entries.length;

  // Solution types
  const solutionTypeCounts = new Map<string, number>();
  for (const entry of analysisIndex.entries) {
    const count = solutionTypeCounts.get(entry.analysis.solutionType) || 0;
    solutionTypeCounts.set(entry.analysis.solutionType, count + 1);
  }

  const solutionTypes = Array.from(solutionTypeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  // Success rates
  const successCounts = new Map<string, number>();
  for (const entry of analysisIndex.entries) {
    const count = successCounts.get(entry.analysis.successIndicators) || 0;
    successCounts.set(entry.analysis.successIndicators, count + 1);
  }

  const successRates = Array.from(successCounts.entries())
    .map(([indicator, count]) => ({
      indicator,
      count,
      percentage: (count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Languages
  const languageCounts = new Map<string, number>();
  for (const entry of analysisIndex.entries) {
    for (const lang of entry.analysis.codeLanguages) {
      const count = languageCounts.get(lang) || 0;
      languageCounts.set(lang, count + 1);
    }
  }

  const languages = Array.from(languageCounts.entries())
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalSessions: total,
    solutionTypes,
    successRates,
    languages,
  };
}
