import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { refreshRepositories } from "./repository-freshness.js";
import { ChannelBridge } from "./bridge/channel-bridge.js";
import { Interaction } from "@umwelten/core/interaction/core/interaction.js";
import { Stimulus } from "@umwelten/core/stimulus/stimulus.js";
import type { AgentHost } from "./types.js";
import { Habitat } from "./habitat.js";

let root: string, source: string, remote: string, project: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
const config = () => ({ agents: [], gitUrl: remote });
async function advance() {
  await writeFile(join(source, "README.md"), "fresh context");
  git(source, "add", ".");
  git(source, "commit", "-m", "advance");
  git(source, "push", remote, "main");
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "freshness-"));
  source = join(root, "source");
  remote = join(root, "remote.git");
  project = join(root, "project");
  await mkdir(source);
  git(source, "init", "-b", "main");
  await writeFile(join(source, "README.md"), "old context");
  git(source, "add", ".");
  git(source, "commit", "-m", "initial");
  git(root, "clone", "--bare", source, remote);
  git(root, "clone", remote, project);
  vi.stubEnv("GAIA_URL", "https://gaia.invalid");
  vi.stubEnv("HABITAT_API_KEY", "child-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: "read-secret",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        ),
    ),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

it("refreshes owned and mounted repos, renews read credentials and skips unchanged HEAD", async () => {
  const mounted = join(root, "mounted");
  git(root, "clone", remote, mounted);
  await advance();
  const cfg = {
    ...config(),
    agents: [
      {
        id: "mounted",
        name: "Mounted",
        projectPath: mounted,
        gitRemote: remote,
      },
    ],
  };
  expect(await refreshRepositories(root, cfg)).toBe(true);
  expect(await readFile(join(mounted, "README.md"), "utf8")).toBe(
    "fresh context",
  );
  expect(await refreshRepositories(root, cfg)).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
    body: '{"kind":"read"}',
    headers: { authorization: "Bearer child-secret" },
  });
});

