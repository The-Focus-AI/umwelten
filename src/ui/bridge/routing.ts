/**
 * Generalized channel → agent routing.
 *
 * Replaces the Discord-specific `discord.json` with a platform-agnostic
 * `routing.json`. Supports per-channel bindings, platform defaults,
 * parent-channel inheritance, and a global fallback.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  RoutingConfig,
  ChannelBinding,
  ChannelRuntimeMode,
  RouteResolution,
} from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Normalize a legacy string or partial object to a full binding. */
export function coerceChannelBinding(
  value: string | ChannelBinding | undefined,
): ChannelBinding | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const agentId = value.trim();
    return agentId ? { agentId, runtime: 'default' } : null;
  }
  if (typeof value === 'object' && typeof value.agentId === 'string') {
    const agentId = value.agentId.trim();
    if (!agentId) return null;
    const runtime: ChannelRuntimeMode =
      value.runtime === 'claude-sdk' ? 'claude-sdk' : 'default';
    return { agentId, runtime };
  }
  return null;
}

/** Extract the platform prefix from a channelKey (e.g. "discord" from "discord:123"). */
function platformFromKey(channelKey: string): string {
  const colon = channelKey.indexOf(':');
  return colon > 0 ? channelKey.slice(0, colon) : channelKey;
}

// ── Load / save ──────────────────────────────────────────────────────

export async function loadRouting(
  workDir: string,
  explicitPath?: string,
): Promise<RoutingConfig> {
  const routingPath = explicitPath ?? join(workDir, 'routing.json');
  try {
    const raw = await readFile(routingPath, 'utf-8');
    const parsed = JSON.parse(raw) as RoutingConfig;
    return {
      channels: parsed.channels ?? {},
      defaultAgentId: parsed.defaultAgentId,
      platformDefaults: parsed.platformDefaults,
    };
  } catch {
    return { channels: {} };
  }
}

export async function saveRouting(
  workDir: string,
  config: RoutingConfig,
  explicitPath?: string,
): Promise<void> {
  const routingPath = explicitPath ?? join(workDir, 'routing.json');
  await writeFile(routingPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ── Resolution ───────────────────────────────────────────────────────

/**
 * Resolve which agent (if any) should handle a channel.
 *
 * Resolution order:
 *  1. Exact channelKey match in `channels`
 *  2. parentChannelKey match in `channels` (thread inherits parent)
 *  3. Platform default (e.g. all Discord channels → "jeeves")
 *  4. Global `defaultAgentId`
 *  5. `{ kind: 'main' }` — use the habitat's own stimulus
 */
export function resolveChannelRoute(
  channelKey: string,
  routing: RoutingConfig,
  parentChannelKey?: string,
): RouteResolution {
  // 1. Exact match
  const exact = coerceChannelBinding(routing.channels?.[channelKey]);
  if (exact) {
    return { kind: 'agent', agentId: exact.agentId, runtime: exact.runtime ?? 'default' };
  }

  // 2. Parent channel match (thread inheritance)
  if (parentChannelKey) {
    const parent = coerceChannelBinding(routing.channels?.[parentChannelKey]);
    if (parent) {
      return { kind: 'agent', agentId: parent.agentId, runtime: parent.runtime ?? 'default' };
    }
  }

  // 3. Platform default
  const platform = platformFromKey(channelKey);
  const platformDefault = routing.platformDefaults?.[platform];
  if (platformDefault) {
    return {
      kind: 'agent',
      agentId: platformDefault.agentId,
      runtime: platformDefault.runtime ?? 'default',
    };
  }

  // 4. Global default
  if (routing.defaultAgentId) {
    return { kind: 'agent', agentId: routing.defaultAgentId, runtime: 'default' };
  }

  // 5. Main habitat
  return { kind: 'main' };
}

/**
 * Produce a stable string signature for a route resolution.
 * Used to detect when routing changes and invalidate cached interactions.
 */
export function routeSignature(resolution: RouteResolution): string {
  if (resolution.kind === 'main') return 'main';
  return `agent:${resolution.agentId}:${resolution.runtime}`;
}

// ── Mutations ────────────────────────────────────────────────────────

/** Set or remove a channel binding. Pass `null` to remove. */
export async function setChannelRoute(
  workDir: string,
  channelKey: string,
  agentId: string | null,
  explicitPath?: string,
  opts?: { runtime?: ChannelRuntimeMode },
): Promise<void> {
  const routing = await loadRouting(workDir, explicitPath);
  if (!routing.channels) routing.channels = {};

  if (agentId === null) {
    delete routing.channels[channelKey];
  } else {
    const binding: ChannelBinding = { agentId, runtime: opts?.runtime ?? 'default' };
    routing.channels[channelKey] = binding;
  }

  await saveRouting(workDir, routing, explicitPath);
}
