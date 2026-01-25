import { BaseModelRunner } from '../cognition/runner.js';
import { ModelDetails, ModelResponse } from '../cognition/types.js';
import { Interaction } from '../interaction/interaction.js';
import { Stimulus } from '../stimulus/stimulus.js';
import {
  parseSessionFile,
  extractTextContent,
  extractToolCalls,
  summarizeSession,
} from './session-parser.js';
import type { SessionIndexEntry } from './types.js';
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

/**
 * Convert a session to markdown format for LLM analysis
 * Optimized for analysis - excludes verbose metadata and focuses on conversation
 */
export async function sessionToAnalysisMarkdown(session: SessionIndexEntry): Promise<string> {
  const messages = await parseSessionFile(session.fullPath);
  const conversationMessages = messages.filter(m => m.type === 'user' || m.type === 'assistant');

  const lines: string[] = [];

  // Add first prompt as context
  lines.push(`# Conversation`);
  lines.push('');

  for (const msg of conversationMessages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') {
      continue;
    }

    const role = msg.type === 'user' ? 'User' : 'Assistant';
    lines.push(`### ${role}`);
    lines.push('');

    const content = msg.message.content;
    const texts = extractTextContent(content);

    for (const text of texts) {
      lines.push(text);
      lines.push('');
    }
  }

  return lines.join('\n');
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
 * Parse and validate LLM analysis response
 */
export function parseAnalysisResponse(response: ModelResponse): AnalysisResponse {
  // ModelResponse can have either 'text' or 'content' field
  const text = response.text || (response as any).content || '';

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
 * Analyze a single session and return full analysis entry
 */
export async function analyzeSession(
  session: SessionIndexEntry,
  model: ModelDetails
): Promise<{analysis: SessionAnalysis; relatedFiles: string[]}> {
  // Convert session to markdown
  const markdown = await sessionToAnalysisMarkdown(session);

  // Check markdown size - skip if too large (> 100k characters)
  if (markdown.length > 100_000) {
    // For very large sessions, truncate to first 100k characters
    console.warn(`Session ${session.sessionId} is very large (${markdown.length} chars), truncating...`);
  }

  const truncatedMarkdown = markdown.slice(0, 100_000);

  // Extract analysis using LLM
  const analysisResponse = await extractSessionAnalysis(truncatedMarkdown, model);

  // Get tool calls to extract related files
  const messages = await parseSessionFile(session.fullPath);
  const toolCalls = extractToolCalls(messages);

  // Extract file paths from tool calls (Read, Edit, Write tools)
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