it("resolves relative git-backed mounts from workDir, canonicalizes aliases, and ignores local directory agents", async () => {
  const mounted = join(root, "agents", "client-a", "repo");
  await mkdir(join(root, "agents", "client-a"), { recursive: true });
  git(root, "clone", remote, mounted);
  await symlink(mounted, join(root, "alias"));
  await mkdir(join(root, "local-directory"));
  const agents = [
    {
      id: "client-a",
      name: "Client A",
      projectPath: "agents/client-a/repo",
      gitRemote: remote,
    },
    {
      id: "client-alias",
      name: "Alias",
      projectPath: "alias",
      gitRemote: remote,
    },
    { id: "local", name: "Local", projectPath: "local-directory" },
  ];
  await advance();
  expect(await refreshRepositories(root, { agents })).toBe(true);
  expect(await readFile(join(mounted, "README.md"), "utf8")).toBe(
    "fresh context",
  );
  expect(await readFile(join(project, "README.md"), "utf8")).toBe(
    "old context",
  );
  // A symlink alias must not evade conflicting-branch detection.
  await expect(
    refreshRepositories(root, {
      agents: [agents[0], { ...agents[1], gitBranch: "feature" }],
    }),
  ).rejects.toThrow(
    "Repository freshness blocked [client-alias]: conflicting branch declaration with [client-a]",
  );
  await writeFile(join(mounted, "local.txt"), "preserve");
  await expect(refreshRepositories(root, { agents })).rejects.toThrow(
    "Repository freshness blocked [client-a]: dirty worktree",
  );
  vi.mocked(fetch).mockClear();
  expect(await refreshRepositories(root, { agents: [agents[2]] })).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it("reloads the real Habitat disk prompt without losing non-disk options, installed skills or tools", async () => {
  await writeFile(
    join(project, "STIMULUS.md"),
    "---\nobjective: obsolete goal\n---\nold disk context",
  );
  const habitat = await Habitat.create({
    workDir: root,
    config: config(),
    skipBuiltinTools: true,
    skipSkills: true,
  });
  const previous = await habitat.getStimulus();
  expect(previous.options.objective).toBe("obsolete goal");
  expect(previous.getPrompt()).toContain("old disk context");
  previous.options.temperature = 0.25;
  previous.options.maxTokens = 1234;
  previous.options.toolInstructions = ["keep tool guidance"];
  const registry = previous.getOrCreateSkillsRegistry();
  registry.addSkills([
    {
      name: "installed",
      description: "installed capability",
      instructions: "retained instructions",
      path: root,
    },
  ]);
  previous.addSkillsTool();
  const tool = previous.getTools().skill;
  registry.activateSkill("installed");
  const loadSkills = vi.spyOn(Stimulus.prototype, "loadSkills");
  await writeFile(
    join(project, "STIMULUS.md"),
    "---\nrole: refreshed assistant\n---\nnew disk context",
  );
  await habitat.refreshDiskStimulus();
  const refreshed = await habitat.getStimulus();
  expect(refreshed.getPrompt()).toContain("new disk context");
  expect(refreshed.getPrompt()).not.toMatch(/old disk context|obsolete goal/);
  expect(refreshed.options.objective).toBeUndefined();
  expect(refreshed.options).toMatchObject({
    temperature: 0.25,
    maxTokens: 1234,
    toolInstructions: ["keep tool guidance"],
  });
  expect(refreshed.getSkillsRegistry()).toBe(registry);
  expect(refreshed.getSkillsRegistry()?.activateSkill("installed")).toBe(
    "retained instructions",
  );
  expect(refreshed.getPrompt()).toContain("installed capability");
  expect(refreshed.getTools().skill).toBe(tool);
  expect(loadSkills).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["dirty", "diverged", "branch", "auth", "expired", "offline"])(
  "blocks generation and preserves work on %s",
  async (state) => {
    await advance();
    if (state === "dirty")
      await writeFile(join(project, "local.txt"), "preserve");
    if (state === "diverged") {
      await writeFile(join(project, "local.txt"), "preserve");
      git(project, "add", ".");
      git(project, "commit", "-m", "local");
    }
    if (state === "branch") git(project, "checkout", "-b", "feature");
    if (state === "auth")
      vi.mocked(fetch).mockRejectedValue(new Error("read-secret child-secret"));
    if (state === "expired")
      vi.mocked(fetch).mockResolvedValue(
        new Response(
          JSON.stringify({ token: "read-secret", expiresAt: "2000-01-01" }),
        ),
      );
    if (state === "offline")
      git(project, "remote", "set-url", "origin", join(root, "missing.git"));
    const before = git(project, "rev-parse", "HEAD");
    const stream = vi.spyOn(Interaction.prototype, "streamText");
    const error = vi.fn();
    const bridge = new ChannelBridge({ workDir: root } as AgentHost, {
      beforeGeneration: () => refreshRepositories(root, config()),
    });
    await bridge.handleMessage(
      { channelKey: "web:test", text: "hello" },
      { onDone: vi.fn(), onError: error },
    );
    expect(stream).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain("Repository freshness blocked");
    expect(error.mock.calls[0][0]).toContain("[owned]");
    expect(error.mock.calls[0][0]).not.toMatch(/read-secret|child-secret/);
    expect(git(project, "rev-parse", "HEAD")).toBe(before);
    if (state === "dirty" || state === "diverged")
      expect(await readFile(join(project, "local.txt"), "utf8")).toBe(
        "preserve",
      );
  },
);

it("refreshes cached context before generation while preserving history, and policy-off does not fetch", async () => {
  const prompts: string[] = [];
  const histories: number[] = [];
  vi.spyOn(Interaction.prototype, "streamText").mockImplementation(
    async function (this: Interaction) {
      prompts.push(this.getStimulus().getPrompt());
      histories.push(
        this.getMessages().filter((m) => m.role === "user").length,
      );
      return { content: "reply" } as Awaited<
        ReturnType<Interaction["streamText"]>
      >;
    },
  );
  const host = {
    workDir: root,
    getDefaultModelDetails: () => ({ name: "test", provider: "test" }),
    getStimulus: async () =>
      new Stimulus({
        role: await readFile(join(project, "README.md"), "utf8"),
      }),
    getOrCreateSession: async () => {
      const sessionDir = join(root, "sessions");
      await mkdir(sessionDir, { recursive: true });
      return { sessionId: "one", sessionDir };
    },
    updateSessionMetadata: async () => {},
  } as unknown as AgentHost;
  const error = vi.fn();
  const events = { onDone: vi.fn(), onError: error };
  const bridge = new ChannelBridge(host, {
    beforeGeneration: () => refreshRepositories(root, config()),
  });
  await bridge.handleMessage({ channelKey: "web:test", text: "first" }, events);
  await advance();
  await bridge.handleMessage(
    { channelKey: "web:test", text: "second" },
    events,
  );
  expect(error).not.toHaveBeenCalled();
  expect(prompts[0]).toContain("old context");
  expect(prompts[1]).toContain("fresh context");
  expect(histories).toEqual([1, 2]);
  vi.mocked(fetch).mockClear();
  await new ChannelBridge(host).handleMessage(
    { channelKey: "web:off", text: "off" },
    events,
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("serializes refresh and the entire generation across channels", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const order: string[] = [];
  const host = {
    workDir: root,
    getAgent: () => ({ id: "agent", projectPath: project }),
    getOrCreateSession: async () => ({ sessionId: "one", sessionDir: root }),
  } as unknown as AgentHost;
  await writeFile(
    join(root, "routing.json"),
    JSON.stringify({
      channels: {
        "web:a": { agentId: "agent", runtime: "pi" },
        "web:b": { agentId: "agent", runtime: "pi" },
      },
    }),
  );
  const bridge = new ChannelBridge(host, {
    beforeGeneration: async () => {
      order.push("refresh");
      return false;
    },
    runtimeRunners: {
      pi: {
        run: async () => {
          order.push("start");
          await barrier;
          order.push("end");
          return { content: "ok", success: true, errors: [] };
        },
      },
    },
  });
  const error = vi.fn();
  const first = bridge.handleMessage(
    { channelKey: "web:a", text: "one" },
    { onDone: () => {}, onError: error },
  );
  await vi.waitFor(() => expect(order).toEqual(["refresh", "start"]));
  const second = bridge.handleMessage(
    { channelKey: "web:b", text: "two" },
    { onDone: () => {}, onError: error },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(order).toEqual(["refresh", "start"]);
  release();
  await Promise.all([first, second]);
  expect(error).not.toHaveBeenCalled();
  expect(order).toEqual(["refresh", "start", "end", "refresh", "start", "end"]);
});

it("does not refresh or generate a waiting turn canceled while another turn is active", async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = vi.fn(async () => {
    await barrier;
    return { content: "ok", success: true, errors: [] };
  });
  const host = {
    workDir: root,
    getAgent: () => ({ id: "agent", projectPath: project }),
    getOrCreateSession: async () => ({ sessionId: "one", sessionDir: root }),
  } as unknown as AgentHost;
  await writeFile(
    join(root, "routing.json"),
    JSON.stringify({
      defaultAgentId: "agent",
      channels: {
        "web:a": { agentId: "agent", runtime: "pi" },
        "web:b": { agentId: "agent", runtime: "pi" },
      },
    }),
  );
  const preflight = vi.fn(() => refreshRepositories(root, config()));
  const bridge = new ChannelBridge(host, {
    beforeGeneration: preflight,
    runtimeRunners: { pi: { run } },
  });
  const error = vi.fn();
  const first = bridge.handleMessage(
    { channelKey: "web:a", text: "one" },
    { onDone: () => {}, onError: error },
  );
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
  const controller = new AbortController();
  const done = vi.fn();
  const second = bridge.handleMessage(
    { channelKey: "web:b", text: "two" },
    { onDone: done, onError: error },
    controller.signal,
  );
  controller.abort();
  release();
  await Promise.all([first, second]);
  expect(preflight).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(run).toHaveBeenCalledOnce();
  expect(done).not.toHaveBeenCalled();
  expect(error).not.toHaveBeenCalled();
});
