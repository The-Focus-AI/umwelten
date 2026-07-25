/**
 * lexical-drift — the deterministic detector.
 *
 * No model call, so it is free, instant, and reproducible. It is both a
 * standalone detector and the cheap gate inside `hybrid`.
 *
 * Four signals, three of them lexical:
 *   topic-dissimilarity  how unlike the node (and its recent turns) this is
 *   unseen-terms         share of the turn's vocabulary the node has never used
 *   pivot-cue            explicit "new topic" phrasing
 *   back-reference       anaphora and follow-up markers — evidence *against* a fork
 *
 * Two guards matter more than the weights. A node with no turns can't be
 * drifted from, and a turn with almost no content words ("why?", "keep going")
 * carries no topical signal — scoring those on cosine distance alone is what
 * makes naive drift detection fork constantly mid-thread.
 */

import {
  buildSignature,
  cosineSimilarity,
  termCoverage,
  tokenize,
  topTerms,
} from "../tree/signature.js";
import type { DetectorResult, TurnRecord } from "../types.js";
import { continueResult, type DetectorContext, type FissionDetector } from "./types.js";

/** Phrases that announce a subject change outright. */
const PIVOT_CUES = [
  /\bnew (?:topic|question|subject|thread|chat)\b/i,
  /\b(?:different|another|unrelated|separate) (?:topic|question|subject|thing|matter)\b/i,
  /\b(?:switching|changing) (?:gears|topics|subjects)\b/i,
  /\blet'?s talk about\b/i,
  /\bmoving on\b/i,
  /\bforget (?:that|about that|the above)\b/i,
  /\bon a (?:different|separate) note\b/i,
  /\bunrelated\b/i,
  /^\s*(?:ok(?:ay)?|alright|so)[,.]?\s+(?:now\s+)?(?:i (?:have|need|want)|can you|what|how)\b/i,
];

/** Markers that this turn is leaning on what just happened. */
const BACK_REFERENCE_CUES = [
  /\b(?:that|this|those|these|it|they)\b/i,
  /\b(?:the (?:one|ones|same|above|previous|last))\b/i,
  /\b(?:you (?:said|mentioned|wrote|suggested|showed))\b/i,
  /\b(?:instead|also|too|again|as well|furthermore|and then)\b/i,
  /\b(?:why|how come|what about|and)\b\s*\??$/i,
  /\bkeep going\b|\bcontinue\b|\bgo on\b/i,
  /\b(?:fix|change|update|redo|retry) (?:it|that|this)\b/i,
];

const WEIGHTS = {
  dissimilarity: 0.45,
  unseenTerms: 0.3,
  pivotCue: 0.3,
  backReference: 0.35,
} as const;

/** Minimum content terms before a turn is considered topically meaningful. */
const MIN_CONTENT_TERMS = 3;

/** How many recent turns to test the incoming turn against. */
const RECENT_WINDOW = 4;

/**
 * The text that best represents a past turn's topic. Analysis output is much
 * cleaner than raw transcript, so prefer it and fall back to the transcript.
 */
