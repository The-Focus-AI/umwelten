/**
 * Session digester — run compaction + analysis + fact extraction on read-only sessions.
 *
 * Uses the habitat compaction system (CompactionStrategy, FileLearningsStore, SessionHandle)
 * for all storage and compaction. Adds beat analysis, phase detection, and cross-project
 * discovery on top.
 */

import type { CoreMessage } from 'ai';
import type { ModelDetails } from '../../cognition/types.js';
import type { SessionIndexEntry } from '../types/types.js';
import type {
  SessionDigest,
  DigestSegment,
  DigestBeat,
  DigestPhase,
  DigestOptions,
  AnalysisModelDetails,
} from './analysis-types.js';
import {
  parseSessionFile,
  summarizeSession,
  extractToolCalls,
  getBeatsForSession,
} from '../persistence/session-parser.js';
import { messagesToBeats } from './conversation-beats.js';
import {
  getProjectSessionsIncludingFromDirectory,
} from '../persistence/session-store.js';
import {
  analyzeSessionWithRetry,
} from './session-analyzer.js';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { readdir } from 'node:fs/promises';

// System B imports — the habitat infrastructure
import { getCompactionStrategy } from '../../context/registry.js';
import { BaseModelRunner } from '../../cognition/runner.js';
import { Stimulus } from '../../stimulus/stimulus.js';
import { Interaction } from '../core/interaction.js';
import { FileLearningsStore } from '../../session-record/learnings-store.js';
import { resolveClaudeCodeSessionHandle } from '../../session-record/resolve-claude.js';
import type { LearningProvenance } from '../../session-record/types.js';
import {
  saveAnalysisIndex,
  readAnalysisIndex,
  hasAnalysisIndex,
} from '../persistence/session-store.js';

// ─── Noise detection & beat filtering ───────────────────────────────────────

const NOISE_PATTERNS = [
  /^\[Request interrupted/,
  /^<task-notification>/,
  /^<ide_opened_file>.*<\/ide_opened_file>\s*$/,
  /^<system-reminder>/,
];

function isNoiseBeat(userContent: string): boolean {
  const clean = userContent.trim();
  if (!clean) return true;
  return NOISE_PATTERNS.some(p => p.test(clean));
}

function stripXmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, '').trim();
}

/**
 * Filter raw beats: drop noise, clean IDE-event + real-question combos.
 */
export function filterBeats(rawBeats: ReturnType<typeof messagesToBeats>): ReturnType<typeof messagesToBeats> {
  const filtered: typeof rawBeats = [];

  for (const beat of rawBeats) {
    const userMsg = beat.messages.find(m => m.role === 'user');
    const userContent = userMsg?.content || '';

    if (isNoiseBeat(userContent)) continue;

    if (userContent.includes('<ide_opened_file>') && stripXmlTags(userContent).length > 10) {
      if (userMsg) userMsg.content = stripXmlTags(userContent);
    }

    filtered.push(beat);
  }

  return filtered;
}

// ─── Batch beat compaction prompt ───────────────────────────────────────────

const BATCH_BEAT_PROMPT = `You are analyzing a segment of a software development conversation between a user and an AI assistant. Below are several "beats" — each beat is one user request and the assistant's response.

Your job is to extract KNOWLEDGE from this conversation — not just summarize what happened, but capture what was learned, decided, built, broken, and left unfinished.

For each beat, write ONE sentence describing: what was asked, what was done, and what the outcome was.

Then write a "Through-line" (2-3 sentences) explaining the narrative arc of this group — what problem was being solved and how the approach evolved.

Then classify the extracted knowledge into these categories:

FACTS: Concrete things that are now known — technical details, architecture decisions, API behaviors, configuration values. Write these as reusable knowledge, not changelog entries.
PLAYBOOKS: Patterns or procedures that worked — "to do X, you need to Y." Things someone could follow in the future.
MISTAKES: Things that went wrong and were corrected. What was the error, why did it happen, what was the fix? These prevent repeating the same mistakes.
OPEN_LOOPS: Things left unfinished, deferred, or explicitly marked as future work. Unanswered questions.
PREFERENCES: User preferences expressed — how they want things done, what they rejected, what style they prefer.

Format your response EXACTLY like this:
Beat 1: <one sentence>
Beat 2: <one sentence>
...
Through-line: <2-3 sentences>
FACTS:
- <fact>
PLAYBOOKS:
- <playbook>
MISTAKES:
- <mistake>
OPEN_LOOPS:
- <open loop>
PREFERENCES:
- <preference>

If a category has no entries, write "- (none)" for that category.

CONVERSATION BEATS:
`;

