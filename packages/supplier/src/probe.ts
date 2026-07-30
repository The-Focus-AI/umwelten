/**
 * Stage 3 of the supplier agent: probe.
 *
 * This is the only stage that produces facts. `whichllm` estimates from VRAM
 * math and other people's leaderboard scores; Ollama reports context windows
 * from a hardcoded lookup table (`providers/ollama.ts`). Neither knows what
 * *this* box does with *this* build of *this* quantization — which is exactly
 * the thing an Offer's Capabilities are supposed to record.
 *
 * So we run the model and watch what happens.
 *
 * On token limits: the binary capability probes set `maxTokens` on their own
 * Stimulus, which is the sanctioned per-task escape hatch in CLAUDE.md's HARD
 * RULES — we are testing whether a tool call happens, not how long a model can
 * talk. The headroom probe deliberately sets **no** cap; it uses a
 * self-terminating prompt so the measurement window is bounded by the task
 * rather than by a truncation that would distort tokens/sec.
 */

import { z } from "zod";
import { tool } from "ai";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import { runWithWatchdog } from "./watchdog.js";
import type { CapabilityProbe, HeadroomSample, ProbedOffer } from "./types.js";

/** Binary probes are short by construction; 3 minutes is already generous. */
const CAPABILITY_TIMEOUT_MS = 3 * 60_000;
/** Throughput generates ~200 lines, and a cold model load can be slow. */
const THROUGHPUT_TIMEOUT_MS = 10 * 60_000;

function elapsedSince(start: number): number {
  return Date.now() - start;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ── Individual capability probes ─────────────────────────────────────────────

/** Does it answer at all, and does it follow a trivial instruction? */
async function probeChat(model: ModelDetails): Promise<CapabilityProbe> {
  const start = Date.now();
  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: async (signal) => {
      const interaction = new Interaction(
        model,
        new Stimulus({
          role: "a terse assistant",
          instructions: ["Answer with the single requested word and nothing else."],
          maxTokens: 32,
        }),
      );
      interaction.addMessage({
        role: "user",
        content: 'Reply with exactly the word: READY',
      });
      return interaction.generateText(signal);
    },
  });

  if (!outcome.ok) {
    return {
      name: "chat",
      supported: false,
      evidence: outcome.reason === "timeout" ? "timed out" : String(outcome.error),
      elapsedMs: elapsedSince(start),
    };
  }

  const said = outcome.value.content.trim().toUpperCase().includes("READY");
  return {
    name: "chat",
    supported: said,
    evidence: said
      ? "responded with the requested token"
      : `unexpected response: ${outcome.value.content.slice(0, 120)}`,
    elapsedMs: elapsedSince(start),
  };
}

/** Do deltas actually arrive incrementally, or does it buffer and dump? */
async function probeStreaming(model: ModelDetails): Promise<CapabilityProbe> {
  const start = Date.now();
  let deltas = 0;

  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: async (signal) => {
      const interaction = new Interaction(
        model,
        new Stimulus({ role: "a helpful assistant", maxTokens: 128 }),
      );
      interaction.addMessage({
        role: "user",
        content: "Count from one to twenty, in words, separated by commas.",
      });
      return interaction.streamText(signal, {
        onTextDelta: () => {
          deltas += 1;
        },
      });
    },
  });

  if (!outcome.ok) {
    return {
      name: "streaming",
      supported: false,
      evidence: outcome.reason === "timeout" ? "timed out" : String(outcome.error),
      elapsedMs: elapsedSince(start),
    };
  }

  // A single delta means the runtime buffered the whole completion and handed
  // it over at the end. That is not streaming, whatever the API shape claims.
  return {
    name: "streaming",
    supported: deltas > 1,
    evidence: `${deltas} text delta(s) observed`,
    elapsedMs: elapsedSince(start),
  };
}

/**
 * Will it call a tool? This is the capability most likely to differ between
 * two runtimes serving the same weights — chat template and grammar support
 * decide it, not the model.
 */
