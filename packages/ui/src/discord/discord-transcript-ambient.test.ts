import { describe, it, expect } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { transcriptJsonlHasAssistant } from "./discord-transcript-ambient.js";

describe("transcriptJsonlHasAssistant", () => {
  it("returns false when file missing", async () => {
    const dir = join(tmpdir(), `disc-tr-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      expect(await transcriptJsonlHasAssistant(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns false for user-only transcript", async () => {
    const dir = join(tmpdir(), `disc-tr-${Date.now()}-b`);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(
        join(dir, "transcript.jsonl"),
        '{"type":"user","message":{"role":"user","content":"hi"}}\n',
        "utf-8",
      );
      expect(await transcriptJsonlHasAssistant(dir)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns true when an assistant row exists", async () => {
    const dir = join(tmpdir(), `disc-tr-${Date.now()}-c`);
    await mkdir(dir, { recursive: true });
    try {
      await writeFile(
        join(dir, "transcript.jsonl"),
        '{"type":"user","message":{"role":"user","content":"hi"}}\n{"type":"assistant","message":{"role":"assistant","content":"hello"}}\n',
        "utf-8",
      );
      expect(await transcriptJsonlHasAssistant(dir)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
