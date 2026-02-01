#!/usr/bin/env node
/**
 * Jeeves CLI: REPL or one-shot. Use --provider and --model or env JEEVES_PROVIDER, JEEVES_MODEL.
 * Default: google / gemini-2.0-flash.
 * Commands: /exit, /quit, /onboard, /context, /checkpoint, /compact [strategyId], /compact help
 * CLI runs create a session under JEEVES_SESSIONS_DIR (cli-{timestamp}-{id}) and persist a transcript.
 */

import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoreMessage } from 'ai';
import { coreMessagesToJSONL } from './jeeves-jsonl.js';
import { Interaction } from '../../src/interaction/interaction.js';
import { estimateContextSize, listCompactionStrategies } from '../../src/context/index.js';
import { createJeevesStimulus } from './stimulus.js';
import { getOrCreateSession, updateSessionMetadata } from './session-manager.js';

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

async function writeSessionTranscript(sessionDir: string, messages: CoreMessage[]): Promise<void> {
  const jsonl = coreMessagesToJSONL(messages);
  await writeFile(join(sessionDir, 'transcript.jsonl'), jsonl, 'utf-8');
}

/**
 * Build full message array from ModelResponse metadata (toolCalls, toolResults).
 * Vercel AI SDK uses: input (not args), output (not result).
 */
function buildFullMessagesFromResponse(
  prompt: string,
  response: { content?: string; metadata?: { toolCalls?: any[]; toolResults?: any[] } }
): CoreMessage[] {
  const messages: CoreMessage[] = [];
  messages.push({ role: 'user', content: prompt });

  const toolCalls = response.metadata?.toolCalls || [];
  const toolResults = response.metadata?.toolResults || [];
  const finalText = response.content || '';

  // If we have tool calls, reconstruct the conversation
  if (toolCalls.length > 0) {
    // Group tool results by toolCallId
    const resultMap = new Map<string, any>();
    for (const tr of toolResults) {
      resultMap.set(tr.toolCallId, tr);
    }

    // Process each tool call
    for (const tc of toolCalls) {
      // Assistant message with tool call (use input, not args)
      messages.push({
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.input || tc.args || {},
          },
        ],
      });

      // Tool result message (use output, not result)
      const result = resultMap.get(tc.toolCallId);
      if (result) {
        messages.push({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: result.toolCallId,
              toolName: result.toolName,
              result: result.output || result.result,
              isError: result.isError ?? false,
            },
          ],
        } as CoreMessage);
      }
    }

    // Add final assistant text if present
    if (finalText) {
      messages.push({ role: 'assistant', content: finalText });
    }
  } else {
    // No tool calls, just user and assistant
    if (finalText) {
      messages.push({ role: 'assistant', content: finalText });
    }
  }

  return messages;
}

async function oneShotRun(
  interaction: Interaction,
  prompt: string,
  quiet: boolean,
  sessionId: string,
  sessionDir: string
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

  // Build full message history including tool calls from response metadata
  const msgs = buildFullMessagesFromResponse(prompt, response);
  await writeSessionTranscript(sessionDir, msgs);
  const userCount = msgs.filter((m) => m.role === 'user').length;
  const assistantCount = msgs.filter((m) => m.role === 'assistant').length;
  const toolCount = msgs.filter((m) => m.role === 'tool').length;
  await updateSessionMetadata(sessionId, {
    metadata: { firstPrompt: prompt.slice(0, 200), messageCount: userCount + assistantCount + toolCount },
  });
}

async function repl(
  interaction: Interaction,
  quiet: boolean,
  sessionId: string,
  sessionDir: string
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
        const messages = interaction.getMessages();
        await writeSessionTranscript(sessionDir, messages);
        const firstUser = messages.find((m) => m.role === 'user');
        const firstPrompt = firstUser ? formatMessageContent(firstUser.content).slice(0, 200) : undefined;
        const userCount = messages.filter((m) => m.role === 'user').length;
        const assistantCount = messages.filter((m) => m.role === 'assistant').length;
        await updateSessionMetadata(sessionId, {
          lastUsed: new Date().toISOString(),
          ...((firstPrompt || userCount + assistantCount > 0) && {
            metadata: {
              ...(firstPrompt && { firstPrompt }),
              messageCount: userCount + assistantCount,
            },
          }),
        });
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
        if (quiet) {
          const response = await interaction.generateText();
          const text = typeof response.content === 'string' ? response.content : String(response.content ?? '');
          console.log(text);
        } else {
          const response = await interaction.streamText();
          // Print final result to ensure it's visible
          const finalText = typeof response.content === 'string' ? response.content : String(response.content ?? '');
          if (finalText && !finalText.trim().endsWith('\n')) {
            process.stdout.write('\n');
          }
          // Also print the final result explicitly to verify it worked
          console.log('[Final Result]:', finalText || '(empty)');
        }
        console.log(formatContextSize(interaction.getMessages()));
        await updateSessionMetadata(sessionId, { lastUsed: new Date().toISOString() });
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

  const { sessionId, sessionDir } = await getOrCreateSession('cli');
  if (!quiet) {
    console.log(`[JEEVES] Work directory: ${workDir}`);
    console.log(`[JEEVES] Sessions directory: ${getSessionsDir()}`);
    console.log(`[JEEVES] Session: ${sessionId}`);
  }

  const stimulus = await createJeevesStimulus();
  const modelDetails = { name: model, provider };
  const interaction = new Interaction(modelDetails, stimulus);

  if (oneShot) {
    await oneShotRun(interaction, oneShot, quiet, sessionId, sessionDir);
    process.exit(0);
  }

  await repl(interaction, quiet, sessionId, sessionDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
