/**
 * Refresh as an operation separate from starting (umwelten #276).
 *
 * The claim under test is a latency one: a warm volume must cost a start
 * nothing, no matter how many Mounted repos it carries. These tests assert it
 * on the plan, where it is checkable, rather than by timing a container.
 */

import { describe, expect, it } from "vitest";
import { planProvision } from "./plan.js";
import { COSTLY_STEP_KINDS } from "./types.js";
import type { HabitatConfig, AgentEntry } from "../types.js";
import type { ProvisionIntent, ProvisionPlan, VolumeState } from "./types.js";

const WORK = "/data";

function volume(overrides: Partial<VolumeState> = {}): VolumeState {
  return {
    configPresent: true,
    ownedRepoCloned: false,
    skillsLockPresent: false,
    volumeProvisioned: false,
    staleMarkerPresent: false,
    agents: {},
    ...overrides,
  };
}

function mounts(count: number): AgentEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `mount-${i}`,
    name: `mount-${i}`,
    projectPath: "",
    mode: "read" as const,
    gitRemote: `git@github.com:acme/mount-${i}.git`,
  }));
}

function allCloned(agents: AgentEntry[]): VolumeState["agents"] {
  return Object.fromEntries(agents.map((a) => [a.id, { repoCloned: true }]));
}

function plan(
  config: HabitatConfig,
  state: VolumeState,
  intent: ProvisionIntent,
): ProvisionPlan {
  return planProvision({ workDir: WORK, config, volume: state, intent });
}

/** The steps that shell out — the only ones a wake actually waits on. */
function costly(p: ProvisionPlan): string[] {
  return p.steps.filter((s) => COSTLY_STEP_KINDS.has(s.kind)).map((s) => s.kind);
}

const OWNED = "https://github.com/acme/ops.git";

describe("starting from a warm volume", () => {
  const agents = mounts(3);
  const config: HabitatConfig = {
    gitUrl: OWNED,
    agents,
    skillsFromGit: ["acme/skills"],
  };
  const warm = volume({
    ownedRepoCloned: true,
    volumeProvisioned: true,
    skillsLockPresent: true,
    agents: allCloned(agents),
  });

  it("does not pull, reinstall dependencies, or restore skills", () => {
    expect(costly(plan(config, warm, "start"))).toEqual([]);
  });

  it("does not grow with the number of Mounted repos", () => {
    const measure = (count: number) => {
      const many = mounts(count);
      return costly(
        plan(
          { gitUrl: OWNED, agents: many, skillsFromGit: ["acme/skills"] },
          volume({
            ownedRepoCloned: true,
            volumeProvisioned: true,
            skillsLockPresent: true,
            agents: allCloned(many),
          }),
          "start",
        ),
      ).length;
    };
    expect(measure(1)).toBe(0);
    expect(measure(40)).toBe(0);
  });

  it("still says what it found, so a flat start is not a silent one", () => {
    const messages = plan(config, warm, "start")
      .steps.filter((s) => s.kind === "log")
      .map((s) => s.message);
    expect(messages.some((m) => m.includes("3 mounted repo(s) already present"))).toBe(true);
  });
});

describe("starting from a cold volume", () => {
  const agents = mounts(2);
  const config: HabitatConfig = { gitUrl: OWNED, agents, skillsFromGit: ["acme/skills"] };

  it("still provisions fully", () => {
    const result = plan(config, volume(), "start");
    expect(result.mode).toBe("cold");
    expect(costly(result)).toEqual([
      "clone-owned-repo",
      "mise-install",
      "install-node-deps",
      "clone-agent-repo",
      "mise-install",
      "clone-agent-repo",
      "mise-install",
      "install-skills",
    ]);
  });

  it("treats a volume last provisioned by the pre-#276 entrypoint as cold", () => {
    // No `.provisioned` marker, but the repos are all there. The installs are
    // owed because nothing recorded that they ever ran.
    const result = plan(
      config,
      volume({ ownedRepoCloned: true, agents: allCloned(agents) }),
      "start",
    );
    expect(costly(result)).toContain("mise-install");
    expect(costly(result)).toContain("install-node-deps");
    expect(costly(result)).not.toContain("update-owned-repo");
  });

  it("clones only the mount added since last start", () => {
    const added = [...agents, ...mounts(3).slice(2)];
    const result = plan(
      { gitUrl: OWNED, agents: added, skillsFromGit: ["acme/skills"] },
      volume({
        ownedRepoCloned: true,
        volumeProvisioned: true,
        skillsLockPresent: true,
        agents: allCloned(agents),
      }),
      "start",
    );
    expect(result.newMounts).toEqual(["mount-2"]);
    expect(costly(result)).toEqual(["clone-agent-repo", "mise-install"]);
  });
});

