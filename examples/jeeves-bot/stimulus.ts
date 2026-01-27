/**
 * Jeeves Stimulus: role, instructions, and all tools (files, agents, sessions).
 * Loads JEEVES_PROMPT.md (butler persona and memory system) and optionally AGENT.md from the work directory.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { loadAgentMd } from './config.js';
import { createReadFileTool, createWriteFileTool, createListDirectoryTool } from './tools/files.js';
import {
  agentsListTool,
  agentsAddTool,
  agentsUpdateTool,
  agentsRemoveTool,
} from './tools/agents.js';
import {
  sessionsListTool,
  sessionsShowTool,
  sessionsMessagesTool,
  sessionsStatsTool,
} from './tools/sessions.js';
import { tavilySearchTool } from './tools/tavily.js';
import { currentTimeTool } from './tools/time.js';
import { wgetTool, markifyTool } from '../../src/stimulus/tools/url-tools.js';

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

export async function createJeevesStimulus(): Promise<Stimulus> {
  const [jeevesPrompt, agentMd] = await Promise.all([loadJeevesPrompt(), loadAgentMd()]);
  const systemContextParts = [jeevesPrompt, agentMd].filter(Boolean);
  const systemContext = systemContextParts.length > 0 ? systemContextParts.join('\n\n---\n\n') : undefined;

  const stimulus = new Stimulus({
    role: 'Jeeves',
    objective: 'Assist with file operations, directory listing, web search, fetching URLs (wget), converting pages to markdown (markify), and managing agents and their Claude Code sessions. Continuously learn about the person you assist and maintain memories.md, facts.md, and private journal.md in the work directory.',
    instructions: [
      'You are a helpful butler-style assistant. Be concise and precise. Use current_time when the user asks for the time, date, or "now". Use the search tool when the user asks for current information, facts, or to look something up on the web. Use wget to fetch raw URL content; use markify to turn a webpage into readable markdown.',
      'File operations: by default paths are relative to the Jeeves work directory (where the bot stores its data). Use list_directory with path "." to list the work dir. Use agentId only when the user explicitly refers to an agent or project.',
      'When listing or showing sessions, always identify the agent by id or name first.',
      'Secrets in agent config are references only (e.g. env var names); never store or echo secret values.',
      'For current date or time, use the current_time tool instead of guessing.',
      'Maintain memories.md, facts.md, and private journal.md in the work directory as described in your additional context (read that section carefully and follow it each conversation).',
    ],
    maxToolSteps: 10,
    ...(systemContext && { systemContext }),
  });

  stimulus.addTool('read_file', createReadFileTool());
  stimulus.addTool('write_file', createWriteFileTool());
  stimulus.addTool('list_directory', createListDirectoryTool());

  stimulus.addTool('agents_list', agentsListTool);
  stimulus.addTool('agents_add', agentsAddTool);
  stimulus.addTool('agents_update', agentsUpdateTool);
  stimulus.addTool('agents_remove', agentsRemoveTool);

  stimulus.addTool('sessions_list', sessionsListTool);
  stimulus.addTool('sessions_show', sessionsShowTool);
  stimulus.addTool('sessions_messages', sessionsMessagesTool);
  stimulus.addTool('sessions_stats', sessionsStatsTool);

  stimulus.addTool('current_time', currentTimeTool);
  stimulus.addTool('search', tavilySearchTool);
  stimulus.addTool('wget', wgetTool);
  stimulus.addTool('markify', markifyTool);

  return stimulus;
}
