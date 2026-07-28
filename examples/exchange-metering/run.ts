#!/usr/bin/env node
/**
 * E3 — can the exchange bill what it sold?
 *
 * Every money decision we have recorded (ADR 0007, ADR 0008) assumes the
 * exchange can count what a request consumed. Nothing had checked that. This
 * spike drives the real runner against a mock upstream and reports what token
 * counts and cost come back in three situations:
 *
 *   1. the upstream reports usage in its final chunk — the happy path
 *   2. the upstream reports no usage at all — common, and real
 *   3. the client hangs up mid-stream — the one that decides whether the
 *      ledger can be gamed
 *
 * Run:  pnpm tsx examples/exchange-metering/run.ts
 */

import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type { ModelDetails, ModelResponse } from "@umwelten/core/cognition/types.js";
import {
  MOCK_COMPLETION_TOKENS,
  MOCK_PROMPT_TOKENS,
  startMockUpstream,
  type UpstreamMode,
} from "./mock-upstream.js";

interface Observation {
  scenario: string;
  contentChars: number;
  promptTokens: number | undefined;
  completionTokens: number | undefined;
  totalCost: number | undefined;
  partial: boolean;
  note: string;
}

const MODEL: ModelDetails = { name: "mock-model", provider: "llamaswap" };

function stimulus() {
  return new Stimulus({ role: "a helpful assistant" });
}

/** Nothing here should take long; a hang is itself a finding worth reporting. */
const SCENARIO_TIMEOUT_MS = 20_000;

async function runScenario(
  scenario: string,
  mode: UpstreamMode,
  opts: { abortAfterMs?: number } = {},
): Promise<Observation> {
  process.stdout.write(`  ${scenario} … `);
  const upstream = await startMockUpstream(mode);
  // The provider reads this at construction, so it has to be set before the
  // registry builds the provider for this call.
  process.env.LLAMASWAP_HOST = upstream.baseUrl;

  const interaction = new Interaction(MODEL, stimulus());
  interaction.addMessage({ role: "user", content: "Say something." });

  const controller = new AbortController();
  if (opts.abortAfterMs !== undefined) {
    setTimeout(() => controller.abort(new Error("client hung up")), opts.abortAfterMs);
  }

  let response: ModelResponse | undefined;
  let note = "";
  try {
    response = await Promise.race([
      interaction.streamText(controller.signal),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`no result after ${SCENARIO_TIMEOUT_MS}ms`)),
          SCENARIO_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
  } catch (error) {
    note = `threw: ${error instanceof Error ? error.message : String(error)}`;
  }

  await upstream.close();
  console.log(note || "ok");

  const meta = response?.metadata as
    | (ModelResponse["metadata"] & { partial?: boolean })
    | undefined;

  return {
    scenario,
    contentChars: response?.content.length ?? 0,
    promptTokens: meta?.tokenUsage?.promptTokens,
    completionTokens: meta?.tokenUsage?.completionTokens,
    totalCost: meta?.cost?.totalCost,
    partial: Boolean(meta?.partial),
    note,
  };
}

function report(observations: Observation[]) {
  console.log("\n─── What the ledger would see ───\n");
  const head =
    "scenario".padEnd(26) +
    "chars".padStart(7) +
    "prompt".padStart(8) +
    "compl".padStart(8) +
    "cost".padStart(12) +
    "  partial";
  console.log(head);
  console.log("-".repeat(head.length));
  for (const o of observations) {
    console.log(
      o.scenario.padEnd(26) +
        String(o.contentChars).padStart(7) +
        String(o.promptTokens ?? "—").padStart(8) +
        String(o.completionTokens ?? "—").padStart(8) +
        String(o.totalCost ?? "—").padStart(12) +
        "  " +
        (o.partial ? "yes" : "no") +
        (o.note ? `  ${o.note}` : ""),
    );
  }

  console.log(
    `\nUpstream truth for a completed stream: prompt=${MOCK_PROMPT_TOKENS}, ` +
      `completion=${MOCK_COMPLETION_TOKENS}.\n`,
  );

  const aborted = observations.find((o) => o.partial);
  if (aborted) {
    console.log("Findings:");
    console.log(
      `  • On a client hang-up the ledger sees promptTokens=${aborted.promptTokens} ` +
        `even though the full prompt was processed and paid for.`,
    );
    console.log(
      `  • completionTokens=${aborted.completionTokens} is a chars/4 estimate, not a count.`,
    );
    console.log(
      `  • cost=${aborted.totalCost ?? "undefined"} — so an aborted request is free ` +
        `if Charge is derived from metadata.cost.`,
    );
    console.log(
      "  • Attack: send a long prompt, abort near the end of generation. You pay",
    );
    console.log("    upstream for nearly all of it and record nothing.");
  }
}

const observations: Observation[] = [];
console.log("Running scenarios against a mock upstream:\n");
observations.push(await runScenario("usage in final chunk", "usage-in-final-chunk"));
observations.push(await runScenario("upstream reports no usage", "no-usage"));
observations.push(
  await runScenario("client hangs up mid-stream", "never-finishes", { abortAfterMs: 900 }),
);
report(observations);

// The local providers install a global undici dispatcher whose keep-alive
// sockets hold the event loop open, so the process will not exit on its own
// once we have touched one. Everything above has already resolved.
process.exit(0);