export interface ClassifiedLearnings {
  facts: string[];
  playbooks: string[];
  mistakes: string[];
  open_loops: string[];
  preferences: string[];
}

function parseBatchResponse(text: string, beatCount: number): {
  beatNarratives: string[];
  throughLine: string;
  learnings: ClassifiedLearnings;
} {
  const beatNarratives: string[] = [];
  for (let i = 1; i <= beatCount; i++) {
    const regex = new RegExp(`Beat\\s+${i}[:\\s]+(.+?)(?=Beat\\s+\\d|Through|FACTS|$)`, 'is');
    const match = text.match(regex);
    beatNarratives.push(match ? match[1].trim().split('\n')[0].trim() : '');
  }
  while (beatNarratives.length < beatCount) beatNarratives.push('');

  const tlMatch = text.match(/through[- ]?line[:\s]+([\s\S]*?)(?=FACTS|$)/i);
  const throughLine = tlMatch
    ? tlMatch[1].trim().split('\n').filter(l => l.trim()).slice(0, 3).join(' ')
    : '';

  // Extract each category
  function extractCategory(label: string, nextLabels: string[]): string[] {
    const nextPattern = nextLabels.map(l => l.replace(/_/g, '[_ ]')).join('|');
    const regex = new RegExp(`${label.replace(/_/g, '[_ ]')}[:\\s]*([\\s\\S]*?)(?=${nextPattern}|$)`, 'i');
    const match = text.match(regex);
    if (!match) return [];
    return match[1].trim().split('\n')
      .map(l => l.replace(/^[-*•]\s*/, '').replace(/^\*\*/g, '').replace(/\*\*$/g, '').trim())
      .filter(l => l.length > 3 && !l.startsWith('(none'));
  }

  const learnings: ClassifiedLearnings = {
    facts: extractCategory('FACTS', ['PLAYBOOKS', 'MISTAKES', 'OPEN_LOOPS', 'PREFERENCES']),
    playbooks: extractCategory('PLAYBOOKS', ['MISTAKES', 'OPEN_LOOPS', 'PREFERENCES']),
    mistakes: extractCategory('MISTAKES', ['OPEN_LOOPS', 'PREFERENCES']),
    open_loops: extractCategory('OPEN_LOOPS', ['PREFERENCES']),
    preferences: extractCategory('PREFERENCES', []),
  };

  return { beatNarratives, throughLine: throughLine || text.slice(0, 200), learnings };
}

// ─── Compaction via System B strategy ───────────────────────────────────────

/**
 * Run compaction using the registered through-line-and-facts strategy.
 * Falls back gracefully if the strategy isn't available.
 */
async function compactViaStrategy(
  text: string,
  model: ModelDetails,
): Promise<string> {
  const strategy = await getCompactionStrategy('through-line-and-facts');
  const runner = new BaseModelRunner();

  if (strategy) {
    const messages: CoreMessage[] = [
      { role: 'user', content: 'placeholder' },
      { role: 'user', content: text },
      { role: 'assistant', content: 'Acknowledged.' },
    ];
    const result = await strategy.compact({
      messages,
      segmentStart: 1,
      segmentEnd: 2,
      model,
      runner,
    });
    const content = result.replacementMessages[0]?.content;
    return typeof content === 'string' ? content : String(content ?? '');
  }

  // Fallback: direct LLM call
  const stimulus = new Stimulus({
    role: 'summarizer',
    objective: 'condense conversation to through-line and key facts',
    instructions: ['Summarize the conversation segment. Output: 1) Through-line (2-4 sentences) 2) Key facts (bullet points)'],
    runnerType: 'base',
  });
  const interaction = new Interaction(model, stimulus);
  interaction.addMessage({ role: 'user', content: text });
  const response = await runner.generateText(interaction);
  return typeof response.content === 'string' ? response.content : String(response.content ?? '');
}

// ─── Single session digestion ───────────────────────────────────────────────

export interface DigestProgress {
  phase: 'loading' | 'compacting' | 'analyzing' | 'extracting' | 'saving';
  detail?: string;
}

