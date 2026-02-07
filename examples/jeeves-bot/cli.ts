#!/usr/bin/env node
/**
 * Jeeves CLI: REPL or one-shot. Use --provider and --model or env JEEVES_PROVIDER, JEEVES_MODEL.
 * Default: google / gemini-2.0-flash.
 * Commands: /exit, /quit, /onboard, /context, /checkpoint, /compact [strategyId], /compact help
 * CLI runs create a session under JEEVES_SESSIONS_DIR (cli-{timestamp}-{id}) and persist a transcript.
 */

import { createInterface } from 'node:readline';
import type { CoreMessage } from 'ai';
// import { writeSessionTranscript } from './jeeves-jsonl.js'; 
import { Interaction } from '../../src/interaction/core/interaction.js';
import { InteractionStore } from '../../src/interaction/persistence/interaction-store.js';
import { estimateContextSize, listCompactionStrategies } from '../../src/context/index.js';
import { createJeevesStimulus } from './stimulus.js';
// import { getOrCreateSession, updateSessionMetadata } from './session-manager.js';

const DEFAULT_PROVIDER = process.env.JEEVES_PROVIDER || 'google';
const DEFAULT_MODEL = process.env.JEEVES_MODEL || 'gemini-2.0-flash';

function parseArgs(): { provider: string; model: string; oneShot?: string; quiet: boolean } {
  const args = process.argv.slice(2);
  let provider = DEFAULT_PROVIDER;
  let model = DEFAULT_MODEL;
  let oneShot: string | undefined;
  let quiet = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      provider = args[++i];
    } else if ((args[i] === '--model' || args[i] === '-m') && args[i + 1]) {
      model = args[++i];
    } else if (args[i] === '--quiet' || args[i] === '-q') {
      quiet = true;
    } else if (!args[i].startsWith('--') && !oneShot) {
      oneShot = args.slice(i).join(' ').trim();
      break;
    }
  }
  return { provider, model, oneShot, quiet };
}

function formatContextSize(messages: CoreMessage[]): string {
  const size = estimateContextSize(messages);
  const kTokens = size.estimatedTokens >= 1000
    ? (size.estimatedTokens / 1000).toFixed(1) + 'K'
    : String(size.estimatedTokens);
  return `[Context: ${size.messageCount} messages, ~${kTokens} tokens]`;
}

function formatMessageContent(content: CoreMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'object' && p !== null && 'text' in p ? (p as { text: string }).text : JSON.stringify(p)))
      .join('\n');
  }
  return String(content ?? '');
}

/**
 * Persist interaction state using InteractionStore
 */
