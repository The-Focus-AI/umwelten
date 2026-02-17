/**
 * Habitat secrets tools: AI-callable tools for managing the secret store.
 * Tools close over a habitat context (SecretsToolsContext).
 */

import { tool } from 'ai';
import { z } from 'zod';
import type { Tool } from 'ai';

/** Interface for the habitat context that secrets tools need. */
export interface SecretsToolsContext {
  setSecret(name: string, value: string): Promise<void>;
  removeSecret(name: string): Promise<void>;
  listSecretNames(): string[];
}

export function createSecretsTools(ctx: SecretsToolsContext): Record<string, Tool> {
  const secretsSetTool = tool({
    description: 'Set a secret (API key, token, etc.) in the habitat secret store. The secret persists across sessions and is available to containers.',
    inputSchema: z.object({
      name: z.string().describe('Environment variable name (e.g. ANTHROPIC_API_KEY)'),
      value: z.string().describe('The secret value'),
    }),
    execute: async ({ name, value }) => {
      await ctx.setSecret(name, value);
      return { success: true, message: `Secret "${name}" set.` };
    },
  });

  const secretsRemoveTool = tool({
    description: 'Remove a secret from the habitat secret store.',
    inputSchema: z.object({
      name: z.string().describe('Environment variable name to remove'),
    }),
    execute: async ({ name }) => {
      await ctx.removeSecret(name);
      return { success: true, message: `Secret "${name}" removed.` };
    },
  });

  const secretsListTool = tool({
    description: 'List the names of all secrets in the habitat secret store. Never returns secret values.',
    inputSchema: z.object({}).optional(),
    execute: async () => {
      const names = ctx.listSecretNames();
      return { names, count: names.length };
    },
  });

  return {
    secrets_set: secretsSetTool,
    secrets_remove: secretsRemoveTool,
    secrets_list: secretsListTool,
  };
}
