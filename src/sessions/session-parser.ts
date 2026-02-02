import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type {
  ContentBlock,
  SessionMessage,
  UserMessageEntry,
  AssistantMessageEntry,
  ToolCall,
  TokenUsage,
  ToolUseContent,
} from './types.js';

/**
 * Parse a single line of JSONL into a SessionMessage
 */
export function parseJSONLLine(line: string): SessionMessage | null {
  if (!line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line) as SessionMessage;
  } catch (error) {
    console.error('Failed to parse JSONL line:', error);
    return null;
  }
}

/**
 * Read and parse a JSONL session file
 */
export async function parseSessionFile(filePath: string): Promise<SessionMessage[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');

  const messages: SessionMessage[] = [];

  for (const line of lines) {
    const message = parseJSONLLine(line);
    if (message) {
      messages.push(message);
    }
  }

  return messages;
}

/**
 * Stream parse a JSONL session file (better for large files)
 */
export async function streamParseSessionFile(
  filePath: string,
  onMessage: (message: SessionMessage) => void | Promise<void>
): Promise<void> {
  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const message = parseJSONLLine(line);
    if (message) {
      await onMessage(message);
    }
  }
}

/**
 * Extract user and assistant messages from session
 */
export function extractConversation(messages: SessionMessage[]): {
  user: UserMessageEntry[];
  assistant: AssistantMessageEntry[];
} {
  const user: UserMessageEntry[] = [];
  const assistant: AssistantMessageEntry[] = [];

  for (const message of messages) {
    if (message.type === 'user') {
      user.push(message as UserMessageEntry);
    } else if (message.type === 'assistant') {
      assistant.push(message as AssistantMessageEntry);
    }
  }

  return { user, assistant };
}

/**
 * Extract all tool calls from session messages
 */
export function extractToolCalls(messages: SessionMessage[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const message of messages) {
    if (message.type !== 'assistant') {
      continue;
    }

    const assistantMsg = message as AssistantMessageEntry;
    const content = assistantMsg.message.content;

    // Content can be a string or array of ContentBlocks
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use') {
          const toolUse = block as ToolUseContent;
          toolCalls.push({
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input,
            timestamp: message.timestamp || '',
            messageUuid: message.uuid || '',
          });
        }
      }
    }
  }

  return toolCalls;
}

/**
 * Calculate total token usage from session messages
 */
export function calculateTokenUsage(messages: SessionMessage[]): TokenUsage {
  const totals: TokenUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: {
      ephemeral_5m_input_tokens: 0,
      ephemeral_1h_input_tokens: 0,
    },
  };

  for (const message of messages) {
    if (message.type !== 'assistant') {
      continue;
    }

    const assistantMsg = message as AssistantMessageEntry;
    const usage = assistantMsg.message.usage;

    if (!usage) {
      continue;
    }

    totals.input_tokens += usage.input_tokens || 0;
    totals.output_tokens += usage.output_tokens || 0;
    totals.cache_creation_input_tokens =
      (totals.cache_creation_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    totals.cache_read_input_tokens =
      (totals.cache_read_input_tokens || 0) + (usage.cache_read_input_tokens || 0);

    if (usage.cache_creation) {
      totals.cache_creation!.ephemeral_5m_input_tokens =
        (totals.cache_creation!.ephemeral_5m_input_tokens || 0) +
        (usage.cache_creation.ephemeral_5m_input_tokens || 0);
      totals.cache_creation!.ephemeral_1h_input_tokens =
        (totals.cache_creation!.ephemeral_1h_input_tokens || 0) +
        (usage.cache_creation.ephemeral_1h_input_tokens || 0);
    }
  }

  return totals;
}

/**
 * Calculate estimated cost based on token usage
 * Using Claude Sonnet 4.5 pricing as default
 */
export function calculateCost(usage: TokenUsage): number {
  // Claude Sonnet 4.5 pricing (as of Jan 2026)
  const INPUT_PRICE_PER_MTK = 3.0; // $3 per million tokens
  const OUTPUT_PRICE_PER_MTK = 15.0; // $15 per million tokens
  const CACHE_WRITE_PRICE_PER_MTK = 3.75; // $3.75 per million tokens
  const CACHE_READ_PRICE_PER_MTK = 0.3; // $0.30 per million tokens

  const inputCost = (usage.input_tokens / 1_000_000) * INPUT_PRICE_PER_MTK;
  const outputCost = (usage.output_tokens / 1_000_000) * OUTPUT_PRICE_PER_MTK;
  const cacheWriteCost =
    ((usage.cache_creation_input_tokens || 0) / 1_000_000) * CACHE_WRITE_PRICE_PER_MTK;
  const cacheReadCost = ((usage.cache_read_input_tokens || 0) / 1_000_000) * CACHE_READ_PRICE_PER_MTK;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * Get a summary of the session
 */
export interface SessionSummary {
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  tokenUsage: TokenUsage;
  estimatedCost: number;
  firstMessage?: string;
  lastMessage?: string;
  duration?: number; // milliseconds
}

export function summarizeSession(messages: SessionMessage[]): SessionSummary {
  const conversation = extractConversation(messages);
  const toolCalls = extractToolCalls(messages);
  const tokenUsage = calculateTokenUsage(messages);
  const estimatedCost = calculateCost(tokenUsage);

  // Get first and last user messages
  const firstUserMsg = conversation.user[0];
  const lastUserMsg = conversation.user[conversation.user.length - 1];

  // Calculate session duration
  let duration: number | undefined;
  if (firstUserMsg && lastUserMsg && firstUserMsg.timestamp && lastUserMsg.timestamp) {
    const start = new Date(firstUserMsg.timestamp).getTime();
    const end = new Date(lastUserMsg.timestamp).getTime();
    duration = end - start;
  }

  // Extract first message text
  let firstMessage: string | undefined;
  if (firstUserMsg) {
    const content = firstUserMsg.message.content;
    if (typeof content === 'string') {
      firstMessage = content;
    } else if (Array.isArray(content)) {
      const textBlock = content.find(b => b.type === 'text');
      if (textBlock && 'text' in textBlock) {
        firstMessage = textBlock.text;
      }
    }
  }

  // Extract last message text
  let lastMessage: string | undefined;
  if (lastUserMsg) {
    const content = lastUserMsg.message.content;
    if (typeof content === 'string') {
      lastMessage = content;
    } else if (Array.isArray(content)) {
      const textBlock = content.find(b => b.type === 'text');
      if (textBlock && 'text' in textBlock) {
        lastMessage = textBlock.text;
      }
    }
  }

  return {
    totalMessages: messages.length,
    userMessages: conversation.user.length,
    assistantMessages: conversation.assistant.length,
    toolCalls: toolCalls.length,
    tokenUsage,
    estimatedCost,
    firstMessage,
    lastMessage,
    duration,
  };
}

/**
 * Filter messages by type
 */
export function filterMessagesByType<T extends SessionMessage['type']>(
  messages: SessionMessage[],
  type: T
): Extract<SessionMessage, { type: T }>[] {
  return messages.filter(m => m.type === type) as Extract<SessionMessage, { type: T }>[];
}

/**
 * Get all text content from a message
 */
export function extractTextContent(content: string | ContentBlock[]): string[] {
  if (typeof content === 'string') {
    return [content];
  }

  const texts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      texts.push(block.text);
    }
  }

  return texts;
}

