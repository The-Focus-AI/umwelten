#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { CLIInterface } from '../../src/ui/cli/CLIInterface.js';
import { getAgentCommands } from '../../src/ui/cli/DefaultCommands.js';
import { createFileTools } from '../../src/habitat/tools/file-tools.js';
import type { FileToolsContext } from '../../src/habitat/tools/file-tools.js';

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

const stimulus = new Stimulus({
  role: 'an AI agent with a simple file-based memory system',
  systemContext: agentsMdContent,
  maxToolSteps: 10,
  tools: createFileTools(ctx),
});

console.log(`[Bare Bones Memory] ${provider}:${model}  |  memory: ${MEMORY_DIR}`);

const interaction = new Interaction({ name: model, provider }, stimulus);

const cli = new CLIInterface();
cli.addCommands(getAgentCommands());
await cli.startAgent(interaction);
