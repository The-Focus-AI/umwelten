#!/usr/bin/env node
/**
 * Jeeves Telegram bot. Requires TELEGRAM_BOT_TOKEN (or --token).
 * Optionally set --provider and --model (default: google / gemini-2.0-flash).
 */

import { TelegramAdapter } from '../../src/ui/telegram/TelegramAdapter.js';
import { createJeevesStimulus } from './stimulus.js';
import { getOrCreateSession, createNewTelegramThread } from './session-manager.js';
import { writeSessionTranscript } from './jeeves-jsonl.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PROVIDER = process.env.JEEVES_PROVIDER || 'google';
const DEFAULT_MODEL = process.env.JEEVES_MODEL || 'gemini-2.0-flash';

function parseArgs(): { provider: string; model: string; token?: string } {
  const args = process.argv.slice(2);
  let provider = DEFAULT_PROVIDER;
  let model = DEFAULT_MODEL;
  let token: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) provider = args[++i];
    else if ((args[i] === '--model' || args[i] === '-m') && args[i + 1]) model = args[++i];
    else if (args[i] === '--token' && args[i + 1]) token = args[++i];
  }
  return { provider, model, token: token || process.env.TELEGRAM_BOT_TOKEN };
}

async function main(): Promise<void> {
  const { provider, model, token } = parseArgs();
  if (!token) {
    console.error('Telegram bot token is required. Set TELEGRAM_BOT_TOKEN or pass --token.');
    console.error('Get a token from @BotFather on Telegram.');
    process.exit(1);
  }

  // Ensure work and sessions directories exist
  const { ensureWorkDir, ensureSessionsDir } = await import('./config.js');
  const workDir = await ensureWorkDir();
  const sessionsDir = await ensureSessionsDir();
  console.log(`[JEEVES] Work directory: ${workDir}`);
  console.log(`[JEEVES] Sessions directory: ${sessionsDir}`);

  const stimulus = await createJeevesStimulus();
  
  // Use session directories for storing Telegram media files and transcripts
  // Each chat gets its own session directory (telegram-{chatId})
  const adapter = new TelegramAdapter({
    token,
    modelDetails: { name: model, provider },
    stimulus,
    getSessionMediaDir: async (chatId: number) => {
      const { sessionDir } = await getOrCreateSession('telegram', chatId);
      return path.join(sessionDir, 'media');
    },
    getSessionDir: async (chatId: number) => {
      return getOrCreateSession('telegram', chatId);
    },
    writeTranscript: writeSessionTranscript,
    startNewThread: async (chatId: number) => {
      await createNewTelegramThread(chatId);
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
