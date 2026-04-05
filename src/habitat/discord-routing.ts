/**
 * Load channel → agent routing for Discord from the habitat work directory.
 * See discord.json schema in examples/jeeves-bot README.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DiscordRoutingConfig {
  /** Map Discord channel snowflake → habitat agent id (from config.json agents). */
  channels?: Record<string, string>;
  /** Messages in this channel use the main habitat stimulus (butler), not a sub-agent. */
  mainChannelId?: string;
  /** Unmapped channels (except mainChannelId) use this agent when set. */
  defaultAgentId?: string;
}

export async function loadDiscordRouting(
  workDir: string,
  explicitPath?: string,
): Promise<DiscordRoutingConfig> {
  const routingPath = explicitPath ?? join(workDir, 'discord.json');
  try {
    const raw = await readFile(routingPath, 'utf-8');
    const parsed = JSON.parse(raw) as DiscordRoutingConfig;
    return {
      channels: parsed.channels ?? {},
      mainChannelId: parsed.mainChannelId,
      defaultAgentId: parsed.defaultAgentId,
    };
  } catch {
    return { channels: {} };
  }
}

export type DiscordRouteResolution =
  | { kind: 'main' }
  | { kind: 'agent'; agentId: string };

/**
 * Resolve which habitat agent (or main) handles a Discord channel or thread.
 * Thread IDs are distinct snowflakes; if the thread is unmapped, `parentChannelId`
 * is checked so threads inherit their parent text channel’s binding.
 */
export function resolveDiscordChannelRoute(
  channelId: string,
  config: DiscordRoutingConfig,
  parentChannelId?: string | null,
): DiscordRouteResolution {
  const agentFromMap = config.channels?.[channelId];
  if (agentFromMap) {
    return { kind: 'agent', agentId: agentFromMap };
  }
  if (config.mainChannelId && channelId === config.mainChannelId) {
    return { kind: 'main' };
  }

  if (parentChannelId) {
    const parentAgent = config.channels?.[parentChannelId];
    if (parentAgent) {
      return { kind: 'agent', agentId: parentAgent };
    }
    if (
      config.mainChannelId &&
      parentChannelId === config.mainChannelId
    ) {
      return { kind: 'main' };
    }
  }

  if (config.defaultAgentId) {
    return { kind: 'agent', agentId: config.defaultAgentId };
  }
  return { kind: 'main' };
}

/** Stable string for comparing route decisions (e.g. invalidate cached Interaction). */
export function discordRouteSignature(resolution: DiscordRouteResolution): string {
  return resolution.kind === 'main' ? 'main' : `agent:${resolution.agentId}`;
}

/** Merge a new channel mapping into discord.json (used by optional provisioning). */
export async function appendDiscordChannelRoute(
  workDir: string,
  channelId: string,
  agentId: string,
  explicitPath?: string,
): Promise<void> {
  const routingPath = explicitPath ?? join(workDir, 'discord.json');
  const current = await loadDiscordRouting(workDir, routingPath);
  const channels = { ...current.channels, [channelId]: agentId };
  const next: DiscordRoutingConfig = {
    ...current,
    channels,
  };
  await writeFile(routingPath, JSON.stringify(next, null, 2), 'utf-8');
}

/**
 * Set or clear a channel/thread → agent mapping in discord.json.
 * Pass `agentId` null, empty, or case-insensitive `"main"` to remove the mapping
 * (that channel/thread then falls back to parent / default / main).
 */
export async function setDiscordChannelRoute(
  workDir: string,
  channelId: string,
  agentId: string | null,
  explicitPath?: string,
): Promise<void> {
  const routingPath = explicitPath ?? join(workDir, 'discord.json');
  const current = await loadDiscordRouting(workDir, routingPath);
  const channels = { ...(current.channels ?? {}) };
  const clear =
    agentId === null ||
    agentId.trim() === '' ||
    agentId.trim().toLowerCase() === 'main';
  if (clear) {
    delete channels[channelId];
  } else {
    channels[channelId] = agentId.trim();
  }
  const next: DiscordRoutingConfig = {
    ...current,
    channels,
  };
  await writeFile(routingPath, JSON.stringify(next, null, 2), 'utf-8');
}