async function saveInteraction(store: InteractionStore, interaction: Interaction): Promise<void> {
  try {
    const normalized = interaction.toNormalizedSession();
    await store.saveSession(normalized);
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

async function oneShotRun(
  interaction: Interaction,
  store: InteractionStore,
  prompt: string,
  quiet: boolean
): Promise<void> {
  interaction.addMessage({ role: 'user', content: prompt });
  let response;
  if (quiet) {
    response = await interaction.generateText();
    const text = typeof response.content === 'string' ? response.content : String(response.content ?? '');
    console.log(text);
  } else {
    process.stdout.write('Jeeves: ');
    response = await interaction.streamText();
    // Print final result to ensure it's visible
    const finalText = typeof response.content === 'string' ? response.content : String(response.content ?? '');
    if (finalText && !finalText.trim().endsWith('\n')) {
      process.stdout.write('\n');
    }
    // Also print the final result explicitly to verify it worked
    console.log('\n[Final Result]:', finalText || '(empty)');
  }
  console.log(formatContextSize(interaction.getMessages()));

  // Interaction handles message history internally now, including tool calls from response if runner supports it.
  // Although `buildFullMessagesFromResponse` might be needed if the runner doesn't auto-append tool calls?
  // Interaction.runner generally DOES append them.

  await saveInteraction(store, interaction);
}

async function repl(
  interaction: Interaction,
  store: InteractionStore,
  quiet: boolean
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Jeeves at your service. Type a message and press Enter.');
  console.log('Commands: /exit, /quit, /onboard, /time, /context, /checkpoint, /compact [strategyId], /compact help\n');

  const ask = () => {
    rl.question('You: ', async (line) => {
      const input = line?.trim();
      if (!input) {
        ask();
        return;
      }
      if (input === '/exit' || input === '/quit') {
        await saveInteraction(store, interaction);
        rl.close();
        process.exit(0);
      }
      if (input === '/onboard') {
        const { getWorkDir } = await import('./config.js');
        const { runOnboarding, printOnboardingResult } = await import('./onboard.js');
        const wd = getWorkDir();
        const result = await runOnboarding(wd);
        printOnboardingResult(result);
        console.log('');
        ask();
        return;
      }
      if (input === '/time') {
        const now = new Date();
        console.log(now.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' }));
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
      if (input === '/checkpoint') {
        interaction.setCheckpoint();
        console.log('Checkpoint set. Future /compact will condense from here to end of current thread.');
        console.log('');
        ask();
        return;
      }
      if (input === '/compact help') {
        const strategies = await listCompactionStrategies();
        console.log('Compaction strategies:');
        for (const s of strategies) {
          console.log(`  ${s.id} – ${s.description}`);
        }
        console.log('\nUsage: /compact [strategyId]   (default: through-line-and-facts)');
        console.log('');
        ask();
        return;
      }
      if (input === '/compact' || input.startsWith('/compact ')) {
        const strategyId = input === '/compact' ? 'through-line-and-facts' : input.slice(9).trim();
        try {
          const result = await interaction.compactContext(strategyId, { fromCheckpoint: true });
          if (result) {
            console.log(`Compacted segment [${result.segmentStart}..${result.segmentEnd}] into ${result.replacementCount} message(s).`);
            console.log(formatContextSize(interaction.getMessages()));
          } else {
            console.log('No segment to compact (set /checkpoint first and have at least one assistant reply, or strategy not found).');
          }
        } catch (err) {
          console.error('Compaction error:', err);
        }
        console.log('');
        ask();
        return;
      }
      try {
        interaction.addMessage({ role: 'user', content: input });
        process.stdout.write('Jeeves: ');
        let response: { content?: string; reasoning?: string };
        if (quiet) {
          response = await interaction.generateText();
          const text = typeof response.content === 'string' ? response.content : String(response.content ?? '');
          console.log(text);
        } else {
          response = await interaction.streamText();
          // Print final result to ensure it's visible
          const finalText = typeof response.content === 'string' ? response.content : String(response.content ?? '');
          if (finalText && !finalText.trim().endsWith('\n')) {
            process.stdout.write('\n');
          }
          // Also print the final result explicitly to verify it worked
          console.log('[Final Result]:', finalText || '(empty)');
        }
        console.log(formatContextSize(interaction.getMessages()));

        await saveInteraction(store, interaction);
      } catch (err) {
        console.error('Error:', err);
      }
      console.log('');
      ask();
    });
  };
  ask();
}

async function main(): Promise<void> {
  // Delegate to sessions CLI when: jeeves sessions <subcommand> (argv: node, tsx, cli.ts, sessions, ...)
  const args = process.argv.slice(2);
  const sessionsIdx = args.findIndex((a) => a === 'sessions');
  if (sessionsIdx >= 0 && sessionsIdx <= 1) {
    const { runSessionsCli } = await import('./sessions-cli.js');
    await runSessionsCli(args.slice(sessionsIdx + 1));
    process.exit(0);
  }

  const { provider, model, oneShot, quiet } = parseArgs();

  const { ensureWorkDir, ensureSessionsDir, getSessionsDir } = await import('./config.js');
  const workDir = await ensureWorkDir();
  await ensureSessionsDir();

  const { isWorkDirOnboarded, runOnboarding, printOnboardingResult } = await import('./onboard.js');
  if (!(await isWorkDirOnboarded(workDir))) {
    if (!quiet) {
      console.log('[JEEVES] Work directory not fully set up. Running onboarding…');
    }
    const result = await runOnboarding(workDir);
    if (!quiet) {
      printOnboardingResult(result);
    }
  }

  // const { sessionId, sessionDir } = await getOrCreateSession('cli');
  const sessionId = `cli-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const store = new InteractionStore({ basePath: getSessionsDir() });

  if (!quiet) {
    console.log(`[JEEVES] Work directory: ${workDir}`);
    console.log(`[JEEVES] Sessions directory: ${getSessionsDir()}`);
    console.log(`[JEEVES] Session: ${sessionId}`);
  }

  const stimulus = await createJeevesStimulus();
  const modelDetails = { name: model, provider };

  // Create interaction with explict ID
  const interaction = new Interaction(modelDetails, stimulus, { id: sessionId, source: 'native', sourceId: sessionId });

  // Append transcript as messages come in (after each tool call, tool result, final text)
  interaction.setOnTranscriptUpdate((messages) => {
    void saveInteraction(store, interaction);
  });

  if (oneShot) {
    await oneShotRun(interaction, store, oneShot, quiet);
    process.exit(0);
  }

  await repl(interaction, store, quiet);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
