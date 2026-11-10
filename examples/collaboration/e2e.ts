/** Live-model, independently checked E2E run. No scripted runner or canned tool output. */
import "@umwelten/core/env/load.js";
import assert from "node:assert/strict";
import { randomInt, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CollaborationRun } from "@umwelten/habitat/collaboration/runtime.js";
import { CollaborationStore } from "@umwelten/core/collaboration/store.js";
import { collaborationResponse } from "../context-explorer/collaboration.js";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: ".umwelten/e2e" },
    context: { type: "string", default: "fresh" },
    provider: { type: "string", default: "llamaswap-nothink" },
    model: { type: "string", default: "qwen3-1.7b" },
  },
});
assert.ok(["fresh", "summary", "fork"].includes(values.context));
const id = randomUUID();
const root = resolve(values.root);
const directory = join(root, id);
await mkdir(directory, { recursive: true });
const challenge = {
  nonce: randomUUID(),
  values: [randomInt(2, 12), randomInt(13, 24), randomInt(25, 39)],
};
// The checker computes the answer independently; it is never supplied to the agents.
const expected = challenge.values.reduce((a, b) => a + b, 0);
const canary = `SYNTHETIC_PRIVATE_${randomUUID()}`;
const startedAt = new Date().toISOString();
console.log(
  JSON.stringify({
    phase: "started",
    id,
    directory,
    context: values.context,
    challenge,
  }),
);

// Capture this synthetic task's provider bodies, never credentials or headers.
// Remote capture is restricted to the configured Mycel origin.
const originalFetch = globalThis.fetch;
const captures: Promise<void>[] = [];
const mycelOrigin =
  values.provider === "mycel" && process.env.MYCEL_URL
    ? new URL(process.env.MYCEL_URL).origin
    : undefined;
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
    (["localhost", "127.0.0.1"].includes(url.hostname) ||
      url.origin === mycelOrigin) &&
    url.pathname.endsWith("/chat/completions")
  ) {
    const timestamp = new Date().toISOString();
    const request =
      typeof init?.body === "string" ? JSON.parse(init.body) : null;
    captures.push(
      response
        .clone()
        .text()
        .then(async (body) => {
          await appendFile(
            join(directory, "provider-http.jsonl"),
            JSON.stringify({
              timestamp,
              request,
              status: response.status,
              body,
            }) + "\n",
            { mode: 0o600 },
          );
        }),
    );
  }
  return response;
};

