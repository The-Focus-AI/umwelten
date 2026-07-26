/**
 * The provisioning decision (umwelten #269).
 *
 * `planProvision` is pure: given a habitat config and a snapshot of the
 * volume, it returns everything the boot intends to do without doing any of
 * it. `entrypoint.sh` used to make these decisions inline in shell, where
 * they could not be tested at a useful altitude and where wake time scaled
 * with mount count invisibly.
 *
 * Behaviour is deliberately identical to that shell, log lines included —
 * this is a prefactor. #276 (refresh as an operation separate from starting)
 * and #277 (checkout commit and age) hook in here.
 */

import { join } from "node:path";
import type { AgentEntry, HabitatConfig } from "../types.js";
import type {
  FileCondition,
  ProvisionMode,
  ProvisionPlan,
  ProvisionStep,
  VolumeState,
} from "./types.js";

/** Log prefix, kept as `[entrypoint]` so boot logs read the same as before. */
const LOG = "[entrypoint]";

/** Files that mark a directory as mise-managed. */
const MISE_CONFIGS = ["mise.toml", ".mise.toml"];

/** Agent kinds that have no project on disk and so are never cloned. */
const REPOLESS_KINDS = new Set(["credential-only", "remote-habitat"]);

export interface PlanProvisionInput {
  workDir: string;
  config: HabitatConfig;
  volume: VolumeState;
}

/** One agent's provisioning-relevant fields, defaulted the way the shell defaulted them. */
interface NormalizedAgent {
  id: string;
  kind: string;
  mode: string;
  gitRemote?: string;
  gitBranch?: string;
  /** Scope env names plus the legacy `secrets` alias, de-duplicated in declaration order. */
  envNames: string[];
}

/**
 * Mirror of the entrypoint's `list_agents` helper: same defaults, same env
 * flattening, same de-duplication, same "no id → skip" rule.
 */
export function normalizeAgents(agents: AgentEntry[] | undefined): NormalizedAgent[] {
  const out: NormalizedAgent[] = [];
  for (const agent of agents ?? []) {
    if (!agent?.id) continue;
    const names = [
      ...(agent.identity?.scopes ?? []).flatMap((scope) => scope.env ?? []),
      ...(agent.secrets ?? []),
    ];
    out.push({
      id: agent.id,
      kind: agent.kind || "repo",
      mode: agent.mode || "write",
      gitRemote: agent.gitRemote || undefined,
      gitBranch: agent.gitBranch || undefined,
      envNames: [...new Set(names)],
    });
  }
  return out;
}

function miseCondition(dir: string): FileCondition {
  return { dir, anyOf: MISE_CONFIGS };
}

/**
 * Classify the volume. "Declared" means every repo this config expects on
 * disk: the Owned repo plus each agent repo with a remote.
 */
function classify(declared: number, present: number): ProvisionMode {
  if (declared === 0 || present === declared) return "refresh";
  if (present === 0) return "cold";
  return "partial";
}

