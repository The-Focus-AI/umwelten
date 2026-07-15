/**
 * Contract tests for examples/help-habitat.
 *
 * Help is deployed by seeding example files onto a generic managed container,
 * so a typo in config or a stale prompt can otherwise reach production without
 * any TypeScript surface noticing. These assertions cover the effective
 * capability boundary and the product concepts most likely to drift.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Habitat } from "./habitat.js";
import { loadStimulusOptionsFromWorkDir } from "./load-prompts.js";
import {
  managedContainerToolSets,
  selectEnabledToolSets,
} from "./tool-sets.js";
import type { HabitatConfig } from "./types.js";

const HELP_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/help-habitat",
);

async function loadHelpConfig(): Promise<HabitatConfig> {
  return JSON.parse(
    await readFile(join(HELP_DIR, "config.json"), "utf8"),
  ) as HabitatConfig;
}

describe("help habitat setup", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("loads only the product-support tool sets", async () => {
    const config = await loadHelpConfig();
    expect(config.enabledToolSets).toEqual([
      "time",
      "remote-agents",
      "room-history",
    ]);
    expect(config.loadWorkDirTools).toBe(false);
    expect(config.loadSkills).toBe(false);
    expect(
      selectEnabledToolSets(
        managedContainerToolSets,
        config.enabledToolSets,
      ).map((toolSet) => toolSet.name),
    ).toEqual(["time", "remote-agents", "room-history"]);

    const workDir = await mkdtemp(join(tmpdir(), "help-habitat-"));
    tempDirs.push(workDir);
    await mkdir(join(workDir, "tools", "unexpected"), { recursive: true });
    await writeFile(
      join(workDir, "tools", "unexpected", "TOOL.md"),
      "---\nname: unexpected\ndescription: must not load\n---\n",
    );
    await mkdir(join(workDir, "skills", "unexpected"), { recursive: true });
    await writeFile(
      join(workDir, "skills", "unexpected", "SKILL.md"),
      "---\nname: unexpected\ndescription: must not load\n---\n",
    );
    const habitat = await Habitat.create({
      workDir,
      sessionsDir: join(workDir, "sessions"),
      config,
      toolSets: managedContainerToolSets,
    });

    const stimulus = await habitat.getStimulus();
    expect(Object.keys(stimulus.getTools()).sort()).toEqual([
      "ask_remote_agent",
      "current_time",
      "room_history",
    ]);
    expect(Object.keys(stimulus.getTools())).not.toContain("exec");
    expect(Object.keys(stimulus.getTools())).not.toContain("write_file");
    expect(Object.keys(stimulus.getTools())).not.toContain("set_secret");
    expect(Object.keys(stimulus.getTools())).not.toContain("unexpected");
    expect(Object.keys(stimulus.getTools())).not.toContain("skill");
  });

  it("fails loudly when an enabled ToolSet name is wrong", () => {
    expect(() =>
      selectEnabledToolSets(managedContainerToolSets, ["time", "gaia-status"]),
    ).toThrow(/Unknown enabledToolSets: gaia-status/);
  });

  it("loads current room, thread, attachment, and agent-service guidance", async () => {
    const config = await loadHelpConfig();
    const options = await loadStimulusOptionsFromWorkDir(HELP_DIR, config);
    const instructions = options.instructions?.join("\n") ?? "";

    expect(options.role).toBe("product support guide");
    expect(options.maxToolSteps).toBe(4);
    expect(instructions).toContain(
      "Use ask_remote_agent only for read-only operational facts from Gaia",
    );
    expect(instructions).toContain("Never ask Gaia to create, start, stop");

    expect(options.systemContext).toContain(
      "separate conversation for every side thread",
    );
    expect(options.systemContext).toMatch(
      /Attaching does not create or deploy the\s+service/,
    );
    expect(options.systemContext).toContain("**+ Umwelten agent**");
    expect(options.systemContext).toContain(
      "Do not promise that an arbitrary MCP-only server can be attached",
    );
    expect(options.systemContext).toContain("**owners and admins**");
    expect(options.systemContext).toContain(
      "not a self-service agent builder in the current website",
    );
    expect(options.systemContext).toContain("## CHANGELOG.md");
    expect(options.systemContext).toContain("## 2026-07-15");
  });
});
