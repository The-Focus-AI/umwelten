import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { listSegments, WalKVStore } from "../src/index.ts";

test("handles multi-byte UTF-8 keys and values (emoji, CJK, accented) across reopen", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-utf8-"));
  try {
    const store = WalKVStore.open(dir);
    store.set("café", "crème brûlée");
    store.set("日本語-🔑", "こんにちは世界 🚀✨");
    store.set("normal", "after-utf8");
    store.delete("café");

    const reopened = WalKVStore.open(dir);
    assert.equal(reopened.get("café"), undefined);
    assert.equal(reopened.get("日本語-🔑"), "こんにちは世界 🚀✨");
    assert.equal(reopened.get("normal"), "after-utf8");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recovers valid prefix records when trailing WAL bytes are torn/corrupted and truncates cleanly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-torn-"));
  try {
    const s1 = WalKVStore.open(dir);
    s1.set("k1", "v1");
    s1.set("k2", "v2");

    // Simulate crash mid-record (partial garbage appended) + corrupt tail
    const segs = listSegments(dir);
    const active = segs[segs.length - 1];
    fs.appendFileSync(active, Buffer.from([1, 0, 0, 0, 99, 0, 0, 0, 50, 0, 0]));

    const s2 = WalKVStore.open(dir);
    assert.equal(s2.get("k1"), "v1");
    assert.equal(s2.get("k2"), "v2");

    // Subsequent writes after tail truncation must survive another reopen
    s2.set("k3", "v3");
    const s3 = WalKVStore.open(dir);
    assert.equal(s3.get("k1"), "v1");
    assert.equal(s3.get("k2"), "v2");
    assert.equal(s3.get("k3"), "v3");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("salvages valid prefix when trailing CRC byte is flipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-crc-"));
  try {
    const s1 = WalKVStore.open(dir);
    s1.set("good", "ok");
    s1.set("victim", "corrupt");

    const segs = listSegments(dir);
    const active = segs[segs.length - 1];
    const data = fs.readFileSync(active);
    data[data.length - 1] ^= 0xff; // Flip last CRC bit of second record
    fs.writeFileSync(active, data);

    const s2 = WalKVStore.open(dir);
    assert.equal(s2.get("good"), "ok");
    assert.equal(s2.get("victim"), undefined);

    s2.set("after-crc", "fresh");
    const s3 = WalKVStore.open(dir);
    assert.equal(s3.get("good"), "ok");
    assert.equal(s3.get("after-crc"), "fresh");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("partial compaction preserves tombstones when older uncompacted segments remain", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wal-compact-"));
  try {
    const store = WalKVStore.open(dir);
    store.set("ephemeral", "alive-in-seg-0");
    store.set("kept", "v1");

    store.rotateSegment();
    store.set("kept", "v2");

    store.rotateSegment();
    store.delete("ephemeral");

    // Keep oldest segment untouched, compact only newer segments
    store.compact({ keepOldest: 1 });

    const reopened = WalKVStore.open(dir);
    assert.equal(reopened.get("ephemeral"), undefined);
    assert.equal(reopened.get("kept"), "v2");
    assert.deepEqual(reopened.keys(), ["kept"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
