/**
 * Unit tests for the twitter-habitat config seeder (#155).
 *
 * The seeder (`twitter-habitat/seed-config.mjs`) is the one branching piece of
 * the deploy wrapper: it must point a habitat config at the seeded work-dir
 * assets WITHOUT clobbering whatever Gaia already wrote (name/provider/model/
 * secret bindings). We run the real script against temp files and assert the
 * externally observable result — the config.json on disk.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

const SEEDER = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "twitter-habitat",
  "seed-config.mjs",
);

async function seed(configPath: string) {
  await run("node", [SEEDER, configPath]);
}

describe("twitter-habitat seed-config.mjs", () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "twitter-seed-"));
    configPath = join(dir, "config.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a standalone config when none exists", async () => {
    await seed(configPath);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.name).toBe("Twitter");
    expect(config.toolsDir).toBe("tools");
    expect(config.stimulusFile).toBe("STIMULUS.md");
    expect(config.credentialMode).toBe("hybrid");
  });

  it("fills in toolsDir/stimulusFile without clobbering Gaia-seeded fields", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        name: "Twitter",
        defaultProvider: "openrouter",
        defaultModel: "openai/gpt-4o-mini",
        agents: [{ id: "x", name: "X" }],
      }),
    );
    await seed(configPath);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    // Added
    expect(config.toolsDir).toBe("tools");
    expect(config.stimulusFile).toBe("STIMULUS.md");
    // Preserved
    expect(config.defaultProvider).toBe("openrouter");
    expect(config.defaultModel).toBe("openai/gpt-4o-mini");
    expect(config.agents).toEqual([{ id: "x", name: "X" }]);
  });

  it("does not override an operator's explicit toolsDir/stimulusFile", async () => {
    await writeFile(
      configPath,
      JSON.stringify({
        name: "Twitter",
        toolsDir: "custom-tools",
        stimulusFile: "PERSONA.md",
        credentialMode: "per-user",
      }),
    );
    await seed(configPath);
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.toolsDir).toBe("custom-tools");
    expect(config.stimulusFile).toBe("PERSONA.md");
    expect(config.credentialMode).toBe("per-user");
  });

  it("is idempotent — a second run makes no further changes", async () => {
    await seed(configPath);
    const first = await readFile(configPath, "utf8");
    await seed(configPath);
    const second = await readFile(configPath, "utf8");
    expect(second).toBe(first);
  });
});
