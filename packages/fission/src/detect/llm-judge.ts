/**
 * llm-judge — ask the model whether the turn starts a new chat.
 *
 * The model classifies the *relationship* rather than emitting a raw drift
 * number. A label plus a confidence is something a model is reliably good at;
 * a calibrated 0..1 score is not. The number is derived here, deterministically,
 * so the same judgement always maps to the same score and the threshold means
 * something stable across runs.
 */

import { z } from "zod";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { DetectorResult } from "../types.js";
import { continueResult, type DetectorContext, type FissionDetector } from "./types.js";
import { costOf, parseObject } from "../util/usage.js";
import { turnTopicText } from "./lexical-drift.js";

const RELATIONSHIPS = ["continuation", "elaboration", "tangent", "new-topic"] as const;
type Relationship = (typeof RELATIONSHIPS)[number];

const JudgementSchema = z.object({
  relationship: z
    .enum(RELATIONSHIPS)
    .describe(
      "continuation: directly advances the current thread. elaboration: same subject, new angle. tangent: adjacent subject that grew out of this thread but could stand alone. new-topic: unrelated to everything above.",
    ),
  confidence: z.number().min(0).max(1).describe("How sure you are, 0 to 1."),
  reason: z.string().describe("One sentence explaining the call."),
  proposedTitle: z
    .string()
    .describe("A 2-5 word title for the new thread if this is a tangent or new-topic; otherwise an empty string."),
});

type Judgement = z.infer<typeof JudgementSchema>;

/** Where each relationship sits on the drift axis before confidence weighting. */
const BASE_SCORE: Record<Relationship, number> = {
  continuation: 0.05,
  elaboration: 0.2,
  tangent: 0.6,
  "new-topic": 0.95,
};

/**
 * Pull the score toward 0.5 (undecided) as confidence drops, so a hedged
 * judgement never trips the threshold on its own.
 */
export function scoreFromJudgement(relationship: Relationship, confidence: number): number {
  const base = BASE_SCORE[relationship];
  const c = Math.max(0, Math.min(1, confidence));
  return Number((0.5 + (base - 0.5) * c).toFixed(3));
}

const JUDGE_INSTRUCTIONS = `You decide whether an incoming user message continues the conversation it landed in, or starts something new.

You will be given:
- a summary of the thread so far
- the last few exchanges
- the incoming user message

Classify the incoming message's relationship to that thread. Judge the *subject matter*, not the phrasing — a polite "thanks, one more thing:" followed by an unrelated question is a new topic, and a blunt one-word follow-up is still a continuation.

Prefer "continuation" when the message only makes sense given what came before (pronouns pointing back, corrections, follow-up questions).
Prefer "new-topic" only when the message would read perfectly well as the first message of a fresh conversation.
Use "tangent" for something that grew out of this thread but has its own subject and could be pursued independently.`;

function buildJudgePrompt(ctx: DetectorContext): string {
  const parts: string[] = [];
  parts.push(`## Thread: ${ctx.node.title}`);
  if (ctx.runningSummary) {
    parts.push(`\n## Summary so far\n${ctx.runningSummary}`);
  }
  const recent = ctx.recentTurns.slice(-3);
  if (recent.length > 0) {
    parts.push("\n## Last exchanges");
    for (const turn of recent) {
      parts.push(`\nUser: ${turn.userText.slice(0, 1200)}`);
      const assistant = turn.analysis?.summary
        ? `(summary) ${turn.analysis.summary}`
        : turn.assistantText.slice(0, 800);
      parts.push(`Assistant: ${assistant}`);
    }
  }
  parts.push(`\n## Incoming user message\n${ctx.userText}`);
  return parts.join("\n");
}

export const llmJudgeDetector: FissionDetector = {
  id: "llm-judge",
  name: "LLM judge",
  description:
    "Model classifies the turn's relationship to the thread (continuation/elaboration/tangent/new-topic); the score is derived from the label and confidence.",
  usesLlm: true,
  async detect(ctx: DetectorContext): Promise<DetectorResult> {
    const started = Date.now();

    if (ctx.recentTurns.length === 0) {
      return continueResult("llm-judge", ctx, "First turn in this node — nothing to judge against.", {
        latencyMs: Date.now() - started,
      });
    }
    if (!ctx.model) {
      return continueResult("llm-judge", ctx, "No model configured for the judge.", {
        latencyMs: Date.now() - started,
        error: "missing model",
      });
    }

    const stimulus = new Stimulus({
      role: "conversation topic analyst",
      objective: "decide whether a message continues a thread or starts a new one",
      instructions: [JUDGE_INSTRUCTIONS],
      runnerType: "base",
    });
    const interaction = new Interaction(ctx.model, stimulus);
    interaction.addMessage({ role: "user", content: buildJudgePrompt(ctx) });

    try {
      const response = await interaction.generateObject(JudgementSchema, ctx.signal);
      const judgement = parseObject<Judgement>(response.content);
      if (!judgement || !RELATIONSHIPS.includes(judgement.relationship)) {
        return continueResult("llm-judge", ctx, "Judge returned an unparseable verdict.", {
          latencyMs: Date.now() - started,
          usedLlm: true,
          costUsd: costOf(response),
          error: "unparseable judgement",
        });
      }

      const driftScore = scoreFromJudgement(judgement.relationship, judgement.confidence);
      const verdict = driftScore >= ctx.threshold ? "fork" : "continue";
      const proposed = judgement.proposedTitle?.trim();

      return {
        detectorId: "llm-judge",
        verdict,
        driftScore,
        threshold: ctx.threshold,
        reason: judgement.reason,
        signals: [
          {
            label: "relationship",
            value: BASE_SCORE[judgement.relationship],
            note: judgement.relationship,
          },
          {
            label: "confidence",
            value: Number(judgement.confidence.toFixed(3)),
            note: "score is pulled toward 0.5 as this drops",
          },
        ],
        proposedTitle: proposed ? proposed : undefined,
        latencyMs: Date.now() - started,
        costUsd: costOf(response),
        usedLlm: true,
      };
    } catch (error) {
      // A judge failure must never take the conversation down with it.
      return continueResult("llm-judge", ctx, "Judge call failed; defaulting to continue.", {
        latencyMs: Date.now() - started,
        usedLlm: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
