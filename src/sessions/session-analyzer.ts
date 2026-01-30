import { BaseModelRunner } from '../cognition/runner.js';
import { ModelDetails, ModelResponse } from '../cognition/types.js';
import { Interaction } from '../interaction/interaction.js';
import { Stimulus } from '../stimulus/stimulus.js';
import {
  parseSessionFile,
  extractTextContent,
  extractToolCalls,
} from './session-parser.js';
import type { NormalizedSession, NormalizedMessage } from './normalized-types.js';
import type { SessionIndexEntry, ContentBlock } from './types.js';
import type { SessionAnalysis, AnalysisResponse } from './analysis-types.js';
import { AnalysisSchema } from './analysis-types.js';

/**
 * LLM prompt for extracting analysis from session markdown
 */
const ANALYSIS_PROMPT = `Analyze this Claude Code conversation and extract structured metadata.

CONVERSATION:
{markdown_content}

Extract the following information:

1. **Topics** (3-5): Main subjects discussed
   - Examples: "React hooks", "API design", "debugging TypeScript errors"

2. **Tags** (5-10): Searchable keywords
   - Examples: "typescript", "performance", "refactoring", "testing", "git"

3. **Key Learnings** (2-3 sentences): Main insights or solutions discovered
   - Focus on actionable takeaways and solutions found

4. **Summary** (1-2 sentences): Brief description of the conversation

5. **Solution Type**: Type of problem solved
   - Options: bug-fix, feature, refactor, exploration, question, other

6. **Code Languages**: Programming languages involved (if any)

7. **Tools Used**: Key tools/frameworks/libraries mentioned

8. **Success Indicators**: Was the goal achieved?
   - Options: yes, partial, no, unclear

Respond with ONLY valid JSON matching this exact schema:
{
  "topics": ["topic1", "topic2", "topic3"],
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "keyLearnings": "Main insights discovered...",
  "summary": "Brief description of conversation...",
  "solutionType": "bug-fix",
  "codeLanguages": ["typescript", "python"],
  "toolsUsed": ["React", "pytest"],
  "successIndicators": "yes"
}`;

/** Max characters per text block in analysis markdown; long tool output or pastes are truncated so we don't blow the budget. */
const MAX_TEXT_BLOCK_CHARS = 4000;

/** Max characters per chunk sent to the LLM (under 100k so we stay within context). */
const CHUNK_SIZE = 80_000;

/**
 * True if message content is only tool_result blocks (no user/assistant text).
 * Stripping these before indexing keeps markdown small and focused on the actual conversation.
 */
function isToolResultOnlyMessage(content: string | ContentBlock[]): boolean {
  if (typeof content === 'string') return false;
  if (content.length === 0) return true;
  const hasText = content.some(b => b.type === 'text');
  const onlyToolResult = content.every(b => b.type === 'tool_result');
  return !hasText && onlyToolResult;
}

