#!/usr/bin/env node
/**
 * Self-check for the stylometrics heuristics. Not a vitest suite because the
 * unit-test include glob only covers the packages tree — run directly instead:
 *
 *   pnpm tsx examples/language-styles/stylometrics.check.ts
 *
 * Exits non-zero on any failed assertion.
 */

import assert from 'node:assert/strict';
import { countSyllables, countLineSyllables, computeTextMetrics } from './stylometrics.js';

// Syllable counter — exact on common words
for (const [word, expected] of [
  ['the', 1], ['see', 1], ['come', 1], ['table', 2], ['there', 1],
  ['summer', 2], ['compare', 2], ['window', 2], ['yonder', 2],
  ['mercy', 2], ['quality', 3], ['beautiful', 3], ['walking', 2],
] as const) {
  assert.equal(countSyllables(word), expected, `countSyllables(${word})`);
}

// Canonical pentameter lines land in the 9-11 band
const pentameterLines = [
  "Shall I compare thee to a summer's day",
  'But soft what light through yonder window breaks',
  'The quality of mercy is not strained',
];
for (const line of pentameterLines) {
  const n = countLineSyllables(line);
  assert.ok(n >= 9 && n <= 11, `"${line}" scanned as ${n} syllables — outside 9-11 band`);
}

// Prose metrics
const prose = "He walked quickly; the rain didn't stop. It was a long road.";
const m = computeTextMetrics(prose);
assert.equal(m.sentences, 2, 'sentence count');
assert.equal(m.semicolonsPer100Words > 0, true, 'semicolon rate');
assert.equal(m.contractionsPer100Words > 0, true, "contraction rate (didn't)");
assert.ok(m.lyAdverbsPer100Words > 0, '-ly adverb rate (quickly)');
assert.ok(m.avgSentenceLen > 4 && m.avgSentenceLen < 10, `avg sentence length ${m.avgSentenceLen}`);

// A verse block scores high on the pentameter band; a prose paragraph does not
const verse = pentameterLines.join('\n');
assert.equal(computeTextMetrics(verse).linesInPentameterBand, 1, 'verse block fully in band');
const paragraph = 'The rain fell on the long road all through the morning and into the afternoon, and the walker kept going without stopping to rest or to look at the sky.';
assert.equal(computeTextMetrics(paragraph).linesInPentameterBand, 0, 'prose paragraph out of band');

// Empty input is safe
const empty = computeTextMetrics('');
assert.equal(empty.words, 0);
assert.equal(empty.avgSentenceLen, 0);

console.log('stylometrics.check: all assertions passed');
