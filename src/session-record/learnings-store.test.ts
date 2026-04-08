import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileLearningsStore } from "./learnings-store.js";

describe("FileLearningsStore", () => {
  it("appends and reads kind files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "umwl-learn-"));
    try {
      const store = new FileLearningsStore(dir);
      await store.append("facts", { payload: { text: "hello" } });
      await store.append("facts", { payload: { n: 2 } });
      const facts = await store.read("facts");
      expect(facts.length).toBe(2);
      expect(facts[0]!.payload).toEqual({ text: "hello" });
      expect(facts[1]!.payload).toEqual({ n: 2 });
      expect(facts[0]!.kind).toBe("facts");

      const playbook = await store.read("playbooks");
      expect(playbook).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("readAll returns five kinds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "umwl-learn-"));
    try {
      const store = new FileLearningsStore(dir);
      await store.append("mistakes", { payload: { x: 1 } });
      const all = await store.readAll();
      expect(all.mistakes.length).toBe(1);
      expect(all.facts.length).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
