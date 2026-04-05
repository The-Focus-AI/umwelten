/**
 * Text segmentation utilities for the memorization pipeline.
 * Splits book text into 300-500 word chunks at sentence boundaries.
 */

import type { BookChunk } from './types.js';

/** Sentence boundary regex: period/question/exclamation followed by whitespace */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/** Minimum chunk size in words */
const MIN_CHUNK_WORDS = 300;

/** Maximum chunk size in words */
const MAX_CHUNK_WORDS = 500;

/**
 * Split text into sentences.
 * Handles common abbreviations and edge cases.
 */
export function splitSentences(text: string): string[] {
  // Split on sentence boundaries
  const raw = text.split(SENTENCE_BOUNDARY);

  // Filter empty strings and trim
  return raw
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Count words in a string.
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Segment a book into chunks of 300-500 words at sentence boundaries.
 *
 * Algorithm:
 * - Accumulate sentences until reaching MIN_CHUNK_WORDS
 * - Start new chunk if next sentence would exceed MAX_CHUNK_WORDS
 * - Track character offsets for position mapping back to original
 */
export function segmentBook(bookId: string, text: string): BookChunk[] {
  const sentences = splitSentences(text);
  const chunks: BookChunk[] = [];

  let currentSentences: string[] = [];
  let currentWordCount = 0;
  let charOffset = 0;
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceWords = countWords(sentence);

    // If adding this sentence would exceed max and we already have min words,
    // finalize the current chunk
    if (currentWordCount + sentenceWords > MAX_CHUNK_WORDS && currentWordCount >= MIN_CHUNK_WORDS) {
      const chunkText = currentSentences.join(' ');
      chunks.push({
        bookId,
        chunkIndex,
        text: chunkText,
        wordCount: currentWordCount,
        charOffset,
        charLength: chunkText.length,
      });

      charOffset += chunkText.length + 1; // +1 for the space/newline between chunks
      chunkIndex++;
      currentSentences = [];
      currentWordCount = 0;
    }

    currentSentences.push(sentence);
    currentWordCount += sentenceWords;

    // If we've reached min words and this is a good boundary, check if we should split
    if (currentWordCount >= MIN_CHUNK_WORDS && i < sentences.length - 1) {
      const nextSentenceWords = countWords(sentences[i + 1]);
      if (currentWordCount + nextSentenceWords > MAX_CHUNK_WORDS) {
        const chunkText = currentSentences.join(' ');
        chunks.push({
          bookId,
          chunkIndex,
          text: chunkText,
          wordCount: currentWordCount,
          charOffset,
          charLength: chunkText.length,
        });

        charOffset += chunkText.length + 1;
        chunkIndex++;
        currentSentences = [];
        currentWordCount = 0;
      }
    }
  }

  // Handle remaining sentences
  if (currentSentences.length > 0) {
    const chunkText = currentSentences.join(' ');
    // Only add if it has a reasonable number of words (at least 50)
    if (currentWordCount >= 50) {
      chunks.push({
        bookId,
        chunkIndex,
        text: chunkText,
        wordCount: currentWordCount,
        charOffset,
        charLength: chunkText.length,
      });
    }
  }

  return chunks;
}

/**
 * Tokenize text to word array: lowercase, strip punctuation.
 * Used for bmc@k matching.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')  // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Extract n-grams from a word array.
 */
export function extractNgrams(words: string[], n: number): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}
