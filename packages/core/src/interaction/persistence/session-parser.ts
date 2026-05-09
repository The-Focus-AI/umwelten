import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
  ContentBlock,
  SessionMessage,
  UserMessageEntry,
  AssistantMessageEntry,
  ToolCall,
  TokenUsage,
  ToolUseContent,
  ToolResultContent,
} from "../types/types.js";
import type {
  NormalizedMessage,
  NormalizedTokenUsage,
} from "../types/normalized-types.js";
import { messagesToBeats } from "../analysis/conversation-beats.js";
import type { ConversationBeat } from "../analysis/conversation-beats.js";

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
    console.error("Failed to parse JSONL line:", error);
    return null;
  }
}

/**
 * Read and parse a JSONL session file
 */
export async function parseSessionFile(
  filePath: string,
): Promise<SessionMessage[]> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");

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
  onMessage: (message: SessionMessage) => void | Promise<void>,
): Promise<void> {
  const fileStream = createReadStream(filePath, { encoding: "utf-8" });
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
    if (message.type === "user") {
      user.push(message as UserMessageEntry);
    } else if (message.type === "assistant") {
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
    if (message.type !== "assistant") {
      continue;
    }

    const assistantMsg = message as AssistantMessageEntry;
    const content = assistantMsg.message.content;

    // Content can be a string or array of ContentBlocks
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === "tool_use") {
          const toolUse = block as ToolUseContent;
          toolCalls.push({
            id: toolUse.id,
            name: toolUse.name,
            input: toolUse.input,
            timestamp: message.timestamp || "",
            messageUuid: message.uuid || "",
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
    if (message.type !== "assistant") {
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
      (totals.cache_creation_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0);
    totals.cache_read_input_tokens =
      (totals.cache_read_input_tokens || 0) +
      (usage.cache_read_input_tokens || 0);

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
    ((usage.cache_creation_input_tokens || 0) / 1_000_000) *
    CACHE_WRITE_PRICE_PER_MTK;
  const cacheReadCost =
    ((usage.cache_read_input_tokens || 0) / 1_000_000) *
    CACHE_READ_PRICE_PER_MTK;

  return inputCost + outputCost + cacheWriteCost + cacheReadCost;
}

/**
 * Size breakdown (character counts) for session content.
 * System prompt is not in transcript; Jeeves may store systemPromptChars in meta.json.
 */
export interface SessionSizeBreakdown {
  systemPromptChars?: number;
  userChars: number;
  reasoningChars: number;
  toolCallChars: number;
  toolResponseChars: number;
  assistantChars: number;
}

/**
 * Compute size breakdown for session messages (character counts).
 */
export function computeSizeBreakdown(
  messages: SessionMessage[],
): SessionSizeBreakdown {
  let userChars = 0;
  let reasoningChars = 0;
  let toolCallChars = 0;
  let toolResponseChars = 0;
  let assistantChars = 0;

  for (const msg of messages) {
    if (msg.type === "user") {
      const content = (msg as UserMessageEntry).message.content;
      if (typeof content === "string") {
        userChars += content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && "text" in block) {
            userChars += block.text.length;
          } else if (block.type === "tool_result") {
            const c = block.content;
            toolResponseChars +=
              typeof c === "string" ? c.length : JSON.stringify(c).length;
          }
        }
      }
    } else if (msg.type === "assistant") {
      const entry = msg as AssistantMessageEntry;
      if (entry.reasoning) {
        reasoningChars += entry.reasoning.length;
      }
      const content = entry.message.content;
      if (typeof content === "string") {
        assistantChars += content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && "text" in block) {
            assistantChars += block.text.length;
          } else if (block.type === "tool_use") {
            toolCallChars += JSON.stringify(block.input).length;
          }
        }
      }
    }
  }

  return {
    userChars,
    reasoningChars,
    toolCallChars,
    toolResponseChars,
    assistantChars,
  };
}

