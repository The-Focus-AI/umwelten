import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WalKVStore } from "../src/index.ts";

test("basic ASCII writes, deletes, rotation, and full compaction survive reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-pub-"));
  try {
    const store = WalKVStore.open(dir);
    store.set("alpha", "one");
    store.set("beta", "two");
    store.rotateSegment();
    store.delete("alpha");
    store.set("gamma", "three");

    assert.equal(store.get("alpha"), undefined);
    assert.equal(store.get("beta"), "two");
    assert.equal(store.get("gamma"), "three");

    store.compact();
    const reopened = WalKVStore.open(dir);
    assert.equal(reopened.get("alpha"), undefined);
    assert.equal(reopened.get("beta"), "two");
    assert.equal(reopened.get("gamma"), "three");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
