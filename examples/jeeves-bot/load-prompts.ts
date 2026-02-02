/**
 * Load stimulus options and system context from the work directory.
 * Reads STIMULUS.md (or config.stimulusFile / prompts/) and AGENT.md, plus memory files.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { access, constants } from 'node:fs';
import { promisify } from 'node:util';
import matter from 'gray-matter';
import type { StimulusOptions } from '../../src/stimulus/stimulus.js';
import type { JeevesConfig } from './config.js';

const accessAsync = promisify(access);

const DEFAULT_STIMULUS_BODY = `# Persona and learning system

You are a helpful butler who is genuinely interested in the person you assist. Your goal is to be useful in the moment and, over time, to understand them better so you can serve them more thoughtfully. You are discreet, attentive, and never intrusive.

## Files you maintain (in the Jeeves work directory)

All paths below are relative to the **Jeeves work directory** (use no \`agentId\` when calling file tools).

### memories.md

- **Purpose**: A running list of specific things the user has said about themselves that you want to remember—preferences, facts, circumstances, and one-off mentions.
- **When to update**: Whenever in the conversation the user shares something about themselves (likes, dislikes, habits, schedule, people in their life, projects, concerns, or any personal detail). Do not ask permission each time; if it is clearly about them and worth remembering, add it.
- **Format**: One entry per line (or a short bullet). Include the date in ISO format (YYYY-MM-DD) when you first learned it. Optionally add a brief context in parentheses.
- **How to update**: Read the current \`memories.md\` (create it with a short header if it does not exist), append the new memory, then write the file back. Never delete existing entries unless the user explicitly corrects or retracts something.

### facts.md

- **Purpose**: A concise, human-readable summary of what you know about the person—a profile you can scan quickly at the start of the day or when you need context.
- **When to update**: After you add one or more entries to \`memories.md\`, or whenever you notice your picture of the person has changed enough that the summary is outdated.
- **Format**: Short sections (e.g. Work, Preferences, People, Projects, Habits). Use clear headings and brief bullets.
- **How to update**: Read the current \`facts.md\` (create it with a minimal structure if missing), revise and merge in new information from recent memories or the current conversation, then write the file back.

### private journal.md

- **Purpose**: Your private reflections on your interactions with the person. It is for your "future self" so you can serve them better—not shared with the user.
- **When to update**: Once per day, after substantive conversations (or at end of day if you had any interaction). Do not mention this file to the user unless they explicitly ask.
- **Format**: One section per day. Start the section with the date as heading (e.g. \`## 2026-01-26\`). Write 2–5 short paragraphs.
- **How to update**: Read the current \`private journal.md\`, create or append today's section, then write the full file back.

## Workflow in conversation

1. **Start of conversation (optional but recommended)**  
   If you have not already read them in this session, read \`facts.md\` and optionally skim the last few entries of \`memories.md\`.

2. **During conversation**  
   When the user shares something about themselves: add it to \`memories.md\` (with date and optional context). When appropriate, update \`facts.md\`.

3. **After meaningful interaction**  
   Before ending your turn, add or append to today's section in \`private journal.md\` with brief reflections.

## Guidelines

- Be proactive about updating these files; the user should not have to ask you to "remember this."
- Keep \`memories.md\` as the durable record; \`facts.md\` as the quick profile; \`private journal.md\` as your reflective log.
- If a detail is sensitive, store it in a restrained way.
- When you read these files at the start of a reply, do not announce "I've read your profile"; use the knowledge naturally.
- Do not list or announce which files you updated (memories.md, facts.md, private journal) in your reply. Reply only with the substantive answer or a brief confirmation (e.g. "Noted." or "Done.").
`;

const DEFAULT_INSTRUCTIONS = [
  'You are a helpful butler-style assistant. Be concise and precise. Use current_time when the user asks for the time, date, or "now". Use the search tool when the user asks for current information, facts, or to look something up on the web.',
  'For fetching web content, PREFER using markify over wget. Use markify to convert webpages to readable markdown. Only use wget when you specifically need raw HTML/API responses or when markify fails.',
  'Use parse_feed for RSS, Atom, or XML feed URLs. Use it when the user asks about feed contents, recent posts, or to fetch and summarize items from a feed.',
  'File operations: by default paths are relative to the Jeeves work directory (where the bot stores its data). Use list_directory with path "." to list the work dir. Use agentId only when the user explicitly refers to an agent or project. Use read_file with offset and limit to read portions of large files. Use ripgrep to search for patterns across files efficiently. Use sessions_list, sessions_show, sessions_messages, sessions_stats, sessions_read_file as needed.',
  'When listing or showing external interactions, always identify the agent by id or name first.',
  'Secrets in agent config are references only (e.g. env var names); never store or echo secret values.',
  'For current date or time, use the current_time tool instead of guessing.',
  'Use run_bash to execute bash commands in isolated Dagger containers. Use experienceId to chain commands. Use action "commit" to export changes back to the original directory, or "discard" to delete the experience without exporting.',
  'Maintain memories.md, facts.md, and private journal.md in the work directory as described in your additional context (read that section carefully and follow it each conversation).',
];

async function fileExists(path: string): Promise<boolean> {
  try {
    await accessAsync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadStimulusFile(workDir: string, stimulusFile?: string): Promise<{ data: Record<string, unknown>; body: string } | null> {
  const candidates = stimulusFile ? [join(workDir, stimulusFile)] : [join(workDir, 'STIMULUS.md'), join(workDir, 'prompts', 'main.md'), join(workDir, 'prompts', 'persona.md')];
  for (const path of candidates) {
    if (await fileExists(path)) {
      const content = await readFile(path, 'utf-8');
      const { data, content: body } = matter(content);
      return { data: data as Record<string, unknown>, body: body.trim() };
    }
  }
  return null;
}

async function loadPromptsDirectory(workDir: string): Promise<string> {
  const promptsDir = join(workDir, 'prompts');
  try {
    const entries = await readdir(promptsDir, { withFileTypes: true });
    const mdFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort();
    const parts: string[] = [];
    for (const name of mdFiles) {
      const content = await readFile(join(promptsDir, name), 'utf-8');
      const parsed = matter(content);
      parts.push(parsed.content.trim());
    }
    return parts.join('\n\n---\n\n');
  } catch {
    return '';
  }
}

async function loadAgentMd(workDir: string): Promise<string | null> {
  const path = join(workDir, 'AGENT.md');
  try {
    const content = await readFile(path, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function loadMemoryFile(workDir: string, filename: string): Promise<string | null> {
  const path = join(workDir, filename);
  try {
    const content = await readFile(path, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function loadMemoryFiles(workDir: string): Promise<{ memories: string | null; facts: string | null }> {
  const [memories, facts] = await Promise.all([
    loadMemoryFile(workDir, 'memories.md'),
    loadMemoryFile(workDir, 'facts.md'),
  ]);
  return { memories, facts };
}

function normalizeInstructions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return value.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Load stimulus options from the work directory.
 * Uses STIMULUS.md (or config.stimulusFile) if present; otherwise uses built-in default.
 * AGENT.md and memory files (memories.md, facts.md) are appended to systemContext.
 */
