#!/usr/bin/env node
/**
 * Jeeves CLI: REPL or one-shot. Use --provider and --model or env JEEVES_PROVIDER, JEEVES_MODEL.
 * Default: google / gemini-2.0-flash.
 * Commands: /exit, /quit, /context, /checkpoint, /compact [strategyId], /compact help
 */

import { createInterface } from 'node:readline';
import { Interaction } from '../../src/interaction/interaction.js';
import { estimateContextSize, listCompactionStrategies } from '../../src/context/index.js';
import { createJeevesStimulus } from './stimulus.js';

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

function formatContextSize(messages: import('ai').CoreMessage[]): string {
  const size = estimateContextSize(messages);
  const kTokens = size.estimatedTokens >= 1000
    ? (size.estimatedTokens / 1000).toFixed(1) + 'K'
    : String(size.estimatedTokens);
  return `[Context: ${size.messageCount} messages, ~${kTokens} tokens]`;
}

async function oneShotRun(interaction: Interaction, prompt: string, quiet: boolean): Promise<void> {
  interaction.addMessage({ role: 'user', content: prompt });
  if (quiet) {
    const response = await interaction.generateText();
    const text = typeof response.content === 'string' ? response.content : String(response.content ?? '');
    console.log(text);
  } else {
    const response = await interaction.streamText();
    if (response.content) process.stdout.write('\n');
  }
  console.log(formatContextSize(interaction.getMessages()));
}

async function repl(interaction: Interaction, quiet: boolean): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log('Jeeves at your service. Type a message and press Enter.');
  console.log('Commands: /exit, /quit, /time, /context, /checkpoint, /compact [strategyId], /compact help\n');

  const ask = () => {
    rl.question('You: ', async (line) => {
      const input = line?.trim();
      if (!input) {
        ask();
        return;
      }
      if (input === '/exit' || input === '/quit') {
        rl.close();
        process.exit(0);
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
        if (quiet) {
          const response = await interaction.generateText();
          const text = typeof response.content === 'string' ? response.content : String(response.content ?? '');
          console.log(text);
        } else {
          await interaction.streamText();
          process.stdout.write('\n');
        }
        console.log(formatContextSize(interaction.getMessages()));
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
  const { provider, model, oneShot, quiet } = parseArgs();
  const stimulus = await createJeevesStimulus();
  const modelDetails = { name: model, provider };
  const interaction = new Interaction(modelDetails, stimulus);

  if (oneShot) {
    await oneShotRun(interaction, oneShot, quiet);
    process.exit(0);
  }

  await repl(interaction, quiet);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
