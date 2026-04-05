/**
 * Stage 3: Prepare finetuning data.
 *
 * Combines chunks + summaries into training pairs, formatted for MLX or HF.
 * Splits train books 90/10 into train.jsonl + valid.jsonl.
 * Test book summaries become test-prompts.jsonl.
 *
 * Usage: pnpm tsx examples/memorization/03-prepare-data.ts
 */

import fs from 'fs';
import path from 'path';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import { countWords } from './shared/text-utils.js';
import type { BookChunk, Summary, ChatTrainingExample, MemorizationConfig, SplitInfo } from './shared/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');
const SEGMENTS_EVAL = 'memorization-segments';
const SUMMARIES_EVAL = 'memorization-summaries';
const DATA_EVAL = 'memorization-data';

function loadConfig(): MemorizationConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadChunks(dir: string, bookId: string): BookChunk[] {
  const p = path.join(dir, bookId, 'chunks.jsonl');
  return fs.readFileSync(p, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
}

function loadSummaries(dir: string, bookId: string): Summary[] {
  const p = path.join(dir, bookId, 'summaries.jsonl');
  return fs.readFileSync(p, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
}

function buildUserPrompt(author: string, summary: string, wordCount: number): string {
  return `Write a ${wordCount} word paragraph about the content below emulating the style and voice of ${author}\nContent: ${summary}`;
}

function makeChatExample(author: string, summary: string, verbatimText: string): ChatTrainingExample {
  const wordCount = countWords(verbatimText);
  return {
    messages: [
      {
        role: 'user',
        content: buildUserPrompt(author, summary, wordCount),
      },
      {
        role: 'assistant',
        content: verbatimText,
      },
    ],
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function main() {
  console.log('=== Stage 3: Prepare Training Data ===\n');

  const config = loadConfig();
  const segmentsRun = resolveRun(SEGMENTS_EVAL);
  const summariesRun = resolveRun(SUMMARIES_EVAL);
  const { runId, runDir } = resolveRun(DATA_EVAL);

  fs.mkdirSync(runDir, { recursive: true });

  console.log(`Segments: ${segmentsRun.runDir}`);
  console.log(`Summaries: ${summariesRun.runDir}`);
  console.log(`Output: ${runDir}\n`);

  // Build training pairs from train books
  const trainExamples: ChatTrainingExample[] = [];
  for (const bookId of config.trainBooks) {
    const chunks = loadChunks(segmentsRun.runDir, bookId);
    const summaries = loadSummaries(summariesRun.runDir, bookId);

    let paired = 0;
    for (const chunk of chunks) {
      const summary = summaries.find(s => s.chunkIndex === chunk.chunkIndex);
      if (!summary) continue;

      trainExamples.push(makeChatExample(config.author, summary.summary, chunk.text));
      paired++;
    }
    console.log(`Train: ${bookId} -> ${paired} pairs`);
  }

  // Build test prompts from test books
  const testPrompts: Array<{ bookId: string; chunkIndex: number; prompt: string; originalText: string }> = [];
  for (const bookId of config.testBooks) {
    const chunks = loadChunks(segmentsRun.runDir, bookId);
    const summaries = loadSummaries(summariesRun.runDir, bookId);

    let paired = 0;
    for (const chunk of chunks) {
      const summary = summaries.find(s => s.chunkIndex === chunk.chunkIndex);
      if (!summary) continue;

      const wordCount = countWords(chunk.text);
      testPrompts.push({
        bookId,
        chunkIndex: chunk.chunkIndex,
        prompt: buildUserPrompt(config.author, summary.summary, wordCount),
        originalText: chunk.text,
      });
      paired++;
    }
    console.log(`Test: ${bookId} -> ${paired} prompts`);
  }

  // Shuffle and split train examples 90/10
  const shuffled = shuffle(trainExamples);
  const splitIdx = Math.floor(shuffled.length * 0.9);
  const train = shuffled.slice(0, splitIdx);
  const valid = shuffled.slice(splitIdx);

  // Write files
  fs.writeFileSync(
    path.join(runDir, 'train.jsonl'),
    train.map(e => JSON.stringify(e)).join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(runDir, 'valid.jsonl'),
    valid.map(e => JSON.stringify(e)).join('\n') + '\n',
  );
  fs.writeFileSync(
    path.join(runDir, 'test-prompts.jsonl'),
    testPrompts.map(p => JSON.stringify(p)).join('\n') + '\n',
  );

  const splitInfo: SplitInfo = {
    trainBooks: config.trainBooks,
    testBooks: config.testBooks,
    trainSamples: train.length,
    validSamples: valid.length,
    testPrompts: testPrompts.length,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(runDir, 'split.json'), JSON.stringify(splitInfo, null, 2));

  console.log(`\nSplit: ${train.length} train, ${valid.length} valid, ${testPrompts.length} test prompts`);
  console.log(`Output: ${runDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
