#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tool } from 'ai';
import { z } from 'zod';
import { Stimulus } from '@umwelten/core/stimulus/stimulus.js';
import { Interaction } from '@umwelten/core/interaction/core/interaction.js';
import { CLIInterface } from '@umwelten/ui/cli/CLIInterface.js';
import { getAgentCommands } from '@umwelten/ui/cli/DefaultCommands.js';
import { createFileTools } from '@umwelten/habitat/tools/file-tools.js';
import type { FileToolsContext } from '@umwelten/habitat/tools/file-tools.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = resolve(__dirname, '.');

const provider = process.env.BARE_MEMORY_PROVIDER || 'ollama';
const model = process.env.BARE_MEMORY_MODEL || 'gemma4:26b';

const ctx: FileToolsContext = {
  getWorkDir: () => MEMORY_DIR,
  getSessionsDir: () => MEMORY_DIR,
  getConfig: () => ({ agents: [] }),
  getAgent: () => undefined,
  getAllowedRoots: () => [MEMORY_DIR],
};

const agentsMdContent = await readFile(join(__dirname, 'AGENTS.md'), 'utf-8');

const patchTool = tool({
  description: 'Patch a file by replacing a specific string with a new string. Path is relative to the work directory.',
  inputSchema: z.object({
    path: z.string().describe('The path to the file to patch'),
    search: z.string().describe('The string to search for'),
    replace: z.string().describe('The string to replace it with'),
  }),
  execute: async ({ path, search, replace }) => {
    try {
      const fullPath = path.startsWith('/') ? path : resolve(MEMORY_DIR, path);
      const content = await readFile(fullPath, 'utf-8');
      if (!content.includes(search)) {
        return { error: `Could not find search string in ${path}` };
      }
      const newContent = content.replace(search, replace);
      await writeFile(fullPath, newContent, 'utf-8');
      return { path: fullPath, patched: true };
    } catch (err: any) {
      return { error: `Error patching file: ${err.message}` };
    }
  },
});

const stimulus = new Stimulus({
  role: 'an AI agent with a simple file-based memory system',
  systemContext: agentsMdContent,
  maxToolSteps: 10,
  tools: { ...createFileTools(ctx), patch_file: patchTool },
});

console.log(`[Bare Bones Memory - Patch Enabled] ${provider}:${model}  |  memory: ${MEMORY_DIR}`);

const interaction = new Interaction({ name: model, provider }, stimulus);

const cli = new CLIInterface();
cli.addCommands(getAgentCommands());
await cli.startAgent(interaction);