export async function digestSession(
  session: SessionIndexEntry,
  projectPath: string,
  projectName: string,
  model: ModelDetails,
  onProgress?: (p: DigestProgress) => void,
): Promise<SessionDigest | null> {
  if (!session.fullPath) return null;

  try {
    // 1. Load session and get beats
    onProgress?.({ phase: 'loading', detail: session.sessionId.slice(0, 8) });
    const rawMessages = await parseSessionFile(session.fullPath);
    const summary = summarizeSession(rawMessages);
    const toolCallsList = extractToolCalls(rawMessages);

    if (summary.totalMessages < 2) return null;

    const { beats: rawBeats } = await getBeatsForSession(rawMessages);
    if (rawBeats.length === 0) return null;

    // 2. Filter noise beats
    const beats = filterBeats(rawBeats);
    console.log(`  ${rawBeats.length} raw beats → ${beats.length} after filtering`);

    // 3. Build beat structures
    const digestBeats: DigestBeat[] = beats.map((beat, i) => {
      const userMsg = beat.messages.find(m => m.role === 'user');
      const userRequest = stripXmlTags(userMsg?.content || beat.userPreview);

      const toolCounts = new Map<string, number>();
      for (const m of beat.messages) {
        if (m.role === 'tool' && m.tool?.name) {
          toolCounts.set(m.tool.name, (toolCounts.get(m.tool.name) || 0) + 1);
        }
      }
      const toolsUsed = Array.from(toolCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      const assistantMsgs = beat.messages.filter(m => m.role === 'assistant' && m.content.trim());
      const outcome = assistantMsgs.length > 0
        ? assistantMsgs[assistantMsgs.length - 1].content
        : '';

      return { index: i, userRequest, toolsUsed, outcome, narrative: '', keyFacts: [] };
    });

    // 4. Batch-compact beats in groups of ~5
    const isLocal = model.provider === 'ollama' || model.provider === 'lmstudio' || model.provider === 'llamabarn';
    const BASE_DELAY_MS = isLocal ? 0 : 2000;
    const BEATS_PER_BATCH = 5;
    const digestSegments: DigestSegment[] = [];
    const allLearnings: ClassifiedLearnings = {
      facts: [], playbooks: [], mistakes: [], open_loops: [], preferences: [],
    };

    onProgress?.({ phase: 'compacting', detail: `${digestBeats.length} beats in groups of ${BEATS_PER_BATCH}` });

    for (let gi = 0; gi < digestBeats.length; gi += BEATS_PER_BATCH) {
      const group = digestBeats.slice(gi, gi + BEATS_PER_BATCH);
      const groupEnd = Math.min(gi + BEATS_PER_BATCH, digestBeats.length);

      if (gi > 0 && !isLocal) {
        await new Promise(r => setTimeout(r, BASE_DELAY_MS));
      }

      const beatsText = group.map((b, i) => {
        const toolStr = b.toolsUsed.length > 0
          ? `\nTools: ${b.toolsUsed.map(t => `${t.name}(${t.count})`).join(', ')}`
          : '';
        return `--- Beat ${i + 1} ---\nUser: ${b.userRequest}${toolStr}\nAssistant: ${b.outcome}`;
      }).join('\n\n');

      const batchInput = BATCH_BEAT_PROMPT + beatsText;
      const inputKb = Math.round(batchInput.length / 1024);
      console.log(`  compacting beats ${gi + 1}-${groupEnd} of ${digestBeats.length}... (${inputKb}KB)`);

      try {
        const stimulus = new Stimulus({
          role: 'knowledge extractor',
          objective: 'extract structured knowledge from conversation beats',
          instructions: [BATCH_BEAT_PROMPT.split('CONVERSATION BEATS:')[0]],
          runnerType: 'base',
        });
        const interaction = new Interaction(model, stimulus);
        interaction.addMessage({ role: 'user', content: batchInput });
        const runner = new BaseModelRunner();
        const response = await runner.generateText(interaction);
        const fullText = typeof response.content === 'string' ? response.content : String(response.content ?? '');

        const batchParsed = parseBatchResponse(fullText, group.length);

        for (let i = 0; i < group.length; i++) {
          group[i].narrative = batchParsed.beatNarratives[i] || batchParsed.throughLine;
          group[i].keyFacts = i === 0 ? batchParsed.learnings.facts : [];
        }

        // Accumulate all classified learnings
        for (const kind of ['facts', 'playbooks', 'mistakes', 'open_loops', 'preferences'] as const) {
          allLearnings[kind].push(...batchParsed.learnings[kind]);
        }

        digestSegments.push({
          index: digestSegments.length,
          messageRange: [group[0].index, group[group.length - 1].index],
          throughLine: batchParsed.throughLine,
          keyFacts: batchParsed.learnings.facts,
        });

        const totalExtracted = Object.values(batchParsed.learnings).reduce((a, b) => a + b.length, 0);
        console.log(`    done (${batchParsed.beatNarratives.filter(n => n).length}/${group.length} narratives, ${totalExtracted} learnings)`);
      } catch (err) {
        console.error(`  beats ${gi + 1}-${groupEnd} failed:`, err instanceof Error ? err.message : err);
        for (const b of group) {
          b.narrative = b.userRequest.slice(0, 200);
        }
      }
    }

    // 5. Detect phases
    console.log(`  detecting phases...`);
    let phases: DigestPhase[] = [];
    try {
      phases = await detectPhases(digestBeats, model);
    } catch {
      phases = [{
        name: 'Full Session',
        beatRange: [0, digestBeats.length - 1],
        description: digestSegments.map(s => s.throughLine).join(' '),
      }];
    }

    // 6. Run session analysis (delegates to System B's session-analyzer)
    console.log(`  analyzing session...`);
    const fallbackAnalysis = {
      topics: phases.map(p => p.name),
      tags: ['session', 'code', 'development'],
      keyLearnings: digestSegments.map(s => s.throughLine).join(' ') || '',
      summary: digestSegments[0]?.throughLine || session.firstPrompt || '',
      solutionType: 'other' as const,
      codeLanguages: [] as string[],
      toolsUsed: [] as string[],
      successIndicators: 'unclear' as const,
      relatedFiles: [] as string[],
    };

    let analysis;
    try {
      const result = await analyzeSessionWithRetry(session, model);
      analysis = result?.analysis ?? fallbackAnalysis;
    } catch {
      analysis = fallbackAnalysis;
    }

    // 7. Write all classified learnings to FileLearningsStore via SessionHandle
    const totalLearnings = Object.values(allLearnings).reduce((a, b) => a + b.length, 0);
    console.log(`  writing ${totalLearnings} learnings across ${Object.entries(allLearnings).filter(([,v]) => v.length > 0).length} categories...`);

    try {
      const handle = await resolveClaudeCodeSessionHandle({
        workDir: homedir(),
        projectPath,
        sessionUuid: session.sessionId,
      });

      const store = new FileLearningsStore(handle.learningsRoot);
      const provenance: LearningProvenance = {
        claudeProjectPath: projectPath,
        claudeSessionUuid: session.sessionId,
      };

      // Write all 5 learning categories
      for (const kind of ['facts', 'playbooks', 'mistakes', 'open_loops', 'preferences'] as const) {
        for (const text of allLearnings[kind]) {
          await store.append(kind, {
            payload: { text },
            provenance,
          });
        }
      }

      // Write phase summaries as playbooks too
      for (const phase of phases) {
        await store.append('playbooks', {
          payload: { phase: phase.name, beats: phase.beatRange, description: phase.description },
          provenance,
        });
      }

      // Log what was written
      for (const [kind, items] of Object.entries(allLearnings)) {
        if (items.length > 0) console.log(`    ${kind}: ${items.length}`);
      }
    } catch (err) {
      console.error(`  learnings write failed:`, err instanceof Error ? err.message : err);
    }

    // 8. Build digest
    const allFacts = allLearnings.facts;
    const overallSummary = digestSegments.map(s => s.throughLine).join(' ');

    const digest: SessionDigest = {
      sessionId: session.sessionId,
      projectPath,
      projectName,
      source: 'claude-code',
      created: session.created || new Date().toISOString(),
      modified: session.modified || new Date().toISOString(),
      digestedAt: new Date().toISOString(),
      segments: digestSegments,
      beats: digestBeats,
      phases,
      overallSummary,
      allFacts,
      analysis,
      extractedFacts: allFacts.map(f => ({ type: 'facts', text: f })),
      metrics: {
        messageCount: summary.totalMessages,
        segmentCount: digestSegments.length,
        toolCallCount: toolCallsList.length,
        estimatedCost: summary.estimatedCost,
        duration: summary.duration ?? 0,
      },
    };

    return digest;
  } catch (err) {
    console.error(`Failed to digest session ${session.sessionId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Detect conversation phases from beat narratives via LLM.
 */
async function detectPhases(
  beats: DigestBeat[],
  model: ModelDetails,
): Promise<DigestPhase[]> {
  const beatSummaries = beats.map((b, i) =>
    `Beat ${i + 1}: ${b.narrative || b.userRequest.slice(0, 100)}`
  ).join('\n');

  const prompt = `Given these beat summaries from a coding conversation, identify the distinct phases of the conversation. Focus on:
- Where did the approach CHANGE? (e.g., user rejected an idea, a bug was found, a redesign happened)
- What were the TURNING POINTS? (not just topic groupings)
- Where did mistakes get caught and corrected?

For each phase (3-6 total), give:
- A descriptive name that captures what HAPPENED, not just the topic (e.g., "Architecture Mistake Caught" not "Design Discussion")
- Beat range (e.g., "1-4")
- One sentence explaining the turning point or arc of this phase

Format:
Phase 1: <name> (beats <start>-<end>)
<description>

Phase 2: ...

BEATS:
${beatSummaries}`;

  const stimulus = new Stimulus({
    role: 'analyzer',
    objective: 'identify conversation phases',
    instructions: ['Identify distinct phases in this conversation. Be concise.'],
    runnerType: 'base',
  });
  const interaction = new Interaction(model, stimulus);
  interaction.addMessage({ role: 'user', content: prompt });

  const runner = new BaseModelRunner();
  const response = await runner.generateText(interaction);
  const text = typeof response.content === 'string' ? response.content : String(response.content ?? '');

  const phases: DigestPhase[] = [];
  const phaseRegex = /Phase\s+\d+:\s*(.+?)\s*\(beats?\s*(\d+)\s*[-–]\s*(\d+)\)\s*\n([^\n]+)/gi;
  let match;
  while ((match = phaseRegex.exec(text)) !== null) {
    phases.push({
      name: match[1].trim(),
      beatRange: [parseInt(match[2]) - 1, parseInt(match[3]) - 1],
      description: match[4].trim(),
    });
  }

  if (phases.length === 0) {
    const lines = text.split('\n').filter(l => l.trim());
    let currentPhase: Partial<DigestPhase> | null = null;
    for (const line of lines) {
      const nameMatch = line.match(/(?:Phase\s+\d+[:\s]*)?(.+?)\s*\(beats?\s*(\d+)\s*[-–]\s*(\d+)\)/i);
      if (nameMatch) {
        if (currentPhase?.name) phases.push(currentPhase as DigestPhase);
        currentPhase = {
          name: nameMatch[1].replace(/^\*+|\*+$/g, '').trim(),
          beatRange: [parseInt(nameMatch[2]) - 1, parseInt(nameMatch[3]) - 1],
          description: '',
        };
      } else if (currentPhase && !currentPhase.description && line.trim().length > 10) {
        currentPhase.description = line.replace(/^\*+|\*+$/g, '').trim();
      }
    }
    if (currentPhase?.name) phases.push(currentPhase as DigestPhase);
  }

  return phases.length > 0 ? phases : [{
    name: 'Full Session',
    beatRange: [0, beats.length - 1],
    description: beats[0]?.narrative || '',
  }];
}

// ─── Batch digestion ────────────────────────────────────────────────────────

export interface DigestResult {
  digested: number;
  skipped: number;
  failed: number;
  projectsProcessed: number;
}

/** Threshold: sessions with this many messages or fewer are "micro" (pipeline runs) */
const MICRO_SESSION_THRESHOLD = 10;

function projectDisplayName(projectPath: string): string {
  const parts = projectPath.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

/**
 * Check if a session has been digested by looking for learnings in the session handle.
 */
async function isSessionDigested(projectPath: string, sessionId: string): Promise<boolean> {
  try {
    const handle = await resolveClaudeCodeSessionHandle({
      workDir: homedir(),
      projectPath,
      sessionUuid: sessionId,
    });
    const store = new FileLearningsStore(handle.learningsRoot);
    const facts = await store.read('facts');
    return facts.length > 0;
  } catch {
    return false;
  }
}

/**
 * Digest all sessions in a single project.
 * Short automated sessions (<=10 messages) are batched together into one digest.
 */
export async function digestProject(
  projectPath: string,
  model: ModelDetails,
  modelUsed: AnalysisModelDetails,
  options: { force?: boolean; verbose?: boolean } = {},
): Promise<{ digested: number; skipped: number; failed: number }> {
  const { force = false, verbose = false } = options;
  const projectName = projectDisplayName(projectPath);

  let sessions: SessionIndexEntry[];
  try {
    sessions = await getProjectSessionsIncludingFromDirectory(projectPath);
  } catch {
    return { digested: 0, skipped: 0, failed: 0 };
  }

  const toProcess: SessionIndexEntry[] = [];
  let skipped = 0;

  for (const session of sessions) {
    if (!force && await isSessionDigested(projectPath, session.sessionId)) {
      skipped++;
      continue;
    }
    if (session.messageCount < 2) {
      skipped++;
      continue;
    }
    // Skip micro sessions for now (batch later)
    if (session.messageCount <= MICRO_SESSION_THRESHOLD) {
      skipped++;
      continue;
    }
    toProcess.push(session);
  }

  let digested = 0;
  let failed = 0;
  const isLocalModel = model.provider === 'ollama' || model.provider === 'lmstudio' || model.provider === 'llamabarn';

  for (let i = 0; i < toProcess.length; i++) {
    const session = toProcess[i];

    if (i > 0 && !isLocalModel) {
      await new Promise(r => setTimeout(r, 1000));
    }

    if (verbose) {
      const rawPrompt = (session.firstPrompt || '(no prompt)').replace(/<[^>]+>/g, '').trim();
      const prompt = rawPrompt.slice(0, 60) || '(no prompt)';
      console.log(`  Digesting ${session.sessionId.slice(0, 8)}… "${prompt}"`);
    }

    const digest = await digestSession(
      session, projectPath, projectName, model,
      verbose ? (p) => console.log(`    [${p.phase}${p.detail ? ': ' + p.detail : ''}]`) : undefined,
    );

    if (digest) {
      digested++;
      if (verbose) console.log(`    ✓ ${digest.segments.length} segments, ${digest.allFacts.length} facts`);
    } else {
      failed++;
    }
  }

  return { digested, skipped, failed };
}

/**
 * Discover ALL project paths from ~/.claude/projects/.
 */
async function discoverAllProjectPaths(): Promise<string[]> {
  const claudeDir = join(homedir(), '.claude', 'projects');
  const projects: string[] = [];

  try {
    const entries = await readdir(claudeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const files = await readdir(join(claudeDir, entry.name));
        const hasJsonl = files.some(f => f.endsWith('.jsonl'));
        if (hasJsonl) {
          const projectPath = entry.name.replace(/^-/, '/').replace(/-/g, '/');
          projects.push(projectPath);
        }
      } catch { /* skip */ }
    }
  } catch { /* ~/.claude/projects/ doesn't exist */ }

  return projects;
}

// ─── Ask questions about a session ──────────────────────────────────────────

// ─── Ask questions about a session ──────────────────────────────────────────

/**
 * Build the session context (beats + learnings) for analysis.
 * Shared by both one-shot `askAboutSession` and interactive `buildSessionAnalysisInteraction`.
 */
async function buildSessionContext(options: {
  sessionFile: string;
  projectPath: string;
  sessionId: string;
}): Promise<{ systemPrompt: string; beatCount: number }> {
  const { sessionFile, projectPath, sessionId } = options;

  console.log('  loading session...');
  const rawMessages = await parseSessionFile(sessionFile);
  const { beats: rawBeats } = await getBeatsForSession(rawMessages);
  const beats = filterBeats(rawBeats);

  const sessionContext = beats.map((beat, i) => {
    const userMsg = beat.messages.find(m => m.role === 'user');
    const userText = stripXmlTags(userMsg?.content || '').slice(0, 500);
    const assistantMsgs = beat.messages.filter(m => m.role === 'assistant' && m.content.trim());
    const outcome = assistantMsgs.length > 0
      ? assistantMsgs[assistantMsgs.length - 1].content.slice(0, 500)
      : '';
    const toolNames = beat.messages
      .filter(m => m.role === 'tool' && m.tool?.name)
      .map(m => m.tool!.name);
    const uniqueTools = [...new Set(toolNames)];
    const toolStr = uniqueTools.length > 0 ? ` [tools: ${uniqueTools.join(', ')}]` : '';
    return `Beat ${i + 1}: User: ${userText}${toolStr}\nOutcome: ${outcome}`;
  }).join('\n\n---\n\n');

  console.log('  loading learnings...');
  let learningsContext = '';
  try {
    const handle = await resolveClaudeCodeSessionHandle({
      workDir: homedir(),
      projectPath,
      sessionUuid: sessionId,
    });
    const store = new FileLearningsStore(handle.learningsRoot);
    const all = await store.readAll();

    const sections: string[] = [];
    for (const [kind, records] of Object.entries(all)) {
      if (records.length > 0) {
        sections.push(`### ${kind.toUpperCase()} (${records.length})`);
        for (const r of records) {
          const text = (r.payload as any)?.text || (r.payload as any)?.description || JSON.stringify(r.payload);
          sections.push(`- ${text}`);
        }
      }
    }
    if (sections.length > 0) {
      learningsContext = '\n\n## Extracted Knowledge\n\n' + sections.join('\n');
    }
  } catch { /* no learnings yet */ }

  const systemPrompt = `You are analyzing a completed coding session. Below is the full conversation (as beats) and any knowledge that was previously extracted from it.

Answer the user's questions based on this context. Be specific — reference beat numbers, quote decisions, and cite extracted facts/mistakes/playbooks when relevant. You can have a multi-turn conversation about this session.

## Session Transcript (${beats.length} beats)

${sessionContext}
${learningsContext}`;

  return { systemPrompt, beatCount: beats.length };
}

