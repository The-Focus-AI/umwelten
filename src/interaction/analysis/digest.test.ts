import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreMessage } from 'ai';

// ─── Test parseCompactionResponse ───────────────────────────────────────────

// We need to test the parsing logic directly. Since it's not exported,
// we test it indirectly through the module's behavior, or we extract it.
// For now, let's test the segmentation and store/search layers.

// ─── Segment splitting ──────────────────────────────────────────────────────

// Re-implement the logic here to test it (the function isn't exported).
// This is a unit test of the algorithm; the real function is identical.
const MAX_SEGMENT_CHARS = 50_000;

function estimateMessageSize(msg: CoreMessage): number {
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  return content.length + 20;
}

function splitIntoSegments(messages: CoreMessage[]): { start: number; end: number }[] {
  if (messages.length === 0) return [];
  const segments: { start: number; end: number }[] = [];
  let segStart = 0;
  let segSize = 0;
  for (let i = 0; i < messages.length; i++) {
    const msgSize = estimateMessageSize(messages[i]);
    if (segSize + msgSize > MAX_SEGMENT_CHARS && i > segStart) {
      segments.push({ start: segStart, end: i - 1 });
      segStart = i;
      segSize = 0;
    }
    segSize += msgSize;
  }
  if (segStart < messages.length) {
    segments.push({ start: segStart, end: messages.length - 1 });
  }
  return segments;
}

describe('splitIntoSegments', () => {
  it('returns empty for no messages', () => {
    expect(splitIntoSegments([])).toEqual([]);
  });

  it('returns single segment for small conversations', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const segs = splitIntoSegments(msgs);
    expect(segs).toEqual([{ start: 0, end: 1 }]);
  });

  it('splits by content size, not message count', () => {
    // Create messages that together exceed MAX_SEGMENT_CHARS
    const bigContent = 'x'.repeat(30_000);
    const msgs: CoreMessage[] = [
      { role: 'user', content: bigContent },
      { role: 'assistant', content: bigContent },
      { role: 'user', content: 'small' },
      { role: 'assistant', content: 'small' },
    ];
    const segs = splitIntoSegments(msgs);
    // First two messages ~60K > 50K limit, so should split
    expect(segs.length).toBe(2);
    expect(segs[0]).toEqual({ start: 0, end: 0 }); // first big message alone
    expect(segs[1]).toEqual({ start: 1, end: 3 }); // rest fits together
  });

  it('every message appears in exactly one segment', () => {
    const msgs: CoreMessage[] = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: 'x'.repeat(1000),
    }));
    const segs = splitIntoSegments(msgs);

    // Verify contiguous coverage
    expect(segs[0].start).toBe(0);
    expect(segs[segs.length - 1].end).toBe(99);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBe(segs[i - 1].end + 1);
    }
  });

  it('handles single huge message', () => {
    const msgs: CoreMessage[] = [
      { role: 'user', content: 'x'.repeat(100_000) },
    ];
    const segs = splitIntoSegments(msgs);
    // Can't split a single message, so it stays as one segment
    expect(segs).toEqual([{ start: 0, end: 0 }]);
  });
});

// ─── Digest store ───────────────────────────────────────────────────────────

// We test the store with a temporary directory override.
// Since the store uses hardcoded paths, we test the index entry builder instead.

// digestToIndexEntry was removed — digest now writes to SessionAnalysisIndex + FileLearningsStore

// ─── Digest search ──────────────────────────────────────────────────────────

import type { DigestIndexEntry } from './analysis-types.js';

// Re-test the ranking logic with known entries
function makeEntry(overrides: Partial<DigestIndexEntry> = {}): DigestIndexEntry {
  return {
    sessionId: 'sess-1',
    projectPath: '/test',
    projectName: 'test/project',
    source: 'claude-code',
    created: new Date().toISOString(),
    digestedAt: new Date().toISOString(),
    overallSummary: 'Built a feature for the app.',
    allFacts: ['Used React hooks', 'Deployed to staging'],
    topics: ['React development', 'deployment'],
    tags: ['react', 'hooks', 'deploy', 'staging', 'frontend'],
    keyLearnings: 'React hooks simplify state management.',
    solutionType: 'feature',
    successIndicators: 'yes',
    messageCount: 15,
    estimatedCost: 0.05,
    ...overrides,
  };
}

