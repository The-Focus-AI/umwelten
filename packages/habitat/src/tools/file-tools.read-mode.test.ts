import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileTools, type FileToolsContext } from "./file-tools.js";
import type { AgentEntry, HabitatConfig } from "../types.js";
import { findReadOnlyAgentForPath } from "../config.js";

/**
 * Unit tests for the read-mode policy: write_file should refuse to write into
 * a `mode: "read"` agent's repo, both via the explicit agentId path and via
 * a path that resolves into the read-only root.
 */
describe("file-tools read-mode policy", () => {
  let tempDir: string;
  let workDir: string;
  let readAgentRoot: string;
  let writeAgentRoot: string;
  let agents: AgentEntry[];
  let config: HabitatConfig;
  let ctx: FileToolsContext;
  let tools: Record<string, any>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "file-tools-readmode-"));
    workDir = join(tempDir, "work");
    readAgentRoot = join(tempDir, "agents", "standards");
    writeAgentRoot = join(tempDir, "agents", "frontend");
    await mkdir(workDir, { recursive: true });
    await mkdir(readAgentRoot, { recursive: true });
    await mkdir(writeAgentRoot, { recursive: true });

    agents = [
      {
        id: "standards",
        name: "Standards",
        projectPath: readAgentRoot,
        kind: "repo",
        mode: "read",
      },
      {
        id: "frontend",
        name: "Frontend",
        projectPath: writeAgentRoot,
        kind: "repo",
        mode: "write",
      },
    ];
    config = { agents } as HabitatConfig;

    ctx = {
      getWorkDir: () => workDir,
      getSessionsDir: () => join(workDir, "sessions"),
      getConfig: () => config,
      getAgent: (id) => agents.find((a) => a.id === id || a.name === id),
      getAllowedRoots: () => [workDir, readAgentRoot, writeAgentRoot],
      findReadOnlyAgentForPath: (absPath) =>
        findReadOnlyAgentForPath(config, absPath),
    };

    tools = createFileTools(ctx);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects write_file with explicit read agentId", async () => {
    const result = await tools.write_file.execute({
      path: "STANDARDS.md",
      content: "should be blocked",
      agentId: "standards",
    });
    expect(result.error).toBe("READ_ONLY_AGENT");
    expect(result.agent).toBe("standards");
  });

  it("rejects write_file when path resolves into read-only agent root", async () => {
    const result = await tools.write_file.execute({
      path: join(readAgentRoot, "subdir", "file.md"),
      content: "blocked",
    });
    expect(result.error).toBe("READ_ONLY_AGENT");
    expect(result.agent).toBe("standards");
  });

  it("allows write_file into a write-mode agent", async () => {
    const result = await tools.write_file.execute({
      path: "OK.md",
      content: "fine",
      agentId: "frontend",
    });
    expect(result.written).toBe(true);
    const written = await readFile(join(writeAgentRoot, "OK.md"), "utf-8");
    expect(written).toBe("fine");
  });

  it("allows reads from a read-only agent", async () => {
    // Pre-write a file into the read-only agent (we own the disk in this test)
    const readPath = join(readAgentRoot, "DOC.md");
    await readFile(join(readAgentRoot)).catch(() => undefined);
    const fs = await import("node:fs/promises");
    await fs.writeFile(readPath, "hello");

    const result = await tools.read_file.execute({
      path: "DOC.md",
      agentId: "standards",
    });
    expect(result.content).toBe("hello");
  });
});
