import { describe, it, expect } from 'vitest';
import { expectedScore, updateElo, buildStandings } from './elo.js';
import { allPairs, swissPairs } from './pairing.js';
import { evaluationResultsToRankingEntries } from './types.js';
import type { RankingEntry } from './types.js';

// ── Additional Elo edge cases (not covered in elo.test.ts) ──────────────

describe('expectedScore edge cases', () => {
  it('handles extreme rating differences', () => {
    const score = expectedScore(2400, 1200);
    expect(score).toBeGreaterThan(0.99);
  });

  it('handles very low ratings', () => {
    const score = expectedScore(100, 100);
    expect(score).toBeCloseTo(0.5);
  });
});

describe('updateElo edge cases', () => {
  it('tie with unequal ratings moves both toward center', () => {
    const [newA, newB] = updateElo(1600, 1400, 0.5, 32);
    // Higher-rated player expected to win, so a tie is a disappointment
    expect(newA).toBeLessThan(1600);
    expect(newB).toBeGreaterThan(1400);
    // Total is conserved
    expect(newA + newB).toBeCloseTo(3000);
  });

  it('B wins (scoreA = 0) flips gains', () => {
    const [newA, newB] = updateElo(1500, 1500, 0, 32);
    expect(newA).toBeLessThan(1500);
    expect(newB).toBeGreaterThan(1500);
    expect(newA).toBeCloseTo(1484);
    expect(newB).toBeCloseTo(1516);
  });
});

// ── Additional pairing edge cases ───────────────────────────────────────

describe('allPairs edge cases', () => {
  it('returns 1 pair for n=2', () => {
    const pairs = allPairs(2);
    expect(pairs.length).toBe(1);
    expect(pairs[0].a).not.toBe(pairs[0].b);
  });

  it('returns 3 pairs for n=3', () => {
    expect(allPairs(3).length).toBe(3);
  });
});

describe('swissPairs edge cases', () => {
  it('returns 0 pairs for 1 entry', () => {
    expect(swissPairs([1500], 1).length).toBe(0);
  });

  it('returns 1 pair for 2 entries', () => {
    const pairs = swissPairs([1500, 1600], 1);
    expect(pairs.length).toBe(1);
  });

  it('returns 0 pairs for empty array', () => {
    expect(swissPairs([], 1).length).toBe(0);
  });
});

// ── buildStandings additional cases ─────────────────────────────────────

describe('buildStandings edge cases', () => {
  it('handles single entry', () => {
    const entries: RankingEntry[] = [
      { key: 'solo', model: 'model-x', provider: 'p', responseText: 'hello' },
    ];
    const standings = buildStandings(entries, [1500], [0], [0], [0]);
    expect(standings).toHaveLength(1);
    expect(standings[0].elo).toBe(1500);
    expect(standings[0].matches).toBe(0);
  });

  it('tiebreaks by elo only (stable sort order for equal elo)', () => {
    const entries: RankingEntry[] = [
      { key: 'a', model: 'a', provider: 'p', responseText: '' },
      { key: 'b', model: 'b', provider: 'p', responseText: '' },
    ];
    const standings = buildStandings(entries, [1500, 1500], [1, 1], [1, 1], [0, 0]);
    expect(standings).toHaveLength(2);
    // Both have same elo — both should appear
    expect(standings[0].elo).toBe(standings[1].elo);
  });
});

// ── evaluationResultsToRankingEntries ───────────────────────────────────

describe('evaluationResultsToRankingEntries', () => {
  it('converts successful results to ranking entries', () => {
    const evalResult = {
      results: [
        {
          model: { name: 'gpt-4o', provider: 'openrouter' },
          success: true,
          response: { content: 'Hello world' },
        },
      ],
    } as any;
    const entries = evaluationResultsToRankingEntries(evalResult);
    expect(entries).toHaveLength(1);
    expect(entries[0].model).toBe('gpt-4o');
    expect(entries[0].provider).toBe('openrouter');
    expect(entries[0].responseText).toBe('Hello world');
  });

  it('filters out failed results', () => {
    const evalResult = {
      results: [
        {
          model: { name: 'gpt-4o', provider: 'openrouter' },
          success: false,
          response: { content: 'error' },
        },
        {
          model: { name: 'gemini', provider: 'google' },
          success: true,
          response: { content: 'OK' },
        },
      ],
    } as any;
    const entries = evaluationResultsToRankingEntries(evalResult);
    expect(entries).toHaveLength(1);
    expect(entries[0].model).toBe('gemini');
  });

  it('filters out results without content', () => {
    const evalResult = {
      results: [
        {
          model: { name: 'gpt-4o', provider: 'openrouter' },
          success: true,
          response: { content: '' },
        },
        {
          model: { name: 'gemini', provider: 'google' },
          success: true,
          response: null,
        },
      ],
    } as any;
    const entries = evaluationResultsToRankingEntries(evalResult);
    expect(entries).toHaveLength(0);
  });

  it('generates safe keys from model names with special chars', () => {
    const evalResult = {
      results: [
        {
          model: { name: 'openai/gpt-4o', provider: 'openrouter' },
          success: true,
          response: { content: 'test' },
        },
      ],
    } as any;
    const entries = evaluationResultsToRankingEntries(evalResult);
    expect(entries[0].key).toBe('openrouter__openai_gpt-4o');
    expect(entries[0].key).not.toContain('/');
    expect(entries[0].key).not.toContain(':');
  });
});