describe("refreshing", () => {
  const agents = mounts(2);
  const config: HabitatConfig = { gitUrl: OWNED, agents, skillsFromGit: ["acme/skills"] };
  const warm = volume({
    ownedRepoCloned: true,
    volumeProvisioned: true,
    skillsLockPresent: true,
    agents: allCloned(agents),
  });

  it("updates the Owned repo, every Mounted repo, and dependencies", () => {
    const result = plan(config, warm, "refresh");
    expect(costly(result)).toEqual([
      "update-owned-repo",
      "mise-install",
      "install-node-deps",
      "update-agent-repo",
      "mise-install",
      "update-agent-repo",
      "mise-install",
      "restore-skills",
    ]);
  });

  it("pulls a Mounted repo under the same scoped env its clone used", () => {
    const scoped: AgentEntry = {
      id: "web",
      name: "web",
      projectPath: "",
      gitRemote: "git@github.com:acme/web.git",
      gitBranch: "trunk",
      secrets: ["DEPLOY_KEY"],
    };
    const result = plan(
      { gitUrl: OWNED, agents: [scoped] },
      volume({
        ownedRepoCloned: true,
        volumeProvisioned: true,
        agents: { web: { repoCloned: true } },
      }),
      "refresh",
    );
    const update = result.steps.find((s) => s.kind === "update-agent-repo");
    expect(update).toMatchObject({
      dir: "/data/agents/web/repo",
      branch: "trunk",
      envNames: ["DEPLOY_KEY"],
      onFailure: "warn",
    });
  });

  it("is idempotent — the same volume plans the same work twice", () => {
    const first = plan(config, warm, "refresh");
    const second = plan(config, warm, "refresh");
    expect(second.steps).toEqual(first.steps);
    // and nothing in it destroys state: every step is a pull, an install or a mark.
    expect(costly(first).every((k) => !k.startsWith("clone-"))).toBe(true);
  });

  it("clones a missing repo rather than trying to pull it", () => {
    const result = plan(
      config,
      volume({ volumeProvisioned: true, agents: allCloned(agents) }),
      "refresh",
    );
    expect(costly(result)).toContain("clone-owned-repo");
    expect(costly(result)).not.toContain("update-owned-repo");
  });
});

describe("the stale mark", () => {
  const agents = mounts(1);
  const config: HabitatConfig = { gitUrl: OWNED, agents, skillsFromGit: ["acme/skills"] };
  const stale = volume({
    ownedRepoCloned: true,
    volumeProvisioned: true,
    skillsLockPresent: true,
    staleMarkerPresent: true,
    agents: allCloned(agents),
  });

  it("promotes the next start to a refresh", () => {
    const result = plan(config, stale, "start");
    expect(result.intent).toBe("refresh");
    expect(result.promotedByStaleMark).toBe(true);
    expect(costly(result)).toContain("update-owned-repo");
    expect(costly(result)).toContain("update-agent-repo");
    expect(costly(result)).toContain("restore-skills");
  });

  it("clears the mark, last, after the refresh has run", () => {
    const steps = plan(config, stale, "start").steps;
    const clear = steps.filter((s) => s.kind === "clear-stale-mark");
    expect(clear).toHaveLength(1);
    expect(clear[0]).toMatchObject({ path: "/data/.needs-refresh" });
    expect(steps.at(-1)).toBe(clear[0]);
  });

  it("says why the start turned into a refresh", () => {
    const messages = plan(config, stale, "start")
      .steps.filter((s) => s.kind === "log")
      .map((s) => s.message);
    expect(messages[0]).toContain("Stale mark found");
  });

  it("leaves nothing to clear when the volume is not stale", () => {
    const clean = plan(config, { ...stale, staleMarkerPresent: false }, "start");
    expect(clean.promotedByStaleMark).toBe(false);
    expect(clean.steps.some((s) => s.kind === "clear-stale-mark")).toBe(false);
  });

  it("does not clear a mark on an explicit refresh it did not consume", () => {
    // Gaia asked directly; the mark is not this run's to clear, because a
    // concurrent wake may still be relying on it.
    const result = plan(config, stale, "refresh");
    expect(result.promotedByStaleMark).toBe(false);
    expect(result.steps.some((s) => s.kind === "clear-stale-mark")).toBe(false);
  });
});