export function turnTopicText(turn: TurnRecord): string {
  if (turn.analysis && !turn.analysis.degraded) {
    return [
      turn.userText,
      turn.analysis.summary,
      turn.analysis.topics.join(" "),
      turn.analysis.facts.join(" "),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return `${turn.userText}\n${turn.assistantText.slice(0, 800)}`;
}

function matchCount(text: string, patterns: RegExp[]): number {
  let hits = 0;
  for (const re of patterns) {
    if (re.test(text)) hits++;
  }
  return hits;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function scoreLexicalDrift(ctx: DetectorContext): DetectorResult {
  const started = Date.now();
  const incoming = buildSignature(ctx.userText);
  const contentTerms = tokenize(ctx.userText);

  if (ctx.recentTurns.length === 0) {
    return continueResult(
      "lexical-drift",
      ctx,
      "First turn in this node — nothing to drift from.",
      { latencyMs: Date.now() - started },
    );
  }

  if (contentTerms.length < MIN_CONTENT_TERMS) {
    return continueResult(
      "lexical-drift",
      ctx,
      `Only ${contentTerms.length} content term(s) — too short to read as a new topic.`,
      {
        latencyMs: Date.now() - started,
        signals: [
          { label: "content-terms", value: 0, note: `${contentTerms.length} terms` },
        ],
      },
    );
  }

  // Best match against the node as a whole, and against any single recent turn.
  const nodeSim = cosineSimilarity(ctx.node.topicSignature, incoming);
  let bestRecentSim = 0;
  let bestRecentIndex = -1;
  const window = ctx.recentTurns.slice(-RECENT_WINDOW);
  window.forEach((turn, i) => {
    const sim = cosineSimilarity(buildSignature(turnTopicText(turn)), incoming);
    if (sim > bestRecentSim) {
      bestRecentSim = sim;
      bestRecentIndex = ctx.recentTurns.length - window.length + i;
    }
  });

  const affinity = Math.max(nodeSim, bestRecentSim);
  const dissimilarity = clamp01(1 - affinity);
  const unseen = clamp01(1 - termCoverage(ctx.node.topicSignature, incoming));
  const pivotHits = matchCount(ctx.userText, PIVOT_CUES);
  const pivot = pivotHits > 0 ? 1 : 0;
  const backRefHits = matchCount(ctx.userText, BACK_REFERENCE_CUES);
  const backReference = clamp01(backRefHits / 2);

  const raw =
    WEIGHTS.dissimilarity * dissimilarity +
    WEIGHTS.unseenTerms * unseen +
    WEIGHTS.pivotCue * pivot -
    WEIGHTS.backReference * backReference;
  const driftScore = clamp01(raw);

  const signals = [
    {
      label: "topic-dissimilarity",
      value: Number(dissimilarity.toFixed(3)),
      note:
        bestRecentIndex >= 0
          ? `best affinity ${affinity.toFixed(3)} (node ${nodeSim.toFixed(3)}, turn #${bestRecentIndex + 1} ${bestRecentSim.toFixed(3)})`
          : `node affinity ${nodeSim.toFixed(3)}`,
    },
    {
      label: "unseen-terms",
      value: Number(unseen.toFixed(3)),
      note: `node knows: ${topTerms(ctx.node.topicSignature, 6).join(", ") || "—"}`,
    },
    {
      label: "pivot-cue",
      value: pivot,
      note: pivotHits > 0 ? `${pivotHits} explicit topic-change phrase(s)` : "none",
    },
    {
      label: "back-reference",
      value: Number(backReference.toFixed(3)),
      note:
        backRefHits > 0
          ? `${backRefHits} continuation marker(s) — pulls the score down`
          : "none",
    },
  ];

  const verdict = driftScore >= ctx.threshold ? "fork" : "continue";
  const reason =
    verdict === "fork"
      ? `Drift ${driftScore.toFixed(2)} ≥ ${ctx.threshold.toFixed(2)}: ${(unseen * 100).toFixed(0)}% of the vocabulary is new to this thread${pivot ? " and the turn explicitly announces a topic change" : ""}.`
      : `Drift ${driftScore.toFixed(2)} < ${ctx.threshold.toFixed(2)}: affinity ${affinity.toFixed(2)} to recent context${backRefHits > 0 ? ` plus ${backRefHits} continuation marker(s)` : ""}.`;

  return {
    detectorId: "lexical-drift",
    verdict,
    driftScore: Number(driftScore.toFixed(3)),
    threshold: ctx.threshold,
    reason,
    signals,
    proposedTitle:
      verdict === "fork" ? topTerms(incoming, 4).join(" ") || undefined : undefined,
    latencyMs: Date.now() - started,
    usedLlm: false,
  };
}

export const lexicalDriftDetector: FissionDetector = {
  id: "lexical-drift",
  name: "Lexical drift",
  description:
    "Deterministic vocabulary-overlap scoring with pivot and back-reference cues. No model call.",
  usesLlm: false,
  async detect(ctx: DetectorContext): Promise<DetectorResult> {
    return scoreLexicalDrift(ctx);
  },
};