/**
 * Extract reasoning/thinking from an assistant message entry (Jeeves persists this from runner).
 */
export function extractReasoning(
  entry: AssistantMessageEntry,
): string | undefined {
  return entry.reasoning;
}

/**
 * Extract all reasoning strings from session messages (for size breakdown / summaries).
 */
export function extractAllReasoning(messages: SessionMessage[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    if (m.type === "assistant") {
      const r = (m as AssistantMessageEntry).reasoning;
      if (r != null && r !== "") out.push(r);
    }
  }
  return out;
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
  /** Number of assistant messages that have reasoning. */
  reasoningCount?: number;
  /** Total character length of all reasoning content. */
  totalReasoningChars?: number;
  /** Character counts by category (user, reasoning, tool call/response, assistant). */
  sizeBreakdown?: SessionSizeBreakdown;
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
  if (
    firstUserMsg &&
    lastUserMsg &&
    firstUserMsg.timestamp &&
    lastUserMsg.timestamp
  ) {
    const start = new Date(firstUserMsg.timestamp).getTime();
    const end = new Date(lastUserMsg.timestamp).getTime();
    duration = end - start;
  }

  // Extract first message text
  let firstMessage: string | undefined;
  if (firstUserMsg) {
    const content = firstUserMsg.message.content;
    if (typeof content === "string") {
      firstMessage = content;
    } else if (Array.isArray(content)) {
      const textBlock = content.find((b) => b.type === "text");
      if (textBlock && "text" in textBlock) {
        firstMessage = textBlock.text;
      }
    }
  }

  // Extract last message text
  let lastMessage: string | undefined;
  if (lastUserMsg) {
    const content = lastUserMsg.message.content;
    if (typeof content === "string") {
      lastMessage = content;
    } else if (Array.isArray(content)) {
      const textBlock = content.find((b) => b.type === "text");
      if (textBlock && "text" in textBlock) {
        lastMessage = textBlock.text;
      }
    }
  }

  const reasoningStrings = extractAllReasoning(messages);
  const totalReasoningChars = reasoningStrings.reduce(
    (sum, s) => sum + s.length,
    0,
  );
  const sizeBreakdown = computeSizeBreakdown(messages);

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
    reasoningCount: reasoningStrings.length,
    totalReasoningChars:
      totalReasoningChars > 0 ? totalReasoningChars : undefined,
    sizeBreakdown,
  };
}

/**
 * Filter messages by type
 */
export function filterMessagesByType<T extends SessionMessage["type"]>(
  messages: SessionMessage[],
  type: T,
): Extract<SessionMessage, { type: T }>[] {
  return messages.filter((m) => m.type === type) as Extract<
    SessionMessage,
    { type: T }
  >[];
}

/**
 * Get all text content from a message
 */
export function extractTextContent(content: string | ContentBlock[]): string[] {
  if (typeof content === "string") {
    return [content];
  }

  const texts: string[] = [];
  for (const block of content) {
    if (block.type === "text" && "text" in block) {
      texts.push(block.text);
    }
  }

  return texts;
}

function contentToText(content: string | ContentBlock[]): string {
  return extractTextContent(content).join("\n");
}

function isToolResultOnlyMessage(content: string | ContentBlock[]): boolean {
  if (typeof content === "string") return false;
  if (content.length === 0) return true;
  const hasText = content.some((b) => b.type === "text");
  const onlyToolResult = content.every((b) => b.type === "tool_result");
  return !hasText && onlyToolResult;
}

function extractToolCallsFromContent(
  content: string | ContentBlock[],
): Array<{ id: string; name: string; input: Record<string, unknown> }> {
  if (typeof content === "string") return [];
  return content
    .filter((b): b is ToolUseContent => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

function tokenUsageToNormalized(
  usage?: TokenUsage,
): NormalizedTokenUsage | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    cacheWrite: usage.cache_creation_input_tokens,
    total:
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0),
  };
}

