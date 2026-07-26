import { describe, expect, it } from "vitest";
import { describePlan, normalizeAgents, planProvision } from "./plan.js";
import { readVolumeState } from "./volume-state.js";
import type { HabitatConfig } from "../types.js";
import type { ProvisionStep, VolumeState } from "./types.js";

const WORK = "/data";

function emptyVolume(overrides: Partial<VolumeState> = {}): VolumeState {
  return {
    configPresent: true,
    ownedRepoCloned: false,
    skillsLockPresent: false,
    agents: {},
    ...overrides,
  };
}

function config(overrides: Partial<HabitatConfig> = {}): HabitatConfig {
  return { agents: [], ...overrides };
}

function plan(cfg: HabitatConfig, volume: VolumeState) {
  return planProvision({ workDir: WORK, config: cfg, volume });
}

function kinds(steps: ProvisionStep[]): string[] {
  return steps.map((s) => s.kind);
}

function stepOfKind<K extends ProvisionStep["kind"]>(
  steps: ProvisionStep[],
  kind: K,
): Extract<ProvisionStep, { kind: K }> | undefined {
  return steps.find((s) => s.kind === kind) as
    | Extract<ProvisionStep, { kind: K }>
    | undefined;
}

describe("planProvision — volume states", () => {
  it("plans nothing at all when there is no config.json", () => {
    const result = plan(
      config({ gitUrl: "https://github.com/acme/ops.git" }),
      emptyVolume({ configPresent: false }),
    );
    expect(result.steps).toEqual([]);
    expect(result.mode).toBe("refresh");
  });

  it("cold volume: clones the owned repo and every declared mount", () => {
    const result = plan(
      config({
        gitUrl: "https://github.com/acme/ops.git",
        gitBranch: "main",
        agents: [
          { id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git", mode: "read" },
          { id: "api", name: "api", projectPath: "", gitRemote: "git@github.com:acme/api.git", mode: "read" },
        ],
      }),
      emptyVolume(),
    );

    expect(result.mode).toBe("cold");
    expect(result.newMounts).toEqual(["web", "api"]);
    expect(result.knownMounts).toEqual([]);
    expect(kinds(result.steps)).toEqual([
      "clone-owned-repo",
      "mise-install",
      "install-node-deps",
      "ensure-dir", // agents/
      "ensure-dir", // agents/web
      "clone-agent-repo",
      "mise-install",
      "mark-agent-provisioned",
      "ensure-dir", // agents/api
      "clone-agent-repo",
      "mise-install",
      "mark-agent-provisioned",
    ]);

    const clone = stepOfKind(result.steps, "clone-owned-repo");
    expect(clone).toMatchObject({
      dir: "/data/project",
      url: "https://github.com/acme/ops.git",
      branch: "main",
      onFailure: "abort",
    });
  });

  it("fully provisioned volume: fast-forwards, clones nothing", () => {
    const result = plan(
      config({
        gitUrl: "https://github.com/acme/ops.git",
        agents: [
          { id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git" },
        ],
      }),
      emptyVolume({
        ownedRepoCloned: true,
        agents: { web: { repoCloned: true } },
      }),
    );

    expect(result.mode).toBe("refresh");
    expect(result.newMounts).toEqual([]);
    expect(result.knownMounts).toEqual(["web"]);
    expect(kinds(result.steps)).not.toContain("clone-owned-repo");
    expect(kinds(result.steps)).not.toContain("clone-agent-repo");

    const update = stepOfKind(result.steps, "update-owned-repo");
    expect(update).toMatchObject({ dir: "/data/project", onFailure: "warn" });
  });

  it("partially provisioned volume: owned repo present, mount missing", () => {
    const result = plan(
      config({
        gitUrl: "https://github.com/acme/ops.git",
        agents: [
          { id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git" },
        ],
      }),
      emptyVolume({ ownedRepoCloned: true, agents: { web: { repoCloned: false } } }),
    );

    expect(result.mode).toBe("partial");
    expect(result.newMounts).toEqual(["web"]);
    expect(kinds(result.steps)).toContain("update-owned-repo");
    expect(kinds(result.steps)).toContain("clone-agent-repo");
  });

  it("mounts added since last start: only the new one is cloned", () => {
    const result = plan(
      config({
        gitUrl: "https://github.com/acme/ops.git",
        agents: [
          { id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git" },
          { id: "billing", name: "billing", projectPath: "", gitRemote: "git@github.com:acme/billing.git" },
        ],
      }),
      emptyVolume({
        ownedRepoCloned: true,
        agents: { web: { repoCloned: true } },
      }),
    );

    expect(result.mode).toBe("partial");
    expect(result.newMounts).toEqual(["billing"]);
    expect(result.knownMounts).toEqual(["web"]);

    const clones = result.steps.filter((s) => s.kind === "clone-agent-repo");
    expect(clones).toHaveLength(1);
    expect(clones[0]).toMatchObject({ agentId: "billing", dir: "/data/agents/billing/repo" });

    // The already-cloned mount is still re-installed and re-marked, exactly
    // as the shell did.
    expect(result.steps.some((s) => s.kind === "log" && s.message.includes("web already cloned"))).toBe(true);
    expect(
      result.steps.filter((s) => s.kind === "mark-agent-provisioned").map((s) => s.agentId),
    ).toEqual(["web", "billing"]);
  });

  it("a habitat with no owned repo is a refresh, not a cold start", () => {
    const result = plan(config(), emptyVolume());
    expect(result.mode).toBe("refresh");
    expect(result.ownedRepoDir).toBeUndefined();
    expect(kinds(result.steps)).toEqual(["mise-install", "install-node-deps", "ensure-dir"]);
  });
});

describe("planProvision — owned repo", () => {
  it("honours a custom projectDir", () => {
    const result = plan(
      config({ gitUrl: "https://example.com/r.git", projectDir: "checkout" }),
      emptyVolume(),
    );
    expect(result.ownedRepoDir).toBe("/data/checkout");
    expect(stepOfKind(result.steps, "clone-owned-repo")?.dir).toBe("/data/checkout");
  });

  it("guards toolchain and dependency installs on the files that trigger them", () => {
    const result = plan(config({ gitUrl: "https://example.com/r.git" }), emptyVolume());

    const mise = stepOfKind(result.steps, "mise-install");
    expect(mise?.condition).toEqual({
      dir: "/data/project",
      anyOf: ["mise.toml", ".mise.toml"],
    });
    expect(mise?.onFailure).toBe("abort");

    const deps = stepOfKind(result.steps, "install-node-deps");
    expect(deps?.condition).toEqual({ dir: "/data/project", anyOf: ["package.json"] });
    expect(deps?.miseWrap).toEqual({
      dir: "/data/project",
      anyOf: ["mise.toml", ".mise.toml"],
    });
    expect(deps?.onFailure).toBe("warn");
  });

  it("installs toolchain for a seeded project dir with no gitUrl", () => {
    const result = plan(config(), emptyVolume());
    expect(stepOfKind(result.steps, "mise-install")?.dir).toBe("/data/project");
  });
});

describe("planProvision — agents", () => {
  it("skips clones for agents that have no project on disk", () => {
    const result = plan(
      config({
        agents: [
          { id: "vault", name: "vault", projectPath: "", kind: "credential-only" },
          { id: "peer", name: "peer", projectPath: "", kind: "remote-habitat", a2aUrl: "http://x" },
        ],
      }),
      emptyVolume(),
    );

    expect(result.steps.filter((s) => s.kind === "clone-agent-repo")).toHaveLength(0);
    expect(result.steps.filter((s) => s.kind === "mark-agent-provisioned")).toHaveLength(0);
    const dirs = result.steps.filter((s) => s.kind === "ensure-dir");
    expect(dirs.map((s) => s.dir)).toEqual([
      "/data/agents",
      "/data/agents/vault",
      "/data/agents/peer",
    ]);
    expect(dirs[1]?.done).toContain("kind=credential-only");
  });

  it("skips a repo agent with no gitRemote but still makes its directory", () => {
    const result = plan(
      config({ agents: [{ id: "local", name: "local", projectPath: "/somewhere" }] }),
      emptyVolume(),
    );
    expect(result.steps.filter((s) => s.kind === "clone-agent-repo")).toHaveLength(0);
    const dir = result.steps.filter((s) => s.kind === "ensure-dir")[1];
    expect(dir?.done).toContain("has no gitRemote");
  });

  it("ignores agents with no id", () => {
    const result = plan(
      config({ agents: [{ id: "", name: "nameless", projectPath: "" }] }),
      emptyVolume(),
    );
    expect(kinds(result.steps)).toEqual(["mise-install", "install-node-deps", "ensure-dir"]);
  });

  it("carries the agent branch onto the clone step", () => {
    const result = plan(
      config({
        agents: [
          {
            id: "web",
            name: "web",
            projectPath: "",
            gitRemote: "git@github.com:acme/web.git",
            gitBranch: "release",
            mode: "read",
            kind: "repo",
          },
        ],
      }),
      emptyVolume(),
    );
    expect(stepOfKind(result.steps, "clone-agent-repo")).toMatchObject({
      branch: "release",
      agentMode: "read",
      agentKind: "repo",
    });
  });

  it("marks provisioning attempted even when the clone is allowed to fail", () => {
    const result = plan(
      config({
        agents: [{ id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git" }],
      }),
      emptyVolume(),
    );
    expect(stepOfKind(result.steps, "clone-agent-repo")?.onFailure).toBe("warn");
    expect(stepOfKind(result.steps, "mark-agent-provisioned")?.path).toBe(
      "/data/agents/web/.provisioned",
    );
  });
});

describe("normalizeAgents", () => {
  it("flattens scope env plus the legacy secrets alias, de-duplicated in order", () => {
    const [agent] = normalizeAgents([
      {
        id: "web",
        name: "web",
        projectPath: "",
        secrets: ["DEPLOY_KEY", "GITHUB_TOKEN"],
        identity: {
          principal: "web",
          scopes: [
            { kind: "git-read", env: ["GITHUB_TOKEN"] },
            { kind: "api-key", env: ["OPENAI_API_KEY"] },
            { kind: "ssh", env: [] },
          ],
        },
      },
    ]);
    expect(agent.envNames).toEqual(["GITHUB_TOKEN", "OPENAI_API_KEY", "DEPLOY_KEY"]);
  });

  it("defaults kind to repo and mode to write", () => {
    const [agent] = normalizeAgents([{ id: "web", name: "web", projectPath: "" }]);
    expect(agent).toMatchObject({ kind: "repo", mode: "write" });
  });
});

describe("planProvision — skills", () => {
  const withSkills = config({ skillsFromGit: ["acme/skills", "acme/more"] });

  it("restores from the lock when one is on the volume", () => {
    const result = plan(withSkills, emptyVolume({ skillsLockPresent: true }));
    expect(stepOfKind(result.steps, "restore-skills")?.dir).toBe(WORK);
    expect(result.steps.filter((s) => s.kind === "install-skills")).toHaveLength(0);
  });

  it("installs each source when there is no lock", () => {
    const result = plan(withSkills, emptyVolume());
    expect(
      result.steps.filter((s) => s.kind === "install-skills").map((s) => s.source),
    ).toEqual(["acme/skills", "acme/more"]);
    expect(result.steps.filter((s) => s.kind === "restore-skills")).toHaveLength(0);
  });

  it("plans no skills work when none are declared", () => {
    const result = plan(config({ skillsFromGit: [] }), emptyVolume({ skillsLockPresent: true }));
    expect(kinds(result.steps)).not.toContain("restore-skills");
    expect(kinds(result.steps)).not.toContain("install-skills");
  });
});

describe("describePlan", () => {
  it("summarises the decision without performing it", () => {
    const result = plan(
      config({
        gitUrl: "https://example.com/r.git",
        agents: [{ id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git" }],
      }),
      emptyVolume({ ownedRepoCloned: true, agents: { web: { repoCloned: false } } }),
    );
    const lines = describePlan(result);
    expect(lines[0]).toContain("mode=partial");
    expect(lines[0]).toContain("new=web");
    expect(lines.join("\n")).toContain("clone-agent-repo /data/agents/web/repo");
    expect(lines.join("\n")).toContain("(if mise.toml or .mise.toml)");
  });
});

describe("readVolumeState", () => {
  it("probes exactly the paths the decision depends on", async () => {
    const present = new Set([
      "/data/config.json",
      "/data/project/.git",
      "/data/agents/web/repo/.git",
    ]);
    const asked: string[] = [];
    const state = await readVolumeState({
      workDir: WORK,
      config: config({
        gitUrl: "https://example.com/r.git",
        agents: [
          { id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git" },
          { id: "api", name: "api", projectPath: "", gitRemote: "git@github.com:acme/api.git" },
        ],
      }),
      probe: {
        exists: async (path) => {
          asked.push(path);
          return present.has(path);
        },
      },
    });

    expect(state).toEqual({
      configPresent: true,
      ownedRepoCloned: true,
      skillsLockPresent: false,
      agents: { web: { repoCloned: true }, api: { repoCloned: false } },
    });
    expect(asked).toContain("/data/skills-lock.json");
    expect(asked).toContain("/data/agents/api/repo/.git");
  });

  it("reports an empty volume", async () => {
    const state = await readVolumeState({
      workDir: WORK,
      config: config({ gitUrl: "https://example.com/r.git" }),
      probe: { exists: async () => false },
    });
    expect(state).toEqual({
      configPresent: false,
      ownedRepoCloned: false,
      skillsLockPresent: false,
      agents: {},
    });
  });
});
