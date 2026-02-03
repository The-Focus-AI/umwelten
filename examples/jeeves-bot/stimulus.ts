/**
 * Jeeves Stimulus: role, instructions, and all tools (files, agents, external interactions).
 * Loads prompts and optional skills from the work directory (STIMULUS.md or prompts/, AGENT.md);
 * registers built-in tools and any work-dir tools from tools/.
 */

import { join } from 'node:path';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { loadToolsFromDirectory } from '../../src/stimulus/tools/loader.js';
import { loadConfig, getWorkDir, ensureWorkDir } from './config.js';
import { loadStimulusOptionsFromWorkDir } from './load-prompts.js';
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
  sessionsMessagesTool,
  sessionsStatsTool,
  sessionsReadFileTool,
} from './tools/sessions.js';
import { tavilySearchTool } from './tools/tavily.js';
import { currentTimeTool } from './tools/time.js';
import { wgetTool, markifyTool, parseFeedTool } from '../../src/stimulus/tools/url-tools.js';
import { runBashTool } from './tools/dagger.js';

export async function createJeevesStimulus(): Promise<Stimulus> {
  await ensureWorkDir();
  const workDir = getWorkDir();
  const config = await loadConfig();

  const options = await loadStimulusOptionsFromWorkDir(workDir, config);
  const stimulus = new Stimulus(options);

  // Built-in tools (always registered)
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
  stimulus.addTool('sessions_messages', sessionsMessagesTool);
  stimulus.addTool('sessions_stats', sessionsStatsTool);
  stimulus.addTool('sessions_read_file', sessionsReadFileTool);

  stimulus.addTool('current_time', currentTimeTool);
  stimulus.addTool('search', tavilySearchTool);
  stimulus.addTool('wget', wgetTool);
  stimulus.addTool('markify', markifyTool);
  stimulus.addTool('parse_feed', parseFeedTool);
  stimulus.addTool('run_bash', runBashTool);

  // Work-dir tools (from tools/ or config.toolsDir)
  const toolsDirRelative = config.toolsDir ?? 'tools';
  const workDirTools = await loadToolsFromDirectory(workDir, toolsDirRelative);
  for (const [name, tool] of Object.entries(workDirTools)) {
    stimulus.addTool(name, tool);
  }

  // Skills: resolve skillsDirs relative to work dir; git repos clone into work dir (no global cache)
  const skillsDirsResolved = (config.skillsDirs ?? ['./skills']).map((d) => join(workDir, d));
  stimulus.options.skillsDirs = skillsDirsResolved;
  stimulus.options.skillsFromGit = config.skillsFromGit ?? [];
  stimulus.options.skillsCacheRoot = join(workDir, config.skillsCacheDir ?? 'repos');
  await stimulus.loadSkills();
  stimulus.addSkillsTool();

  return stimulus;
}
