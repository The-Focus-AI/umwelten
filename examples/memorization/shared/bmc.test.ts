/**
 * Unit tests for bmc@k algorithm.
 */

import { describe, it, expect } from 'vitest';
import { computeBmcAtK } from './bmc.js';

describe('computeBmcAtK', () => {
  it('returns 0 for empty inputs', () => {
    const result = computeBmcAtK('', [], [], [], 5, 5);
    expect(result.bmcAtK).toBe(0);
    expect(result.totalBookWords).toBe(0);
    expect(result.coveredWords).toBe(0);
  });

  it('returns 0 when no generations match', () => {
    const bookText = 'The quick brown fox jumps over the lazy dog and runs through the forest at night.';
    const excerpts = [bookText];
    const instructions = ['A story about a fox.'];
    const generations = [['Something completely different with no overlap at all in any of the words used here.']];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 5, 5);
    expect(result.bmcAtK).toBe(0);
    expect(result.spans.length).toBe(0);
  });

  it('detects exact verbatim match', () => {
    const bookText = 'The quick brown fox jumps over the lazy dog and the fox runs through the dark forest path at night under stars.';
    const excerpts = [bookText];
    const instructions = ['A description of an animal running.'];
    // Generation reproduces the book exactly
    const generations = [[bookText]];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 5, 5);
    expect(result.bmcAtK).toBeGreaterThan(0.8);
    expect(result.coveredWords).toBeGreaterThan(0);
    expect(result.longestSpan).toBeGreaterThan(5);
  });

  it('detects partial verbatim match', () => {
    const bookText = 'The quick brown fox jumps over the lazy dog and then the fox runs through the dark forest under the moonlight stars shining bright above.';
    const excerpts = [bookText];
    const instructions = ['An animal story.'];
    // Generation has a matching substring of ~10 words
    const generations = [['The quick brown fox jumps over the lazy dog and then something else happens in the story.']];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 5, 5);
    expect(result.bmcAtK).toBeGreaterThan(0);
    expect(result.bmcAtK).toBeLessThan(1);
    expect(result.spans.length).toBeGreaterThan(0);
  });

  it('filters instruction overlap', () => {
    const bookText = 'The quick brown fox jumps over the lazy dog near the river bank where flowers grow tall and bright.';
    const excerpts = [bookText];
    // The instruction contains the same words as the book match
    const instructions = ['The quick brown fox jumps over the lazy dog in a meadow.'];
    // Generation matches the book but also overlaps with instruction
    const generations = [['The quick brown fox jumps over the lazy dog near the river.']];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 5, 5);
    // The match should be filtered because it overlaps with instruction n-grams
    expect(result.bmcAtK).toBeLessThan(0.5);
  });

  it('handles multiple generations per excerpt', () => {
    const words: string[] = [];
    for (let i = 0; i < 50; i++) {
      words.push(`word${i}`);
    }
    const bookText = words.join(' ');
    const excerpts = [bookText];
    const instructions = ['A test document.'];

    // Two generations, each matching a different part
    const gen1 = words.slice(0, 15).join(' ') + ' extra words here not in book';
    const gen2 = words.slice(25, 40).join(' ') + ' more extra content here';
    const generations = [[gen1, gen2]];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 5, 5);
    expect(result.coveredWords).toBeGreaterThan(15);
    expect(result.spans.length).toBeGreaterThanOrEqual(2);
  });

  it('classifies regurgitated spans (>20 words)', () => {
    const words: string[] = [];
    for (let i = 0; i < 80; i++) {
      words.push(`uniqueword${i}`);
    }
    const bookText = words.join(' ');
    const excerpts = [bookText];
    const instructions = ['A test.'];
    // Generate 25 consecutive words from the book
    const generations = [[words.slice(10, 35).join(' ')]];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 5, 5);
    expect(result.regurgitatedSpans.length).toBeGreaterThan(0);
    expect(result.longestRegurgitated).toBeGreaterThanOrEqual(20);
  });

  it('handles k=1 (single word matching)', () => {
    const bookText = 'alpha beta gamma delta epsilon zeta';
    const excerpts = [bookText];
    const instructions = ['Greek letters.'];
    const generations = [['alpha gamma epsilon']];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 1, 1);
    expect(result.coveredWords).toBeGreaterThan(0);
  });

  it('tracks longest span correctly', () => {
    const words: string[] = [];
    for (let i = 0; i < 100; i++) {
      words.push(`token${i}`);
    }
    const bookText = words.join(' ');
    const excerpts = [bookText];
    const instructions = ['A sequence.'];

    // Three different length matches
    const gen1 = words.slice(0, 10).join(' ');    // 10 words
    const gen2 = words.slice(30, 60).join(' ');   // 30 words
    const gen3 = words.slice(70, 85).join(' ');   // 15 words
    const generations = [[gen1, gen2, gen3]];

    const result = computeBmcAtK(bookText, excerpts, instructions, generations, 5, 5);
    expect(result.longestSpan).toBe(30);
  });
});
