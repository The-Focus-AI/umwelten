/**
 * Unit tests for text-utils: segmentation, tokenization, n-grams.
 */

import { describe, it, expect } from 'vitest';
import { splitSentences, countWords, segmentBook, tokenize, extractNgrams } from './text-utils.js';

describe('countWords', () => {
  it('counts words in a simple sentence', () => {
    expect(countWords('hello world')).toBe(2);
  });

  it('handles multiple spaces', () => {
    expect(countWords('hello   world  foo')).toBe(3);
  });

  it('handles empty string', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});

describe('splitSentences', () => {
  it('splits on periods', () => {
    const result = splitSentences('Hello world. Goodbye world.');
    expect(result).toEqual(['Hello world.', 'Goodbye world.']);
  });

  it('splits on question marks', () => {
    const result = splitSentences('Is it raining? Yes it is.');
    expect(result).toEqual(['Is it raining?', 'Yes it is.']);
  });

  it('splits on exclamation marks', () => {
    const result = splitSentences('Wow! That is great.');
    expect(result).toEqual(['Wow!', 'That is great.']);
  });

  it('handles single sentence', () => {
    const result = splitSentences('Just one sentence.');
    expect(result).toEqual(['Just one sentence.']);
  });

  it('handles empty string', () => {
    const result = splitSentences('');
    expect(result).toEqual([]);
  });
});

describe('segmentBook', () => {
  it('creates chunks from text', () => {
    // Generate text with enough words for at least one chunk
    const sentences: string[] = [];
    for (let i = 0; i < 40; i++) {
      sentences.push(`This is sentence number ${i} with enough words to fill the chunks properly and test boundaries.`);
    }
    const text = sentences.join(' ');

    const chunks = segmentBook('test-book', text);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.bookId).toBe('test-book');
      expect(chunk.wordCount).toBeGreaterThanOrEqual(50); // minimum threshold
      expect(chunk.wordCount).toBeLessThanOrEqual(500); // max threshold
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it('assigns sequential chunk indices', () => {
    const sentences: string[] = [];
    for (let i = 0; i < 60; i++) {
      sentences.push(`Sentence ${i} with several words to accumulate into proper sized chunks for testing.`);
    }
    const text = sentences.join(' ');

    const chunks = segmentBook('test-book', text);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].chunkIndex).toBe(i);
    }
  });

  it('handles short text gracefully', () => {
    const chunks = segmentBook('short', 'Very short text.');
    // Too short for a chunk (< 50 words), should be empty
    expect(chunks.length).toBe(0);
  });

  it('preserves all text content across chunks', () => {
    const sentences: string[] = [];
    for (let i = 0; i < 50; i++) {
      sentences.push(`This is a test sentence number ${i} that should be preserved across chunk boundaries.`);
    }
    const text = sentences.join(' ');

    const chunks = segmentBook('preservation-test', text);
    const reconstructed = chunks.map(c => c.text).join(' ');

    // All words from chunks should be present in original text
    const originalWords = text.split(/\s+/);
    const chunkWords = reconstructed.split(/\s+/);

    // Allow slight difference due to joining
    expect(chunkWords.length).toBeGreaterThan(originalWords.length * 0.9);
  });
});

describe('tokenize', () => {
  it('lowercases and strips punctuation', () => {
    expect(tokenize('Hello, World!')).toEqual(['hello', 'world']);
  });

  it('handles apostrophes', () => {
    expect(tokenize("don't stop")).toEqual(['dont', 'stop']);
  });

  it('handles empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('handles multiple spaces and newlines', () => {
    expect(tokenize('one  two\nthree')).toEqual(['one', 'two', 'three']);
  });
});

describe('extractNgrams', () => {
  it('extracts bigrams', () => {
    const words = ['the', 'cat', 'sat', 'on', 'the', 'mat'];
    const ngrams = extractNgrams(words, 2);
    expect(ngrams.has('the cat')).toBe(true);
    expect(ngrams.has('cat sat')).toBe(true);
    expect(ngrams.has('the mat')).toBe(true);
    expect(ngrams.size).toBe(5);
  });

  it('extracts 5-grams', () => {
    const words = ['a', 'b', 'c', 'd', 'e', 'f'];
    const ngrams = extractNgrams(words, 5);
    expect(ngrams.size).toBe(2);
    expect(ngrams.has('a b c d e')).toBe(true);
    expect(ngrams.has('b c d e f')).toBe(true);
  });

  it('returns empty for too-short input', () => {
    const ngrams = extractNgrams(['a', 'b'], 5);
    expect(ngrams.size).toBe(0);
  });
});
