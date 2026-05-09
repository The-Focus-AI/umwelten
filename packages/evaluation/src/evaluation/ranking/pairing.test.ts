import { describe, it, expect } from 'vitest';
import { allPairs, swissPairs } from './pairing.js';

describe('allPairs', () => {
  it('returns n*(n-1)/2 pairs', () => {
    expect(allPairs(4).length).toBe(6);
    expect(allPairs(5).length).toBe(10);
    expect(allPairs(10).length).toBe(45);
  });

  it('returns 0 pairs for n < 2', () => {
    expect(allPairs(0).length).toBe(0);
    expect(allPairs(1).length).toBe(0);
  });

  it('covers all unique pairs', () => {
    const pairs = allPairs(5);
    const pairSet = new Set(pairs.map(p => `${Math.min(p.a, p.b)}-${Math.max(p.a, p.b)}`));
    expect(pairSet.size).toBe(10);
  });

  it('never pairs an index with itself', () => {
    const pairs = allPairs(6);
    for (const p of pairs) {
      expect(p.a).not.toBe(p.b);
    }
  });
});

describe('swissPairs', () => {
  it('pairs floor(n/2) matchups', () => {
    const ratings = [1500, 1500, 1500, 1500];
    const pairs = swissPairs(ratings, 1);
    expect(pairs.length).toBe(2);
  });

  it('handles odd number of entries (one bye)', () => {
    const ratings = [1500, 1500, 1500, 1500, 1500];
    const pairs = swissPairs(ratings, 1);
    expect(pairs.length).toBe(2); // 5 players → 2 pairs + 1 bye
  });

  it('pairs adjacent by rating', () => {
    const ratings = [1400, 1600, 1500, 1300];
    const pairs = swissPairs(ratings, 1);
    // Sorted order: 1(1600), 2(1500), 0(1400), 3(1300)
    // Pairs: (1,2) and (0,3)
    const pairKeys = pairs.map(p => [p.a, p.b].sort().join('-')).sort();
    expect(pairKeys).toEqual(['0-3', '1-2']);
  });

  it('covers all indices at most once', () => {
    const ratings = [1500, 1600, 1400, 1550, 1450, 1500];
    const pairs = swissPairs(ratings, 1);
    const used = new Set<number>();
    for (const p of pairs) {
      expect(used.has(p.a)).toBe(false);
      expect(used.has(p.b)).toBe(false);
      used.add(p.a);
      used.add(p.b);
    }
  });
});
