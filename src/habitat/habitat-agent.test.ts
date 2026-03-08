import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Habitat } from "./habitat.js";
import { HabitatAgent } from "./habitat-agent.js";

describe("HabitatAgent", () => {
  let tempDir: string;
  let workDir: string;
  let sessionsDir: string;
  let agentProjectDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "habitat-agent-test-"));
    workDir = join(tempDir, "work");
    sessionsDir = join(tempDir, "sessions");
    agentProjectDir = join(tempDir, "agent-project");

    await mkdir(workDir, { recursive: true });
    await mkdir(sessionsDir, { recursive: true });
    await mkdir(agentProjectDir, { recursive: true });
    await writeFile(join(agentProjectDir, "README.md"), "# Test Agent\n", "utf-8");
    await writeFile(
      join(agentProjectDir, "run.sh"),
      "#!/bin/bash\nbin/do-work\n",
      "utf-8",
    );
    await writeFile(
      join(agentProjectDir, "setup.sh"),
      "#!/bin/bash\nclaude -p \"setup\"\n",
      "utf-8",
    );
    await mkdir(join(agentProjectDir, "bin"), { recursive: true });
    await writeFile(
      join(agentProjectDir, "bin", "do-work"),
      "#!/bin/bash\nmagick input output\n",
      "utf-8",
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("gives sub-agents host-side file tools and host-first instructions", async () => {
    const habitat = await Habitat.create({
      workDir,
      sessionsDir,
      config: {
        agents: [],
        defaultProvider: "google",
        defaultModel: "gemini-3-flash-preview",
      },
      skipSkills: true,
    });

    await habitat.addAgent({
      id: "test-agent",
      name: "Test Agent",
      projectPath: agentProjectDir,
    });
    await habitat.ensureAgentDir("test-agent");
    await writeFile(
      join(habitat.getAgentDir("test-agent"), "MEMORY.md"),
      "# Test Agent MEMORY\n\n- run: ./run.sh\n",
      "utf-8",
    );

    const agentEntry = habitat.getAgent("test-agent");
    expect(agentEntry).toBeDefined();

    const habitatAgent = await HabitatAgent.create(habitat, agentEntry!);
    const stimulus = habitatAgent.getInteraction().getStimulus();
    const tools = stimulus.getTools();

    expect(tools.read_file).toBeDefined();
    expect(tools.write_file).toBeDefined();
    expect(tools.list_directory).toBeDefined();
    expect(tools.ripgrep).toBeDefined();
    expect(stimulus.instructions).toContain(
      "Prefer host-side file tools first when inspecting the repo. Do not use bridge tools unless the user explicitly asks for an isolated runtime or host-side inspection is insufficient.",
    );
    expect(stimulus.instructions).toContain(
      "When asked how the project runs or what it needs, inspect the actual runnable entrypoints first (for example run.sh, setup.sh, start.sh, Makefile targets, Dockerfile, and bin/* scripts) and follow the scripts they invoke. Do not rely only on README or package manifests.",
    );
    expect(stimulus.instructions).toContain(
      "Ignore incidental mentions in reports/, notes, or research documents unless those files are part of the actual runnable path.",
    );
    expect(stimulus.getPrompt()).toContain("# run.sh");
    expect(stimulus.getPrompt()).toContain("# setup.sh");
    expect(stimulus.getPrompt()).toContain("# bin/");
    expect(stimulus.getPrompt()).toContain("# bin/do-work");
    expect(stimulus.getPrompt()).toContain("# MEMORY.md");
    expect(stimulus.getPrompt()).toContain("magick input output");
  });

  it("loads MEMORY.md from the agent memoryPath when configured", async () => {
    const habitat = await Habitat.create({
      workDir,
      sessionsDir,
      config: {
        agents: [],
        defaultProvider: "google",
        defaultModel: "gemini-3-flash-preview",
      },
      skipSkills: true,
    });

    const memoryPath = join(agentProjectDir, "MEMORY.md");
    await writeFile(memoryPath, "# Local Memory\n\n- run: ./run.sh\n", "utf-8");

    await habitat.addAgent({
      id: "local-agent",
      name: "Local Agent",
      projectPath: agentProjectDir,
      memoryPath,
    });

    const agentEntry = habitat.getAgent("local-agent");
    expect(agentEntry).toBeDefined();

    const habitatAgent = await HabitatAgent.create(habitat, agentEntry!);
    const prompt = habitatAgent.getInteraction().getStimulus().getPrompt();

    expect(prompt).toContain("# MEMORY.md");
    expect(prompt).toContain("# Local Memory");
  });
});
