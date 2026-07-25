/**
 * Turn fan-out: run several probes in parallel over the conversation so far.
 *
 * After a turn completes, the same context can be asked many different
 * questions at once — what is this about, what were we trying to do, is it
 * done, and what would this look like compacted. Two kinds of answer come back:
 *
 *   annotation — information *about* the state; rides alongside it
 *   baseline   — a candidate replacement context you could continue from
 *
 * Nothing here constrains how a probe is built. An annotation sends the
 * conversation verbatim plus a short question, so the provider's prefix cache
 * should already be warm; a compaction strategy may rebuild the messages
 * entirely and pay full prompt cost. Both are allowed and both are measured —
 * `sharedPrefix` records which happened, so a run can show what fanning out
 * actually costs rather than assuming.
 */

import type { ModelMessage } from "ai";
import type { ModelDetails, ModelRunner } from "../../cognition/types.js";
import { BaseModelRunner } from "../../cognition/runner.js";
import { Stimulus } from "../../stimulus/stimulus.js";
import { Interaction } from "../core/interaction.js";
import { estimateContextSize } from "../../context/estimate-size.js";
import { getCompactionStrategy } from "../../context/registry.js";

export type ProbeKind = "annotation" | "baseline";

export interface Probe {
  /** Stable id, used as the key in results and in the UI. */
  id: string;
  /** Short human label for the card. */
  label: string;
  kind: ProbeKind;
  /**
   * annotation: the question to ask over the conversation. Kept short — it is
   * appended after the verbatim history, so it is the only novel input.
   */
  question?: string;
  /** baseline: id of a registered compaction strategy. */
  strategyId?: string;
  /** baseline: options handed to the strategy. */
  strategyOptions?: Record<string, unknown>;
  /** Override the fan-out model for this probe alone. */
  model?: ModelDetails;
}

export interface ProbeResult {
  probeId: string;
  label: string;
  kind: ProbeKind;
  /** The answer, or the compacted context for a baseline. */
  text: string;
  /** Messages a baseline would continue from. Undefined for annotations. */
  replacement?: ModelMessage[];
  model: ModelDetails;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  /** Estimated tokens of the context this probe would leave behind. */
  resultTokens: number;
  /**
   * True when the probe sent the conversation verbatim as its prefix, so a
   * provider-side prefix cache could apply. False when it rebuilt the messages.
   */
  sharedPrefix: boolean;
  error?: string;
}

export interface RunFanoutOptions {
  /** The conversation so far, including its system message. */
  messages: ModelMessage[];
  /** Default model for probes that don't override it. */
  model: ModelDetails;
  probes: Probe[];
  runner?: ModelRunner;
  signal?: AbortSignal;
  /** Called as each probe finishes, so a UI can render them as they land. */
  onResult?: (result: ProbeResult) => void;
}

/** The default set — the questions you actually want after every turn. */
export const DEFAULT_PROBES: Probe[] = [
  {
    id: "title",
    label: "Title",
    kind: "annotation",
    question:
      "In under eight words, what would you title this conversation? Reply with the title only.",
  },
  {
    id: "intent",
    label: "What are we trying to do?",
    kind: "annotation",
    question:
      "In two sentences, what is the person actually trying to accomplish here? Reply with the answer only.",
  },
  {
    id: "done",
    label: "Is this done?",
    kind: "annotation",
    question:
      "Is the thing this conversation set out to do finished? Answer 'yes', 'no', or 'unclear', then one sentence saying what remains. Reply with that only.",
  },
  {
    id: "open-loops",
    label: "Open loops",
    kind: "annotation",
    question:
      "List anything raised here and left unresolved, as short bullets. If nothing is open, reply exactly: none.",
  },
  {
    id: "through-line-and-facts",
    label: "Compacted (through-line + facts)",
    kind: "baseline",
    strategyId: "through-line-and-facts",
  },
  {
    id: "truncate",
    label: "Compacted (truncate)",
    kind: "baseline",
    strategyId: "truncate",
  },
];

function usageOf(response: { metadata?: unknown } | undefined) {
  const metadata = response?.metadata as
    | {
        tokenUsage?: { promptTokens?: number; completionTokens?: number };
        cost?: { totalCost?: number };
      }
    | undefined;
  return {
    promptTokens: metadata?.tokenUsage?.promptTokens,
    completionTokens: metadata?.tokenUsage?.completionTokens,
    costUsd: metadata?.cost?.totalCost,
  };
}

