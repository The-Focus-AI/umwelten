/**
 * Habitat agent management tools: list, add, update, remove agents.
 * Tools close over a habitat context instead of calling global config functions.
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';
import type { HabitatConfig, AgentEntry, HabitatCommands } from '../types.js';

/** Interface for the habitat context that agent tools need. */
export interface AgentToolsContext {
  getConfig(): HabitatConfig;
  getAgent(idOrName: string): AgentEntry | undefined;
  addAgent(agent: AgentEntry): Promise<void>;
  updateAgent(idOrName: string, updates: Partial<AgentEntry>): Promise<void>;
  removeAgent(idOrName: string): Promise<AgentEntry | undefined>;
}

export function createAgentTools(ctx: AgentToolsContext): Record<string, Tool> {
  const agentsListTool = tool({
    description: 'List all configured agents (habitats): id, name, projectPath, gitRemote, commands.',
    inputSchema: z.object({}).optional(),
    execute: async () => {
      const config = ctx.getConfig();
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

  const addAgentSchema = z.object({
    id: z.string().describe('Unique agent id'),
    name: z.string().describe('Display name'),
    projectPath: z.string().describe('Absolute path to the project'),
    gitRemote: z.string().optional().describe('Git remote URL'),
    secrets: z.array(z.string()).optional().describe('Secret key references (env var names)'),
    commands: z.record(z.string(), z.string()).optional().describe('Commands to interact with this habitat'),
  });

  const agentsAddTool = tool({
    description: 'Add a new agent (habitat). projectPath must be the absolute path to the project.',
    inputSchema: addAgentSchema,
    execute: async ({ id, name, projectPath, gitRemote, secrets, commands }) => {
      const config = ctx.getConfig();
      if (config.agents.some(a => a.id === id || a.name === name)) {
        return { error: 'AGENT_EXISTS', message: `An agent with id or name "${id}" / "${name}" already exists.` };
      }
      const entry: AgentEntry = { id, name, projectPath, gitRemote, secrets, commands: commands as HabitatCommands | undefined };
      await ctx.addAgent(entry);
      return { added: entry, message: `Agent "${name}" (${id}) added.` };
    },
  });

  const updateAgentSchema = z.object({
    agentId: z.string().describe('Agent id or name to update'),
    name: z.string().optional().describe('New display name'),
    projectPath: z.string().optional().describe('New project path'),
    gitRemote: z.string().optional().describe('New git remote URL'),
    secrets: z.array(z.string()).optional().describe('New secret key list'),
    commands: z.record(z.string(), z.string()).optional().describe('New commands map'),
  });

  const agentsUpdateTool = tool({
    description: 'Update an existing agent by id or name.',
    inputSchema: updateAgentSchema,
    execute: async ({ agentId, name, projectPath, gitRemote, secrets, commands }) => {
      const agent = ctx.getAgent(agentId);
      if (!agent) {
        return { error: 'AGENT_NOT_FOUND', message: `No agent found with id or name "${agentId}".` };
      }
      const updates: Partial<AgentEntry> = {};
      if (name !== undefined) updates.name = name;
      if (projectPath !== undefined) updates.projectPath = projectPath;
      if (gitRemote !== undefined) updates.gitRemote = gitRemote;
      if (secrets !== undefined) updates.secrets = secrets;
      if (commands !== undefined) updates.commands = commands as HabitatCommands;
      await ctx.updateAgent(agentId, updates);
      return { updated: { ...agent, ...updates }, message: `Agent "${agent.name}" updated.` };
    },
  });

  const agentsRemoveTool = tool({
    description: 'Remove an agent by id or name.',
    inputSchema: z.object({ agentId: z.string().describe('Agent id or name') }),
    execute: async ({ agentId }) => {
      const removed = await ctx.removeAgent(agentId);
      if (!removed) {
        return { error: 'AGENT_NOT_FOUND', message: `No agent found with id or name "${agentId}".` };
      }
      return { removed: { id: removed.id, name: removed.name }, message: `Agent "${removed.name}" removed.` };
    },
  });

  return {
    agents_list: agentsListTool,
    agents_add: agentsAddTool,
    agents_update: agentsUpdateTool,
    agents_remove: agentsRemoveTool,
  };
}
