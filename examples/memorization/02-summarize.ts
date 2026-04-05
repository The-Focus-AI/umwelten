/**
 * Stage 2: Generate plot summaries for each chunk.
 *
 * Uses the umwelten evaluation framework (SimpleEvaluation + cache)
 * to generate detailed plot summaries via an LLM.
 *
 * Prompt follows the paper: "Describe in detail ({response_count} words) what
 * is happening in this excerpt. Mention the characters and whether the narration
 * is primarily in the first or third person. Maintain the original sentence order
 * while describing."
 *
 * Usage: dotenvx run -- pnpm tsx examples/memorization/02-summarize.ts
 */

import './shared/env.js';

import fs from 'fs';
import path from 'path';
import { Stimulus } from '../../src/stimulus/stimulus.js';
import { Interaction } from '../../src/interaction/core/interaction.js';
import { EvaluationCache } from '../../src/evaluation/caching/cache-service.js';
import { clearAllRateLimitStates } from '../../src/rate-limit/rate-limit.js';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import { countWords } from './shared/text-utils.js';
import type { BookChunk, Summary, MemorizationConfig } from './shared/types.js';
import type { ModelDetails } from '../../src/cognition/types.js';

const CONFIG_PATH = path.join(process.cwd(), 'input', 'memorization', 'config.json');
const SEGMENTS_EVAL = 'memorization-segments';
const SUMMARIES_EVAL = 'memorization-summaries';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function loadConfig(): MemorizationConfig {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Config not found: ${CONFIG_PATH}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadChunks(segmentsDir: string, bookId: string): BookChunk[] {
  const chunksPath = path.join(segmentsDir, bookId, 'chunks.jsonl');
  if (!fs.existsSync(chunksPath)) {
    console.error(`Chunks not found: ${chunksPath}`);
    console.error('Run 01-segment.ts first.');
    process.exit(1);
  }
  return fs.readFileSync(chunksPath, 'utf-8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
}

function buildSummaryPrompt(excerpt: string): string {
  const wordCount = countWords(excerpt);
  // Target summary ~40% of original length (enough detail for reconstruction)
  const responseCount = Math.max(80, Math.round(wordCount * 0.4));
  return `Describe in detail (${responseCount} words) what is happening in this excerpt. Mention the characters and whether the narration is primarily in the first or third person. Maintain the original sentence order while describing.\n\n${excerpt}`;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(
  model: ModelDetails,
  stimulus: Stimulus,
  prompt: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // Clear rate limit state before each attempt to avoid false backoff on local models
      clearAllRateLimitStates();
      const interaction = new Interaction(model, stimulus);
      interaction.addMessage({ role: 'user', content: prompt });
      const response = await interaction.generateText();
      return response.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES - 1) {
        const waitMs = RETRY_DELAY_MS * (attempt + 1);
        process.stdout.write(`  Retry ${attempt + 1}/${MAX_RETRIES} (${msg}), waiting ${waitMs}ms...\n`);
        await delay(waitMs);
      } else {
        throw err;
      }
    }
  }
  throw new Error('Unreachable');
}

async function main() {
  console.log('=== Stage 2: Generate Summaries ===\n');

  const config = loadConfig();
  const allBooks = [...config.trainBooks, ...config.testBooks];

  // Find latest segments run
  const segmentsRun = resolveRun(SEGMENTS_EVAL);
  if (!fs.existsSync(segmentsRun.runDir)) {
    console.error(`Segments not found at ${segmentsRun.runDir}`);
    console.error('Run 01-segment.ts first.');
    process.exit(1);
  }

  // Resolve summaries run
  const { runId, runDir } = resolveRun(SUMMARIES_EVAL);
  console.log(`Segments: ${segmentsRun.runDir}`);
  console.log(`Output: ${runDir}\n`);

  const summaryModel: ModelDetails = {
    name: config.summaryModel || 'gemini-3-flash-preview',
    provider: config.summaryProvider || 'google',
  };

  console.log(`Summary model: ${summaryModel.provider}:${summaryModel.name}\n`);

  const stimulus = new Stimulus({
    role: 'literary analyst',
    objective: 'Generate detailed plot summaries of text excerpts',
    temperature: 0.3,
    maxTokens: 500,
  });

  const totalChunks = allBooks.reduce((sum, bookId) => {
    const chunks = loadChunks(segmentsRun.runDir, bookId);
    return sum + chunks.length;
  }, 0);
  let globalDone = 0;
  const startTime = Date.now();

  for (const bookId of allBooks) {
    const chunks = loadChunks(segmentsRun.runDir, bookId);
    console.log(`\nProcessing: ${bookId} (${chunks.length} chunks)`);

    const bookDir = path.join(runDir, bookId);
    fs.mkdirSync(bookDir, { recursive: true });
    const outPath = path.join(bookDir, 'summaries.jsonl');

    // Use cache to avoid re-summarizing
    const cache = new EvaluationCache(`memorization-summaries/runs/${runId}/${bookId}`, { verbose: false });

    const summaries: Summary[] = [];

    for (const chunk of chunks) {
      const cacheKey = `summary-${chunk.chunkIndex}`;
      const summary = await cache.getCachedFile<Summary>(cacheKey, async () => {
        const content = await generateWithRetry(summaryModel, stimulus, buildSummaryPrompt(chunk.text));
        return {
          bookId: chunk.bookId,
          chunkIndex: chunk.chunkIndex,
          summary: content,
          wordCount: countWords(content),
          model: `${summaryModel.provider}:${summaryModel.name}`,
        };
      });

      summaries.push(summary);
      globalDone++;

      if (globalDone % 10 === 0 || globalDone === totalChunks) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = elapsed > 0 ? globalDone / elapsed : 0;
        const eta = rate > 0 ? Math.round((totalChunks - globalDone) / rate / 60) : '?';
        process.stdout.write(`  ${globalDone}/${totalChunks} total (${(globalDone / totalChunks * 100).toFixed(0)}%) ~${eta}m remaining\r`);
      }
    }

    // Write all summaries
    const lines = summaries.map(s => JSON.stringify(s));
    fs.writeFileSync(outPath, lines.join('\n') + '\n');

    const avgWords = Math.round(summaries.reduce((s, x) => s + x.wordCount, 0) / summaries.length);
    console.log(`\n  -> ${summaries.length} summaries (avg ${avgWords} words)`);
  }

  const totalTime = Math.round((Date.now() - startTime) / 1000);
  console.log(`\nDone. ${globalDone} summaries in ${Math.floor(totalTime / 60)}m ${totalTime % 60}s.`);
  console.log(`Output: ${runDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