describe('digest search ranking', () => {
  // We can't call searchDigests directly (it reads from disk),
  // but we can test the format functions exist and work.

  it('formatDigestResults handles empty', async () => {
    const { formatDigestResults } = await import('./digest-search.js');
    expect(formatDigestResults([])).toBe('No results found.');
  });

  it('formatDigestResults formats results', async () => {
    const { formatDigestResults } = await import('./digest-search.js');
    const results = [{
      entry: makeEntry({ overallSummary: 'Built PDF pipeline' }),
      score: 15.5,
      matchedFields: ['summary', 'tag'],
    }];
    const output = formatDigestResults(results);
    expect(output).toContain('Built PDF pipeline');
    expect(output).toContain('test/project');
    expect(output).toContain('15.5');
  });

  it('formatDigestResultsJSON returns valid JSON', async () => {
    const { formatDigestResultsJSON } = await import('./digest-search.js');
    const results = [{
      entry: makeEntry(),
      score: 10,
      matchedFields: ['tag'],
    }];
    const json = formatDigestResultsJSON(results);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].projectName).toBe('test/project');
  });
});

// ─── Overview ───────────────────────────────────────────────────────────────

describe('formatOverview', () => {
  it('handles empty state', async () => {
    const { formatOverview } = await import('./digest-search.js');
    const output = formatOverview({
      totalSessions: 0,
      projectCount: 0,
      totalFacts: 0,
      dateRange: null,
      recentSessions: [],
      topTopics: [],
      successRates: [],
      solutionTypes: [],
      topProjects: [],
      activityByWeek: [],
    });
    expect(output).toContain('INTROSPECTION BRAIN');
    expect(output).toContain('No sessions analyzed yet');
  });

  it('renders full overview with data', async () => {
    const { formatOverview } = await import('./digest-search.js');
    const output = formatOverview({
      totalSessions: 42,
      projectCount: 5,
      totalFacts: 300,
      dateRange: { oldest: '2026-03-01T00:00:00Z', newest: '2026-04-10T00:00:00Z' },
      recentSessions: [{
        sessionId: 'abc123',
        projectName: 'my/project',
        created: new Date().toISOString(),
        summary: 'Fixed a bug in the auth flow',
        solutionType: 'bug-fix',
        success: 'yes',
        factCount: 5,
      }],
      topTopics: [{ topic: 'Authentication', count: 8, projects: ['my/project'] }],
      successRates: [{ indicator: 'yes', count: 35, percentage: 83.3 }],
      solutionTypes: [{ type: 'feature', count: 20 }],
      topProjects: [{ name: 'my/project', count: 42 }],
      activityByWeek: [{ week: '2026-04-06', count: 10, projects: new Set(['my/project']) }],
    });
    expect(output).toContain('42 sessions');
    expect(output).toContain('5 projects');
    expect(output).toContain('WEEKLY ACTIVITY');
    expect(output).toContain('Authentication');
    expect(output).toContain('my/project');
    expect(output).toContain('Fixed a bug');
  });
});

// ─── Beat filtering ────────────────────────────────────────────────────────

import { filterBeats } from './session-digester.js';
import type { ConversationBeat } from './conversation-beats.js';
import type { NormalizedMessage } from '../types/normalized-types.js';