export function planProvision(input: PlanProvisionInput): ProvisionPlan {
  const { workDir, config, volume } = input;

  // No config.json → the entrypoint's whole provisioning block was skipped.
  if (!volume.configPresent) {
    return { mode: "refresh", workDir, newMounts: [], knownMounts: [], steps: [] };
  }

  const steps: ProvisionStep[] = [];
  const ownedRepoDir = join(workDir, config.projectDir ?? "project");
  const agentsDir = join(workDir, "agents");
  const agents = normalizeAgents(config.agents);

  // ── Owned repo ──────────────────────────────────────────────────────
  if (config.gitUrl && !volume.ownedRepoCloned) {
    steps.push({
      kind: "clone-owned-repo",
      dir: ownedRepoDir,
      url: config.gitUrl,
      branch: config.gitBranch,
      announce: `${LOG} Auto-provisioning from ${config.gitUrl}...`,
      done: `${LOG} Clone complete.`,
      onFailure: "abort",
    });
  } else if (config.gitUrl && volume.ownedRepoCloned) {
    // A restart should pick up new commits so "push to repo → rebuild" is the
    // whole deploy. Fast-forward only, and never fail the boot over it.
    steps.push({
      kind: "update-owned-repo",
      dir: ownedRepoDir,
      branch: config.gitBranch,
      announce: `${LOG} Updating ${ownedRepoDir} (git pull --ff-only)...`,
      onFailure: "warn",
      warning: `${LOG} Pull skipped (non-fast-forward or offline; keeping current checkout).`,
    });
  }

  // The project dir can exist without a gitUrl (a bind-mounted or seeded
  // volume), so toolchain and dependency installs are guarded on the files
  // rather than on having just cloned.
  steps.push({
    kind: "mise-install",
    dir: ownedRepoDir,
    scope: "owned",
    condition: miseCondition(ownedRepoDir),
    announce: `${LOG} Running mise install in ${ownedRepoDir}...`,
    done: `${LOG} mise install complete.`,
    onFailure: "abort",
  });
  // Prod deps only: dev deps aren't needed at runtime and their transitive
  // build scripts trip pnpm's ignored-builds error. Non-fatal — a failed
  // install degrades to tools-not-loaded, never a boot loop.
  steps.push({
    kind: "install-node-deps",
    dir: ownedRepoDir,
    miseWrap: miseCondition(ownedRepoDir),
    condition: { dir: ownedRepoDir, anyOf: ["package.json"] },
    announce: `${LOG} Installing project node deps (pnpm install --prod)...`,
    onFailure: "warn",
    warning: `${LOG} project pnpm install failed — repo tools may not load.`,
  });

  // ── Per-agent provisioning (Habitat Runtime spec) ───────────────────
  steps.push({ kind: "ensure-dir", dir: agentsDir, onFailure: "abort" });

  const newMounts: string[] = [];
  const knownMounts: string[] = [];

  for (const agent of agents) {
    const agentDir = join(agentsDir, agent.id);
    const agentRepo = join(agentDir, "repo");

    if (REPOLESS_KINDS.has(agent.kind)) {
      steps.push({
        kind: "ensure-dir",
        dir: agentDir,
        done: `${LOG} Skipping clone for ${agent.id} (kind=${agent.kind}).`,
        onFailure: "abort",
      });
      continue;
    }

    if (!agent.gitRemote) {
      steps.push({
        kind: "ensure-dir",
        dir: agentDir,
        done: `${LOG} Agent ${agent.id} has no gitRemote; skipping clone.`,
        onFailure: "abort",
      });
      continue;
    }

    if (volume.agents[agent.id]?.repoCloned) {
      knownMounts.push(agent.id);
      steps.push({
        kind: "log",
        message: `${LOG} Agent ${agent.id} already cloned.`,
        onFailure: "warn",
      });
    } else {
      newMounts.push(agent.id);
      steps.push({ kind: "ensure-dir", dir: agentDir, onFailure: "abort" });
      steps.push({
        kind: "clone-agent-repo",
        agentId: agent.id,
        dir: agentRepo,
        remote: agent.gitRemote,
        branch: agent.gitBranch,
        agentKind: agent.kind,
        agentMode: agent.mode,
        envNames: agent.envNames,
        announce: `${LOG} Cloning agent ${agent.id} (kind=${agent.kind}, mode=${agent.mode}) from ${agent.gitRemote}...`,
        onFailure: "warn",
        warning: `${LOG} Clone failed for agent ${agent.id} (continuing).`,
      });
    }

    steps.push({
      kind: "mise-install",
      dir: agentRepo,
      scope: "agent",
      agentId: agent.id,
      condition: miseCondition(agentRepo),
      announce: `${LOG} Running mise install for agent ${agent.id}...`,
      onFailure: "warn",
      warning: `${LOG} mise install failed for ${agent.id} (continuing).`,
    });

    // Written even when the clone failed — `provision_status` reports that
    // provisioning was attempted, not that it succeeded.
    steps.push({
      kind: "mark-agent-provisioned",
      agentId: agent.id,
      path: join(agentDir, ".provisioned"),
      onFailure: "abort",
    });
  }

  // ── Skills provisioning ─────────────────────────────────────────────
  const skillSources = Array.isArray(config.skillsFromGit) ? config.skillsFromGit : [];
  if (skillSources.length > 0) {
    if (volume.skillsLockPresent) {
      // Restoring from the lock skips a git clone for unchanged skills.
      steps.push({
        kind: "restore-skills",
        dir: workDir,
        announce: `${LOG} Restoring skills from skills-lock.json...`,
        done: `${LOG} Skills restore complete.`,
        onFailure: "warn",
        warning: `${LOG} Skills restore had warnings (non-fatal)`,
      });
    } else {
      steps.push({
        kind: "log",
        message: `${LOG} Installing skills from config.skillsFromGit...`,
        onFailure: "warn",
      });
      for (const source of skillSources) {
        if (!source) continue;
        steps.push({
          kind: "install-skills",
          dir: workDir,
          source,
          announce: `${LOG} Installing skills from ${source}...`,
          onFailure: "warn",
          warning: `${LOG} Skills install from ${source} had warnings (non-fatal)`,
        });
      }
      steps.push({
        kind: "log",
        message: `${LOG} Skills install complete.`,
        onFailure: "warn",
      });
    }
  }

  const declaredRepos =
    (config.gitUrl ? 1 : 0) +
    agents.filter((a) => !REPOLESS_KINDS.has(a.kind) && a.gitRemote).length;
  const presentRepos =
    (config.gitUrl && volume.ownedRepoCloned ? 1 : 0) + knownMounts.length;

  return {
    mode: classify(declaredRepos, presentRepos),
    workDir,
    ownedRepoDir: config.gitUrl ? ownedRepoDir : undefined,
    newMounts,
    knownMounts,
    steps,
  };
}

/** Render a plan as human-readable lines, for `--dry-run` and boot logging. */
export function describePlan(plan: ProvisionPlan): string[] {
  const lines = [
    `${LOG} provision plan: mode=${plan.mode}, steps=${plan.steps.length}` +
      (plan.newMounts.length ? `, new=${plan.newMounts.join(",")}` : "") +
      (plan.knownMounts.length ? `, present=${plan.knownMounts.join(",")}` : ""),
  ];
  for (const step of plan.steps) {
    if (step.kind === "log") continue;
    const target =
      "dir" in step && step.dir ? ` ${step.dir}` : "path" in step ? ` ${step.path}` : "";
    const guard = step.condition ? ` (if ${step.condition.anyOf.join(" or ")})` : "";
    lines.push(`${LOG}   - ${step.kind}${target}${guard}`);
  }
  return lines;
}
