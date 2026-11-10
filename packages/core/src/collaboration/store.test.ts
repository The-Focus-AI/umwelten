import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollaborationStore } from "./store.js";

describe("CollaborationStore", () => {
  let directory: string;
  let store: CollaborationStore;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "collaboration-store-"));
    store = new CollaborationStore(directory);
  });
  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("persists ordered events, exclusive cursors, detached snapshots, and agent upserts across reopen", () => {
    expect(store.exportTrace()).toBe("");
    const data = { count: 3 };
    const first = store.append("run.started", null, data);
    data.count = 99;
    const second = store.append(
      "agent.spawned",
      "beta",
      { task: "review" },
      first.id,
    );
    store.putAgent("beta", { status: "idle" });
    store.putAgent("alpha", { status: "working" });
    store.putAgent("beta", { status: "done", count: 7 });
    store.close();
    store = new CollaborationStore(directory);
    expect(store.events()).toEqual([first, second]);
    expect(store.events(first.id)).toEqual([second]);
    expect(store.events(second.id)).toEqual([]);
    expect(first.data).toEqual({ count: 3 });
    expect(first.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first).not.toHaveProperty("causeId");
    expect(store.agents()).toEqual([
      { id: "alpha", state: { status: "working" } },
      { id: "beta", state: { status: "done", count: 7 } },
    ]);
    expect(
      store
        .exportTrace()
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([first, second]);
    expect(store.append("continued", null, {}).id).toBeGreaterThan(second.id);
  });

  it("uses WAL and protects immutable event and artifact rows", () => {
    store.append("test", null, {});
    store.publish("writer", "note.md", "hello", 0);
    const db = new Database(join(directory, "collaboration.sqlite"));
    try {
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(() => db.exec("UPDATE events SET kind = 'changed'")).toThrow(
        "append-only",
      );
      expect(() => db.exec("DELETE FROM events")).toThrow("append-only");
      expect(() => db.exec("UPDATE artifacts SET version = 8")).toThrow(
        "immutable",
      );
      expect(() => db.exec("DELETE FROM artifacts")).toThrow("immutable");
    } finally {
      db.close();
    }
  });

  it("keeps asymmetric immutable versions per path and rejects stale writers across connections", () => {
    const first = store.publish("writer-a", "reports/a.md", "old-a", 0);
    const other = new CollaborationStore(directory);
    try {
      const second = other.publish("writer-b", "reports/a.md", "new-a", 1);
      const unrelated = store.publish("writer-a", "reports/b.md", "only-b", 0);
      expect(second.version).toBe(2);
      expect(unrelated.version).toBe(1);
      expect(second.hash).not.toBe(first.hash);
      expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(store.artifact("reports/a.md", 1)).toEqual(first);
      expect(store.artifact("reports/a.md")).toEqual(second);
      expect(store.artifact("reports/b.md")).toEqual(unrelated);
      expect(store.artifact("reports/b.md", 2)).toBeUndefined();
      expect(store.artifact("missing")).toBeUndefined();
      expect(() => store.publish("stale", "reports/a.md", "bad", 1)).toThrow(
        "version conflict",
      );
      expect(() => store.publish("stale", "reports/a.md", "bad", 0)).toThrow(
        "version conflict",
      );
      expect(() => store.publish("stale", "missing", "bad", 1)).toThrow(
        "version conflict",
      );
      expect(store.events()).toHaveLength(3);
      expect(store.events()[1]).toMatchObject({
        kind: "artifact.published",
        agentId: "writer-b",
        data: {
          path: "reports/a.md",
          version: 2,
          previousVersion: 1,
          hash: second.hash,
        },
      });
      expect(readdirSync(join(directory, "blobs")).sort()).toEqual(
        [first.hash, second.hash, unrelated.hash].sort(),
      );
      expect(readdirSync(directory)).not.toContain("reports");
      store.close();
      store = new CollaborationStore(directory);
      expect(store.artifact("reports/a.md", 1)).toEqual(first);
      expect(store.artifact("reports/a.md")).toEqual(second);
    } finally {
      other.close();
    }
  });

  it("rolls metadata back when the publication event fails", () => {
    const db = new Database(join(directory, "collaboration.sqlite"));
    try {
      db.exec(
        "CREATE TRIGGER fail_publication BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'injected failure'); END",
      );
      expect(() =>
        store.publish("writer", "a.md", "orphan allowed", 0),
      ).toThrow("injected failure");
      expect(store.artifact("a.md")).toBeUndefined();
      expect(store.events()).toEqual([]);
      db.exec("DROP TRIGGER fail_publication");
      expect(store.publish("writer", "a.md", "orphan allowed", 0).version).toBe(
        1,
      );
    } finally {
      db.close();
    }
  });

  it.each([
    "",
    "/absolute",
    "../escape",
    "a/../b",
    "a/./b",
    "a//b",
    "a/",
    "C:/escape",
    "a\\b",
    "a\0b",
    "a\nb",
  ])("rejects unsafe logical path %j on read and write", (path) => {
    expect(() => store.publish("writer", path, "bad", 0)).toThrow(
      "Unsafe artifact path",
    );
    expect(() => store.artifact(path)).toThrow("Unsafe artifact path");
    expect(store.events()).toEqual([]);
    expect(readdirSync(join(directory, "blobs"))).toEqual([]);
  });

  it.each([-1, 0.5, NaN, Infinity])(
    "rejects invalid CAS version %s",
    (version) => {
      expect(() => store.publish("writer", "a", "bad", version)).toThrow(
        "Invalid expected artifact version",
      );
    },
  );

  it("exports paired Interaction inputs and only added targets without future leakage, with mandatory redaction", () => {
    const messages = [{ role: "user", content: "secret input" }];
    const start = store.append("decision.started", "alpha", {
      decisionId: "d1",
      messages,
      tools: [{ name: "publish", description: "secret tool" }],
      model: { id: "test-model" },
      taskId: "task-1",
      runId: "run-1",
      lineage: { parent: "secret parent" },
    });
    store.append("decision.started", "alpha", {
      decisionId: "incomplete",
      messages,
    });
    const answer = {
      role: "assistant",
      content: [
        { type: "reasoning", text: "PRIVATE THOUGHT" },
        { type: "text", text: "secret answer" },
      ],
    };
    const complete = store.append("decision.completed", "alpha", {
      decisionId: "d1",
      messages: [...messages, answer],
      output: "FUTURE OUTPUT",
      usage: { outputTokens: 20 },
    });
    store.append("message.received", "alpha", { content: "FUTURE INPUT" });
    store.append("decision.completed", "alpha", {
      decisionId: "orphan",
      messages: [answer],
    });
    store.append("decision.started", "beta", {
      decisionId: "d2",
      messages: [],
    });
    store.append("decision.completed", "beta", {
      decisionId: "d2",
      messages: [answer],
    });
    const exported = store.exportTraining({
      includeAgent: (id) => id === "alpha",
      redact: (sample) =>
        JSON.parse(JSON.stringify(sample).replaceAll("secret", "[redacted]")),
    });
    expect(exported.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(exported)).toEqual({
      decisionId: "d1",
      agentId: "alpha",
      input: {
        messages: [{ role: "user", content: "[redacted] input" }],
        tools: [{ name: "publish", description: "[redacted] tool" }],
        model: { id: "test-model" },
        taskId: "task-1",
        runId: "run-1",
        lineage: { parent: "[redacted] parent" },
      },
      target: [
        {
          role: "assistant",
          content: [{ type: "text", text: "[redacted] answer" }],
        },
      ],
      metadata: {
        startEventId: start.id,
        completedEventId: complete.id,
        taskId: "task-1",
        runId: "run-1",
        lineage: { parent: "[redacted] parent" },
      },
    });
    expect(exported).not.toMatch(/FUTURE|PRIVATE|secret|reasoning/);
    expect(store.exportTrace()).toContain("PRIVATE THOUGHT");
    expect(store.exportTrace()).toContain("secret input");
    // @ts-expect-error A redactor is mandatory, including at runtime.
    expect(() => store.exportTraining()).toThrow("explicit redactor");
    // @ts-expect-error No unsafe default policy.
    expect(() => store.exportTraining({})).toThrow("explicit redactor");
    expect(store.exportTraining({ redact: () => null })).toBe("");
    expect(
      store.exportTraining({ redact: (sample) => ({ ...sample, target: [] }) }),
    ).toBe("");
  });

  it("excludes rewritten histories, actor mismatches, duplicate starts, and targets without assistant content", () => {
    const original = [{ role: "user", content: "original" }];
    const cases = [
      [
        { role: "user", content: "rewritten" },
        { role: "assistant", content: "answer" },
      ],
      [
        ...original,
        {
          role: "assistant",
          content: [{ type: "reasoning", text: "private" }],
        },
      ],
      [...original, { role: "tool", content: "tool output" }],
      [...original, { role: "assistant", content: "   " }],
      [],
    ];
    for (const [index, messages] of cases.entries()) {
      store.append("decision.started", "a", {
        decisionId: String(index),
        messages: original,
      });
      store.append("decision.completed", "a", {
        decisionId: String(index),
        messages,
      });
    }
    store.append("decision.started", "a", {
      decisionId: "wrong-actor",
      messages: [],
    });
    store.append("decision.completed", "b", {
      decisionId: "wrong-actor",
      messages: [{ role: "assistant", content: "wrong" }],
    });
    store.append("decision.started", "a", {
      decisionId: "duplicate",
      messages: [],
    });
    store.append("decision.started", "a", {
      decisionId: "duplicate",
      messages: [],
    });
    store.append("decision.completed", "a", {
      decisionId: "duplicate",
      messages: [{ role: "assistant", content: "ambiguous" }],
    });
    expect(store.exportTraining({ redact: (value) => value })).toBe("");
  });

  it("pairs interleaved decisions by identity and exports tool-call targets once", () => {
    for (const decisionId of ["first", "second"])
      store.append("decision.started", "a", { decisionId, messages: [] });
    const target = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call",
            toolName: "publish",
            input: { path: "a" },
          },
        ],
      },
    ];
    for (const decisionId of ["second", "first", "first"])
      store.append("decision.completed", "a", { decisionId, messages: target });
    const rows = store
      .exportTraining({ redact: (value) => value })
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.map((row) => row.decisionId)).toEqual(["second", "first"]);
    expect(rows[0].target).toEqual(target);
  });
});
