/**
 * Tools for editing Discord channel → agent routing (discord.json) from chat.
 */

import { tool } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';
import {
  loadDiscordRouting,
  setDiscordChannelRoute,
} from '../discord-routing.js';

export interface DiscordRoutingToolsContext {
  workDir: string;
  routingPath?: string;
}

const SNOWFLAKE = z
  .string()
  .regex(/^\d{5,25}$/, 'Discord snowflake (numeric id), e.g. from copying message link or developer mode');

export function createDiscordRoutingTools(
  ctx: DiscordRoutingToolsContext,
): Record<string, Tool> {
  const bind = tool({
    description:
      'Map a Discord channel or thread to a habitat agent id from config.json, or clear the mapping. ' +
      'Thread IDs are separate snowflakes—bind the thread id to dedicate a thread to an agent; otherwise the thread inherits the parent channel’s mapping. ' +
      'Use agent_id "main" to remove this channel/thread from the map (fall back to parent, defaultAgentId, or main).',
    inputSchema: z.object({
      channel_id: SNOWFLAKE.describe(
        'Discord channel or thread snowflake (right-click channel → Copy Channel ID with Developer Mode)',
      ),
      agent_id: z
        .string()
        .describe(
          'Habitat agent id, or "main" to unbind this snowflake',
        ),
    }),
    execute: async ({ channel_id, agent_id }) => {
      await setDiscordChannelRoute(
        ctx.workDir,
        channel_id,
        agent_id,
        ctx.routingPath,
      );
      const lower = agent_id.trim().toLowerCase();
      if (lower === 'main' || agent_id.trim() === '') {
        return {
          ok: true,
          message: `Removed routing for ${channel_id}. It will use parent channel, default, or main.`,
        };
      }
      return {
        ok: true,
        message: `Mapped Discord ${channel_id} → agent "${agent_id.trim()}". New messages use this after the next turn (routing reloads automatically).`,
      };
    },
  });

  const list = tool({
    description:
      'List current Discord routing from discord.json: per-channel agent mappings, mainChannelId, and defaultAgentId.',
    inputSchema: z.object({}).optional(),
    execute: async () => {
      const cfg = await loadDiscordRouting(ctx.workDir, ctx.routingPath);
      return {
        channels: cfg.channels ?? {},
        mainChannelId: cfg.mainChannelId ?? null,
        defaultAgentId: cfg.defaultAgentId ?? null,
      };
    },
  });

  return {
    discord_route_bind: bind,
    discord_route_list: list,
  };
}
