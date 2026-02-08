/**
 * Jeeves sessions CLI: list, show, beats, messages, message, pull.
 * Reads from JEEVES_SESSIONS_DIR. Use: pnpm run cli -- sessions <subcommand> [args]
 */

import { join } from 'node:path';
import { createJeevesHabitat } from './habitat.js';
import {
  parseSessionFile,
  summarizeSession,
  getBeatsForSession,
  sessionMessagesToNormalized,
  extractTextContent,
  extractReasoning,
} from '../../src/interaction/persistence/session-parser.js';
import type { SessionMessage, AssistantMessageEntry, UserMessageEntry } from '../../src/interaction/types/types.js';
import { formatBeatToolSummary } from '../../src/interaction/analysis/conversation-beats.js';
import type { Habitat } from '../../src/habitat/index.js';

const TRANSCRIPT = 'transcript.jsonl';

function formatDuration(ms: number): string {
  if (!ms || ms < 0) return 'N/A';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

async function resolveSession(habitat: Habitat, sessionId: string): Promise<{ sessionId: string; sessionDir: string } | null> {
  const all = await habitat.listSessions();
  const entry = all.find((s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
  if (!entry) return null;
  const sessionDir = await habitat.getSessionDir(entry.sessionId);
  if (!sessionDir) return null;
  return { sessionId: entry.sessionId, sessionDir };
}

async function cmdList(habitat: Habitat, limit: number): Promise<void> {
  const sessions = await habitat.listSessions();
  const slice = sessions.slice(0, limit);
  console.log(`Sessions (${slice.length} of ${sessions.length}):\n`);
  for (const s of slice) {
    const fp = (s.metadata?.firstPrompt as string) ?? '';
    const mc = (s.metadata?.messageCount as number) ?? 0;
    const short = s.sessionId.split('-').slice(0, 2).join('-');
    console.log(`  ${short}  ${mc} msg  ${fp.slice(0, 50)}${fp.length > 50 ? '...' : ''}`);
  }
}

async function cmdShow(habitat: Habitat, sessionId: string, json: boolean): Promise<void> {
  const resolved = await resolveSession(habitat, sessionId);
  if (!resolved) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
  const messages = await parseSessionFile(transcriptPath);
  const summary = summarizeSession(messages);
  const { beats } = await getBeatsForSession(messages);

  if (json) {
    console.log(
      JSON.stringify(
        {
          sessionId: resolved.sessionId,
          ...summary,
          beatCount: beats.length,
          sizeBreakdown: summary.sizeBreakdown,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`\nSession: ${resolved.sessionId}\n`);
  console.log(`  Messages: ${summary.totalMessages} (user: ${summary.userMessages}, assistant: ${summary.assistantMessages}, tool: ${summary.toolCalls})`);
  console.log(`  Beats: ${beats.length}`);
  if (summary.duration != null) console.log(`  Duration: ${formatDuration(summary.duration)}`);
  if (summary.tokenUsage.input_tokens + summary.tokenUsage.output_tokens > 0) {
    console.log(
      `  Tokens: in ${summary.tokenUsage.input_tokens}, out ${summary.tokenUsage.output_tokens}`
    );
  }
  if (summary.estimatedCost > 0) console.log(`  Est. cost: $${summary.estimatedCost.toFixed(4)}`);
  if (summary.reasoningCount != null && summary.reasoningCount > 0) {
    console.log(`  Reasoning: ${summary.reasoningCount} entries, ${summary.totalReasoningChars} chars`);
  }
  const sb = summary.sizeBreakdown;
  if (sb) {
    console.log(
      `  Size (chars): user ${sb.userChars}, reasoning ${sb.reasoningChars}, tool call ${sb.toolCallChars}, tool response ${sb.toolResponseChars}, assistant ${sb.assistantChars}`
    );
  }
  if (summary.firstMessage) {
    console.log(`  First prompt: ${summary.firstMessage.slice(0, 80)}${summary.firstMessage.length > 80 ? '...' : ''}`);
  }
}

async function cmdBeats(habitat: Habitat, sessionId: string, topicFilter?: string): Promise<void> {
  const resolved = await resolveSession(habitat, sessionId);
  if (!resolved) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
  const messages = await parseSessionFile(transcriptPath);
  const { beats } = await getBeatsForSession(messages);
  const filtered =
    topicFilter?.trim() ?
      beats.filter(
        (b) =>
          (b.topic?.toLowerCase().includes(topicFilter.toLowerCase()) ?? false) ||
          b.userPreview.toLowerCase().includes(topicFilter.toLowerCase())
      )
    : beats;
  console.log(
    `\nBeats (${filtered.length}${topicFilter ? ` matching "${topicFilter}"` : ''} of ${beats.length}): ${resolved.sessionId}\n`
  );
  filtered.forEach((b) => {
    const toolSummary = formatBeatToolSummary(b.toolCount, b.toolDurationMs);
    const topicLabel = b.topic ? ` [${b.topic}]` : '';
    console.log(`  ${b.index}.${topicLabel} ${b.userPreview.slice(0, 60)}${b.userPreview.length > 60 ? '...' : ''}`);
    if (toolSummary) console.log(`     ${toolSummary}`);
    if (b.assistantPreview) console.log(`     → ${b.assistantPreview.slice(0, 60)}${b.assistantPreview.length > 60 ? '...' : ''}`);
    console.log('');
  });
}

async function cmdMessages(habitat: Habitat, sessionId: string, limit: number): Promise<void> {
  const resolved = await resolveSession(habitat, sessionId);
  if (!resolved) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
  const messages = await parseSessionFile(transcriptPath);
  const normalized = sessionMessagesToNormalized(messages);
  const slice = normalized.slice(-limit);
  console.log(`\nMessages (last ${slice.length}): ${resolved.sessionId}\n`);
  for (const m of slice) {
    const role = m.role.toUpperCase();
    const content = m.tool ? `[${m.tool.name}]` : (m.content ?? '').slice(0, 200);
    console.log(`  [${role}] ${content}${(m.content?.length ?? 0) > 200 ? '...' : ''}`);
  }
}

function getMessageByIndexOrUuid(messages: SessionMessage[], indexOrUuid: string): SessionMessage | null {
  const idx = parseInt(indexOrUuid, 10);
  if (!Number.isNaN(idx) && idx >= 0 && idx < messages.length) {
    return messages[idx];
  }
  return messages.find((m) => (m as { uuid?: string }).uuid === indexOrUuid) ?? null;
}

async function cmdMessage(habitat: Habitat, sessionId: string, indexOrUuid: string): Promise<void> {
  const resolved = await resolveSession(habitat, sessionId);
  if (!resolved) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
  const messages = await parseSessionFile(transcriptPath);
  const msg = getMessageByIndexOrUuid(messages, indexOrUuid);
  if (!msg) {
    console.error(`Message not found: ${indexOrUuid}`);
    process.exit(1);
  }
  const uuid = (msg as { uuid?: string }).uuid ?? '';
  console.log(`\nMessage: ${indexOrUuid} (uuid: ${uuid})\n`);
  if (msg.type === 'user') {
    const content = (msg as UserMessageEntry).message.content;
    const texts = extractTextContent(content);
    console.log(texts.join('\n'));
    if (typeof content !== 'string' && Array.isArray(content)) {
      const toolResults = content.filter((b) => b.type === 'tool_result');
      if (toolResults.length > 0) {
        console.log('\n--- Tool results ---');
        for (const tr of toolResults) {
          const c = tr.content;
          console.log(typeof c === 'string' ? c.slice(0, 500) : JSON.stringify(c).slice(0, 500));
        }
      }
    }
  } else if (msg.type === 'assistant') {
    const am = msg as AssistantMessageEntry;
    const reasoning = extractReasoning(am);
    if (reasoning) {
      console.log('--- Reasoning ---\n');
      console.log(reasoning);
      console.log('\n--- Content ---\n');
    }
    const content = am.message.content;
    const texts = extractTextContent(content);
    console.log(texts.join('\n'));
    if (typeof content !== 'string' && Array.isArray(content)) {
      const toolCalls = content.filter((b) => b.type === 'tool_use');
      if (toolCalls.length > 0) {
        console.log('\n--- Tool calls ---');
        for (const tc of toolCalls) {
          console.log(`${tc.name}:`, JSON.stringify(tc.input, null, 2).slice(0, 300));
        }
      }
    }
  }
}

async function cmdPull(habitat: Habitat, sessionId: string, beatIndex: number, outputPath?: string): Promise<void> {
  const resolved = await resolveSession(habitat, sessionId);
  if (!resolved) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }
  const transcriptPath = join(resolved.sessionDir, TRANSCRIPT);
  const messages = await parseSessionFile(transcriptPath);
  const { beats } = await getBeatsForSession(messages);
  if (beatIndex < 0 || beatIndex >= beats.length) {
    console.error(`Beat index ${beatIndex} out of range (0..${beats.length - 1})`);
    process.exit(1);
  }
  const beat = beats[beatIndex];
  const payload = {
    sessionId: resolved.sessionId,
    beatIndex,
    messages: beat.messages,
    userPreview: beat.userPreview,
    assistantPreview: beat.assistantPreview,
    toolCount: beat.toolCount,
  };
  const json = JSON.stringify(payload, null, 2);
  if (outputPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outputPath, json, 'utf-8');
    console.log(`Wrote beat ${beatIndex} to ${outputPath}`);
  } else {
    console.log(json);
  }
}

export async function runSessionsCli(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    console.log(`
jeeves sessions <command> [options]

Commands:
  list [--limit N]       List sessions (default limit 20)
  show <session-id> [--json]   Show summary with size breakdown and beat count
  beats <session-id> [--topic FILTER]   List beats (optionally filter by topic)
  messages <session-id> [--limit N]   Print last N messages
  message <session-id> <index|uuid>   Inspect one message (with tool response if applicable)
  pull <session-id> <beat-index> [--output FILE]   Extract one beat as JSON for replay
  replay <pulled.json> [--provider P] [--model M]  Re-run that turn through the current agent
`);
    return;
  }

  const habitat = await createJeevesHabitat();

  if (sub === 'list') {
    const limitIdx = argv.indexOf('--limit');
    const limit = limitIdx >= 0 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : 20;
    await cmdList(habitat, limit);
    return;
  }

  if (sub === 'show') {
    const sessionId = argv[1];
    if (!sessionId) {
      console.error('Usage: jeeves sessions show <session-id> [--json]');
      process.exit(1);
    }
    const json = argv.includes('--json');
    await cmdShow(habitat, sessionId, json);
    return;
  }

  if (sub === 'beats') {
    const sessionId = argv[1];
    if (!sessionId) {
      console.error('Usage: jeeves sessions beats <session-id> [--topic FILTER]');
      process.exit(1);
    }
    const topicIdx = argv.indexOf('--topic');
    const topicFilter = topicIdx >= 0 && argv[topicIdx + 1] ? argv[topicIdx + 1] : undefined;
    await cmdBeats(habitat, sessionId, topicFilter);
    return;
  }

  if (sub === 'messages') {
    const sessionId = argv[1];
    if (!sessionId) {
      console.error('Usage: jeeves sessions messages <session-id> [--limit N]');
      process.exit(1);
    }
    const limitIdx = argv.indexOf('--limit');
    const limit = limitIdx >= 0 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : 50;
    await cmdMessages(habitat, sessionId, limit);
    return;
  }

  if (sub === 'message') {
    const sessionId = argv[1];
    const indexOrUuid = argv[2];
    if (!sessionId || indexOrUuid === undefined) {
      console.error('Usage: jeeves sessions message <session-id> <index|uuid>');
      process.exit(1);
    }
    await cmdMessage(habitat, sessionId, indexOrUuid);
    return;
  }

  if (sub === 'pull') {
    const sessionId = argv[1];
    const beatIndexStr = argv[2];
    if (!sessionId || beatIndexStr === undefined) {
      console.error('Usage: jeeves sessions pull <session-id> <beat-index> [--output FILE]');
      process.exit(1);
    }
    const beatIndex = parseInt(beatIndexStr, 10);
    if (Number.isNaN(beatIndex)) {
      console.error('Beat index must be a number');
      process.exit(1);
    }
    const outputIdx = argv.indexOf('--output');
    const outputPath = outputIdx >= 0 && argv[outputIdx + 1] ? argv[outputIdx + 1] : undefined;
    await cmdPull(habitat, sessionId, beatIndex, outputPath);
    return;
  }

  if (sub === 'replay') {
    const filePath = argv[1];
    if (!filePath) {
      console.error('Usage: jeeves sessions replay <pulled.json> [--provider P] [--model M]');
      process.exit(1);
    }
    const providerIdx = argv.indexOf('--provider');
    const provider = providerIdx >= 0 && argv[providerIdx + 1] ? argv[providerIdx + 1] : undefined;
    const modelIdx = argv.indexOf('--model');
    const model = modelIdx >= 0 && argv[modelIdx + 1] ? argv[modelIdx + 1] : undefined;
    const { runReplay } = await import('./replay.js');
    const response = await runReplay(filePath, { provider, model });
    console.log(response);
    return;
  }

  console.error(`Unknown command: ${sub}. Use: jeeves sessions --help`);
  process.exit(1);
}