/**
 * Load a session + its digested learnings into an Interaction, then ask a single question.
 */
export async function askAboutSession(options: {
  sessionFile: string;
  projectPath: string;
  sessionId: string;
  question: string;
  model: ModelDetails;
}): Promise<string> {
  const { systemPrompt } = await buildSessionContext(options);

  console.log('  asking model...');
  const stimulus = new Stimulus({
    role: 'session analyst',
    objective: 'answer questions about a completed coding session',
    instructions: [systemPrompt],
    runnerType: 'base',
  });

  const interaction = new Interaction(options.model, stimulus);
  interaction.addMessage({ role: 'user', content: options.question });

  const runner = new BaseModelRunner();
  const response = await runner.generateText(interaction);
  return typeof response.content === 'string' ? response.content : String(response.content ?? '');
}

/**
 * Build a pre-loaded Interaction for interactive chat about a session.
 * The session context (beats + learnings) is loaded as the system prompt.
 * The caller can then use `cli.startChat(interaction)` for an interactive REPL.
 */
export async function buildSessionAnalysisInteraction(options: {
  sessionFile: string;
  projectPath: string;
  sessionId: string;
  model: ModelDetails;
}): Promise<Interaction> {
  const { systemPrompt, beatCount } = await buildSessionContext(options);

  const stimulus = new Stimulus({
    role: 'session analyst',
    objective: 'answer questions about a completed coding session in an interactive conversation',
    instructions: [systemPrompt],
    runnerType: 'base',
  });

  console.log(`  ${beatCount} beats loaded into context`);
  return new Interaction(options.model, stimulus);
}

