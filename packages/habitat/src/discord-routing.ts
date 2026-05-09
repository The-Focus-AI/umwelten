/**
 * Load channel → agent routing for Discord from the habitat work directory.
 * See discord.json schema in examples/jeeves-bot README.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** How bound channel messages are executed (see Jeeves Discord docs). */
export type DiscordChannelRuntimeMode = 'default' | 'claude-sdk';

export interface DiscordChannelBinding {
  agentId: string;
  /**
   * `default`: Jeeves Interaction + configured LLM + tools (includes agent_ask_claude when enabled).
   * `claude-sdk`: each user message (text-only) runs `runClaudeSDK` against the agent projectPath.
   */
  runtime?: DiscordChannelRuntimeMode;
  /** Pinned “info” message id (managed by bot on bind/unbind). */
  infoMessageId?: string;
}

export interface DiscordRoutingConfig {
  /**
   * Map Discord channel/thread snowflake → agent id (legacy string) or binding object.
   */
  channels?: Record<string, string | DiscordChannelBinding>;
  /** Messages in this channel use the main habitat stimulus (butler), not a sub-agent. */
  mainChannelId?: string;
  /** Unmapped channels (except mainChannelId) use this agent when set. */
  defaultAgentId?: string;
}

/** Normalize legacy string or partial object to a full binding. */
export function coerceDiscordChannelBinding(
  value: string | DiscordChannelBinding | undefined,
): DiscordChannelBinding | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    const agentId = value.trim();
    if (!agentId) {
      return null;
    }
    return { agentId, runtime: 'default' };
  }
  if (typeof value === 'object' && typeof value.agentId === 'string') {
    const agentId = value.agentId.trim();
    if (!agentId) {
      return null;
    }
    const runtime: DiscordChannelRuntimeMode =
      value.runtime === 'claude-sdk' ? 'claude-sdk' : 'default';
    const infoMessageId =
      typeof value.infoMessageId === 'string' && value.infoMessageId.trim()
        ? value.infoMessageId.trim()
        : undefined;
    return { agentId, runtime, infoMessageId };
  }
  return null;
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
  | {
      kind: 'agent';
      agentId: string;
      runtime: DiscordChannelRuntimeMode;
    };

function bindingFromMapEntry(
  entry: string | DiscordChannelBinding | undefined,
): DiscordChannelBinding | null {
  return coerceDiscordChannelBinding(entry);
}

/**
 * Resolve which habitat agent (or main) handles a Discord channel or thread.
 * Thread IDs are distinct snowflakes; if the thread is unmapped, `parentChannelId`
 * is checked so threads inherit their parent text channel’s binding (including runtime).
 */
export function resolveDiscordChannelRoute(
  channelId: string,
  config: DiscordRoutingConfig,
  parentChannelId?: string | null,
): DiscordRouteResolution {
  const direct = bindingFromMapEntry(config.channels?.[channelId]);
  if (direct) {
    return {
      kind: 'agent',
      agentId: direct.agentId,
      runtime: direct.runtime ?? 'default',
    };
  }
  if (config.mainChannelId && channelId === config.mainChannelId) {
    return { kind: 'main' };
  }

  if (parentChannelId) {
    const parentB = bindingFromMapEntry(config.channels?.[parentChannelId]);
    if (parentB) {
      return {
        kind: 'agent',
        agentId: parentB.agentId,
        runtime: parentB.runtime ?? 'default',
      };
    }
    if (
      config.mainChannelId &&
      parentChannelId === config.mainChannelId
    ) {
      return { kind: 'main' };
    }
  }

  if (config.defaultAgentId) {
    return {
      kind: 'agent',
      agentId: config.defaultAgentId,
      runtime: 'default',
    };
  }
  return { kind: 'main' };
}

/** Stable string for comparing route decisions (e.g. invalidate cached Interaction). */
export function discordRouteSignature(resolution: DiscordRouteResolution): string {
  if (resolution.kind === 'main') {
    return 'main';
  }
  return `agent:${resolution.agentId}:${resolution.runtime}`;
}

/** Binding stored under this exact snowflake (no inheritance). */
export async function peekExactDiscordBinding(
  workDir: string,
  channelId: string,
  explicitPath?: string,
): Promise<DiscordChannelBinding | null> {
  const cfg = await loadDiscordRouting(workDir, explicitPath);
  return bindingFromMapEntry(cfg.channels?.[channelId]);
}

/** Persist pinned info message id for this channel’s binding (exact key only). */
export async function setDiscordChannelInfoMessageId(
  workDir: string,
  channelId: string,
  infoMessageId: string | null,
  explicitPath?: string,
): Promise<void> {
  const routingPath = explicitPath ?? join(workDir, 'discord.json');
  const current = await loadDiscordRouting(workDir, routingPath);
  const channels = { ...(current.channels ?? {}) };
  const b = bindingFromMapEntry(channels[channelId]);
  if (!b) {
    return;
  }
  const nextBinding: DiscordChannelBinding = {
    ...b,
    infoMessageId:
      infoMessageId && infoMessageId.trim() ? infoMessageId.trim() : undefined,
  };
  channels[channelId] = nextBinding;
  await writeFile(
    routingPath,
    JSON.stringify({ ...current, channels }, null, 2),
    'utf-8',
  );
}

/**
 * Update runtime mode for an existing exact binding. Returns false if no binding.
 */
export async function updateDiscordChannelRuntime(
  workDir: string,
  channelId: string,
  runtime: DiscordChannelRuntimeMode,
  explicitPath?: string,
): Promise<boolean> {
  const routingPath = explicitPath ?? join(workDir, 'discord.json');
  const current = await loadDiscordRouting(workDir, routingPath);
  const channels = { ...(current.channels ?? {}) };
  const b = bindingFromMapEntry(channels[channelId]);
  if (!b) {
    return false;
  }
  channels[channelId] = { ...b, runtime };
  await writeFile(
    routingPath,
    JSON.stringify({ ...current, channels }, null, 2),
    'utf-8',
  );
  return true;
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
 * Pass `agentId` null, empty, or case-insensitive `"main"` to remove the mapping.
 */
export async function setDiscordChannelRoute(
  workDir: string,
  channelId: string,
  agentId: string | null,
  explicitPath?: string,
  options?: { runtime?: DiscordChannelRuntimeMode },
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
    const rt: DiscordChannelRuntimeMode =
      options?.runtime === 'claude-sdk' ? 'claude-sdk' : 'default';
    channels[channelId] = {
      agentId: agentId.trim(),
      runtime: rt,
    };
  }
  const next: DiscordRoutingConfig = {
    ...current,
    channels,
  };
  await writeFile(routingPath, JSON.stringify(next, null, 2), 'utf-8');
}
