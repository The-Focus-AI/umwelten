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
  getSecret(name: string): string | undefined;
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
    description: 'List all secrets in the habitat secret store. Shows names and whether they are set, but not values (for security).',
    inputSchema: z.object({}).optional(),
    execute: async () => {
      const names = ctx.listSecretNames();
      const secrets: Array<{ name: string; isSet: boolean }> = [];
      for (const name of names) {
        const value = ctx.getSecret(name);
        secrets.push({ name, isSet: value !== undefined && value !== null });
      }
      return { secrets, count: secrets.length };
    },
  });

  const secretsGetTool = tool({
    description: 'Check if a specific secret exists in the habitat secret store. Returns whether it is set, but not the value (for security).',
    inputSchema: z.object({
      name: z.string().describe('Environment variable name to look up'),
    }),
    execute: async ({ name }) => {
      const value = ctx.getSecret(name);
      if (value === undefined) {
        return { name, found: false, message: `Secret "${name}" not found in store or environment.` };
      }
      return { name, found: true, message: `Secret "${name}" is set.` };
    },
  });

  return {
    secrets_set: secretsSetTool,
    secrets_remove: secretsRemoveTool,
    secrets_list: secretsListTool,
    secrets_get: secretsGetTool,
  };
}
