/**
 * Stage 3 of the supplier agent: probe capabilities and headroom directly
 * over `@earendil-works/pi-ai` (`runPiTurn` / `runPiStructuredObject`).
 */

import { z } from "zod";
import {
  runPiStructuredObject,
  runPiTurn,
  tool,
  type ModelSpec,
} from "@umwelten/pi";
import { runWithWatchdog } from "./watchdog.js";
import {
  HEADROOM_POLICY,
  classifySaturation,
  countingPrompt,
  meetsPolicy,
  sanitizeLevels,
} from "./headroom.js";
import type {
  CapabilityProbe,
  HeadroomMeta,
  HeadroomSample,
  ProbedOffer,
} from "./types.js";

const CAPABILITY_TIMEOUT_MS = 3 * 60_000;
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

async function probeChat(model: ModelSpec): Promise<CapabilityProbe> {
  const start = Date.now();
  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: (signal) =>
      runPiTurn({
        model,
        systemPrompt:
          "You are a terse assistant. Answer with the single requested word and nothing else.",
        prompt: "Reply with exactly the word: READY",
        maxTokens: 32,
        signal,
      }),
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

async function probeStreaming(model: ModelSpec): Promise<CapabilityProbe> {
  const start = Date.now();
  let deltas = 0;

  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: (signal) =>
      runPiTurn({
        model,
        systemPrompt: "You are a helpful assistant.",
        prompt: "Count from one to twenty, in words, separated by commas.",
        maxTokens: 128,
        signal,
        onTextDelta: () => {
          deltas += 1;
        },
      }),
  });

  if (!outcome.ok) {
    return {
      name: "streaming",
      supported: false,
      evidence: outcome.reason === "timeout" ? "timed out" : String(outcome.error),
      elapsedMs: elapsedSince(start),
    };
  }

  return {
    name: "streaming",
    supported: deltas > 1,
    evidence: `${deltas} text delta(s) observed`,
    elapsedMs: elapsedSince(start),
  };
}

async function probeToolCalling(model: ModelSpec): Promise<CapabilityProbe> {
  const start = Date.now();
  let called = false;

  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: (signal) =>
      runPiTurn({
        model,
        systemPrompt:
          "Use the provided tool to answer. Do not compute it yourself.",
        prompt: "What is 3737 multiplied by 1319? Use the tool.",
        maxTokens: 256,
        maxToolSteps: 3,
        signal,
        tools: {
          multiply: tool({
            description: "Multiply two integers.",
            inputSchema: z.object({ a: z.number(), b: z.number() }),
            execute: async ({ a, b }) => {
              called = true;
              return { product: a * b };
            },
          }),
        },
      }),
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

async function probeStructuredOutput(model: ModelSpec): Promise<CapabilityProbe> {
  const start = Date.now();
  const schema = z.object({
    city: z.string(),
    countryCode: z.string().length(2),
    populationMillions: z.number(),
  });

  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: (signal) =>
      runPiStructuredObject({
        model,
        schema,
        systemPrompt: "You are a precise data extractor.",
        prompt: "Give me structured data about the capital city of Japan.",
        maxTokens: 256,
        signal,
      }),
  });

  if (!outcome.ok) {
    return {
      name: "structured-output",
      supported: false,
      evidence: outcome.reason === "timeout" ? "timed out" : String(outcome.error),
      elapsedMs: elapsedSince(start),
    };
  }

  return {
    name: "structured-output",
    supported: true,
    evidence: "returned schema-valid JSON",
    elapsedMs: elapsedSince(start),
  };
}

