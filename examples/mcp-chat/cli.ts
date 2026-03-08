#!/usr/bin/env node

import { createInterface } from 'node:readline';
import type { CoreMessage } from 'ai';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { InteractionStore } from '../../src/interaction/persistence/interaction-store.js';
import { estimateContextSize } from '../../src/context/index.js';
import { writeSessionTranscript } from '../../src/habitat/transcript.js';
import type { Habitat } from '../../src/habitat/index.js';
import { createMCPChatRuntime } from './habitat.js';
import { TezLabMCPManager, type TezLabMCPManager as TezLabMCPManagerType } from './tezlab-mcp.js';

const DEFAULT_PROVIDER = process.env.MCP_CHAT_PROVIDER || 'google';
const DEFAULT_MODEL = process.env.MCP_CHAT_MODEL || 'gemini-3-flash-preview';

function parseArgs(): {
  provider: string;
  model: string;
  oneShot?: string;
  quiet: boolean;
  logout: boolean;
} {
  const args = process.argv.slice(2);
  let provider = DEFAULT_PROVIDER;
  let model = DEFAULT_MODEL;
  let oneShot: string | undefined;
  let quiet = false;
  let logout = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      provider = args[++i];
    } else if ((args[i] === '--model' || args[i] === '-m') && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      quiet = true;
    } else if (args[i] === '--logout') {
      logout = true;
    } else if (!args[i].startsWith('--') && !oneShot) {
      oneShot = args.slice(i).join(' ').trim();
      break;
    }
  }

  return { provider, model, oneShot, quiet, logout };
}

function formatContextSize(messages: CoreMessage[]): string {
  const size = estimateContextSize(messages);
  const kTokens = size.estimatedTokens >= 1000
    ? `${(size.estimatedTokens / 1000).toFixed(1)}K`
    : String(size.estimatedTokens);
  return `[Context: ${size.messageCount} messages, ~${kTokens} tokens]`;
}

function printReplHelp(): void {
  console.log('TezLab MCP chat commands:');
  console.log('  /help     Show this help');
  console.log('  /tools    List available MCP tools');
  console.log('  /context  Show approximate context size');
  console.log('  /logout   Clear saved TezLab OAuth credentials');
  console.log('  /exit     Exit the REPL');
  console.log('  /quit     Exit the REPL');
}

async function saveInteraction(store: InteractionStore, interaction: Interaction): Promise<void> {
  try {
    await store.saveSession(interaction.toNormalizedSession());
  } catch (error) {
    console.error('Failed to save session:', error);
  }
}

async function oneShotRun(
  interaction: Interaction,
  store: InteractionStore,
  prompt: string,
  quiet: boolean,
): Promise<void> {
  interaction.addMessage({ role: 'user', content: prompt });

  if (quiet) {
    const response = await interaction.generateText();
    console.log(typeof response.content === 'string' ? response.content : String(response.content ?? ''));
  } else {
    process.stdout.write('MCP Chat: ');
    const response = await interaction.streamText();
    const finalText = typeof response.content === 'string' ? response.content : String(response.content ?? '');
    if (finalText && !finalText.trim().endsWith('\n')) {
      process.stdout.write('\n');
    }
    console.log('\n[Final Result]:', finalText || '(empty)');
  }

  console.log(formatContextSize(interaction.getMessages()));
  await saveInteraction(store, interaction);
}

