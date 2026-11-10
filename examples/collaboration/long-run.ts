/** Three live inventory reconciliation rounds with the same four agents. */
import "@umwelten/core/env/load.js";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { CollaborationRun } from "@umwelten/habitat/collaboration/runtime.js";
import { CollaborationStore } from "@umwelten/core/collaboration/store.js";

const origin = process.env.MYCEL_URL ?? "https://mycel.thefocus.ai";
process.env.MYCEL_URL = origin;
process.env.MYCEL_END_USER ??= "collaboration-e2e";
const modelName = "deepseek/deepseek-v4.1-flash";
const catalogue = await fetch(`${origin}/v1/models`).then((r) => r.json());
const offer = catalogue.data.find((m: { id: string }) => m.id === modelName);
assert.ok(offer?.capabilities?.includes("tool-calling"), "Model unavailable");
assert.ok(process.env.MYCEL_API_KEY, "MYCEL_API_KEY is required");
const id = randomUUID();
const directory = resolve(".umwelten/e2e", id);
await mkdir(directory, { recursive: true });
const regions = ["north", "south", "west"];
const skus = ["bolts", "cables", "pumps"];
const contexts = ["fresh", "fork", "summary"];
const prices = [7, 13, 29];
const nonce = randomUUID();
const initial = regions.map(() => skus.map(() => randomInt(30, 70)));
const delta = regions.map(() => skus.map(() => randomInt(3, 12)));
const snapshots = [
  initial,
  initial.map((row, r) =>
    row.map((n, s) => n + (r === s ? -delta[r][s] : delta[r][s])),
  ),
  initial.map((row, r) =>
    row.map(
      (n, s) =>
        n +
        (r === s ? -delta[r][s] : delta[r][s]) +
        (s === 0 ? -2 - r : s === 2 ? 5 + r : 0),
    ),
  ),
];
// Expected results are calculated separately and never supplied to participants.
const expected = snapshots.map((matrix) => {
  const stock = Object.fromEntries(
    skus.map((sku, s) => [sku, matrix.reduce((sum, row) => sum + row[s], 0)]),
  );
  return {
    stock,
    value: skus.reduce((sum, sku, s) => sum + stock[sku] * prices[s], 0),
  };
});
const run = new CollaborationRun(directory, {
  id,
  limits: {
    maxAgents: 4,
    maxDepth: 1,
    concurrency: 3,
    maxCalls: 100,
    maxDurationMs: 900_000,
    maxTotalTokens: 600_000,
    maxOutputTokens: 4096,
    maxCostUsd: 0.5,
  },
});
const originalFetch = globalThis.fetch;
const captures: Promise<void>[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  const response = await originalFetch(input, init);
  if (
    url.origin === new URL(origin).origin &&
    url.pathname.endsWith("/chat/completions")
  ) {
    const timestamp = new Date().toISOString();
    captures.push(
      response
        .clone()
        .text()
        .then((body) =>
          appendFile(
            join(directory, "provider-http.jsonl"),
            JSON.stringify({
              timestamp,
              status: response.status,
              request:
                typeof init?.body === "string" ? JSON.parse(init.body) : null,
              body,
            }) + "\n",
            { mode: 0o600 },
          ),
        ),
    );
  }
  return response;
};
const workerTasks = regions.map(
  (region) =>
    `You are the ${region} inventory worker, NOT the coordinator. Never spawn. Work through rounds 1, 2, 3 in this same conversation. For each round R read latest source-${region}.json: it is a complete replacement snapshot, NOT an incremental adjustment. Compute stock per SKU as opening + received - shipped - damaged, then total value=sum(stock*unitPrice). Publish ${region}.json at expectedVersion=R-1 with exactly {nonce,round:R,stock:{bolts:number,cables:number,pumps:number},value:number}. Send channel:main a concise explanation citing the source version and changes since the previous round. For rounds 1 and 2 call agent_wait with channels=["updates"], never finish. On an operator round update reread the source and recompute. After publishing and messaging round 3 call agent_finish. Do not react to unrelated regional publications. Use actual tools, one per response.`,
);
run.addAgent({
  model: {
    provider: "mycel",
    name: modelName,
    costs: {
      promptTokens: offer.pricing.prompt,
      completionTokens: offer.pricing.completion,
    },
  },
  instructions:
    "Follow the latest assigned task. Tools are real. Never invent their results. Use one tool per response; waiting yields without polling. All monetary values in this exercise are integer cents.",
  task: `You coordinate three inventory workers over three rounds. First spawn exactly three children, assigning these tasks and contexts: ${JSON.stringify(workerTasks.map((task, i) => ({ task, context: contexts[i] })))}. No more spawns. For each round R=1,2,3 read north.json, south.json, west.json with agent_read; wait on channels=["artifacts","updates","main"] if results are missing or from an earlier round. Aggregate the three regional stock quantities and values. Publish consolidated.json at expectedVersion=R-1 containing exactly {nonce,round:R,stock:{bolts:number,cables:number,pumps:number},value:number}. Send channel:main your evidence-based summary of changes. After rounds 1 and 2 wait with channels=["updates"] until the operator starts the next round. Do not finish early and do not reuse stale regional results. Once consolidated round 3 is published and explained, call agent_finish. Regional sources are complete replacement snapshots, not deltas. Never compute a worker's report on its behalf.`,
});
const rounds: unknown[] = [];
const started = Date.now();
let failure: string | undefined;
let cursor = 0;
const progress = setInterval(() => {
  for (const e of run.store.events(cursor)) {
    cursor = e.id;
    if (
      [
        "agent.spawned",
        "artifact.published",
        "message",
        "agent.finished",
        "agent.failed",
        "decision.failed",
      ].includes(e.kind)
    )
      console.log(
        JSON.stringify({
          event: e.id,
          kind: e.kind,
          agent: e.agentId,
          data: e.data,
        }),
      );
  }
  const { calls, tokens, costUsd, agents } = run.status();
  console.log(
    JSON.stringify({
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      calls,
      tokens,
      costUsd,
      agents: agents.map((a) => ({ id: a.id, status: a.status })),
    }),
  );
}, 10_000);
console.log(
  JSON.stringify({ id, directory, model: modelName, limits: run.limits }),
);
try {
  for (let round = 1; round <= 3; round++) {
    for (let r = 0; r < regions.length; r++) {
      const source = {
        nonce,
        round,
        region: regions[r],
        note:
          round === 1
            ? "Initial warehouse count"
            : round === 2
              ? "Corrected receipts and shipping counts; replaces prior snapshot"
              : "Damage audit and late returns; replaces prior snapshot",
        items: skus.map((sku, s) => ({
          sku,
          opening: snapshots[round - 1][r][s] - 8 + s,
          received: 17 + r,
          shipped: 6 + s,
          damaged: 3 + r,
          unitPrice: prices[s],
        })),
      };
      // opening + received - shipped - damaged equals the independently generated stock.
      run.publish(
        null,
        `source-${regions[r]}.json`,
        JSON.stringify(source),
        round - 1,
      );
    }
    if (round > 1)
      run.send(
        null,
        "channel:updates",
        `Round ${round} starts now. All three source snapshots have been replaced. Reread them and recompute; do not apply them as deltas. Publish version ${round}. ${round === 3 ? "This is the final round: finish after publishing and messaging." : "Wait for the next update after this round."}`,
      );
    run.start();
    await run.waitForIdle();
    const errors: string[] = [];
    for (let r = 0; r <= regions.length; r++) {
      const path =
        r === regions.length ? "consolidated.json" : `${regions[r]}.json`;
      try {
        const artifact = run.store.artifact(path);
        assert.ok(artifact, `${path} missing`);
        assert.equal(artifact.version, round);
        const stock =
          r === regions.length
            ? expected[round - 1].stock
            : Object.fromEntries(
                skus.map((sku, s) => [sku, snapshots[round - 1][r][s]]),
              );
        const value =
          r === regions.length
            ? expected[round - 1].value
            : snapshots[round - 1][r].reduce(
                (sum, n, s) => sum + n * prices[s],
                0,
              );
        assert.deepEqual(JSON.parse(artifact.content), {
          nonce,
          round,
          stock,
          value,
        });
      } catch (error) {
        errors.push(`${path}: ${String(error)}`);
      }
    }
    const status = run.status();
    if (
      status.agents.length !== 4 ||
      status.agents.some(
        (a) => a.status !== (round === 3 ? "finished" : "waiting"),
      )
    )
      errors.push(
        "Expected four waiting agents between rounds and four finished agents after round 3",
      );
    const result = {
      round,
      expected: expected[round - 1],
      elapsedSeconds: (Date.now() - started) / 1000,
      calls: status.calls,
      tokens: status.tokens,
      costUsd: status.costUsd,
      passed: errors.length === 0,
      errors,
    };
    rounds.push(result);
    console.log(JSON.stringify(result));
    run.store.append("evaluation", null, result);
    // Keep incorrect results as failures, but continue if agents can accept updates.
    if (errors.length) failure = "One or more rounds failed independent checks";
    if (round < 3 && status.agents.some((a) => a.status !== "waiting"))
      throw new Error(
        "Cannot continue: an agent terminated before the final round",
      );
  }
  assert.deepEqual(
    run.store
      .events()
      .filter((e) => e.kind === "agent.spawned")
      .map((e) => (e.data as { context: string }).context)
      .sort(),
    [...contexts].sort(),
  );
  assert.equal(
    run.store.events().filter((e) => e.kind === "decision.failed").length,
    0,
  );
  // This task contains only synthetic warehouse data; omit reasoning via the exporter.
  if (!failure)
    await writeFile(
      join(directory, "training.jsonl"),
      run.store.exportTraining({ redact: (sample) => sample }),
      { mode: 0o600 },
    );
} catch (error) {
  failure = String(error);
  process.exitCode = 1;
} finally {
  clearInterval(progress);
  await run.close();
  await Promise.all(captures);
  globalThis.fetch = originalFetch;
  const reopened = new CollaborationStore(directory);
  await writeFile(join(directory, "trace.jsonl"), reopened.exportTrace(), {
    mode: 0o600,
  });
  reopened.close();
  const report = {
    id,
    model: modelName,
    passed: !failure,
    failure,
    rounds,
    elapsedSeconds: (Date.now() - started) / 1000,
    providerHttpCaptures: captures.length,
  };
  await writeFile(
    join(directory, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  if (failure) process.exitCode = 1;
  console.log(JSON.stringify(report, null, 2));
}
