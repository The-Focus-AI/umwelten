import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHabitatTranscriptReadPaths } from "./transcript-segments.js";
import { resolveHabitatSessionHandle } from "./resolve-habitat.js";
import { FileLearningsStore } from "./learnings-store.js";
import { compactHabitatTranscriptSegment } from "./compaction-habitat.js";
import {
  loadHabitatSessionTranscriptMessages,
  loadRecentHabitatTranscriptCoreMessages,
} from "./habitat-transcript-load.js";

describe("Habitat session record flow", () => {
  it("orders frozen segments then live transcript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "umwl-sess-"));
    try {
      await writeFile(join(dir, "transcript.2026-04-01T00-00-00.000Z.jsonl"), "a\n", "utf-8");
      await writeFile(join(dir, "transcript.2026-04-02T00-00-00.000Z.jsonl"), "b\n", "utf-8");
      await writeFile(join(dir, "transcript.jsonl"), "c\n", "utf-8");
      const paths = await listHabitatTranscriptReadPaths(dir);
      expect(paths.map((p) => p.split("/").pop())).toEqual([
        "transcript.2026-04-01T00-00-00.000Z.jsonl",
        "transcript.2026-04-02T00-00-00.000Z.jsonl",
        "transcript.jsonl",
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolveHabitatSessionHandle sets learningsRoot to sessionDir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "umwl-sess-"));
    try {
      await writeFile(join(dir, "transcript.jsonl"), "\n", "utf-8");
      const h = await resolveHabitatSessionHandle(dir);
      expect(h.source).toBe("habitat");
      expect(h.learningsRoot).toBe(dir);
      expect(h.transcriptReadPaths.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("compaction renames live and writes marker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "umwl-sess-"));
    try {
      await writeFile(join(dir, "transcript.jsonl"), '{"type":"user"}\n', "utf-8");
      const store = new FileLearningsStore(dir);
      await store.append("facts", { payload: { compacted: true } });

      const { frozenRelative } = await compactHabitatTranscriptSegment({
        sessionDir: dir,
        summary: "rolled up",
        runId: "run-1",
        learningCounts: { facts: 1 },
      });

      const live = await readFile(join(dir, "transcript.jsonl"), "utf-8");
      const ev = JSON.parse(live.trim());
      expect(ev.type).toBe("umwelten_compaction");
      expect(ev.summary).toBe("rolled up");
      expect(ev.predecessorSegment).toBe(frozenRelative);
      expect(ev.learningCounts?.facts).toBe(1);

      const frozen = await readFile(join(dir, frozenRelative), "utf-8");
      expect(frozen).toContain('"type":"user"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loadHabitatSessionTranscriptMessages merges segments and drops compaction markers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "umwl-sess-"));
    const user = (text: string) =>
      JSON.stringify({
        type: "user",
        message: { role: "user", content: text },
      });
    try {
      await writeFile(join(dir, "transcript.2026-04-01T00-00-00.000Z.jsonl"), `${user("a")}\n`, "utf-8");
      await writeFile(
        join(dir, "transcript.jsonl"),
        `${JSON.stringify({ type: "umwelten_compaction", summary: "x", schema: 1 })}\n${user("b")}\n`,
        "utf-8",
      );
      const messages = await loadHabitatSessionTranscriptMessages(dir);
      expect(messages).toHaveLength(2);
      expect((messages[0] as { message?: { content?: string } }).message?.content).toBe("a");
      expect((messages[1] as { message?: { content?: string } }).message?.content).toBe("b");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loadRecentHabitatTranscriptCoreMessages reads across frozen + live", async () => {
    const dir = await mkdtemp(join(tmpdir(), "umwl-sess-"));
    const user = (text: string) =>
      JSON.stringify({
        type: "user",
        message: { role: "user", content: text },
      });
    const asst = (text: string) =>
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: text },
      });
    try {
      await writeFile(
        join(dir, "transcript.2026-04-01T00-00-00.000Z.jsonl"),
        `${user("u1")}\n${asst("a1")}\n`,
        "utf-8",
      );
      await writeFile(join(dir, "transcript.jsonl"), `${user("u2")}\n${asst("a2")}\n`, "utf-8");
      const recent = await loadRecentHabitatTranscriptCoreMessages(dir, 4);
      expect(recent.map((m) => m.content)).toEqual(["u1", "a1", "u2", "a2"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
