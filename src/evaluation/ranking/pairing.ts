/**
 * Pairing strategies for pairwise comparisons.
 */

export interface Matchup {
  a: number; // index into entries
  b: number;
}

/** Generate all pairs (round-robin), shuffled to avoid systematic bias. */
export function allPairs(n: number): Matchup[] {
  const pairs: Matchup[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      pairs.push({ a: i, b: j });
    }
  }
  // Shuffle to avoid systematic bias
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs;
}

/** Swiss-style pairing: sort by current rating, pair adjacent models. */
export function swissPairs(ratings: number[], _round: number): Matchup[] {
  const indices = ratings.map((r, i) => ({ i, r }))
    .sort((a, b) => b.r - a.r)
    .map(x => x.i);

  const pairs: Matchup[] = [];
  const used = new Set<number>();

  for (let k = 0; k < indices.length - 1; k++) {
    const a = indices[k];
    if (used.has(a)) continue;
    for (let m = k + 1; m < indices.length; m++) {
      const b = indices[m];
      if (used.has(b)) continue;
      pairs.push({ a, b });
      used.add(a);
      used.add(b);
      break;
    }
  }

  return pairs;
}
