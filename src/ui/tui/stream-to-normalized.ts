/**
 * Convert stream-json (Claude Code --output-format stream-json) lines to NormalizedMessage.
 * Same JSONL shape as session files; shared logic for TUI and format command.
 */

import type { NormalizedMessage, NormalizedTokenUsage } from '../../sessions/normalized-types.js';
import type {
  UserMessageEntry,
  AssistantMessageEntry,
  ContentBlock,
  TokenUsage,
} from '../../sessions/types.js';
import { extractTextContent } from '../../sessions/session-parser.js';

export interface StreamInit {
  type: 'init';
  sessionId?: string;
  model?: string;
  cwd?: string;
  claudeCodeVersion?: string;
}

export interface StreamResult {
  type: 'result';
  subtype?: string;
  isError?: boolean;
  result?: string;
  durationMs?: number;
}

export type StreamEvent =
  | StreamInit
  | { type: 'message'; messages: NormalizedMessage[] }
  | StreamResult
  | null;

function extractContent(content: string | ContentBlock[]): string {
  const texts = extractTextContent(content);
  return texts.join('\n');
}

function isToolResultMessage(content: string | ContentBlock[]): boolean {
  if (typeof content === 'string') return false;
  return content.some(block => block.type === 'tool_result');
}

function extractToolCallsFromContent(
  content: string | ContentBlock[]
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  if (typeof content === 'string') return [];
  return (content as ContentBlock[])
    .filter(block => block.type === 'tool_use')
    .map(block => {
      const toolUse = block as { id: string; name: string; input: Record<string, unknown> };
      return { id: toolUse.id, name: toolUse.name, input: toolUse.input ?? {} };
    });
}

function convertTokenUsage(usage?: TokenUsage): NormalizedTokenUsage | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    total:
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0),
  };
}

/**
 * Convert a single stream-json line (parsed object) to a StreamEvent.
 * Returns null for lines we don't need in the message list (e.g. progress, summary).
 */
export function streamLineToEvent(raw: unknown, messageIndex: { count: number }): StreamEvent {
  if (raw == null || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  const type = msg.type as string | undefined;

  if (type === 'system' && msg.subtype === 'init') {
    return {
      type: 'init',
      sessionId: msg.session_id as string | undefined,
      model: msg.model as string | undefined,
      cwd: msg.cwd as string | undefined,
      claudeCodeVersion: msg.claude_code_version as string | undefined,
    };
  }

  if (type === 'result') {
    return {
      type: 'result',
      subtype: msg.subtype as string | undefined,
      isError: msg.is_error as boolean | undefined,
      result: msg.result as string | undefined,
      durationMs: msg.duration_ms as number | undefined,
    };
  }

  if (type === 'user') {
    const userMsg = raw as UserMessageEntry;
    if (isToolResultMessage(userMsg.message?.content ?? [])) return null;
    const content = extractContent(userMsg.message?.content ?? '');
    const id = (userMsg.uuid as string) ?? `user-${messageIndex.count++}`;
    return {
      type: 'message',
      messages: [
        {
          id,
          role: 'user',
          content,
          timestamp: userMsg.timestamp as string | undefined,
          sourceData: { type: 'user', uuid: userMsg.uuid },
        },
      ],
    };
  }

  if (type === 'assistant') {
    const assistantMsg = raw as AssistantMessageEntry;
    const content = extractContent(assistantMsg.message?.content ?? '');
    const usage = assistantMsg.message?.usage;
    const tokens = convertTokenUsage(usage as TokenUsage | undefined);
    const toolCalls = extractToolCallsFromContent(assistantMsg.message?.content ?? []);
    const messages: NormalizedMessage[] = [];

    if (content.trim()) {
      messages.push({
        id: (assistantMsg.uuid as string) ?? `assistant-${messageIndex.count++}`,
        role: 'assistant',
        content,
        timestamp: assistantMsg.timestamp as string | undefined,
        tokens,
        model: assistantMsg.message?.model as string | undefined,
        sourceData: { type: 'assistant', uuid: assistantMsg.uuid },
      });
    }

    for (const tool of toolCalls) {
      messages.push({
        id: tool.id,
        role: 'tool',
        content: `Tool: ${tool.name}`,
        timestamp: assistantMsg.timestamp as string | undefined,
        tool: { name: tool.name, input: tool.input },
        sourceData: { type: 'tool_use', toolUseId: tool.id },
      });
    }

    if (messages.length === 0) return null;
    return { type: 'message', messages };
  }

  return null;
}