/**
 * Metadata extracted from a session file without loading full messages.
 * Used when discovering sessions from directory (files not in sessions-index.json).
 */
export interface SessionFileMetadata {
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  isSidechain: boolean;
}

const UUID_JSONL_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

/** True if message content is only tool_result blocks (no user-visible text). */
function isToolResultOnlyContent(content: string | ContentBlock[]): boolean {
  if (typeof content === 'string') return false;
  if (content.length === 0) return true;
  const hasText = content.some(b => b.type === 'text');
  const onlyToolResult = content.every(b => b.type === 'tool_result');
  return !hasText && onlyToolResult;
}

/**
 * Extract first user-visible text from a user message for use as firstPrompt.
 * Uses extractTextContent for standard text blocks; also checks any block with a .text or string .content for alternate formats.
 */
function extractFirstUserText(msg: { message: { content: string | ContentBlock[] } }): string {
  const content = msg.message.content;
  if (typeof content === 'string') {
    return content.trim().slice(0, 500);
  }
  const texts = extractTextContent(content);
  const joined = texts.join('\n').trim();
  if (joined.length > 0) return joined.slice(0, 500);
  for (const block of content) {
    if (block && typeof block === 'object') {
      const b = block as Record<string, unknown>;
      if (typeof b.text === 'string' && b.text.trim().length > 0) {
        return b.text.trim().slice(0, 500);
      }
      if (typeof b.content === 'string' && b.content.trim().length > 0) {
        return b.content.trim().slice(0, 500);
      }
    }
  }
  return '';
}

/**
 * Stream a session JSONL file and extract minimal metadata (first prompt, count, timestamps, git branch).
 * Use this when building session index entries from files not listed in sessions-index.json.
 * When the file has no message timestamps, created/modified use fallbackMtimeMs (e.g. file mtime) instead of "now".
 */
export async function parseSessionFileMetadata(
  filePath: string,
  fallbackMtimeMs?: number
): Promise<SessionFileMetadata | null> {
  const fileStream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let firstPrompt = '';
  let messageCount = 0;
  let created = '';
  let modified = '';
  let gitBranch = '';
  let isSidechain = false;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const msg = parseJSONLLine(line) as SessionMessage | null;
      if (!msg) continue;

      const ts = msg.timestamp || '';
      if (ts) {
        if (!created) created = ts;
        modified = ts;
      }
      if ('gitBranch' in msg && typeof (msg as { gitBranch?: string }).gitBranch === 'string') {
        if (!gitBranch) gitBranch = (msg as { gitBranch: string }).gitBranch;
      }
      if ('isSidechain' in msg && typeof (msg as { isSidechain?: boolean }).isSidechain === 'boolean') {
        isSidechain = (msg as { isSidechain: boolean }).isSidechain;
      }

      if (msg.type === 'user') {
        messageCount++;
        if (!firstPrompt && !isToolResultOnlyContent((msg as UserMessageEntry).message.content)) {
          const text = extractFirstUserText(msg as UserMessageEntry);
          if (text) firstPrompt = text;
        }
      } else if (msg.type === 'assistant') {
        messageCount++;
      }
    }
  } finally {
    fileStream.destroy();
  }

  const fallbackIso = fallbackMtimeMs != null
    ? new Date(fallbackMtimeMs).toISOString()
    : new Date().toISOString();
  if (!created) created = modified || fallbackIso;
  if (!modified) modified = created;

  return {
    firstPrompt: firstPrompt || '(no prompt)',
    messageCount,
    created,
    modified,
    gitBranch: gitBranch || 'main',
    isSidechain,
  };
}

/**
 * Check if a filename looks like a session JSONL (UUID.jsonl), not a subagent file (agent-*.jsonl).
 */
export function isSessionJsonlFilename(name: string): boolean {
  return UUID_JSONL_REGEX.test(name) && !name.startsWith('agent-');
}
