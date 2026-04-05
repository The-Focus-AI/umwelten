/**
 * Optional: create a guild text channel for a habitat agent and append discord.json.
 * Gated by DISCORD_AUTO_CHANNELS=1 and Manage Channels permission.
 */

import type { CategoryChannel, Guild, TextChannel } from 'discord.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { appendDiscordChannelRoute } from './discord-routing.js';

const CATEGORY_NAME = 'Jeeves';

export interface DiscordProvisionOptions {
  guild: Guild;
  workDir: string;
  agentId: string;
  /** Channel name (slug), e.g. operations */
  channelName: string;
  routingPath?: string;
}

function slugChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'agent';
}

/**
 * Create (or reuse) a category "Jeeves" and a text channel under it, then map channel → agentId.
 */
export async function provisionDiscordAgentChannel(
  options: DiscordProvisionOptions,
): Promise<{ ok: true; channelId: string; channelName: string } | { ok: false; error: string }> {
  if (process.env.DISCORD_AUTO_CHANNELS !== '1' && process.env.DISCORD_AUTO_CHANNELS !== 'true') {
    return {
      ok: false,
      error:
        'Set DISCORD_AUTO_CHANNELS=1 to enable automatic channel creation (bot needs Manage Channels).',
    };
  }

  const me = options.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return { ok: false, error: 'Bot lacks Manage Channels permission in this server.' };
  }

  const slug = slugChannelName(options.channelName);
  let category = options.guild.channels.cache.find(
    (c): c is CategoryChannel =>
      c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME,
  );
  if (!category) {
    try {
      category = await options.guild.channels.create({
        name: CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        reason: 'Jeeves habitat agent channels',
      });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Failed to create category',
      };
    }
  }

  let channel: TextChannel;
  try {
    channel = await options.guild.channels.create({
      name: slug,
      type: ChannelType.GuildText,
      parent: category.id,
      reason: `Agent ${options.agentId}`,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to create text channel',
    };
  }

  await appendDiscordChannelRoute(
    options.workDir,
    channel.id,
    options.agentId,
    options.routingPath,
  );

  return { ok: true, channelId: channel.id, channelName: slug };
}
