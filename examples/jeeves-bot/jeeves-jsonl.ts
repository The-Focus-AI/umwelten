/**
 * Convert Jeeves CoreMessage[] to Claude-style JSONL.
 * Handles user messages, assistant messages with tool_use blocks, and tool results.
 * Session transcript is stored as transcript.jsonl and read via session-parser.
 */

import { randomUUID } from 'node:crypto';
import type { CoreMessage } from 'ai';
import type {
  UserMessageEntry,
  AssistantMessageEntry,
  ContentBlock,
  TextContent,
  ToolUseContent,
  ToolResultContent,
} from '../../src/sessions/types.js';

type VercelContentPart = {
  type?: string;
  text?: string;
  toolName?: string;
  toolCallId?: string;
  args?: unknown;      // Vercel AI SDK may use either
  input?: unknown;     // field name depending on version
  result?: unknown;    // Vercel AI SDK may use either
  output?: unknown;    // field name depending on version
  isError?: boolean;
};

type VercelToolInvocation = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  state?: string;
  result?: unknown;
};

type ExtendedCoreMessage = CoreMessage & {
  toolInvocations?: VercelToolInvocation[];
};

function extractContentBlocks(content: CoreMessage['content']): ContentBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) {
    const s = String(content ?? '');
    return s ? [{ type: 'text', text: s }] : [];
  }

  const blocks: ContentBlock[] = [];
  for (const part of content as VercelContentPart[]) {
    if (!part || typeof part !== 'object') continue;

    // Text part
    if (part.type === 'text' && typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text });
      continue;
    }

    // Tool invocation (tool call) in assistant message
    if (part.type === 'tool-call' || part.type === 'tool-invocation') {
      const argsOrInput = part.args ?? part.input ?? {};
      const toolUse: ToolUseContent = {
        type: 'tool_use',
        id: part.toolCallId || randomUUID(),
        name: part.toolName || 'unknown',
        input: argsOrInput as Record<string, unknown>,
      };
      blocks.push(toolUse);
      continue;
    }

    // Tool result in user/tool message
    if (part.type === 'tool-result') {
      const resultOrOutput = part.result ?? part.output;
      const toolResult: ToolResultContent = {
        type: 'tool_result',
        tool_use_id: part.toolCallId || '',
        content:
          typeof resultOrOutput === 'string'
            ? resultOrOutput
            : JSON.stringify(resultOrOutput ?? ''),
        is_error: part.isError ?? false,
      };
      blocks.push(toolResult);
      continue;
    }

    // Legacy: plain text object
    if ('text' in part && typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text });
    }
  }
  return blocks;
}

function extractToolInvocationsAsBlocks(
  invocations: VercelToolInvocation[] | undefined
): ToolUseContent[] {
  if (!invocations || !Array.isArray(invocations)) return [];
  return invocations.map((inv) => ({
    type: 'tool_use' as const,
    id: inv.toolCallId || randomUUID(),
    name: inv.toolName || 'unknown',
    input: (inv.args as Record<string, unknown>) || {},
  }));
}

function extractToolResultsFromInvocations(
  invocations: VercelToolInvocation[] | undefined
): ToolResultContent[] {
  if (!invocations || !Array.isArray(invocations)) return [];
  return invocations
    .filter((inv) => inv.state === 'result' || inv.result !== undefined)
    .map((inv) => ({
      type: 'tool_result' as const,
      tool_use_id: inv.toolCallId || '',
      content:
        typeof inv.result === 'string'
          ? inv.result
          : JSON.stringify(inv.result ?? ''),
      is_error: false,
    }));
}

/**
 * Convert CoreMessage[] to Claude-style JSONL (one JSON object per line).
 * Handles user, assistant (with tool_use), and tool messages.
 * Timestamps preserve order (1ms apart).
 */
export function coreMessagesToJSONL(
  messages: CoreMessage[],
  _sessionId?: string
): string {
  const lines: string[] = [];
  const base = Date.now();
  let idx = 0;

  for (const m of messages as ExtendedCoreMessage[]) {
    const timestamp = new Date(base + idx).toISOString();
    idx += 1;
    const uuid = randomUUID();

    if (m.role === 'system') {
      // Skip system messages (not stored in Claude transcript)
      continue;
    }

    if (m.role === 'user') {
      const blocks = extractContentBlocks(m.content);
      const content: string | ContentBlock[] =
        blocks.length === 1 && blocks[0].type === 'text'
          ? (blocks[0] as TextContent).text
          : blocks;
      const ent: UserMessageEntry = {
        type: 'user',
        uuid,
        timestamp,
        message: { role: 'user', content },
      };
      lines.push(JSON.stringify(ent));
      continue;
    }

    if (m.role === 'assistant') {
      // Extract content blocks from content array
      const contentBlocks = extractContentBlocks(m.content);
      // Also extract tool calls from toolInvocations array (Vercel AI SDK style)
      const toolUseBlocks = extractToolInvocationsAsBlocks(m.toolInvocations);
      // Merge: text blocks first, then tool_use blocks
      const allBlocks: ContentBlock[] = [...contentBlocks, ...toolUseBlocks];
      // Dedupe tool_use by id
      const seenIds = new Set<string>();
      const deduped = allBlocks.filter((b) => {
        if (b.type !== 'tool_use') return true;
        if (seenIds.has(b.id)) return false;
        seenIds.add(b.id);
        return true;
      });

      const content: string | ContentBlock[] =
        deduped.length === 1 && deduped[0].type === 'text'
          ? (deduped[0] as TextContent).text
          : deduped.length === 0
            ? ''
            : deduped;
      const ent: AssistantMessageEntry = {
        type: 'assistant',
        uuid,
        timestamp,
        message: { role: 'assistant', content },
      };
      lines.push(JSON.stringify(ent));

      // If toolInvocations have results, emit a user message with tool_result blocks
      const toolResults = extractToolResultsFromInvocations(m.toolInvocations);
      if (toolResults.length > 0) {
        const resultUuid = randomUUID();
        const resultTimestamp = new Date(base + idx).toISOString();
        idx += 1;
        const resultEnt: UserMessageEntry = {
          type: 'user',
          uuid: resultUuid,
          timestamp: resultTimestamp,
          message: { role: 'user', content: toolResults },
        };
        lines.push(JSON.stringify(resultEnt));
      }
      continue;
    }

    if (m.role === 'tool') {
      // Tool results as a user message with tool_result content
      const blocks = extractContentBlocks(m.content);
      // If blocks are not already tool_result, wrap them
      const resultBlocks: ContentBlock[] = blocks.map((b) => {
        if (b.type === 'tool_result') return b;
        // Convert text to tool_result (need toolCallId from somewhere)
        return {
          type: 'tool_result',
          tool_use_id: (m as unknown as { toolCallId?: string }).toolCallId || '',
          content: b.type === 'text' ? b.text : JSON.stringify(b),
          is_error: false,
        } as ToolResultContent;
      });
      const ent: UserMessageEntry = {
        type: 'user',
        uuid,
        timestamp,
        message: { role: 'user', content: resultBlocks },
      };
      lines.push(JSON.stringify(ent));
      continue;
    }
  }

  return lines.join('\n');
}