function serializeMessagesToMarkdown(messages: { role: string; texts: string[] }[]): string {
  const lines: string[] = [];
  for (const { role, texts } of messages) {
    lines.push(`### ${role}`);
    lines.push('');
    for (const text of texts) {
      lines.push(text);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/** Approximate char length of one message when serialized (### Role + texts). */
function messageMarkdownLength(msg: { role: string; texts: string[] }): number {
  let n = 6 + msg.role.length + 2; // ### Role\n\n
  for (const t of msg.texts) n += t.length + 2;
  return n;
}

/**
 * Convert NormalizedMessage[] to the collected format (role + texts) used for markdown.
 * Truncates long content to MAX_TEXT_BLOCK_CHARS.
 */
function normalizedMessagesToCollected(messages: NormalizedMessage[]): { role: string; texts: string[] }[] {
  const collected: { role: string; texts: string[] }[] = [];
  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'tool') continue;
    const role = msg.role === 'user' ? 'User' : 'Assistant';
    const text =
      msg.content.length > MAX_TEXT_BLOCK_CHARS
        ? msg.content.slice(0, MAX_TEXT_BLOCK_CHARS) + '\n\n… [truncated for analysis]'
        : msg.content;
    if (text.length > 0) collected.push({ role, texts: [text] });
  }
  return collected;
}

/**
 * Build analysis markdown from a normalized session (adapter-based sources).
 * Uses messages when present; otherwise uses firstPrompt as a single user message.
 */
export function normalizedSessionToMarkdown(session: NormalizedSession): string {
  const collected =
    session.messages.length > 0
      ? normalizedMessagesToCollected(session.messages)
      : session.firstPrompt
        ? [{ role: 'User', texts: [session.firstPrompt] }]
        : [];
  const body = serializeMessagesToMarkdown(collected);
  return `# Conversation\n\n${body}`;
}

/**
 * Convert a session to markdown for LLM analysis.
 * Strips tool-result-only user messages and truncates long text blocks; does not drop any messages.
 * File-based only (requires session.fullPath).
 */
export async function sessionToAnalysisMarkdown(session: SessionIndexEntry): Promise<string> {
  const { collected } = await collectSessionMessages(session);
  const body = serializeMessagesToMarkdown(collected);
  return `# Conversation\n\n${body}`;
}

/**
 * Collect user/assistant messages (strip tool-result-only, truncate long blocks). Used for both single markdown and chunks.
 */
async function collectSessionMessages(session: SessionIndexEntry): Promise<{
  collected: { role: string; texts: string[] }[];
}> {
  const messages = await parseSessionFile(session.fullPath);
  const conversationMessages = messages.filter(m => m.type === 'user' || m.type === 'assistant');

  const collected: { role: string; texts: string[] }[] = [];

  for (const msg of conversationMessages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue;

    const content = msg.message.content;

    if (msg.type === 'user' && isToolResultOnlyMessage(content)) continue;

    const role = msg.type === 'user' ? 'User' : 'Assistant';
    const texts = extractTextContent(content).map(text =>
      text.length > MAX_TEXT_BLOCK_CHARS
        ? text.slice(0, MAX_TEXT_BLOCK_CHARS) + '\n\n… [truncated for analysis]'
        : text
    );
    if (texts.length > 0) collected.push({ role, texts });
  }

  return { collected };
}

/**
 * Split session into multiple markdown chunks, each under CHUNK_SIZE, at message boundaries.
 * Nothing is dropped; every message appears in exactly one chunk.
 */
export async function sessionToAnalysisMarkdownChunks(session: SessionIndexEntry): Promise<string[]> {
  const { collected } = await collectSessionMessages(session);
  if (collected.length === 0) return [];

  const chunks: { role: string; texts: string[] }[][] = [];
  let current: { role: string; texts: string[] }[] = [];
  let currentLen = 0;

  for (const msg of collected) {
    const msgLen = messageMarkdownLength(msg);
    if (currentLen + msgLen > CHUNK_SIZE && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(msg);
    currentLen += msgLen;
  }
  if (current.length > 0) chunks.push(current);

  const total = chunks.length;
  return chunks.map((part, i) => {
    const body = serializeMessagesToMarkdown(part);
    const header =
      total > 1 ? `# Conversation (part ${i + 1} of ${total})\n\n` : `# Conversation\n\n`;
    return header + body;
  });
}

/**
 * Extract session analysis using LLM
 */
export async function extractSessionAnalysis(
  markdown: string,
  model: ModelDetails
): Promise<AnalysisResponse> {
  // Create stimulus for analysis task
  const stimulus = new Stimulus({
    role: 'conversation analyzer',
    objective: 'extract structured metadata from Claude Code conversations',
    instructions: [
      'Be precise and accurate in identifying topics and tags',
      'Extract actionable key learnings',
      'Respond with ONLY valid JSON - no additional text',
      'Follow the schema exactly',
    ],
    temperature: 0.2, // Low temperature for consistent structured output
    maxTokens: 2000,
    runnerType: 'base',
  });

  // Create interaction
  const conversation = new Interaction(model, stimulus);

  // Add analysis prompt with markdown
  const prompt = ANALYSIS_PROMPT.replace('{markdown_content}', markdown);
  conversation.addMessage({
    role: 'user',
    content: prompt,
  });

  // Run the conversation
  const runner = new BaseModelRunner();
  const response = await runner.generateText(conversation);

  if (!response) {
    throw new Error('No response from LLM');
  }

  // Parse the response
  return parseAnalysisResponse(response);
}

/**
 * Merge multiple chunk analyses into one AnalysisResponse.
 * Topics/tags/languages/tools: union and dedupe, then trim to schema limits.
 * Key learnings/summary: concatenate chunk content.
 * Solution type / success: take most "positive" or last chunk.
 */
export function mergeChunkAnalyses(chunkResponses: AnalysisResponse[]): AnalysisResponse {
  if (chunkResponses.length === 0) {
    throw new Error('mergeChunkAnalyses requires at least one chunk');
  }
  if (chunkResponses.length === 1) return chunkResponses[0];

  const topics = [...new Set(chunkResponses.flatMap(r => r.topics))].slice(0, 5);
  const tags = [...new Set(chunkResponses.flatMap(r => r.tags))].slice(0, 10);
  const codeLanguages = [...new Set(chunkResponses.flatMap(r => r.codeLanguages))];
  const toolsUsed = [...new Set(chunkResponses.flatMap(r => r.toolsUsed))];

  const keyLearnings = chunkResponses.map(r => r.keyLearnings).filter(Boolean).join(' ');
  const summary = chunkResponses.map(r => r.summary).filter(Boolean).join(' ');

  const solutionOrder = ['feature', 'refactor', 'bug-fix', 'exploration', 'question', 'other'] as const;
  const solutionCounts = new Map<string, number>();
  for (const r of chunkResponses) {
    solutionCounts.set(r.solutionType, (solutionCounts.get(r.solutionType) || 0) + 1);
  }
  const solutionType = [...solutionCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0][0] as AnalysisResponse['solutionType'];

  const successOrder = ['yes', 'partial', 'no', 'unclear'] as const;
  const lastSuccess = chunkResponses[chunkResponses.length - 1].successIndicators;
  const anyYes = chunkResponses.some(r => r.successIndicators === 'yes');
  const anyPartial = chunkResponses.some(r => r.successIndicators === 'partial');
  const successIndicators: AnalysisResponse['successIndicators'] = anyYes
    ? 'yes'
    : anyPartial
      ? 'partial'
      : lastSuccess;

  const merged: AnalysisResponse = {
    topics: topics.length >= 3 ? topics : [...topics, ...Array(3 - topics.length).fill('other')],
    tags: tags.length >= 5 ? tags : [...tags, ...Array(5 - tags.length).fill('general')],
    keyLearnings: keyLearnings || 'Session analyzed in chunks.',
    summary: summary || 'Long conversation analyzed in multiple parts.',
    solutionType,
    codeLanguages,
    toolsUsed,
    successIndicators,
  };

  return parseAnalysisResponse({ content: JSON.stringify(merged) } as ModelResponse);
}

/**
 * Parse and validate LLM analysis response
 */
export function parseAnalysisResponse(response: ModelResponse): AnalysisResponse {
  // ModelResponse uses 'content' field
  const text = response.content || '';

  // Debug: log the raw response
  if (!text) {
    console.error('Empty response from LLM. Full response:', JSON.stringify(response, null, 2));
    throw new Error('LLM returned empty response');
  }

  // Try to extract JSON from response (handle cases where model adds extra text)
  let jsonText = text.trim();

  // If response starts with ```json, extract content
  if (jsonText.startsWith('```json')) {
    const match = jsonText.match(/```json\s*\n([\s\S]*?)\n```/);
    if (match) {
      jsonText = match[1];
    }
  } else if (jsonText.startsWith('```')) {
    const match = jsonText.match(/```\s*\n([\s\S]*?)\n```/);
    if (match) {
      jsonText = match[1];
    }
  }

  // Try to parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`Failed to parse LLM response as JSON: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  // Validate with Zod schema
  try {
    const validated = AnalysisSchema.parse(parsed);
    return validated;
  } catch (error) {
    throw new Error(`LLM response failed schema validation: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Analyze a single session and return full analysis entry.
 * For sessions that exceed CHUNK_SIZE, indexes in multiple chunks and merges results so nothing is dropped.
 */
export async function analyzeSession(
  session: SessionIndexEntry,
  model: ModelDetails
): Promise<{analysis: SessionAnalysis; relatedFiles: string[]}> {
  if (!session.fullPath) {
    throw new Error('analyzeSession requires session.fullPath (file-based sessions only). Use analyzeSessionFromNormalizedSession for adapter sessions.');
  }
  const chunks = await sessionToAnalysisMarkdownChunks(session);

  let analysisResponse: AnalysisResponse;

  if (chunks.length > 1) {
    // Analyze each chunk and merge so we capture everything
    const chunkResponses: AnalysisResponse[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const response = await extractSessionAnalysis(chunks[i], model);
      chunkResponses.push(response);
    }
    analysisResponse = mergeChunkAnalyses(chunkResponses);
  } else if (chunks.length === 1) {
    analysisResponse = await extractSessionAnalysis(chunks[0], model);
  } else {
    // No conversation messages (e.g. only tool results)
    analysisResponse = {
      topics: ['session', 'conversation', 'metadata'],
      tags: ['session', 'empty', 'metadata', 'conversation', 'analysis'],
      keyLearnings: 'No user/assistant text to analyze.',
      summary: 'Session with no analyzable conversation content.',
      solutionType: 'other',
      codeLanguages: [],
      toolsUsed: [],
      successIndicators: 'unclear',
    };
  }

  // Get tool calls to extract related files (from full session, not chunks)
  const messages = await parseSessionFile(session.fullPath);
  const toolCalls = extractToolCalls(messages);

  const relatedFiles: string[] = [];
  for (const toolCall of toolCalls) {
    if (
      toolCall.name === 'Read' ||
      toolCall.name === 'Edit' ||
      toolCall.name === 'Write' ||
      toolCall.name === 'NotebookEdit'
    ) {
      const input = toolCall.input as any;
      if (input.file_path || input.notebook_path) {
        const filePath = input.file_path || input.notebook_path;
        if (!relatedFiles.includes(filePath)) {
          relatedFiles.push(filePath);
        }
      }
    }
  }

  return {
    analysis: {
      ...analysisResponse,
      relatedFiles,
    },
    relatedFiles,
  };
}

/**
 * Analyze a normalized session (adapter-based: Cursor, etc.).
 * Builds markdown from messages/firstPrompt and runs LLM analysis. relatedFiles is left empty.
 */
export async function analyzeSessionFromNormalizedSession(
  session: NormalizedSession,
  _sessionId: string,
  _mtime: number,
  model: ModelDetails
): Promise<{analysis: SessionAnalysis; relatedFiles: string[]}> {
  const markdown = normalizedSessionToMarkdown(session);
  const conversationMessages = session.messages.filter(m => m.role === 'user' || m.role === 'assistant');
  let analysisResponse: AnalysisResponse;

  if (conversationMessages.length > 0 || session.firstPrompt) {
    analysisResponse = await extractSessionAnalysis(markdown, model);
  } else {
    analysisResponse = {
      topics: ['session', 'conversation', 'metadata'],
      tags: ['session', 'empty', 'metadata', 'conversation', 'analysis'],
      keyLearnings: 'No user/assistant text to analyze.',
      summary: 'Session with no analyzable conversation content.',
      solutionType: 'other',
      codeLanguages: [],
      toolsUsed: [],
      successIndicators: 'unclear',
    };
  }

  return {
    analysis: { ...analysisResponse, relatedFiles: [] },
    relatedFiles: [],
  };
}

/**
 * Analyze a session with error handling and retries
 */
export async function analyzeSessionWithRetry(
  session: SessionIndexEntry,
  model: ModelDetails,
  maxRetries: number = 2
): Promise<{analysis: SessionAnalysis; relatedFiles: string[]} | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries + 1; attempt++) {
    try {
      return await analyzeSession(session, model);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  // All retries failed
  console.error(
    `Failed to analyze session ${session.sessionId} after ${maxRetries + 1} attempts: ${lastError?.message}`
  );
  return null;
}
