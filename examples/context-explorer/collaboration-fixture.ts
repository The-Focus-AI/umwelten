/** Synthetic trace for tests and local UI inspection; never calls a model. */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const fixtureId = "11111111-2222-4333-8444-555555555555";
export async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "collaboration-inspector-"));
  const dir = join(root, fixtureId);
  await mkdir(join(dir, "blobs"), { recursive: true });
  const contents = [
    "Draft: compare the two approaches.",
    "<script>alert('not executable')</script>\nFinal: prefer the simpler approach.",
  ];
  const hashes = contents.map((content) =>
    createHash("sha256").update(content).digest("hex"),
  );
  await Promise.all(
    contents.map((content, i) =>
      writeFile(join(dir, "blobs", hashes[i]), content),
    ),
  );
  const db = new DatabaseSync(join(dir, "collaboration.sqlite"));
  try {
    db.exec(`CREATE TABLE events(id INTEGER PRIMARY KEY, kind TEXT, agentId TEXT, data TEXT, causeId INTEGER, timestamp TEXT);
      CREATE TABLE agents(id TEXT PRIMARY KEY, state TEXT);
      CREATE TABLE artifacts(path TEXT PRIMARY KEY, version INTEGER, hash TEXT);`);
    const model = { provider: "fixture", name: "planner" };
    for (const state of [
      {
        id: "coordinator",
        depth: 0,
        status: "completed",
        task: "Compare approaches and assemble a recommendation.",
        model,
      },
      {
        id: "researcher",
        parentId: "coordinator",
        depth: 1,
        status: "completed",
        task: "Check the simpler approach against the requirements.",
        model: { provider: "fixture", name: "reviewer" },
      },
      {
        id: "critic",
        parentId: "coordinator",
        depth: 1,
        status: "failed",
        task: "Look for counterexamples.",
        error: "Synthetic call failure",
        model: { provider: "fixture", name: "critic" },
      },
    ])
      db.prepare("INSERT INTO agents VALUES (?,?)").run(
        state.id,
        JSON.stringify({
          ...state,
          messages: [],
          cursor: 0,
          channels: ["findings"],
        }),
      );
    let id = 0;
    const event = (
      kind: string,
      agentId: string | null,
      data: unknown,
      causeId: number | null = null,
    ) => {
      ++id;
      db.prepare("INSERT INTO events VALUES (?,?,?,?,?,?)").run(
        id,
        kind,
        agentId,
        JSON.stringify(data),
        causeId,
        `2026-09-22T10:00:${String(id).padStart(2, "0")}.000Z`,
      );
    };
    event("run.created", null, {
      id: fixtureId,
      limits: { maxCalls: 10, maxTokens: 10000, maxCost: 1 },
    });
    event("agent.spawned", "coordinator", {
      childId: "researcher",
      context: "fork",
      sourceSnapshotId: "snapshot-1",
      inheritedMessages: 2,
    });
    event("agent.spawned", "coordinator", {
      childId: "critic",
      context: "fresh",
      inheritedMessages: 0,
    });
    event("message", "coordinator", {
      to: "researcher",
      content: "Please compare implementation complexity.",
    });
    event("decision.started", "researcher", {
      decisionId: "review-1",
      runId: fixtureId,
      parentAgentId: "coordinator",
      model: { provider: "fixture", name: "reviewer" },
      messages: [
        { role: "system", content: "Review only the supplied evidence." },
        { role: "user", content: "Please compare implementation complexity." },
      ],
      tools: {
        publishArtifact: {
          description: "Publish the recommendation",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
          },
        },
      },
      options: { temperature: 0 },
      deliveredEventIds: [4],
    });
    event("artifact.published", "researcher", {
      path: "recommendation.md",
      version: 1,
      hash: hashes[0],
    });
    event(
      "decision.completed",
      "researcher",
      {
        decisionId: "review-1",
        messages: [
          { role: "assistant", content: "Prefer the simpler approach." },
        ],
        output:
          "Prefer the simpler approach: fewer moving parts, same requirements.",
        usage: { totalTokens: 9999 },
      },
      5,
    );
    event(
      "call.completed",
      "researcher",
      { tokens: 321, cost: 0.0017, estimated: false, failed: false },
      5,
    );
    event("message", "researcher", {
      to: "coordinator",
      content: "The simpler approach meets the requirements. Draft published.",
    });
    event("artifact.published", "researcher", {
      path: "recommendation.md",
      version: 2,
      hash: hashes[1],
      previousVersion: 1,
    });
    event("decision.started", "critic", {
      decisionId: "review-2",
      runId: fixtureId,
      model: { provider: "fixture", name: "critic" },
      messages: [{ role: "user", content: "Find a counterexample." }],
      tools: {},
      options: {},
      deliveredEventIds: [],
    });
    event(
      "call.completed",
      "critic",
      { tokens: 79, cost: 0.0003, estimated: true, failed: true },
      11,
    );
    event("run.stopped", null, { reason: "completed" });
    db.prepare("INSERT INTO artifacts VALUES (?,?,?)").run(
      "recommendation.md",
      2,
      hashes[1],
    );
  } finally {
    db.close();
  }
  return { root, dir, hashes, contents };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log((await createFixture()).root);
}