async function probeReasoning(model: ModelSpec): Promise<CapabilityProbe> {
  const start = Date.now();
  const asking: ModelSpec = { ...model, reasoningEffort: "medium" };
  const outcome = await runWithWatchdog({
    timeoutMs: CAPABILITY_TIMEOUT_MS,
    task: (signal) =>
      runPiTurn({
        model: asking,
        systemPrompt: "You are a careful reasoner.",
        prompt:
          "A bat and a ball cost $1.10 together. The bat costs $1.00 more than the ball. How much does the ball cost?",
        maxTokens: 1024,
        signal,
      }),
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
    evidence: hasReasoning
      ? `${outcome.value.reasoning!.length} chars of reasoning surfaced`
      : "no separate reasoning channel",
    elapsedMs: elapsedSince(start),
  };
}

async function measureColdStart(model: ModelSpec): Promise<number | undefined> {
  let firstTokenAt: number | undefined;
  const started = Date.now();

  const outcome = await runWithWatchdog({
    timeoutMs: THROUGHPUT_TIMEOUT_MS,
    task: (signal) =>
      runPiTurn({
        model,
        systemPrompt: "You are a terse assistant.",
        prompt: "Say: hi",
        maxTokens: 8,
        signal,
        onTextDelta: () => {
          firstTokenAt ??= Date.now();
        },
      }),
  });

  if (!outcome.ok || !firstTokenAt) return undefined;
  return firstTokenAt - started;
}

async function measureThroughput(
  model: ModelSpec,
  concurrency: number,
  countTo: number = HEADROOM_POLICY.countTo,
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
        task: (signal) =>
          runPiTurn({
            model,
            // Deliberately uncapped: self-terminating counting prompt
            systemPrompt: "Output only the numbers. No commentary.",
            prompt: countingPrompt(countTo),
            signal,
            onTextDelta: () => {
              firstTokenAt ??= Date.now();
            },
          }),
      });

      if (!outcome.ok) {
        errors += 1;
        return;
      }

      const tokens = outcome.value.usage.completionTokens ?? 0;
      completionTokens += tokens;

      if (firstTokenAt) {
        ttfts.push(firstTokenAt - started);
        const decodeSeconds = (Date.now() - firstTokenAt) / 1000;
        if (decodeSeconds > 0 && tokens > 0) {
          decodeRates.push(tokens / decodeSeconds);
        }
      }
    }),
  );

  const wallSeconds = (Date.now() - wallStart) / 1000;
  const decodeSeconds = Number(
    Math.max(0, wallSeconds - median(ttfts) / 1000).toFixed(1),
  );

  const sample: HeadroomSample = {
    concurrency,
    ttftMs: Math.round(median(ttfts)),
    tokensPerSecond:
      wallSeconds > 0 ? Number((completionTokens / wallSeconds).toFixed(1)) : 0,
    decodeTokensPerSecond: Number(median(decodeRates).toFixed(1)),
    errors,
    decodeSeconds,
    meetsPolicy: false,
  };
  return { ...sample, meetsPolicy: meetsPolicy(sample) };
}

async function sampleHeadroom(
  model: ModelSpec,
  opts: {
    concurrency?: number[];
    sleep?: (ms: number) => Promise<void>;
    coldStartMs?: number;
    coldStartFirstTouch: boolean;
  },
): Promise<{ samples: HeadroomSample[]; meta: HeadroomMeta }> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const levels = sanitizeLevels(opts.concurrency);
  const started = Date.now();

  const samples: HeadroomSample[] = [];
  let failed: string | undefined;

  for (const [index, level] of levels.entries()) {
    const spent = (Date.now() - started) / 1000;
    if (spent > HEADROOM_POLICY.maxSampleSeconds) {
      failed =
        `sampling budget of ${HEADROOM_POLICY.maxSampleSeconds}s spent after ${index} of ` +
        `${levels.length} level(s); remaining levels not measured`;
      break;
    }
    if (index > 0) await sleep(HEADROOM_POLICY.cooldownMs);
    samples.push(await measureThroughput(model, level));
  }

  const allFailed =
    samples.length > 0 && samples.every((s) => s.tokensPerSecond === 0);
  if (allFailed) failed ??= "every sample errored or produced no tokens";
  if (samples.length === 0) failed ??= "no samples were taken";

  return {
    samples,
    meta: {
      sampledAt: new Date().toISOString(),
      coldStartMs: opts.coldStartMs,
      coldStartFirstTouch: opts.coldStartFirstTouch,
      policy: { ...HEADROOM_POLICY, levels },
      saturation: classifySaturation(samples),
      failed,
    },
  };
}

export interface ProbeOptions {
  concurrency?: number[];
  skipHeadroom?: boolean;
}

export async function probeOffer(
  provider: string,
  model: string,
  opts: ProbeOptions = {},
): Promise<ProbedOffer> {
  const details: ModelSpec = { name: model, provider };
  const probedAt = new Date().toISOString();

  const coldStartMs = opts.skipHeadroom
    ? undefined
    : await measureColdStart(details);

  const chat = await probeChat(details);
  if (!chat.supported) {
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

  if (opts.skipHeadroom) {
    return { provider, model, probedAt, capabilities, headroom: [] };
  }

  const { samples, meta } = await sampleHeadroom(details, {
    concurrency: opts.concurrency,
    coldStartMs,
    coldStartFirstTouch: true,
  });

  return {
    provider,
    model,
    probedAt,
    capabilities,
    headroom: samples,
    headroomMeta: meta,
  };
}
