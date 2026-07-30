/**
 * Optional: create a guild text channel for a habitat agent and write the
 * channel → agent binding into routing.json (via bridge/routing.ts).
 * Gated by DISCORD_AUTO_CHANNELS=1 and Manage Channels permission.
 */

import { setChannelRoute } from './bridge/routing.js';

const CATEGORY_NAME = 'Jeeves';

// Discord API constants, inlined so habitat doesn't depend on discord.js
// (the actual bot lives in @umwelten/ui). Values are wire-protocol stable:
// https://discord.com/developers/docs/resources/channel#channel-object-channel-types
const CHANNEL_TYPE_GUILD_TEXT = 0;
const CHANNEL_TYPE_GUILD_CATEGORY = 4;
const PERMISSION_MANAGE_CHANNELS = 1n << 4n;

/** Structural subset of a discord.js guild channel used by provisioning. */
export interface ProvisionGuildChannel {
  id: string;
  name: string;
  type: number;
}

/**
 * Structural subset of discord.js's Guild used by provisioning. A real
 * `Guild` satisfies this shape; callers outside discord.js can stub it.
 */
export interface ProvisionGuild {
  members: {
    me: { permissions: { has(permission: bigint): boolean } } | null;
  };
  channels: {
    cache: { values(): IterableIterator<ProvisionGuildChannel> };
    create(options: {
      name: string;
      type: number;
      parent?: string;
      reason?: string;
    }): Promise<ProvisionGuildChannel>;
  };
}

export interface DiscordProvisionOptions {
  guild: ProvisionGuild;
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
  if (!me?.permissions.has(PERMISSION_MANAGE_CHANNELS)) {
    return { ok: false, error: 'Bot lacks Manage Channels permission in this server.' };
  }

  const slug = slugChannelName(options.channelName);
  let category: ProvisionGuildChannel | undefined;
  for (const c of options.guild.channels.cache.values()) {
    if (c.type === CHANNEL_TYPE_GUILD_CATEGORY && c.name === CATEGORY_NAME) {
      category = c;
      break;
    }
  }
  if (!category) {
    try {
      category = await options.guild.channels.create({
        name: CATEGORY_NAME,
        type: CHANNEL_TYPE_GUILD_CATEGORY,
        reason: 'Jeeves habitat agent channels',
      });
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Failed to create category',
      };
    }
  }

  let channel: ProvisionGuildChannel;
  try {
    channel = await options.guild.channels.create({
      name: slug,
      type: CHANNEL_TYPE_GUILD_TEXT,
      parent: category.id,
      reason: `Agent ${options.agentId}`,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to create text channel',
    };
  }

  await setChannelRoute(
    options.workDir,
    `discord:${channel.id}`,
    options.agentId,
    options.routingPath,
  );

  return { ok: true, channelId: channel.id, channelName: slug };
}
