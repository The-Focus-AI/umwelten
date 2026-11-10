/** Run from the repo root; see README.md for scripted and real-model modes. */
import "@umwelten/core/env/load.js";
import { parseArgs } from "node:util";
import { resolve, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import type {
  ModelRunner,
  ModelResponse,
} from "@umwelten/core/cognition/types.js";
import { CollaborationRun } from "@umwelten/habitat/collaboration/runtime.js";

const { values } = parseArgs({
  options: {
    scripted: { type: "boolean", default: false },
    single: { type: "boolean", default: false },
    context: { type: "string", default: "fork" },
    provider: { type: "string", default: "openrouter" },
    model: { type: "string", default: "google/gemini-3.1-flash-lite" },
    dir: { type: "string" },
  },
});
if (!["fresh", "summary", "fork"].includes(values.context))
  throw new Error("--context must be fresh, summary, or fork");
const directory = resolve(
  values.dir ?? join(".umwelten", "collaborations", randomUUID()),
);
const model = values.scripted
  ? { provider: "scripted", name: "deterministic" }
  : { provider: values.provider, name: values.model };
let rootId = "";

// A deterministic end-to-end smoke run, not a claim about model collaboration quality.
const counts = new Map<string, number>();
const reply = (content = ""): ModelResponse => ({
  content,
  metadata: {
    startTime: new Date(),
    endTime: new Date(),
    provider: "scripted",
    model: "scripted",
    tokenUsage: { promptTokens: 40, completionTokens: 8, total: 48 },
  },
});
async function use(ix: Interaction, name: string, input: unknown) {
  const t = ix.tools![name];
  const args = t.inputSchema.parse(input);
  const toolCallId = randomUUID();
  ix.addMessage({
    role: "assistant",
    content: [{ type: "tool-call", toolCallId, toolName: name, input: args }],
  });
  const output = await t.execute(args, { toolCallId, messages: ix.messages });
  ix.addMessage({
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName: name,
        output: { type: "json", value: output },
      },
    ],
  });
  return output;
}
const scripted: ModelRunner = {
  async streamText(ix: Interaction) {
    const turn = (counts.get(ix.id) ?? 0) + 1;
    counts.set(ix.id, turn);
    if (values.single) {
      if (turn === 1)
        await use(ix, "agent_publish", {
          path: "answer.json",
          content: JSON.stringify({ answer: 444 }),
          expectedVersion: 0,
        });
      else await use(ix, "agent_finish", { result: "444" });
    } else if (ix.id === rootId) {
      if (turn === 1)
        await use(ix, "agent_spawn", {
          context: values.context,
          task: "Compute 3² + 5² + 11² + 17²; publish answer.json containing {answer:number}, then finish.",
        });
      else if (turn === 2)
        await use(ix, "agent_wait", { channels: ["artifacts"] });
      else await use(ix, "agent_finish", { result: "Verified 444" });
    } else {
      if (turn === 1)
        await use(ix, "agent_send", {
          to: "channel:main",
          message: "I am checking the arithmetic independently.",
        });
      else if (turn === 2)
        await use(ix, "agent_publish", {
          path: "answer.json",
          content: JSON.stringify({ answer: 444, evidence: [9, 25, 121, 289] }),
          expectedVersion: 0,
        });
      else await use(ix, "agent_finish", { result: "444" });
    }
    return reply();
  },
  async generateText(ix: Interaction) {
    const text =
      "Task: compute the sum of squares. Evidence: inputs 3, 5, 11, 17. Pending: publish and verify answer.json. No result verified yet.";
    ix.addMessage({ role: "assistant", content: text });
    return reply(text);
  },
  async generateObject() {
    throw new Error("unused");
  },
  async streamObject() {
    throw new Error("unused");
  },
};

const run = new CollaborationRun(directory, {
  runner: values.scripted ? scripted : undefined,
  limits: {
    maxAgents: values.single ? 1 : 4,
    maxDepth: 2,
    concurrency: 2,
    maxCalls: 32,
    maxDurationMs: 180_000,
    maxTotalTokens: 100_000,
    maxOutputTokens: 2048,
  },
});
try {
  const task = `Compute the sum of squares of 3, 5, 11 and 17. Publish answer.json with {"answer":number,"evidence":...}. Verify the result and finish. ${values.single ? "Work alone." : `You may collaborate or spawn children using ${values.context} context. Use agent_read to discover peers; share findings explicitly.`}`;
  rootId = run.addAgent({ task, model });
  if (!values.single && !values.scripted) run.addAgent({ task, model });
  const started = Date.now();
  run.start();
  await run.waitForIdle();
  const artifact = run.store.artifact("answer.json");
  let correct = false;
  try {
    correct = JSON.parse(artifact?.content ?? "null")?.answer === 444;
  } catch {
    /* invalid output is a failed check */
  }
  const evaluation = {
    taskId: "sum-squares-3-5-11-17",
    mode: values.single ? "single" : "collaboration",
    context: values.context,
    scripted: values.scripted,
    correct,
    elapsedMs: Date.now() - started,
    ...run.status(),
  };
  run.store.append("evaluation", null, evaluation);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "evaluation.json"),
    JSON.stringify(evaluation, null, 2),
  );
  await writeFile(join(directory, "trace.jsonl"), run.store.exportTrace(), {
    mode: 0o600,
  });
  console.log(JSON.stringify({ directory, ...evaluation }, null, 2));
  if (!correct) process.exitCode = 1;
} finally {
  await run.close();
}
