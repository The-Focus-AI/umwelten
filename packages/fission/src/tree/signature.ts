/**
 * Deterministic topic signatures.
 *
 * Cheap, no-LLM lexical fingerprints used by the lexical-drift detector and as
 * the gate in the hybrid detector. Nothing here touches the network, so the
 * unit tests cover it exactly.
 */

import type { TopicSignature } from "../types.js";

/**
 * Closed-class words plus conversational filler. Deliberately small: an
 * aggressive stoplist would strip the domain terms that carry the topic.
 */
const STOPWORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are",
  "as", "at", "back", "be", "because", "been", "before", "being", "but", "by",
  "can", "could", "did", "do", "does", "doing", "done", "down", "each", "even",
  "for", "from", "get", "got", "had", "has", "have", "he", "her", "here", "him",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "like",
  "make", "me", "more", "most", "my", "no", "not", "now", "of", "off", "on",
  "one", "only", "or", "other", "our", "out", "over", "own", "please", "put",
  "same", "see", "she", "should", "so", "some", "still", "such", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "thing", "things",
  "this", "those", "through", "to", "too", "under", "up", "us", "use", "very",
  "want", "was", "way", "we", "well", "were", "what", "when", "where", "which",
  "while", "who", "why", "will", "with", "would", "you", "your",
]);

const TOKEN_RE = /[a-z0-9][a-z0-9_'-]*/g;

/**
 * Conservative suffix stripping.
 *
 * Without it, "eviction" and "evicts" — or "cache" and "caching" — count as
 * different vocabulary, and an obviously on-topic follow-up scores as drift.
 * That single miss is enough to push ordinary continuations past the hybrid
 * detector's cheap gate and into a paid model call, so this is a cost fix as
 * much as an accuracy one.
 *
 * Deliberately not a full Porter stemmer: the goal is collapsing inflections of
 * the same word, not conflating related ones.
 */
export function stem(term: string): string {
  let out = term;
  if (out.length > 4 && out.endsWith("ies")) out = `${out.slice(0, -3)}y`;
  else if (out.length > 5 && out.endsWith("ing")) out = out.slice(0, -3);
  else if (out.length > 5 && out.endsWith("ion")) out = out.slice(0, -3);
  else if (out.length > 4 && out.endsWith("ed")) out = out.slice(0, -2);
  else if (out.length > 4 && out.endsWith("es")) out = out.slice(0, -2);
  else if (out.length > 3 && out.endsWith("s") && !out.endsWith("ss")) out = out.slice(0, -1);
  // Collapse the silent-e alternation ("cache"/"caching" → "cach").
  if (out.length > 3 && out.endsWith("e")) out = out.slice(0, -1);
  return out.length >= 3 ? out : term;
}

/** Raw content words, before stemming. Stopwords and noise already removed. */
export function surfaceTerms(text: string): string[] {
  const lowered = text.toLowerCase();
  const out: string[] = [];
  for (const match of lowered.matchAll(TOKEN_RE)) {
    const term = match[0];
    if (term.length < 3) continue;
    if (STOPWORDS.has(term)) continue;
    if (/^\d+$/.test(term)) continue;
    out.push(term);
  }
  return out;
}

/** Stemmed content words — the vocabulary all comparisons run on. */
export function tokenize(text: string): string[] {
  return surfaceTerms(text).map(stem);
}

export function emptySignature(): TopicSignature {
  return { terms: [], weights: {}, display: {}, turnCount: 0 };
}

export function buildSignature(text: string): TopicSignature {
  const weights: Record<string, number> = {};
  const display: Record<string, string> = {};
  for (const surface of surfaceTerms(text)) {
    const term = stem(surface);
    weights[term] = (weights[term] ?? 0) + 1;
    // Keep the shortest surface form seen, so titles read as words.
    if (!display[term] || surface.length < display[term].length) display[term] = surface;
  }
  return { terms: Object.keys(weights), weights, display, turnCount: 1 };
}

/**
 * Fold a new turn into a running signature with exponential decay, so a node's
 * fingerprint tracks where the conversation *is* rather than where it started.
 * decay = 1 keeps full history; lower values forget faster.
 */
export function mergeSignature(
  base: TopicSignature,
  incoming: TopicSignature,
  decay = 0.85,
): TopicSignature {
  const weights: Record<string, number> = {};
  for (const [term, w] of Object.entries(base.weights)) {
    const decayed = w * decay;
    // Drop terms that have decayed into noise; keeps signatures bounded.
    if (decayed >= 0.05) weights[term] = decayed;
  }
  for (const [term, w] of Object.entries(incoming.weights)) {
    weights[term] = (weights[term] ?? 0) + w;
  }
  const display: Record<string, string> = {};
  for (const term of Object.keys(weights)) {
    const surface = incoming.display?.[term] ?? base.display?.[term];
    if (surface) display[term] = surface;
  }
  return {
    terms: Object.keys(weights),
    weights,
    display,
    turnCount: base.turnCount + incoming.turnCount,
  };
}

/** Cosine similarity over term weights. 0 = disjoint, 1 = identical. */
export function cosineSimilarity(a: TopicSignature, b: TopicSignature): number {
  const aTerms = Object.keys(a.weights);
  if (aTerms.length === 0 || Object.keys(b.weights).length === 0) return 0;

  let dot = 0;
  for (const term of aTerms) {
    const bw = b.weights[term];
    if (bw !== undefined) dot += a.weights[term] * bw;
  }
  if (dot === 0) return 0;

  let aMag = 0;
  for (const w of Object.values(a.weights)) aMag += w * w;
  let bMag = 0;
  for (const w of Object.values(b.weights)) bMag += w * w;

  return dot / (Math.sqrt(aMag) * Math.sqrt(bMag));
}

/** Fraction of the incoming turn's terms already present in the node. */
export function termCoverage(node: TopicSignature, incoming: TopicSignature): number {
  const incomingTerms = Object.keys(incoming.weights);
  if (incomingTerms.length === 0) return 1;
  let hits = 0;
  for (const term of incomingTerms) {
    if (node.weights[term] !== undefined) hits++;
  }
  return hits / incomingTerms.length;
}

/**
 * The heaviest terms in a signature, as words rather than stems — these end up
 * in thread titles and in the signal notes shown next to a verdict.
 */
export function topTerms(sig: TopicSignature, limit = 8): string[] {
  return Object.entries(sig.weights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term]) => sig.display?.[term] ?? term);
}
