import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inspectSkill, mergeRequirements } from "./skill-inspector.js";

describe("inspectSkill", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-inspect-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(rel: string, content: string): Promise<void> {
    const abs = join(dir, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, content);
  }

  it("returns empty requirements for an empty directory", async () => {
    const r = await inspectSkill(dir);
    expect(r.envVars).toEqual([]);
    expect(r.cliTools).toEqual([]);
    expect(r.sourceHash).toBeDefined();
  });

  it("discovers process.env references in TypeScript", async () => {
    await write("scripts/run.ts", `
      const key = process.env.GEMINI_API_KEY;
      const explicit = process.env["TAVILY_API_KEY"];
      console.log(process.env.HOME);  // noise, filtered
    `);
    const r = await inspectSkill(dir);
    const names = r.envVars.map(e => e.name).sort();
    expect(names).toContain("GEMINI_API_KEY");
    expect(names).toContain("TAVILY_API_KEY");
    expect(names).not.toContain("HOME");
  });

  it("discovers shell env vars and CLI invocations", async () => {
    await write("scripts/install.sh", [
      "#!/bin/sh",
      "set -e",
      "echo \"using ${GITHUB_TOKEN}\"",
      "curl -sSL https://example.com/install.sh | bash",
      "cargo build --release",
    ].join("\n"));
    const r = await inspectSkill(dir);
    expect(r.envVars.find(e => e.name === "GITHUB_TOKEN")).toBeDefined();
    expect(r.cliTools.find(c => c.name === "curl")).toBeDefined();
    expect(r.cliTools.find(c => c.name === "cargo")).toBeDefined();
    // builtins filtered
    expect(r.cliTools.find(c => c.name === "echo")).toBeUndefined();
    expect(r.cliTools.find(c => c.name === "set")).toBeUndefined();
  });

  it("discovers Python os.environ references", async () => {
    await write("scripts/main.py", `
      import os
      key = os.environ["OPENAI_API_KEY"]
      sec = os.getenv("ANTHROPIC_API_KEY")
    `);
    const r = await inspectSkill(dir);
    const names = r.envVars.map(e => e.name).sort();
    expect(names).toContain("OPENAI_API_KEY");
    expect(names).toContain("ANTHROPIC_API_KEY");
  });

  it("picks up vars declared in SKILL.md 'Required environment variables' section", async () => {
    await write("SKILL.md", [
      "# My Skill",
      "",
      "## Required environment variables",
      "",
      "- `MY_DECLARED_VAR` — used by the skill",
      "- ANOTHER_VAR — required",
      "",
      "## Other section",
      "",
      "- IGNORED_VAR — outside the env section",
    ].join("\n"));
    const r = await inspectSkill(dir);
    const names = r.envVars.map(e => e.name);
    expect(names).toContain("MY_DECLARED_VAR");
    expect(names).toContain("ANOTHER_VAR");
    expect(names).not.toContain("IGNORED_VAR");
  });

  it("hash is stable across runs", async () => {
    await write("scripts/run.ts", "const k = process.env.FOO_KEY;");
    const r1 = await inspectSkill(dir);
    const r2 = await inspectSkill(dir);
    expect(r1.sourceHash).toBe(r2.sourceHash);
  });
});

describe("mergeRequirements", () => {
  it("dedups by name and promotes required:true", () => {
    const merged = mergeRequirements([
      { envVars: [{ name: "A", reason: "from skill1", required: false }], cliTools: [] },
      { envVars: [{ name: "A", reason: "from skill2", required: true }], cliTools: [] },
    ]);
    expect(merged.envVars).toHaveLength(1);
    expect(merged.envVars[0].name).toBe("A");
    expect(merged.envVars[0].required).toBe(true);
  });
});
