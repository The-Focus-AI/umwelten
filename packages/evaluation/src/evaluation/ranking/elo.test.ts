import { describe, it, expect } from 'vitest';
import { expectedScore, updateElo, buildStandings } from './elo.js';
import type { RankingEntry } from './types.js';

describe('expectedScore', () => {
  it('returns 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5);
  });

  it('returns higher score for higher-rated player', () => {
    const score = expectedScore(1600, 1400);
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeCloseTo(0.7597, 3);
  });

  it('returns lower score for lower-rated player', () => {
    const score = expectedScore(1400, 1600);
    expect(score).toBeLessThan(0.5);
  });

  it('is symmetric: eA + eB = 1', () => {
    const eA = expectedScore(1600, 1400);
    const eB = expectedScore(1400, 1600);
    expect(eA + eB).toBeCloseTo(1.0);
  });
});

describe('updateElo', () => {
  it('winner gains and loser loses with K=32', () => {
    const [newA, newB] = updateElo(1500, 1500, 1, 32);
    expect(newA).toBeGreaterThan(1500);
    expect(newB).toBeLessThan(1500);
    // For equal ratings, winner gains K/2 = 16
    expect(newA).toBeCloseTo(1516);
    expect(newB).toBeCloseTo(1484);
  });

  it('tie leaves equal-rated players unchanged', () => {
    const [newA, newB] = updateElo(1500, 1500, 0.5, 32);
    expect(newA).toBeCloseTo(1500);
    expect(newB).toBeCloseTo(1500);
  });

  it('upset gives bigger Elo swing', () => {
    // Lower-rated player wins
    const [newA, newB] = updateElo(1400, 1600, 1, 32);
    const gain = newA - 1400;
    // Expected win was ~0.24, so gain ≈ K * (1 - 0.24) ≈ 24.3
    expect(gain).toBeGreaterThan(20);
  });

  it('respects custom K-factor', () => {
    const [newA16] = updateElo(1500, 1500, 1, 16);
    const [newA64] = updateElo(1500, 1500, 1, 64);
    // K=16 → gain = 8, K=64 → gain = 32, ratio = 4
    expect(newA64 - 1500).toBeCloseTo(4 * (newA16 - 1500));
  });

  it('conserves total rating', () => {
    const [newA, newB] = updateElo(1600, 1400, 0.7, 32);
    expect(newA + newB).toBeCloseTo(3000);
  });
});

describe('buildStandings', () => {
  const entries: RankingEntry[] = [
    { key: 'a', model: 'model-a', provider: 'p', responseText: '' },
    { key: 'b', model: 'model-b', provider: 'p', responseText: '' },
    { key: 'c', model: 'model-c', provider: 'p', responseText: '' },
  ];

  it('sorts by Elo descending', () => {
    const standings = buildStandings(entries, [1400, 1600, 1500], [0, 2, 1], [2, 0, 1], [0, 0, 0]);
    expect(standings[0].key).toBe('b');
    expect(standings[1].key).toBe('c');
    expect(standings[2].key).toBe('a');
  });

  it('computes matches correctly', () => {
    const standings = buildStandings(entries, [1500, 1500, 1500], [1, 0, 0], [0, 1, 0], [1, 1, 2]);
    for (const s of standings) {
      expect(s.matches).toBe(s.wins + s.losses + s.ties);
    }
  });

  it('rounds Elo to nearest integer', () => {
    const standings = buildStandings(entries, [1500.7, 1499.3, 1500], [0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(standings[0].elo).toBe(1501);
    expect(standings[2].elo).toBe(1499);
  });

  it('preserves metadata', () => {
    const withMeta: RankingEntry[] = [
      { key: 'a', model: 'm', provider: 'p', responseText: '', metadata: { score: 5 } },
    ];
    const standings = buildStandings(withMeta, [1500], [0], [0], [0]);
    expect(standings[0].metadata).toEqual({ score: 5 });
  });
});
