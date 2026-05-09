/**
 * Shared slash commands that work identically across all platforms.
 *
 * Each platform adapter calls `processBridgeCommand()` when it detects
 * a command prefix (/, !, etc.). The function returns a `CommandResult`
 * that the adapter formats and sends using its platform-specific method.
 */

import type { ChannelBridge } from './channel-bridge.js';

// ── Types ────────────────────────────────────────────────────────────

export interface CommandResult {
  /** Whether the input was recognized as a command. */
  handled: boolean;
  /** Text response to send to the user. */
  text?: string;
}

// ── Command definitions ──────────────────────────────────────────────

interface CommandDef {
  /** Primary trigger (e.g. "reset"). */
  name: string;
  /** Aliases (e.g. ["start"] for reset). */
  aliases?: string[];
  /** Short description for /help. */
  description: string;
  /** Whether the command takes an argument. */
  hasArg?: boolean;
  /** Execute the command. Returns response text. */
  execute: (ctx: CommandContext) => Promise<string>;
}

interface CommandContext {
  bridge: ChannelBridge;
  channelKey: string;
  arg: string;
}

const commands: CommandDef[] = [
  {
    name: 'reset',
    aliases: ['start'],
    description: 'Clear conversation history and start fresh',
    execute: async ({ bridge, channelKey }) => {
      bridge.resetChannel(channelKey);
      return 'Conversation cleared. Send a message to start fresh.';
    },
  },
  {
    name: 'agents',
    description: 'List available agents',
    execute: async ({ bridge }) => {
      const agents = bridge.listAgents();
      if (agents.length === 0) {
        return 'No agents registered. Add agents to config.json.';
      }
      const lines = agents.map(a => `  **${a.id}** — ${a.name}`);
      return `Agents (${agents.length}):\n${lines.join('\n')}`;
    },
  },
  {
    name: 'switch',
    description: 'Switch to an agent: /switch <agent-id> or /switch main',
    hasArg: true,
    execute: async ({ bridge, channelKey, arg }) => {
      if (!arg) {
        const agents = bridge.listAgents();
        const ids = agents.map(a => `\`${a.id}\``).join(', ');
        return `Usage: /switch <agent-id> or /switch main\nAvailable: ${ids || 'none'}`;
      }

      if (arg === 'main' || arg === 'default' || arg === 'habitat') {
        const route = await bridge.switchAgent(channelKey, null);
        return 'Switched to main habitat persona.';
      }

      // Check if agent exists
      const agents = bridge.listAgents();
      const match = agents.find(a => a.id === arg || a.name.toLowerCase() === arg.toLowerCase());
      if (!match) {
        const ids = agents.map(a => `\`${a.id}\``).join(', ');
        return `Agent "${arg}" not found.\nAvailable: ${ids || 'none'}`;
      }

      const route = await bridge.switchAgent(channelKey, match.id);
      return `Switched to agent **${match.id}** (${match.name}). Next message will use this agent's persona and tools.`;
    },
  },
  {
    name: 'switch-claude',
    description: 'Switch to Claude SDK pass-through: /switch-claude <agent-id>',
    hasArg: true,
    execute: async ({ bridge, channelKey, arg }) => {
      if (!arg) {
        return 'Usage: /switch-claude <agent-id>\nMessages will be sent to Claude Code with full tools against the agent\'s project.';
      }

      const agents = bridge.listAgents();
      const match = agents.find(a => a.id === arg || a.name.toLowerCase() === arg.toLowerCase());
      if (!match) {
        const ids = agents.map(a => `\`${a.id}\``).join(', ');
        return `Agent "${arg}" not found.\nAvailable: ${ids || 'none'}`;
      }

      await bridge.switchAgent(channelKey, match.id, 'claude-sdk');
      return `Switched to **Claude SDK** pass-through for agent **${match.id}**. Messages go directly to Claude Code with full tools (Read, Edit, Bash, etc.) against \`${match.name}\`. Use /switch main to go back.`;
    },
  },
  {
    name: 'status',
    description: 'Show current agent routing for this channel',
    execute: async ({ bridge, channelKey }) => {
      const route = await bridge.resolveRoute(channelKey);
      if (route.kind === 'main') {
        return 'Current route: **main habitat** (default persona)';
      }
      const runtimeLabel = route.runtime === 'claude-sdk' ? ' (Claude SDK pass-through)' : '';
      return `Current route: agent **${route.agentId}**${runtimeLabel}`;
    },
  },
  {
    name: 'help',
    description: 'Show available commands',
    execute: async () => {
      const lines = commands.map(c => {
        const trigger = c.hasArg ? `/${c.name} <arg>` : `/${c.name}`;
        const aliases = c.aliases ? ` (also: ${c.aliases.map(a => `/${a}`).join(', ')})` : '';
        return `  **${trigger}**${aliases} — ${c.description}`;
      });
      return `Commands:\n${lines.join('\n')}`;
    },
  },
];

// ── Command index (built once) ───────────────────────────────────────

const commandIndex = new Map<string, CommandDef>();
for (const cmd of commands) {
  commandIndex.set(cmd.name, cmd);
  if (cmd.aliases) {
    for (const alias of cmd.aliases) {
      commandIndex.set(alias, cmd);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Try to process a user message as a bridge command.
 *
 * Returns `{ handled: false }` if the message is not a command,
 * so the adapter should forward it to `bridge.handleMessage()` instead.
 *
 * Command prefix is `/` — adapters should call this before handleMessage
 * for any text that starts with `/`.
 */
export async function processBridgeCommand(
  bridge: ChannelBridge,
  channelKey: string,
  input: string,
): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  // Parse: "/switch ops" → name="switch", arg="ops"
  const withoutSlash = trimmed.slice(1);
  const spaceIdx = withoutSlash.indexOf(' ');
  const name = spaceIdx > 0 ? withoutSlash.slice(0, spaceIdx).toLowerCase() : withoutSlash.toLowerCase();
  const arg = spaceIdx > 0 ? withoutSlash.slice(spaceIdx + 1).trim() : '';

  const cmd = commandIndex.get(name);
  if (!cmd) {
    return { handled: false };
  }

  const text = await cmd.execute({ bridge, channelKey, arg });
  return { handled: true, text };
}

/** Get all command names (for registering Discord slash commands, etc.). */
export function getBridgeCommandDefs(): Array<{
  name: string;
  aliases?: string[];
  description: string;
  hasArg?: boolean;
}> {
  return commands.map(c => ({
    name: c.name,
    aliases: c.aliases,
    description: c.description,
    hasArg: c.hasArg,
  }));
}