async function repl(
  interaction: Interaction,
  store: InteractionStore,
  habitat: Habitat,
  tezlab: TezLabMCPManagerType,
  quiet: boolean,
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('TezLab MCP chat is ready.');
  printReplHelp();
  console.log('');

  const ask = () => {
    rl.question('You: ', async (line) => {
      const input = line.trim();
      if (!input) {
        ask();
        return;
      }

      if (input === '/exit' || input === '/quit') {
        await saveInteraction(store, interaction);
        await tezlab.disconnect();
        rl.close();
        process.exit(0);
      }

      if (input === '/help') {
        printReplHelp();
        console.log('');
        ask();
        return;
      }

      if (input === '/tools') {
        console.log(`Available MCP tools (${tezlab.getToolNames().length}):`);
        for (const name of tezlab.getToolNames()) {
          console.log(`  - ${name}`);
        }
        console.log('');
        ask();
        return;
      }

      if (input === '/context') {
        console.log(formatContextSize(interaction.getMessages()));
        console.log('');
        ask();
        return;
      }

      if (input === '/logout') {
        await tezlab.resetAuth();
        console.log('Cleared saved TezLab OAuth credentials. Restart the example to log in again.\n');
        ask();
        return;
      }

      try {
        interaction.addMessage({ role: 'user', content: input });
        process.stdout.write('MCP Chat: ');

        if (quiet) {
          const response = await interaction.generateText();
          console.log(typeof response.content === 'string' ? response.content : String(response.content ?? ''));
        } else {
          const response = await interaction.streamText();
          const finalText = typeof response.content === 'string' ? response.content : String(response.content ?? '');
          if (finalText && !finalText.trim().endsWith('\n')) {
            process.stdout.write('\n');
          }
          console.log('[Final Result]:', finalText || '(empty)');
        }

        console.log(formatContextSize(interaction.getMessages()));
        await saveInteraction(store, interaction);
      } catch (error) {
        console.error('Error:', error);
      }

      console.log('');
      ask();
    });
  };

  ask();
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Usage: pnpm exec tsx examples/mcp-chat/cli.ts [options] [prompt]\n
Options:
  --provider <name>   LLM provider (default: ${DEFAULT_PROVIDER})
  --model, -m <name>  Model name (default: ${DEFAULT_MODEL})
  --quiet, -q         Only print the final reply
  --logout            Clear saved TezLab OAuth credentials and exit
`);
    return;
  }

  const { provider, model, oneShot, quiet, logout } = parseArgs();

  if (logout) {
    const tezlab = new TezLabMCPManager({
      serverUrl: process.env.MCP_CHAT_SERVER_URL,
      scope: process.env.MCP_CHAT_SCOPE || 'mcp',
      allowCommands: ['1', 'true', 'yes', 'on'].includes((process.env.MCP_CHAT_ALLOW_COMMANDS || '').toLowerCase()),
      oauthPort: process.env.MCP_CHAT_OAUTH_PORT
        ? Number(process.env.MCP_CHAT_OAUTH_PORT)
        : undefined,
      oauthTimeoutMs: process.env.MCP_CHAT_OAUTH_TIMEOUT_MS
        ? Number(process.env.MCP_CHAT_OAUTH_TIMEOUT_MS)
        : undefined,
      authStorePath: process.env.MCP_CHAT_AUTH_STORE,
    });
    await tezlab.resetAuth();
    await tezlab.disconnect();
    console.log('Cleared saved TezLab OAuth credentials.');
    return;
  }

  const { habitat, tezlab } = await createMCPChatRuntime();

  if (!(await habitat.isOnboarded())) {
    console.log('[MCP Chat] Running first-time onboarding…');
    const result = await habitat.onboard();
    console.log('[MCP Chat] Work directory:', result.workDir);
  }

  const store = habitat.getStore();
  const { sessionId, sessionDir } = await habitat.getOrCreateSession('cli');
  const stimulus = await habitat.getStimulus();
  const interaction = new Interaction({ name: model, provider }, stimulus, {
    id: sessionId,
    source: 'native',
    sourceId: sessionId,
  });

  interaction.setOnTranscriptUpdate((messages) => {
    void writeSessionTranscript(sessionDir, messages);
    void saveInteraction(store, interaction);
  });

  if (!quiet) {
    console.log(`[MCP Chat] Work directory: ${habitat.workDir}`);
    console.log(`[MCP Chat] Sessions directory: ${habitat.sessionsDir}`);
    console.log(`[MCP Chat] Session: ${sessionId}`);
    console.log(`[MCP Chat] Connected TezLab tools: ${tezlab.getToolNames().length}`);
  }

  if (oneShot) {
    await oneShotRun(interaction, store, oneShot, quiet);
    await tezlab.disconnect();
    return;
  }

  await repl(interaction, store, habitat, tezlab, quiet);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});