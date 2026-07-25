/**
 * The per-turn analysis pass.
 *
 * Runs after every exchange and produces the compact representation everything
 * downstream reads: the detector matches against it, the compaction strategies
 * build from it, and the tree browser displays it. Analysing once per turn and
 * reusing the result is what keeps the rest of the pipeline from re-reading raw
 * transcript.
 *
 * Failure here is never fatal — a deterministic fallback marked `degraded: true`
 * keeps the turn flowing and keeps the failure visible in the UI.
 */

import { z } from "zod";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import type { TurnAnalysis } from "../types.js";
import { parseObject } from "../util/usage.js";
import { topTerms, buildSignature } from "../tree/signature.js";

const AnalysisSchema = z.object({
  summary: z.string().describe("One sentence: what happened in this exchange."),
  facts: z
    .array(z.string())
    .describe("Durable facts established in this turn that should be remembered later. Empty array if none."),
  topics: z
    .array(z.string())
    .describe("2-4 short topic labels for this exchange, each 1-3 words."),
  openQuestion: z
    .string()
    .describe("What this turn left unresolved, or an empty string if nothing."),
});

type AnalysisPayload = z.infer<typeof AnalysisSchema>;

const ANALYSIS_INSTRUCTIONS = `You compress a single conversation exchange into a structured record.

Be terse. The summary is one sentence. Facts are things that stay true after the conversation moves on — decisions, preferences, names, values, outcomes — not a recap of what was said. Topics are labels, not sentences.

Do not include tool-call mechanics, formatting notes, or pleasantries.`;

export interface AnalyzeTurnOptions {
  model: ModelDetails;
  userText: string;
  assistantText: string;
  /** Truncation guard for very long assistant answers. */
  maxAssistantChars?: number;
  signal?: AbortSignal;
}

/** Deterministic fallback so a failed analysis still yields usable structure. */
export function degradedAnalysis(userText: string, assistantText: string): TurnAnalysis {
  const sig = buildSignature(`${userText}\n${assistantText.slice(0, 1200)}`);
  const firstSentence = userText.trim().split(/(?<=[.?!])\s/)[0] ?? userText.trim();
  return {
    summary: firstSentence.slice(0, 200) || "(no summary available)",
    facts: [],
    topics: topTerms(sig, 4),
    latencyMs: 0,
    degraded: true,
  };
}

export async function analyzeTurn(options: AnalyzeTurnOptions): Promise<TurnAnalysis> {
  const started = Date.now();
  const maxChars = options.maxAssistantChars ?? 6000;
  const assistant = options.assistantText.slice(0, maxChars);

  const stimulus = new Stimulus({
    role: "conversation analyst",
    objective: "compress one exchange into a summary, facts, and topic labels",
    instructions: [ANALYSIS_INSTRUCTIONS],
    runnerType: "base",
  });
  const interaction = new Interaction(options.model, stimulus);
  interaction.addMessage({
    role: "user",
    content: `User said:\n${options.userText}\n\nAssistant replied:\n${assistant}`,
  });

  try {
    const response = await interaction.generateObject(AnalysisSchema, options.signal);
    const payload = parseObject<AnalysisPayload>(response.content);
    if (!payload) {
      return { ...degradedAnalysis(options.userText, options.assistantText), latencyMs: Date.now() - started };
    }
    const openQuestion = payload.openQuestion?.trim();
    return {
      summary: payload.summary?.trim() || "(no summary)",
      facts: Array.isArray(payload.facts) ? payload.facts.filter(Boolean) : [],
      topics: Array.isArray(payload.topics) ? payload.topics.filter(Boolean) : [],
      openQuestion: openQuestion ? openQuestion : undefined,
      latencyMs: Date.now() - started,
    };
  } catch {
    return {
      ...degradedAnalysis(options.userText, options.assistantText),
      latencyMs: Date.now() - started,
    };
  }
}
