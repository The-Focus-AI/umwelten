/**
 * Stage 1: Segment books into chunks.
 *
 * Reads .txt files from input/memorization/books/ and splits them into
 * 300-500 word chunks at sentence boundaries.
 *
 * Usage: pnpm tsx examples/memorization/01-segment.ts
 */

import fs from 'fs';
import path from 'path';
import { segmentBook, countWords } from './shared/text-utils.js';
import { resolveRun } from '../model-showdown/shared/runner-utils.js';
import type { BookChunk } from './shared/types.js';

const BOOKS_DIR = path.join(process.cwd(), 'input', 'memorization', 'books');
const EVAL_NAME = 'memorization-segments';

async function main() {
  console.log('=== Stage 1: Segment Books ===\n');

  // Check input directory
  if (!fs.existsSync(BOOKS_DIR)) {
    console.error(`Books directory not found: ${BOOKS_DIR}`);
    console.error('Place .txt book files in input/memorization/books/');
    process.exit(1);
  }

  // Find all .txt files
  const bookFiles = fs.readdirSync(BOOKS_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  if (bookFiles.length === 0) {
    console.error('No .txt files found in input/memorization/books/');
    process.exit(1);
  }

  console.log(`Found ${bookFiles.length} book(s): ${bookFiles.join(', ')}\n`);

  // Resolve run directory
  const { runId, runDir } = resolveRun(EVAL_NAME);
  console.log(`Output: ${runDir}\n`);

  let totalChunks = 0;

  for (const file of bookFiles) {
    const bookId = path.basename(file, '.txt');
    const bookPath = path.join(BOOKS_DIR, file);
    const text = fs.readFileSync(bookPath, 'utf-8');
    const wordCount = countWords(text);

    console.log(`Processing: ${bookId} (${wordCount.toLocaleString()} words)`);

    // Segment the book
    const chunks = segmentBook(bookId, text);
    totalChunks += chunks.length;

    console.log(`  -> ${chunks.length} chunks (avg ${Math.round(wordCount / chunks.length)} words/chunk)`);

    // Write chunks as JSONL
    const bookDir = path.join(runDir, bookId);
    fs.mkdirSync(bookDir, { recursive: true });
    const outPath = path.join(bookDir, 'chunks.jsonl');
    const lines = chunks.map(c => JSON.stringify(c));
    fs.writeFileSync(outPath, lines.join('\n') + '\n');

    // Write book metadata
    fs.writeFileSync(
      path.join(bookDir, 'meta.json'),
      JSON.stringify({
        bookId,
        file,
        totalWords: wordCount,
        totalChunks: chunks.length,
        avgChunkWords: Math.round(wordCount / chunks.length),
        minChunkWords: Math.min(...chunks.map(c => c.wordCount)),
        maxChunkWords: Math.max(...chunks.map(c => c.wordCount)),
      }, null, 2),
    );
  }

  console.log(`\nDone. ${totalChunks} total chunks across ${bookFiles.length} book(s).`);
  console.log(`Output: ${runDir}`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