const run = new CollaborationRun(directory, {
  id,
  limits: {
    maxAgents: 2,
    maxDepth: 1,
    concurrency: 2,
    maxCalls: 24,
    maxDurationMs: 900_000,
    maxTotalTokens: 300_000,
    maxOutputTokens: 2048,
  },
});
const checks: string[] = [];
const check = (name: string, fn: () => void) => {
  fn();
  checks.push(name);
  console.log(`PASS ${name}`);
};
let failure: string | undefined;
try {
  const childTask =
    'You are the WORKER, not the coordinator. Do not spawn. First call agent_read with path="challenge.json". Sum the three values. Call agent_publish with path="answer.json", expectedVersion=0, content a JSON string with exactly {"nonce":the nonce from challenge.json,"total":the computed sum}. Then call agent_send to="channel:main" with a message containing the nonce and total. Then call agent_finish with your result. Use actual tool calls, not prose.';
  const parent = run.addAgent({
    model: { provider: values.provider, name: values.model },
    instructions:
      "Follow your current task. Use one tool per response. Tool outputs are evidence. Do not invent tool results. When your task is complete call agent_finish.",
    task: `You are the COORDINATOR. Private test marker: ${canary}. First call agent_spawn exactly once with context="${values.context}" and task=${JSON.stringify(childTask)}. After spawning, call agent_wait with channels=["artifacts"]. When the worker publishes answer.json or finishes, call agent_read with path="answer.json". Then call agent_finish with the nonce and total you read. Do not publish the answer yourself. Do not spawn a second child. If you have already received an artifact publication, read it instead of waiting again.`,
  });
  run.publish(null, "challenge.json", JSON.stringify(challenge), 0);
  run.start();
  await run.waitForIdle();
  const status = run.status();
  const events = run.store.events();
  const data = (kind: string) => events.filter((e) => e.kind === kind);
  const answer = run.store.artifact("answer.json");
  check("randomized answer and nonce match an independent checker", () => {
    assert.ok(answer, "worker never published answer.json");
    assert.deepEqual(JSON.parse(answer.content), {
      nonce: challenge.nonce,
      total: expected,
    });
    assert.equal(
      createHash("sha256").update(answer.content).digest("hex"),
      answer.hash,
    );
  });
  const spawn = data("agent.spawned")[0];
  const child = status.agents.find((a) => a.parentId === parent);
  check(
    "model spawned exactly one independent child with the requested context",
    () => {
      assert.equal(data("agent.spawned").length, 1);
      assert.ok(child);
      assert.equal((spawn.data as { context: string }).context, values.context);
      assert.equal(child.depth, 1);
      assert.notEqual(child.id, parent);
    },
  );
  check("worker, not operator or coordinator, published the answer", () => {
    assert.equal(
      data("artifact.published").find(
        (e) => (e.data as { path: string }).path === "answer.json",
      )?.agentId,
      child!.id,
    );
  });
  check("worker explicitly sent its independently computed result", () => {
    assert.ok(
      data("tool.called").some(
        (e) =>
          e.agentId === child!.id &&
          (e.data as { toolName: string }).toolName === "agent_send",
      ),
    );
    assert.ok(
      data("message").some(
        (e) =>
          e.agentId === child!.id &&
          (e.data as { to: string }).to === "channel:main" &&
          JSON.stringify(e.data).includes(challenge.nonce) &&
          JSON.stringify(e.data).includes(String(expected)),
      ),
    );
  });
  check(
    "coordinator actually read the worker artifact before finishing",
    () => {
      assert.ok(
        data("tool.called").some(
          (e) =>
            e.agentId === parent &&
            JSON.stringify(e.data).includes("answer.json") &&
            JSON.stringify(e.data).includes("agent_read"),
        ),
      );
      const finished = data("agent.finished").find((e) => e.agentId === parent);
      assert.ok(finished);
      assert.ok(JSON.stringify(finished.data).includes(challenge.nonce));
      assert.ok(JSON.stringify(finished.data).includes(String(expected)));
    },
  );
  check("both agents finished and all model decisions completed", () => {
    assert.equal(status.agents.length, 2);
    assert.ok(status.agents.every((a) => a.status === "finished"));
    assert.equal(data("decision.failed").length, 0);
    assert.equal(
      data("decision.started").length,
      data("decision.completed").length,
    );
    assert.ok(status.tokens > 0);
  });
  const raw = run.store.exportTrace();
  const training = run.store.exportTraining({
    redact: (sample) =>
      JSON.parse(
        JSON.stringify(sample).replaceAll(
          canary,
          "[REDACTED_SYNTHETIC_MARKER]",
        ),
      ),
  });
  const samples = training
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  check(
    "training export contains each completed decision, with synthetic private marker redacted",
    () => {
      assert.ok(raw.includes(canary));
      assert.ok(!training.includes(canary));
      assert.equal(samples.length, data("decision.completed").length);
      assert.deepEqual(
        new Set(samples.map((s) => s.agentId)),
        new Set([parent, child!.id]),
      );
      for (const sample of samples) {
        assert.ok(
          sample.target.some((m: { role: string }) => m.role === "assistant"),
        );
        assert.ok(
          sample.metadata.startEventId < sample.metadata.completedEventId,
        );
      }
    },
  );
  check(
    "stale artifact writes and traversal are rejected without mutation",
    () => {
      assert.throws(
        () => run.publish(null, "answer.json", "corrupt", 0),
        /conflict/,
      );
      assert.throws(
        () => run.publish(null, "../escape", "corrupt", 0),
        /Unsafe/,
      );
      assert.equal(run.store.artifact("answer.json")?.hash, answer!.hash);
    },
  );
  await writeFile(join(directory, "training.jsonl"), training, { mode: 0o600 });
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  console.error(`FAIL ${failure}`);
  process.exitCode = 1;
} finally {
  await run.close();
  await Promise.all(captures);
  globalThis.fetch = originalFetch;
  const reopened = new CollaborationStore(directory);
  const events = reopened.events();
  await writeFile(join(directory, "trace.jsonl"), reopened.exportTrace(), {
    mode: 0o600,
  });
  if (!failure) {
    check("persisted journal and artifact survive close/reopen", () => {
      assert.deepEqual(JSON.parse(reopened.artifact("answer.json")!.content), {
        nonce: challenge.nonce,
        total: expected,
      });
      assert.ok(events.some((e) => e.kind === "run.stopped"));
    });
    const api = await collaborationResponse(
      root,
      `/api/collaboration/runs/${id}`,
    );
    check(
      "read-only inspector returns the exact persisted event stream",
      () => {
        assert.equal(api.events?.length, events.length);
        assert.equal(api.agents?.length, 2);
        assert.equal(
          api.artifacts?.find((a) => a.path === "answer.json")?.hash,
          reopened.artifact("answer.json")!.hash,
        );
      },
    );
  }
  const report = {
    id,
    startedAt,
    endedAt: new Date().toISOString(),
    provider: values.provider,
    model: values.model,
    context: values.context,
    scripted: false,
    challenge,
    expected,
    checks,
    passed: !failure,
    failure,
    events: events.length,
    modelCalls: events.filter((e) => e.kind === "call.completed").length,
    providerHttpCaptures: captures.length,
  };
  reopened.close();
  await writeFile(
    join(directory, "verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
