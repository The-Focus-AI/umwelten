/**
 * Jeeves Stimulus: role, instructions, and all tools (files, agents, external interactions).
 * Loads JEEVES_PROMPT.md (butler persona and memory system) and optionally AGENT.md from the work directory.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { loadAgentMd, getWorkDir } from './config.js';
import { createReadFileTool, createWriteFileTool, createListDirectoryTool, createRipgrepTool } from './tools/files.js';
import {
  agentsListTool,
  agentsAddTool,
  agentsUpdateTool,
  agentsRemoveTool,
} from './tools/agents.js';
import {
  externalInteractionsListTool,
  externalInteractionsShowTool,
  externalInteractionsMessagesTool,
  externalInteractionsStatsTool,
} from './tools/external-interactions.js';
import {
  sessionsListTool,
  sessionsShowTool,
  sessionsReadFileTool,
} from './tools/sessions.js';
import { tavilySearchTool } from './tools/tavily.js';
import { currentTimeTool } from './tools/time.js';
import { wgetTool, markifyTool, parseFeedTool } from '../../src/stimulus/tools/url-tools.js';
import { runBashTool } from './tools/dagger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadJeevesPrompt(): Promise<string> {
  const path = join(__dirname, 'JEEVES_PROMPT.md');
  try {
    const content = await readFile(path, 'utf-8');
    return content.trim();
  } catch {
    return '';
  }
}

async function loadMemoryFile(filename: string): Promise<string | null> {
  const workDir = getWorkDir();
  const filePath = join(workDir, filename);
  try {
    const content = await readFile(filePath, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}

async function loadMemoryFiles(): Promise<{ memories: string | null; facts: string | null; journal: string | null }> {
  const [memories, facts, journal] = await Promise.all([
    loadMemoryFile('memories.md'),
    loadMemoryFile('facts.md'),
    loadMemoryFile('private journal.md'),
  ]);
  return { memories, facts, journal };
}

export async function createJeevesStimulus(): Promise<Stimulus> {
  // Ensure work directory exists before loading memory files
  const { ensureWorkDir } = await import('./config.js');
  await ensureWorkDir();
  
  const [jeevesPrompt, agentMd, memoryFiles] = await Promise.all([
    loadJeevesPrompt(),
    loadAgentMd(),
    loadMemoryFiles(),
  ]);
  
  const systemContextParts = [jeevesPrompt, agentMd].filter(Boolean);
  
  // Add memory files if they exist
  if (memoryFiles.facts) {
    systemContextParts.push(`## Current Facts About the User\n\n${memoryFiles.facts}`);
  }
  if (memoryFiles.memories) {
    // Include last 20 lines of memories to keep context manageable
    const memoryLines = memoryFiles.memories.split('\n');
    const recentMemories = memoryLines.slice(-20).join('\n');
    systemContextParts.push(`## Recent Memories\n\n${recentMemories}`);
  }
  // Note: private journal.md is intentionally NOT loaded - it's for the bot's private use only
  
  const systemContext = systemContextParts.length > 0 ? systemContextParts.join('\n\n---\n\n') : undefined;

  const stimulus = new Stimulus({
    role: 'Jeeves',
    objective: 'Assist with file operations, directory listing, web search, fetching URLs (wget), converting pages to markdown (markify), parsing XML/RSS/Atom feeds (parse_feed), executing bash commands in containers (run_bash), searching files with ripgrep, managing sessions, and managing agents and their external interactions (Claude Code, Cursor). Continuously learn about the person you assist and maintain memories.md, facts.md, and private journal.md in the work directory.',
    instructions: [
      'You are a helpful butler-style assistant. Be concise and precise. Use current_time when the user asks for the time, date, or "now". Use the search tool when the user asks for current information, facts, or to look something up on the web.',
      'For fetching web content, PREFER using markify over wget. Use markify to convert webpages to readable markdown - it produces cleaner, more useful content. Only use wget when you specifically need raw HTML/API responses or when markify fails.',
      'Use parse_feed for RSS, Atom, or XML feed URLs. It returns feed metadata and a list of items (title, link, description, pubDate). Use it when the user asks about feed contents, recent posts, or to fetch and summarize items from a feed.',
      'File operations: by default paths are relative to the Jeeves work directory (where the bot stores its data). Use list_directory with path "." to list the work dir. Use agentId only when the user explicitly refers to an agent or project. Use read_file with offset and limit to read portions of large files. Use ripgrep to search for patterns across files efficiently. Use sessions_list to see all sessions, sessions_show to view session details, and sessions_read_file to access files in session directories.',
      'When listing or showing external interactions, always identify the agent by id or name first.',
      'Secrets in agent config are references only (e.g. env var names); never store or echo secret values.',
      'For current date or time, use the current_time tool instead of guessing.',
      'Use run_bash to execute bash commands in isolated Dagger containers. Use experienceId to chain commands together - commands in the same experience see previous changes. Use action "commit" to export changes back to the original directory, or "discard" to delete the experience without exporting.',
      'Maintain memories.md, facts.md, and private journal.md in the work directory as described in your additional context (read that section carefully and follow it each conversation).',
    ],
    maxToolSteps: 50,
    ...(systemContext && { systemContext }),
  });

  stimulus.addTool('read_file', createReadFileTool());
  stimulus.addTool('write_file', createWriteFileTool());
  stimulus.addTool('list_directory', createListDirectoryTool());
  stimulus.addTool('ripgrep', createRipgrepTool());

  stimulus.addTool('agents_list', agentsListTool);
  stimulus.addTool('agents_add', agentsAddTool);
  stimulus.addTool('agents_update', agentsUpdateTool);
  stimulus.addTool('agents_remove', agentsRemoveTool);

  stimulus.addTool('external_interactions_list', externalInteractionsListTool);
  stimulus.addTool('external_interactions_show', externalInteractionsShowTool);
  stimulus.addTool('external_interactions_messages', externalInteractionsMessagesTool);
  stimulus.addTool('external_interactions_stats', externalInteractionsStatsTool);

  stimulus.addTool('sessions_list', sessionsListTool);
  stimulus.addTool('sessions_show', sessionsShowTool);
  stimulus.addTool('sessions_read_file', sessionsReadFileTool);

  stimulus.addTool('current_time', currentTimeTool);
  stimulus.addTool('search', tavilySearchTool);
  stimulus.addTool('wget', wgetTool);
  stimulus.addTool('markify', markifyTool);
  stimulus.addTool('parse_feed', parseFeedTool);
  stimulus.addTool('run_bash', runBashTool);

  return stimulus;
}