async function probeToolCalling(model: ModelDetails): Promise<CapabilityProbe> {
  const start = Date.now();
  let called = false;

  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: async (signal) => {
      const interaction = new Interaction(
        model,
        new Stimulus({
          role: "an assistant that uses tools",
          instructions: ["Use the provided tool to answer. Do not compute it yourself."],
          maxToolSteps: 3,
          maxTokens: 256,
          tools: {
            multiply: tool({
              description: "Multiply two integers. The only way to get a correct product.",
              inputSchema: z.object({ a: z.number(), b: z.number() }),
              execute: async ({ a, b }: { a: number; b: number }) => {
                called = true;
                return { product: a * b };
              },
            }),
          },
        }),
      );
      interaction.addMessage({
        role: "user",
        content: "What is 3737 multiplied by 1319? Use the tool.",
      });
      return interaction.streamText(signal);
    },
  });

  if (!outcome.ok) {
    return {
      name: "tool-calling",
      supported: false,
      evidence: outcome.reason === "timeout" ? "timed out" : String(outcome.error),
      elapsedMs: elapsedSince(start),
    };
  }

  return {
    name: "tool-calling",
    supported: called,
    evidence: called
      ? "tool handler executed"
      : `no tool call; model answered directly: ${outcome.value.content.slice(0, 120)}`,
    elapsedMs: elapsedSince(start),
  };
}

/** Can it produce output that validates against a schema? */
async function probeStructuredOutput(model: ModelDetails): Promise<CapabilityProbe> {
  const start = Date.now();
  const schema = z.object({
    city: z.string(),
    countryCode: z.string().length(2),
    populationMillions: z.number(),
  });

  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: async (signal) => {
      const interaction = new Interaction(
        model,
        new Stimulus({ role: "a precise data extractor", maxTokens: 256 }),
      );
      interaction.addMessage({
        role: "user",
        content: "Give me structured data about the capital city of Japan.",
      });
      return interaction.generateObject(schema, signal);
    },
  });

  if (!outcome.ok) {
    return {
      name: "structured-output",
      supported: false,
      evidence: outcome.reason === "timeout" ? "timed out" : String(outcome.error),
      elapsedMs: elapsedSince(start),
    };
  }

  // The runner stringifies generateObject's result into `content`, so this
  // parses in practice — but a probe that crashes the whole run because one
  // model returned something odd is worse than a probe that records a failure.
  let parsedOk = false;
  let detail = "";
  try {
    const parsed = schema.safeParse(JSON.parse(outcome.value.content || "{}"));
    parsedOk = parsed.success;
    if (!parsed.success) detail = `schema mismatch: ${outcome.value.content.slice(0, 120)}`;
  } catch {
    detail = `unparseable output: ${outcome.value.content.slice(0, 120)}`;
  }

  return {
    name: "structured-output",
    supported: parsedOk,
    evidence: parsedOk ? "returned schema-valid JSON" : detail,
    elapsedMs: elapsedSince(start),
  };
}

/**
 * Can this Offer surface reasoning tokens separately from the answer?
 *
 * Note the question: *can it*, not *does it by default*. Those differ, and the
 * difference was worth a bug — llama-server splits thinking into its own
 * channel unprompted, while Ollama only does so when asked via `think: true`.
 * Probing without asking measured a default, not a capability, and reported
 * that four models had no reasoning when they had it all along.
 *
 * So we ask, by setting `reasoningEffort`. Providers that ignore it are
 * unaffected; providers that honor it now answer the question we meant.
 */
async function probeReasoning(model: ModelDetails): Promise<CapabilityProbe> {
  const start = Date.now();
  const asking: ModelDetails = { ...model, reasoningEffort: "medium" };
  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: async (signal) => {
      const interaction = new Interaction(
        asking,
        new Stimulus({ role: "a careful reasoner", maxTokens: 1024 }),
      );
      interaction.addMessage({
        role: "user",
        content:
          "A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. How much does the ball cost?",
      });
      return interaction.generateText(signal);
    },
  });

  if (!outcome.ok) {
    return {
      name: "reasoning",
      supported: false,
      evidence: outcome.reason === "timeout" ? "timed out" : String(outcome.error),
      elapsedMs: elapsedSince(start),
    };
  }

  const hasReasoning = Boolean(outcome.value.reasoning?.trim());
  return {
    name: "reasoning",
    supported: hasReasoning,
    // Deliberately not scored for correctness — that is an eval's job, not a
    // capability probe's. We only record whether the channel exists.
    evidence: hasReasoning
      ? `${outcome.value.reasoning!.length} chars of reasoning surfaced`
      : "no separate reasoning channel",
    elapsedMs: elapsedSince(start),
  };
}