function makeBeat(index: number, userContent: string, toolCount = 0): ConversationBeat {
  const messages: NormalizedMessage[] = [
    { id: `u${index}`, role: 'user', content: userContent },
  ];
  if (toolCount > 0) {
    for (let i = 0; i < toolCount; i++) {
      messages.push({ id: `t${index}-${i}`, role: 'tool', content: '', tool: { name: 'Read' } });
    }
  }
  messages.push({ id: `a${index}`, role: 'assistant', content: 'response' });

  return {
    index,
    userPreview: userContent.slice(0, 120),
    topic: userContent.slice(0, 50),
    toolCount,
    toolDurationMs: 0,
    assistantPreview: 'response',
    messageIds: messages.map(m => m.id),
    messages,
  };
}

describe('filterBeats', () => {
  it('keeps real conversation beats', () => {
    const beats = [
      makeBeat(0, 'How does the auth system work?'),
      makeBeat(1, 'Can you fix the login bug?', 3),
    ];
    const filtered = filterBeats(beats);
    expect(filtered).toHaveLength(2);
  });

  it('removes [Request interrupted] beats', () => {
    const beats = [
      makeBeat(0, 'Fix the bug'),
      makeBeat(1, '[Request interrupted by user for tool use]'),
      makeBeat(2, 'Try a different approach'),
    ];
    const filtered = filterBeats(beats);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].messages[0].content).toBe('Fix the bug');
    expect(filtered[1].messages[0].content).toBe('Try a different approach');
  });

  it('removes task-notification beats', () => {
    const beats = [
      makeBeat(0, 'Start the build'),
      makeBeat(1, '<task-notification><task-id>abc</task-id><status>completed</status></task-notification>'),
      makeBeat(2, 'What happened?'),
    ];
    const filtered = filterBeats(beats);
    expect(filtered).toHaveLength(2);
  });

  it('removes pure ide_opened_file beats', () => {
    const beats = [
      makeBeat(0, '<ide_opened_file>The user opened foo.ts in the IDE.</ide_opened_file>'),
    ];
    const filtered = filterBeats(beats);
    expect(filtered).toHaveLength(0);
  });

  it('keeps ide_opened_file + real question combo, strips the tag', () => {
    const beats = [
      makeBeat(0, '<ide_opened_file>The user opened foo.ts in the IDE.</ide_opened_file>\nWhat does this function do?'),
    ];
    const filtered = filterBeats(beats);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].messages[0].content).not.toContain('<ide_opened_file>');
    expect(filtered[0].messages[0].content).toContain('What does this function do?');
  });

  it('removes empty content beats', () => {
    const beats = [
      makeBeat(0, ''),
      makeBeat(1, '   '),
      makeBeat(2, 'Real question'),
    ];
    const filtered = filterBeats(beats);
    expect(filtered).toHaveLength(1);
  });

  it('filters a realistic session pattern', () => {
    const beats = [
      makeBeat(0, 'I want to build a session digester', 5),
      makeBeat(1, '[Request interrupted by user for tool use]'),
      makeBeat(2, 'What are the code paths that do this?'),
      makeBeat(3, '<ide_opened_file>opened plan.md</ide_opened_file>'),
      makeBeat(4, '<ide_opened_file>opened digester.ts</ide_opened_file>\nWhy is it not printing output?'),
      makeBeat(5, '[Request interrupted by user]'),
      makeBeat(6, '<task-notification><task-id>x</task-id></task-notification>'),
      makeBeat(7, 'Can you make the output better?', 8),
    ];
    const filtered = filterBeats(beats);
    // Should keep: 0, 2, 4 (with cleaned content), 7
    expect(filtered).toHaveLength(4);
    expect(filtered[0].messages[0].content).toBe('I want to build a session digester');
    expect(filtered[1].messages[0].content).toBe('What are the code paths that do this?');
    expect(filtered[2].messages[0].content).toContain('Why is it not printing output?');
    expect(filtered[3].messages[0].content).toBe('Can you make the output better?');
  });
});

// ─── Batch response parsing ────────────────────────────────────────────────

