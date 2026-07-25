import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FissionStore } from "./store.js";
import { FissionTree } from "./tree.js";
import type { TurnRecord } from "../types.js";

const MODEL = { name: "test-model", provider: "test" };

let dir: string;
let store: FissionStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fission-store-"));
  store = new FissionStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function turnFor(tree: FissionTree, overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    id: overrides.id ?? "turn-1",
    treeId: tree.id,
    nodeId: tree.data.rootId,
    arrivedAtNodeId: tree.data.rootId,
    index: 0,
    timestamp: new Date().toISOString(),
    userText: "how does prefix caching work?",
    assistantText: "it matches the longest common token prefix",
    toolCalls: [],
    shadowDetectors: [],
    contextTokensBefore: 120,
    contextTokensAfter: 60,
    wallMs: 42,
    ...overrides,
  };
}

describe("FissionStore", () => {
  it("returns an empty list when nothing has been stored", async () => {
    expect(await store.listTreeIds()).toEqual([]);
    expect(await store.listTrees()).toEqual([]);
  });

  it("round-trips a tree and its turns", async () => {
    const tree = FissionTree.create({ model: MODEL, title: "Round trip" });
    const child = tree.fork({ parentId: tree.data.rootId, title: "Child" });
    tree.addTurn(turnFor(tree));
    tree.addTurn(turnFor(tree, { id: "turn-2", nodeId: child.id }));

    await store.saveAll(tree);
    const loaded = await store.load(tree.id);

    expect(loaded.data.title).toBe("Round trip");
    expect(Object.keys(loaded.data.nodes)).toHaveLength(2);
    expect(loaded.allTurns().map((t) => t.id).sort()).toEqual(["turn-1", "turn-2"]);
    expect(loaded.nodeTurns(child.id)).toHaveLength(1);
    expect(loaded.stats().turnCount).toBe(2);
  });

  it("appends turns without rewriting the log", async () => {
    const tree = FissionTree.create({ model: MODEL });
    await store.saveTree(tree);
    await store.appendTurn(tree.id, turnFor(tree, { id: "a" }));
    await store.appendTurn(tree.id, turnFor(tree, { id: "b" }));

    const turns = await store.loadTurns(tree.id);
    expect(turns.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("tolerates a torn final line from an interrupted append", async () => {
    const tree = FissionTree.create({ model: MODEL });
    await store.saveTree(tree);
    await store.appendTurn(tree.id, turnFor(tree, { id: "good" }));
    await writeFile(join(dir, tree.id, "turns.jsonl"), '{"id":"good"}\n{"id":"tor', {
      flag: "w",
    });

    const turns = await store.loadTurns(tree.id);
    expect(turns.map((t) => t.id)).toEqual(["good"]);
  });

  it("round-trips a node's live messages", async () => {
    const tree = FissionTree.create({ model: MODEL });
    await store.saveTree(tree);
    const messages = [
      { role: "system", content: "prompt" },
      { role: "user", content: "hi" },
    ];
    await store.saveNodeMessages(tree.id, tree.data.rootId, messages);
    expect(await store.loadNodeMessages(tree.id, tree.data.rootId)).toEqual(messages);
  });

  it("returns undefined for messages that were never saved", async () => {
    const tree = FissionTree.create({ model: MODEL });
    await store.saveTree(tree);
    expect(await store.loadNodeMessages(tree.id, "missing-node")).toBeUndefined();
  });

  it("skips a directory whose tree.json is unreadable rather than failing the index", async () => {
    const good = FissionTree.create({ model: MODEL, title: "Good" });
    await store.saveTree(good);
    await mkdir(join(dir, "broken"), { recursive: true });
    await writeFile(join(dir, "broken", "tree.json"), "{ not json", "utf8");

    const trees = await store.listTrees();
    expect(trees.map((t) => t.title)).toEqual(["Good"]);
  });

  it("lists trees newest-updated first", async () => {
    const older = FissionTree.create({ model: MODEL, title: "Older" });
    older.data.updatedAt = "2020-01-01T00:00:00.000Z";
    const newer = FissionTree.create({ model: MODEL, title: "Newer" });
    newer.data.updatedAt = "2030-01-01T00:00:00.000Z";
    await store.saveTree(older);
    await store.saveTree(newer);

    expect((await store.listTrees()).map((t) => t.title)).toEqual(["Newer", "Older"]);
  });
});