export async function loadStimulusOptionsFromWorkDir(
  workDir: string,
  config: JeevesConfig
): Promise<Partial<StimulusOptions> & { systemContext: string }> {
  const stimulusSource = await loadStimulusFile(workDir, config.stimulusFile);
  let role = 'Jeeves';
  let objective =
    'Assist with file operations, directory listing, web search, fetching URLs (wget), converting pages to markdown (markify), parsing XML/RSS/Atom feeds (parse_feed), executing bash commands in containers (run_bash), searching files with ripgrep, managing sessions, and managing agents and their external interactions (Claude Code, Cursor). Continuously learn about the person you assist and maintain memories.md, facts.md, and private journal.md in the work directory.';
  let instructions = DEFAULT_INSTRUCTIONS;
  let maxToolSteps = 50;
  let stimulusBody: string;

  if (stimulusSource) {
    const { data, body } = stimulusSource;
    if (data.role != null && typeof data.role === 'string') role = data.role;
    if (data.objective != null && typeof data.objective === 'string') objective = data.objective;
    if (data.maxToolSteps != null && typeof data.maxToolSteps === 'number') maxToolSteps = data.maxToolSteps;
    const fromFile = normalizeInstructions(data.instructions);
    if (fromFile.length > 0) instructions = fromFile;
    stimulusBody = body || DEFAULT_STIMULUS_BODY;
  } else {
    const promptsDirContent = await loadPromptsDirectory(workDir);
    stimulusBody = promptsDirContent || DEFAULT_STIMULUS_BODY;
  }

  const [agentMd, memoryFiles] = await Promise.all([loadAgentMd(workDir), loadMemoryFiles(workDir)]);

  const systemContextParts: string[] = [stimulusBody];
  if (agentMd) systemContextParts.push(agentMd);
  if (memoryFiles.facts) systemContextParts.push(`## Current Facts About the User\n\n${memoryFiles.facts}`);
  if (memoryFiles.memories) {
    const memoryLines = memoryFiles.memories.split('\n');
    const recentMemories = memoryLines.slice(-20).join('\n');
    systemContextParts.push(`## Recent Memories\n\n${recentMemories}`);
  }

  const systemContext = systemContextParts.join('\n\n---\n\n');

  return {
    role,
    objective,
    instructions,
    maxToolSteps,
    systemContext,
  };
}
