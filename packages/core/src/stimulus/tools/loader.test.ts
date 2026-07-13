/**
 * Directory tool-loader guards. A tool directory registers ONLY when it has a
 * TOOL.md (front-matter name+description); a handler.ts alone is silently
 * skipped. That silent-skip shipped a Twitter tool that never registered
 * (handler present, importable, but absent from the tool list) — these tests
 * pin the contract so the next missing TOOL.md fails in CI, not in prod.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadToolsFromDirectory } from "./loader.js";

const HANDLER = `import { tool } from "ai";
import { z } from "zod";
export default () => tool({
  description: "x",
  inputSchema: z.object({}),
  execute: async () => ({ ok: true }),
});
`;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "loader-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeTool(name: string, opts: { md?: boolean }) {
  const dir = join(root, "tools", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "handler.ts"), HANDLER);
  if (opts.md) {
    await writeFile(
      join(dir, "TOOL.md"),
      `---\nname: ${name}\ndescription: "does a thing"\n---\nbody`,
    );
  }
}

describe("loadToolsFromDirectory", () => {
  it("registers a tool that has TOOL.md + handler.ts", async () => {
    await makeTool("with_md", { md: true });
    const tools = await loadToolsFromDirectory(root, "tools", {});
    expect(Object.keys(tools)).toContain("with_md");
    expect(typeof (tools.with_md as { execute?: unknown }).execute).toBe("function");
  });

  it("SILENTLY SKIPS a tool with handler.ts but no TOOL.md (the trap)", async () => {
    await makeTool("no_md", { md: false });
    const tools = await loadToolsFromDirectory(root, "tools", {});
    expect(Object.keys(tools)).not.toContain("no_md");
  });

  it("loads only the complete tools when a dir is mixed", async () => {
    await makeTool("good", { md: true });
    await makeTool("orphan", { md: false });
    const tools = await loadToolsFromDirectory(root, "tools", {});
    expect(Object.keys(tools).sort()).toEqual(["good"]);
  });
});