/**
 * Build a map from tool_use_id to { content, is_error } by scanning user messages
 * that carry tool_result blocks.
 */
function buildToolResultMap(
  messages: SessionMessage[],
): Map<string, { content: string; isError: boolean }> {
  const map = new Map<string, { content: string; isError: boolean }>();
  for (const msg of messages) {
    if (msg.type !== "user") continue;
    const userMsg = msg as UserMessageEntry;
    const content = userMsg.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if ((block as ToolResultContent).type === "tool_result") {
        const tr = block as ToolResultContent;
        const text =
          typeof tr.content === "string"
            ? tr.content
            : JSON.stringify(tr.content);
        map.set(tr.tool_use_id, { content: text, isError: !!tr.is_error });
      }
    }
  }
  return map;
}

/**
 * Convert SessionMessage[] (e.g. from transcript.jsonl) to NormalizedMessage[].
 * Used for beats (messagesToBeats) and by Jeeves/umwelten when loading a session file.
 *
 * Includes thinking/reasoning, tool call inputs, and tool results.
 */
export function sessionMessagesToNormalized(
  messages: SessionMessage[],
): NormalizedMessage[] {
  const normalized: NormalizedMessage[] = [];
  const toolResults = buildToolResultMap(messages);

  for (const msg of messages) {
    if (msg.type === "user") {
      const userMsg = msg as UserMessageEntry;
      if (isToolResultOnlyMessage(userMsg.message.content)) continue;
      normalized.push({
        id: userMsg.uuid || `user-${normalized.length}`,
        role: "user",
        content: contentToText(userMsg.message.content),
        timestamp: userMsg.timestamp,
        sourceData: { type: "user", uuid: userMsg.uuid },
      });
    } else if (msg.type === "assistant") {
      const assistantMsg = msg as AssistantMessageEntry;
      const content = contentToText(assistantMsg.message.content);
      const tokens = tokenUsageToNormalized(assistantMsg.message.usage);
      const toolCalls = extractToolCallsFromContent(
        assistantMsg.message.content,
      );
      const reasoning = assistantMsg.reasoning;

      if (toolCalls.length > 0) {
        if (content.trim()) {
          normalized.push({
            id: assistantMsg.uuid || `assistant-${normalized.length}`,
            role: "assistant",
            content,
            timestamp: assistantMsg.timestamp,
            tokens,
            model: assistantMsg.message.model,
            sourceData: {
              type: "assistant",
              uuid: assistantMsg.uuid,
              ...(reasoning && { reasoning }),
            },
          });
        }
        for (const tc of toolCalls) {
          const result = toolResults.get(tc.id);
          normalized.push({
            id: tc.id,
            role: "tool",
            content: `Tool: ${tc.name}`,
            timestamp: assistantMsg.timestamp,
            tool: {
              name: tc.name,
              input: tc.input,
              ...(result && {
                output: result.content,
                isError: result.isError,
              }),
            },
            sourceData: { type: "tool_use", toolUseId: tc.id },
          });
        }
      } else {
        normalized.push({
          id: assistantMsg.uuid || `assistant-${normalized.length}`,
          role: "assistant",
          content,
          timestamp: assistantMsg.timestamp,
          tokens,
          model: assistantMsg.message.model,
          sourceData: {
            type: "assistant",
            uuid: assistantMsg.uuid,
            ...(reasoning && { reasoning }),
          },
        });
      }
    }
  }

  return normalized;
}

/**
 * Get beats for a session (from file path or messages).
 * Returns normalized messages and conversation beats (user turn + tools + assistant until next user).
 */