/**
 * Ask one question over the conversation, verbatim.
 *
 * The history goes in untouched and the question is appended as the final user
 * message, so every annotation probe shares the same prefix as the turn that
 * just ran — and as each other.
 */
async function runAnnotation(
  probe: Probe,
  options: RunFanoutOptions,
  model: ModelDetails,
): Promise<ProbeResult> {
  const started = Date.now();
  const stimulus = new Stimulus({
    role: "observer of a conversation",
    objective: "answer one short question about the conversation so far",
    instructions: [
      "Answer only what was asked, in the fewest words that are still specific.",
      "Do not preface the answer or restate the question.",
    ],
    runnerType: "base",
  });
  const interaction = new Interaction(model, stimulus);

  // Replace only the system message; everything after it is sent verbatim.
  interaction.messages = [
    interaction.messages[0],
    ...options.messages.slice(1),
    { role: "user", content: probe.question ?? "Describe the state of this conversation." },
  ];

  const response = await interaction.generateText(options.signal);
  const text = typeof response.content === "string" ? response.content : String(response.content ?? "");

  return {
    probeId: probe.id,
    label: probe.label,
    kind: "annotation",
    text: text.trim(),
    model,
    latencyMs: Date.now() - started,
    ...usageOf(response),
    resultTokens: estimateContextSize([{ role: "user", content: text }]).estimatedTokens,
    sharedPrefix: true,
  };
}

/** Run a registered compaction strategy over the conversation. */
async function runBaseline(
  probe: Probe,
  options: RunFanoutOptions,
  model: ModelDetails,
  runner: ModelRunner,
): Promise<ProbeResult> {
  const started = Date.now();
  const strategy = probe.strategyId
    ? await getCompactionStrategy(probe.strategyId)
    : undefined;
  if (!strategy) {
    throw new Error(`Unknown compaction strategy: ${probe.strategyId}`);
  }

  // Compact everything after the system message up to the last assistant turn.
  let segmentEnd = -1;
  for (let i = options.messages.length - 1; i >= 1; i--) {
    if ((options.messages[i] as { role?: string }).role === "assistant") {
      segmentEnd = i;
      break;
    }
  }
  if (segmentEnd < 1) throw new Error("Nothing to compact yet.");

  const result = await strategy.compact({
    messages: options.messages,
    segmentStart: 1,
    segmentEnd,
    model,
    runner,
    options: probe.strategyOptions,
  });

  const replacement: ModelMessage[] = [
    options.messages[0],
    ...result.replacementMessages,
    ...options.messages.slice(segmentEnd + 1),
  ];
  const text = result.replacementMessages
    .map((m) => {
      const content = (m as { content?: unknown }).content;
      return typeof content === "string" ? content : JSON.stringify(content);
    })
    .join("\n\n");

  return {
    probeId: probe.id,
    label: probe.label,
    kind: "baseline",
    text,
    replacement,
    model,
    latencyMs: Date.now() - started,
    resultTokens: estimateContextSize(replacement).estimatedTokens,
    // Strategies build their own summarizer prompt, so the conversation is not
    // sent as a verbatim prefix and a warm cache doesn't help them.
    sharedPrefix: false,
  };
}

/**
 * Run every probe concurrently. A probe that throws comes back as a result with
 * `error` set — one failing probe must never take the others, or the turn, down.
 */
export async function runFanout(options: RunFanoutOptions): Promise<ProbeResult[]> {
  const runner = options.runner ?? new BaseModelRunner();

  return Promise.all(
    options.probes.map(async (probe) => {
      const model = probe.model ?? options.model;
      let result: ProbeResult;
      try {
        result =
          probe.kind === "baseline"
            ? await runBaseline(probe, options, model, runner)
            : await runAnnotation(probe, options, model);
      } catch (error) {
        result = {
          probeId: probe.id,
          label: probe.label,
          kind: probe.kind,
          text: "",
          model,
          latencyMs: 0,
          resultTokens: 0,
          sharedPrefix: probe.kind === "annotation",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      options.onResult?.(result);
      return result;
    }),
  );
}