// ── Throughput ───────────────────────────────────────────────────────────────

/**
 * Measure TTFT and tokens/sec at a given concurrency. Run at 1 to get the
 * single-stream number a buyer experiences, and at N to find where the box
 * stops scaling — that inflection is the Headroom the exchange needs.
 *
 * No `maxTokens` here on purpose: the prompt self-terminates, so the window is
 * defined by the task. Capping would truncate mid-generation and inflate the
 * rate.
 */
async function measureThroughput(
  model: ModelDetails,
  concurrency: number,
): Promise<HeadroomSample> {
  const ttfts: number[] = [];
  const decodeRates: number[] = [];
  let completionTokens = 0;
  let errors = 0;

  const wallStart = Date.now();

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const started = Date.now();
      let firstTokenAt: number | undefined;

      const outcome = await runWithWatchdog({
        timeoutMs: THROUGHPUT_TIMEOUT_MS,
        task: async (signal) => {
          const interaction = new Interaction(
            model,
            new Stimulus({
              role: "a counting machine",
              instructions: ["Output only the numbers. No commentary."],
            }),
          );
          interaction.addMessage({
            role: "user",
            content: "Count from 1 to 200. One number per line.",
          });
          return interaction.streamText(signal, {
            onTextDelta: () => {
              firstTokenAt ??= Date.now();
            },
          });
        },
      });

      if (!outcome.ok) {
        errors += 1;
        return;
      }

      const tokens = outcome.value.metadata.tokenUsage.completionTokens ?? 0;
      completionTokens += tokens;

      if (firstTokenAt) {
        ttfts.push(firstTokenAt - started);
        // Decode rate excludes the wait before generation began, so it isolates
        // how fast the box emits tokens from how long it made you queue.
        const decodeSeconds = (Date.now() - firstTokenAt) / 1000;
        if (decodeSeconds > 0 && tokens > 0) decodeRates.push(tokens / decodeSeconds);
      }
    }),
  );

  const wallSeconds = (Date.now() - wallStart) / 1000;
  return {
    concurrency,
    ttftMs: Math.round(median(ttfts)),
    tokensPerSecond: wallSeconds > 0 ? Number((completionTokens / wallSeconds).toFixed(1)) : 0,
    decodeTokensPerSecond: Number(median(decodeRates).toFixed(1)),
    errors,
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface ProbeOptions {
  /** Concurrency levels to sample. Default [1]. Try [1, 4] to find the knee. */
  concurrency?: number[];
  /** Skip the headroom stage — capabilities only, much faster. */
  skipHeadroom?: boolean;
}

/**
 * Probe one (runtime, model) pair. Capability probes run in sequence rather
 * than in parallel: on a single-GPU box, concurrent probes would contend and
 * the headroom numbers would measure our own interference.
 */
export async function probeOffer(
  provider: string,
  model: string,
  opts: ProbeOptions = {},
): Promise<ProbedOffer> {
  const details: ModelDetails = { name: model, provider };
  const probedAt = new Date().toISOString();

  const chat = await probeChat(details);
  if (!chat.supported) {
    // Nothing downstream is meaningful if it cannot hold a conversation.
    return {
      provider,
      model,
      probedAt,
      capabilities: [chat],
      headroom: [],
      failed: `chat probe failed: ${chat.evidence}`,
    };
  }

  const capabilities: CapabilityProbe[] = [chat];
  capabilities.push(await probeStreaming(details));
  capabilities.push(await probeToolCalling(details));
  capabilities.push(await probeStructuredOutput(details));
  capabilities.push(await probeReasoning(details));

  const headroom: HeadroomSample[] = [];
  if (!opts.skipHeadroom) {
    for (const level of opts.concurrency ?? [1]) {
      headroom.push(await measureThroughput(details, level));
    }
  }

  return { provider, model, probedAt, capabilities, headroom };
}