/**
 * Digest all sessions across all discovered projects.
 */
export async function digestAllProjects(
  options: DigestOptions = {},
): Promise<DigestResult> {
  const {
    model: modelString = 'google:gemini-3-flash-preview',
    force = false,
    verbose = false,
  } = options;

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

  const modelUsed: AnalysisModelDetails = { provider, name: modelName };

  let projectPaths: string[];
  if (options.projectPath) {
    projectPaths = [options.projectPath];
  } else {
    projectPaths = await discoverAllProjectPaths();
  }

  if (verbose) {
    console.log(`Found ${projectPaths.length} projects\n`);
  }

  let totalDigested = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let i = 0; i < projectPaths.length; i++) {
    const projectPath = projectPaths[i];
    const displayName = projectDisplayName(projectPath);

    if (verbose) {
      console.log(`[${i + 1}/${projectPaths.length}] ${displayName}`);
    }

    try {
      const result = await digestProject(projectPath, model, modelUsed, { force, verbose });
      totalDigested += result.digested;
      totalSkipped += result.skipped;
      totalFailed += result.failed;

      if (verbose && result.digested > 0) {
        console.log(`  → ${result.digested} digested, ${result.skipped} skipped, ${result.failed} failed\n`);
      } else if (verbose) {
        console.log(`  → all ${result.skipped} already digested\n`);
      }
    } catch (err) {
      if (verbose) {
        console.error(`  Error: ${err instanceof Error ? err.message : err}\n`);
      }
    }
  }

  return {
    digested: totalDigested,
    skipped: totalSkipped,
    failed: totalFailed,
    projectsProcessed: projectPaths.length,
  };
}