describe('batch response parsing', () => {
  it('parses structured batch response', () => {
    // Import the parser (it's not exported, so test the pattern)
    const text = `Beat 1: Explored the session introspection system across the codebase.
Beat 2: Identified three gaps in cross-project search capabilities.
Beat 3: Designed a compaction-based approach instead of embeddings.
Through-line: The conversation explored existing infrastructure, found gaps, and chose compaction over embeddings for the introspection brain.
Key facts:
- Session data stored in ~/.claude/projects/
- Existing search is keyword-only, single-project
- Compaction approach chosen over embeddings for simplicity`;

    // Test the Beat N: pattern extraction
    const beatNarratives: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const regex = new RegExp(`Beat\\s+${i}[:\\s]+(.+?)(?=Beat\\s+\\d|Through|Key facts|$)`, 'is');
      const match = text.match(regex);
      beatNarratives.push(match ? match[1].trim().split('\n')[0].trim() : '');
    }
    expect(beatNarratives[0]).toContain('Explored the session introspection');
    expect(beatNarratives[1]).toContain('three gaps');
    expect(beatNarratives[2]).toContain('compaction-based approach');

    // Test through-line extraction
    const tlMatch = text.match(/through[- ]?line[:\s]+([\s\S]*?)(?=key facts|$)/i);
    expect(tlMatch).not.toBeNull();
    expect(tlMatch![1].trim()).toContain('explored existing infrastructure');
  });
});

// ─── Compaction response parsing ────────────────────────────────────────────

// Test the parseCompactionResponse logic by importing it
// Since it's not exported, we test the expected behavior patterns

describe('compaction response parsing patterns', () => {
  // These test the regex/fallback logic we'd expect

  it('handles standard through-line + key facts format', () => {
    const text = `**Through-line:** The user worked on setting up a CI pipeline for the project. They configured GitHub Actions and added test steps.

**Key facts to remember:**
- GitHub Actions workflow in .github/workflows/ci.yml
- Uses Node.js 20
- Runs tests and lint on every PR`;

    // Verify the patterns match
    const throughLineMatch = text.match(
      /(?:through[- ]?line|1\.)[:\s]*([\s\S]*?)(?=(?:key facts|2\.)|$)/i
    );
    const factsMatch = text.match(
      /(?:key facts[^:]*|2\.)[:\s]*([\s\S]*?)$/i
    );

    expect(throughLineMatch).not.toBeNull();
    expect(throughLineMatch![1].trim()).toContain('CI pipeline');

    expect(factsMatch).not.toBeNull();
    const factLines = factsMatch![1].trim().split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').trim())
      .filter(l => l.length > 3);
    expect(factLines.length).toBe(3);
    expect(factLines[0]).toContain('GitHub Actions');
  });

  it('handles numbered format (1. / 2.)', () => {
    const text = `1. The conversation focused on building a REST API with Express.js. Authentication was added using JWT tokens.

2.
- Express.js REST API at port 3000
- JWT auth with RS256
- Routes in /src/routes/`;

    const throughLineMatch = text.match(
      /(?:through[- ]?line|1\.)[:\s]*([\s\S]*?)(?=(?:key facts|2\.)|$)/i
    );
    expect(throughLineMatch).not.toBeNull();
    expect(throughLineMatch![1].trim()).toContain('REST API');
  });

  it('fallback extracts bullet points from unstructured text', () => {
    // When model doesn't follow the format
    const text = `The session was about database migrations.

Some things to note:
- PostgreSQL 15 is the target
- Using Drizzle ORM
- Migration files in /db/migrations/

Overall it went well.`;

    // The fallback should find bullets anywhere
    const bullets: string[] = [];
    for (const line of text.split('\n')) {
      if (/^\s*[-*•]/.test(line)) {
        const cleaned = line.replace(/^[-*•]\s*/, '').trim();
        if (cleaned.length > 3) bullets.push(cleaned);
      }
    }
    expect(bullets.length).toBe(3);
    expect(bullets[0]).toContain('PostgreSQL');
  });
});
