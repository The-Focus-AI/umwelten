#!/usr/bin/env node
/**
 * Jeeves Discord bot. Requires DISCORD_BOT_TOKEN (or --token).
 * Channel → agent routing: <JEEVES_WORK_DIR>/discord.json (override with DISCORD_ROUTING_PATH).
 * Optional: DISCORD_GUILD_ID or --discord-guild for faster slash-command registration.
 */

import path from 'node:path';
import type { Tool } from 'ai';
import { DiscordAdapter } from '../../src/ui/discord/DiscordAdapter.js';
import { writeSessionTranscript } from '../../src/habitat/transcript.js';
import {
  buildAgentStimulus,
  discordRouteSignature,
  loadDiscordRouting,
  resolveDiscordChannelRoute,
} from '../../src/habitat/index.js';
import { createDiscordRoutingTools } from '../../src/habitat/tools/discord-routing-tools.js';
import type { Habitat } from '../../src/habitat/index.js';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { createJeevesHabitat } from './habitat.js';

const DEFAULT_PROVIDER = process.env.JEEVES_PROVIDER || 'google';
const DEFAULT_MODEL = process.env.JEEVES_MODEL || 'gemini-3-flash-preview';
const VISION_PROVIDER = process.env.JEEVES_VISION_PROVIDER || 'google';
const VISION_MODEL = process.env.JEEVES_VISION_MODEL || 'gemini-3-flash-preview';

function parseArgs(): {
  provider: string;
  model: string;
  token?: string;
  discordGuild?: string;
} {
  const args = process.argv.slice(2);
  let provider = DEFAULT_PROVIDER;
  let model = DEFAULT_MODEL;
  let token: string | undefined;
  let discordGuild: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) provider = args[++i];
    else if ((args[i] === '--model' || args[i] === '-m') && args[i + 1])
      model = args[++i];
    else if (args[i] === '--token' && args[i + 1]) token = args[++i];
    else if (args[i] === '--discord-guild' && args[i + 1])
      discordGuild = args[++i];
  }
  return {
    provider,
    model,
    token: token || process.env.DISCORD_BOT_TOKEN,
    discordGuild:
      discordGuild?.trim() || process.env.DISCORD_GUILD_ID?.trim(),
  };
}

async function cloneHabitatStimulus(
  habitat: Habitat,
  discordTools: Record<string, Tool>,
): Promise<Stimulus> {
  const base = await habitat.getStimulus();
  const s = new Stimulus(base.options);
  for (const [name, tool] of Object.entries(base.getTools())) {
    s.addTool(name, tool);
  }
  for (const [name, tool] of Object.entries(discordTools)) {
    s.addTool(name, tool);
  }
  s.addInstruction(
    'You can change which habitat agent answers in a Discord channel or thread using tools `discord_route_bind` and `discord_route_list` (snowflake ids).',
  );
  return s;
}

process.on('unhandledRejection', (reason: unknown) => {
  const msg =
    reason && typeof reason === 'object' && 'message' in reason
      ? String((reason as Error).message)
      : String(reason);
  if (msg.includes('No output generated') || msg.includes('No endpoints found')) {
    console.error('[DISCORD] Suppressed stream error:', msg);
    return;
  }
  console.error('[DISCORD] Unhandled rejection:', reason);
});

async function main(): Promise<void> {
  const { provider, model, token, discordGuild } = parseArgs();
  if (!token) {
    console.error(
      'Discord bot token is required. Set DISCORD_BOT_TOKEN or pass --token.',
    );
    console.error(
      'Enable Message Content Intent in the Discord Developer Portal for the bot.',
    );
    process.exit(1);
  }

  const habitat = await createJeevesHabitat();
  console.log(`[JEEVES] Work directory: ${habitat.workDir}`);
  console.log(`[JEEVES] Sessions directory: ${habitat.sessionsDir}`);

  const routingPath = process.env.DISCORD_ROUTING_PATH;
  const discordRoutingTools = createDiscordRoutingTools({
    workDir: habitat.workDir,
    routingPath,
  });

  const getStimulusForChannel = async (
    channelId: string,
    context?: {
      parentChannelId?: string | null;
      isDiscordThread?: boolean;
    },
  ) => {
    const routing = await loadDiscordRouting(habitat.workDir, routingPath);
    const resolved = resolveDiscordChannelRoute(
      channelId,
      routing,
      context?.parentChannelId,
    );
    if (resolved.kind === 'main') {
      return cloneHabitatStimulus(habitat, discordRoutingTools);
    }
    const agent = habitat.getAgent(resolved.agentId);
    if (!agent) {
      console.warn(
        `[JEEVES] Unknown agent "${resolved.agentId}" for channel ${channelId}; using main stimulus.`,
      );
      return cloneHabitatStimulus(habitat, discordRoutingTools);
    }
    return buildAgentStimulus(agent, habitat);
  };

  const getDiscordRouteSignature = async (
    channelId: string,
    context?: {
      parentChannelId?: string | null;
      isDiscordThread?: boolean;
    },
  ) => {
    const routing = await loadDiscordRouting(habitat.workDir, routingPath);
    const resolved = resolveDiscordChannelRoute(
      channelId,
      routing,
      context?.parentChannelId,
    );
    return discordRouteSignature(resolved);
  };

  const getDiscordUnrestrictedMessages = async (
    channelId: string,
    context?: {
      parentChannelId?: string | null;
      isDiscordThread?: boolean;
    },
  ) => {
    const routing = await loadDiscordRouting(habitat.workDir, routingPath);
    const resolved = resolveDiscordChannelRoute(
      channelId,
      routing,
      context?.parentChannelId,
    );
    if (resolved.kind === 'main') {
      return false;
    }
    return habitat.getAgent(resolved.agentId) != null;
  };

  const adapter = new DiscordAdapter({
    token,
    modelDetails: { name: model, provider },
    visionModelDetails: { name: VISION_MODEL, provider: VISION_PROVIDER },
    getStimulusForChannel,
    getDiscordRouteSignature,
    getDiscordUnrestrictedMessages,
    workDir: habitat.workDir,
    discordRoutingPath: routingPath,
    guildId: discordGuild || undefined,
    getSessionMediaDir: async (channelId, ctx) => {
      const { sessionDir } = await habitat.getOrCreateSession(
        'discord',
        channelId,
        { discordStableSession: ctx?.isDiscordThread === true },
      );
      return path.join(sessionDir, 'media');
    },
    getSessionDir: async (channelId, ctx) =>
      habitat.getOrCreateSession('discord', channelId, {
        discordStableSession: ctx?.isDiscordThread === true,
      }),
    writeTranscript: writeSessionTranscript,
    startNewThread: async (channelId, opts) => {
      await habitat.startNewThread('discord', channelId, {
        discordStableSession: opts?.isDiscordThread === true,
      });
    },
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await adapter.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await adapter.stop();
    process.exit(0);
  });

  await adapter.start();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
