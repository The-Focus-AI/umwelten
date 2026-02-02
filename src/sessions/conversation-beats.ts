/**
 * Conversation beats: group messages into logical turns for browsing.
 *
 * A "beat" = one user turn + the following assistant/tool activity until the next user message.
 * Used by the session browser TUI to show: user preview → "N tools, M min" → assistant preview,
 * with expand/collapse to drill into messages.
 */

import type { NormalizedMessage } from './normalized-types.js';

/** Max characters for user preview (about 2 lines). */
const USER_PREVIEW_CHARS = 120;
/** Max characters for assistant preview (first few lines). */
const ASSISTANT_PREVIEW_CHARS = 180;
/** Max lines to take from user/assistant for preview. */
const PREVIEW_LINES = 2;

function firstLines(s: string, maxLines: number, maxChars: number): string {
  const trimmed = s.trim();
  if (!trimmed) return '';
  const lines = trimmed.split(/\n/).slice(0, maxLines);
  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  return joined.length <= maxChars ? joined : joined.slice(0, maxChars - 3) + '...';
}

export interface ConversationBeat {
  /** Index of this beat (0-based). */
  index: number;
  /** First ~2 lines of the user message. */
  userPreview: string;
  /** Number of tool calls in this turn. */
  toolCount: number;
  /** Total duration of tool calls in ms. */
  toolDurationMs: number;
  /** First few lines of the final assistant text reply (after tools). */
  assistantPreview: string;
  /** Message IDs in this beat (for expand/drill). */
  messageIds: string[];
  /** Messages in this beat (for rendering when expanded). */
  messages: NormalizedMessage[];
}

/**
 * Group messages into beats: each beat is one user message plus all following
 * assistant/tool messages until the next user message.
 */
export function messagesToBeats(messages: NormalizedMessage[]): ConversationBeat[] {
  const beats: ConversationBeat[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];
    if (msg.role !== 'user') {
      i++;
      continue;
    }

    const userPreview = firstLines(msg.content ?? '', PREVIEW_LINES, USER_PREVIEW_CHARS);
    const beatMessages: NormalizedMessage[] = [msg];
    let toolCount = 0;
    let toolDurationMs = 0;
    let lastAssistantText = '';

    i++;
    while (i < messages.length) {
      const next = messages[i];
      if (next.role === 'user') break;

      beatMessages.push(next);
      if (next.role === 'tool') {
        toolCount++;
        toolDurationMs += next.tool?.duration ?? 0;
      } else if (next.role === 'assistant' && (next.content ?? '').trim()) {
        lastAssistantText = next.content ?? '';
      }
      i++;
    }

    const assistantPreview = firstLines(lastAssistantText, PREVIEW_LINES, ASSISTANT_PREVIEW_CHARS);
    beats.push({
      index: beats.length,
      userPreview,
      toolCount,
      toolDurationMs,
      assistantPreview,
      messageIds: beatMessages.map(m => m.id),
      messages: beatMessages,
    });
  }

  return beats;
}

/** Format tool duration for display (e.g. "17 tools, 2m 30s" or "5 tools, 10s"). */
export function formatBeatToolSummary(toolCount: number, toolDurationMs: number): string {
  if (toolCount === 0) return '';
  const sec = Math.round(toolDurationMs / 1000);
  if (sec < 60) return `${toolCount} tool${toolCount === 1 ? '' : 's'}, ${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${toolCount} tool${toolCount === 1 ? '' : 's'}, ${min}m ${s}s`;
}
