import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { access, constants } from "node:fs/promises";

import { getClaudeProjectPath } from "../interaction/persistence/session-store.js";
import type { SessionHandle } from "./types.js";

function claudeLearningsSafeKey(projectPath: string, sessionUuid: string): string {
  return createHash("sha256")
    .update(`${projectPath}\0${sessionUuid}`, "utf-8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Claude Code: transcript is read-only under ~/.claude/projects/.../{uuid}.jsonl.
 * Learnings root is umwelten-owned under workDir.
 */
export async function resolveClaudeCodeSessionHandle(options: {
  workDir: string;
  projectPath: string;
  sessionUuid: string;
}): Promise<SessionHandle> {
  const { workDir, projectPath, sessionUuid } = options;
  const claudeDir = getClaudeProjectPath(projectPath);
  const transcriptPath = join(claudeDir, `${sessionUuid}.jsonl`);

  const safeKey = claudeLearningsSafeKey(projectPath, sessionUuid);
  const learningsRoot = join(
    workDir,
    ".umwelten",
    "learnings",
    "claude",
    safeKey,
  );
  await mkdir(learningsRoot, { recursive: true });

  const metaPath = join(learningsRoot, "meta.json");
  try {
    await access(metaPath, constants.R_OK);
  } catch {
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          claudeProjectPath: projectPath,
          claudeSessionUuid: sessionUuid,
          learningsRoot,
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
  }

  return {
    source: "claude-code",
    sessionKey: `claude-code:${safeKey}`,
    transcriptReadPaths: [transcriptPath],
    learningsRoot,
    workingDirectory: workDir,
    claudeProjectPath: projectPath,
    claudeSessionUuid: sessionUuid,
  };
}
