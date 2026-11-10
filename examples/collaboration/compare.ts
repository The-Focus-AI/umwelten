/** Same checkable task across single-agent, fixed-roster Dialogue, and collaboration. */
import "@umwelten/core/env/load.js";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { tool } from "ai";
import { z } from "zod";
import {
  Dialogue,
  InteractionParticipant,
} from "@umwelten/core/dialogue/index.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import type {
  ModelResponse,
  StreamObserver,
} from "@umwelten/core/cognition/types.js";
import { CollaborationStore } from "@umwelten/core/collaboration/store.js";

const { values } = parseArgs({
  options: {
    scripted: { type: "boolean", default: false },
    provider: { type: "string", default: "openrouter" },
    model: { type: "string", default: "google/gemini-3.1-flash-lite" },
    context: { type: "string", default: "summary" },
    dir: { type: "string" },
  },
});
const root = resolve(
  values.dir ?? join(".umwelten", "comparisons", randomUUID()),
);
await mkdir(root, { recursive: true });
const results: unknown[] = [];
const execute = promisify(execFile);
for (const mode of ["single", "collaboration"]) {
  const directory = join(root, randomUUID());
  const args = [
    "--import",
    "tsx",
    join(dirname(fileURLToPath(import.meta.url)), "run.ts"),
    "--dir",
    directory,
    "--provider",
    values.provider,
    "--model",
    values.model,
    "--context",
    values.context,
    ...(mode === "single" ? ["--single"] : []),
    ...(values.scripted ? ["--scripted"] : []),
  ];
  try {
    await execute(process.execPath, args, { maxBuffer: 5_000_000 });
  } catch (error) {
    // An incorrect answer exits nonzero but still produces an evaluation.
    try {
      await readFile(join(directory, "evaluation.json"));
    } catch {
      throw error;
    }
  }
  results.push(
    JSON.parse(await readFile(join(directory, "evaluation.json"), "utf8")),
  );
}

const directory = join(root, randomUUID());
const store = new CollaborationStore(directory);
const runId = randomUUID();
const model = values.scripted
  ? { provider: "scripted", name: "deterministic" }
  : { provider: values.provider, name: values.model };
const budget = {
  maxCalls: 32,
  maxTotalTokens: 100_000,
  maxOutputTokens: 2048,
  maxDurationMs: 180_000,
};
store.append("run.created", null, {
  id: runId,
  mode: "dialogue",
  limits: budget,
});
let calls = 0,
  tokens = 0,
  costUsd = 0;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), budget.maxDurationMs);
timer.unref();
const started = Date.now();

// Caps are explicit on these experiment Stimuli; no shared runner default changes.
class MeasuredInteraction extends Interaction {
  override async streamText(
    signal?: AbortSignal,
    observer?: StreamObserver,
  ): Promise<ModelResponse> {
    const schemas = Object.fromEntries(
      Object.entries(this.tools ?? {}).map(([name, t]) => [
        name,
        {
          description: t.description,
          inputSchema: z.toJSONSchema(t.inputSchema),
        },
      ]),
    );
    const reservation =
      Math.ceil(
        JSON.stringify({ messages: this.messages, tools: schemas }).length / 4,
      ) + budget.maxOutputTokens;
    if (
      calls >= budget.maxCalls ||
      tokens + reservation > budget.maxTotalTokens ||
      signal?.aborted
    )
      throw new Error("Dialogue budget exhausted");
    calls++;
    const decisionId = randomUUID();
    const event = store.append("decision.started", this.id, {
      decisionId,
      runId,
      messages: this.messages,
      tools: schemas,
      model,
    });
    const call = store.append("call.started", this.id, {
      decisionId,
      reservation,
    });
    let response: ModelResponse | undefined;
    try {
      if (values.scripted) {
        if (!store.artifact("answer.json"))
          store.publish(
            this.id,
            "answer.json",
            JSON.stringify({ answer: 444 }),
            0,
          );
        this.addMessage({
          role: "assistant",
          content: "Verified 444. <done/>",
        });
        response = {
          content: "Verified 444. <done/>",
          metadata: {
            startTime: new Date(),
            endTime: new Date(),
            provider: "scripted",
            model: "scripted",
            tokenUsage: { promptTokens: 40, completionTokens: 8, total: 48 },
          },
        };
      } else response = await super.streamText(signal, observer);
      if (
        signal?.aborted ||
        (response.metadata as { partial?: boolean }).partial
      )
        throw new Error("Interrupted dialogue decision");
      store.append(
        "decision.completed",
        this.id,
        {
          decisionId,
          messages: this.messages,
          output: response.content,
          usage: response.metadata,
        },
        event.id,
      );
      return response;
    } catch (error) {
      store.append(
        "decision.failed",
        this.id,
        { decisionId, error: String(error) },
        event.id,
      );
      throw error;
    } finally {
      const usage = response?.metadata.tokenUsage;
      const spent =
        signal?.aborted || !usage
          ? reservation
          : usage.promptTokens + usage.completionTokens;
      tokens += spent;
      costUsd += response?.metadata.cost?.totalCost ?? 0;
      store.append(
        "call.completed",
        this.id,
        { tokens: spent, cost: response?.metadata.cost?.totalCost ?? 0 },
        call.id,
      );
    }
  }
}
const participants = ["alice", "bob"].map((id) => {
  const stimulus = new Stimulus({
    role: "collaborating agent",
    maxTokens: budget.maxOutputTokens,
    maxToolSteps: 1,
    instructions: [
      "Solve the shared task with your peer. Publish answer.json as JSON with answer and evidence. Verify then bow out.",
    ],
  });
  stimulus.addTool(
    "agent_publish",
    tool({
      description: "Publish a shared versioned artifact.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
        expectedVersion: z.number().int().nonnegative(),
      }),
      execute: async ({ path, content, expectedVersion }) =>
        store.publish(id, path, content, expectedVersion),
    }),
  );
  stimulus.addTool(
    "agent_read",
    tool({
      description: "Read a shared artifact.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => store.artifact(path) ?? null,
    }),
  );
  const interaction = new MeasuredInteraction(model, stimulus, { id });
  return new InteractionParticipant({ id, displayName: id, interaction });
});
try {
  const dialogue = new Dialogue({
    participants,
    seed: {
      content:
        'Compute the sum of squares of 3, 5, 11 and 17. Publish answer.json with {"answer":number,"evidence":...}. Verify the result and finish.',
    },
    stop: { maxTurns: 32, signal: controller.signal },
    persistDir: join(directory, "dialogue"),
  });
  let error: string | undefined;
  try {
    await dialogue.run();
  } catch (err) {
    error = String(err);
  }
  let correct = false;
  try {
    correct =
      JSON.parse(store.artifact("answer.json")?.content ?? "null")?.answer ===
      444;
  } catch {
    /* failure */
  }
  const evaluation = {
    mode: "dialogue",
    scripted: values.scripted,
    taskId: "sum-squares-3-5-11-17",
    correct,
    calls,
    tokens,
    costUsd,
    elapsedMs: Date.now() - started,
    error,
  };
  store.append("evaluation", null, evaluation);
  results.push(evaluation);
  await writeFile(
    join(directory, "evaluation.json"),
    JSON.stringify(evaluation, null, 2),
  );
  await writeFile(
    join(root, "comparison.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify({ directory: root, results }, null, 2));
  if (results.some((result) => !(result as { correct: boolean }).correct))
    process.exitCode = 1;
} finally {
  clearTimeout(timer);
  store.close();
}
