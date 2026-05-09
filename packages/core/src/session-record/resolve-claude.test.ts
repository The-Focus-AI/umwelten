import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants } from "node:fs";
import { resolveClaudeCodeSessionHandle } from "./resolve-claude.js";
import { getClaudeProjectPath } from "../interaction/persistence/session-store.js";

describe("resolveClaudeCodeSessionHandle", () => {
  it("creates umwelten learnings root and meta; transcript path under Claude projects dir", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "umwl-claude-"));
    try {
      const projectPath = join(workDir, "sample-project");
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      const h = await resolveClaudeCodeSessionHandle({
        workDir,
        projectPath,
        sessionUuid: uuid,
      });

      expect(h.source).toBe("claude-code");
      expect(h.claudeSessionUuid).toBe(uuid);
      expect(h.learningsRoot).toContain(join(".umwelten", "learnings", "claude"));
      await access(join(h.learningsRoot, "meta.json"), constants.R_OK);
      const meta = JSON.parse(
        await readFile(join(h.learningsRoot, "meta.json"), "utf-8"),
      ) as { claudeSessionUuid: string };
      expect(meta.claudeSessionUuid).toBe(uuid);

      const expectedTranscript = join(getClaudeProjectPath(projectPath), `${uuid}.jsonl`);
      expect(h.transcriptReadPaths).toEqual([expectedTranscript]);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