export async function getBeatsForSession(
  sessionPathOrMessages: string | SessionMessage[],
): Promise<{ beats: ConversationBeat[]; messages: NormalizedMessage[] }> {
  const messages: SessionMessage[] =
    typeof sessionPathOrMessages === "string"
      ? await parseSessionFile(sessionPathOrMessages)
      : sessionPathOrMessages;
  const normalized = sessionMessagesToNormalized(messages);
  const beats = messagesToBeats(normalized);
  return { beats, messages: normalized };
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

const UUID_JSONL_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i;

/** True if message content is only tool_result blocks (no user-visible text). */
function isToolResultOnlyContent(content: string | ContentBlock[]): boolean {
  if (typeof content === "string") return false;
  if (content.length === 0) return true;
  const hasText = content.some((b) => b.type === "text");
  const onlyToolResult = content.every((b) => b.type === "tool_result");
  return !hasText && onlyToolResult;
}

/**
 * Extract first user-visible text from a user message for use as firstPrompt.
 * Uses extractTextContent for standard text blocks; also checks any block with a .text or string .content for alternate formats.
 */
function extractFirstUserText(msg: {
  message: { content: string | ContentBlock[] };
}): string {
  const content = msg.message.content;
  if (typeof content === "string") {
    return content.trim().slice(0, 500);
  }
  const texts = extractTextContent(content);
  const joined = texts.join("\n").trim();
  if (joined.length > 0) return joined.slice(0, 500);
  for (const block of content) {
    if (block && typeof block === "object") {
      const b = block as unknown as Record<string, unknown>;
      if (typeof b.text === "string" && b.text.trim().length > 0) {
        return b.text.trim().slice(0, 500);
      }
      if (typeof b.content === "string" && b.content.trim().length > 0) {
        return b.content.trim().slice(0, 500);
      }
    }
  }
  return "";
}

/**
 * Stream a session JSONL file and extract minimal metadata (first prompt, count, timestamps, git branch).
 * Use this when building session index entries from files not listed in sessions-index.json.
 * When the file has no message timestamps, created/modified use fallbackMtimeMs (e.g. file mtime) instead of "now".
 */
export async function parseSessionFileMetadata(
  filePath: string,
  fallbackMtimeMs?: number,
): Promise<SessionFileMetadata | null> {
  const fileStream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let firstPrompt = "";
  let messageCount = 0;
  let created = "";
  let modified = "";
  let gitBranch = "";
  let isSidechain = false;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const msg = parseJSONLLine(line) as SessionMessage | null;
      if (!msg) continue;

      const ts = msg.timestamp || "";
      if (ts) {
        if (!created) created = ts;
        modified = ts;
      }
      if (
        "gitBranch" in msg &&
        typeof (msg as { gitBranch?: string }).gitBranch === "string"
      ) {
        if (!gitBranch) gitBranch = (msg as { gitBranch: string }).gitBranch;
      }
      if (
        "isSidechain" in msg &&
        typeof (msg as { isSidechain?: boolean }).isSidechain === "boolean"
      ) {
        isSidechain = (msg as { isSidechain: boolean }).isSidechain;
      }

      if (msg.type === "user") {
        messageCount++;
        if (
          !firstPrompt &&
          !isToolResultOnlyContent((msg as UserMessageEntry).message.content)
        ) {
          const text = extractFirstUserText(msg as UserMessageEntry);
          if (text) firstPrompt = text;
        }
      } else if (msg.type === "assistant") {
        messageCount++;
      }
    }
  } finally {
    fileStream.destroy();
  }

  const fallbackIso =
    fallbackMtimeMs != null
      ? new Date(fallbackMtimeMs).toISOString()
      : new Date().toISOString();
  if (!created) created = modified || fallbackIso;
  if (!modified) modified = created;

  return {
    firstPrompt: firstPrompt || "(no prompt)",
    messageCount,
    created,
    modified,
    gitBranch: gitBranch || "main",
    isSidechain,
  };
}

/**
 * Check if a filename looks like a session JSONL (UUID.jsonl), not a subagent file (agent-*.jsonl).
 */
export function isSessionJsonlFilename(name: string): boolean {
  return UUID_JSONL_REGEX.test(name) && !name.startsWith("agent-");
}
