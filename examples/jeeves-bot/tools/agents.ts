/**
 * Jeeves agent management tools: list, add, update, remove agents.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { loadConfig, saveConfig, getAgentById } from '../config.js';
import type { AgentEntry, HabitatCommands } from '../config.js';

export const agentsListTool = tool({
  description: 'List all configured agents (habitats): id, name, projectPath, gitRemote, commands.',
  inputSchema: z.object({}).optional(),
  execute: async () => {
    const config = await loadConfig();
    return {
      agents: config.agents.map(a => ({
        id: a.id,
        name: a.name,
        projectPath: a.projectPath,
        gitRemote: a.gitRemote ?? null,
        secretsRefs: a.secrets?.length ? a.secrets : undefined,
        commands: a.commands ?? undefined,
      })),
      count: config.agents.length,
    };
  },
});

const agentIdSchema = z.string().describe('Agent id or name');

const addAgentSchema = z.object({
  id: z.string().describe('Unique agent id'),
  name: z.string().describe('Display name'),
  projectPath: z.string().describe('Absolute path to the project (git clone path)'),
  gitRemote: z.string().optional().describe('Git remote URL'),
  secrets: z.array(z.string()).optional().describe('List of secret keys (e.g. env var names); values are not stored'),
  commands: z.record(z.string(), z.string()).optional().describe('Optional commands to interact with this habitat (e.g. { "cli": "pnpm run cli", "run": "pnpm start" })'),
});

export const agentsAddTool = tool({
  description: 'Add a new agent (habitat). projectPath must be the absolute path where Claude Code stores external interactions for that project.',
  inputSchema: addAgentSchema,
  execute: async ({ id, name, projectPath, gitRemote, secrets, commands }) => {
    const config = await loadConfig();
    if (config.agents.some(a => a.id === id || a.name === name)) {
      return { error: 'AGENT_EXISTS', message: `An agent with id or name "${id}" / "${name}" already exists.` };
    }
    const entry: AgentEntry = { id, name, projectPath, gitRemote, secrets, commands: commands as HabitatCommands | undefined };
    config.agents.push(entry);
    await saveConfig(config);
    return { added: entry, message: `Agent "${name}" (${id}) added.` };
  },
});

const updateAgentSchema = z.object({
  agentId: z.string().describe('Agent id or name to update'),
  name: z.string().optional().describe('New display name'),
  projectPath: z.string().optional().describe('New project path'),
  gitRemote: z.string().optional().describe('New git remote URL'),
  secrets: z.array(z.string()).optional().describe('New secret key list'),
  commands: z.record(z.string(), z.string()).optional().describe('New commands map for this habitat'),
});

export const agentsUpdateTool = tool({
  description: 'Update an existing agent by id or name.',
  inputSchema: updateAgentSchema,
  execute: async ({ agentId, name, projectPath, gitRemote, secrets, commands }) => {
    const config = await loadConfig();
    const agent = getAgentById(config, agentId);
    if (!agent) {
      return { error: 'AGENT_NOT_FOUND', message: `No agent found with id or name "${agentId}".` };
    }
    if (name !== undefined) agent.name = name;
    if (projectPath !== undefined) agent.projectPath = projectPath;
    if (gitRemote !== undefined) agent.gitRemote = gitRemote;
    if (secrets !== undefined) agent.secrets = secrets;
    if (commands !== undefined) agent.commands = commands as HabitatCommands;
    await saveConfig(config);
    return { updated: agent, message: `Agent "${agent.name}" updated.` };
  },
});

export const agentsRemoveTool = tool({
  description: 'Remove an agent by id or name.',
  inputSchema: z.object({ agentId: agentIdSchema }),
  execute: async ({ agentId }) => {
    const config = await loadConfig();
    const idx = config.agents.findIndex(a => a.id === agentId || a.name === agentId);
    if (idx === -1) {
      return { error: 'AGENT_NOT_FOUND', message: `No agent found with id or name "${agentId}".` };
    }
    const removed = config.agents.splice(idx, 1)[0];
    await saveConfig(config);
    return { removed: { id: removed.id, name: removed.name }, message: `Agent "${removed.name}" removed.` };
  },
});
