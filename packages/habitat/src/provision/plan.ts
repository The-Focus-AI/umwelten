/**
 * The provisioning decision (umwelten #269, #276).
 *
 * `planProvision` is pure: given a habitat config, an intent, and a snapshot
 * of the volume, it returns everything the run intends to do without doing any
 * of it. `entrypoint.sh` used to make these decisions inline in shell, where
 * they could not be tested at a useful altitude and where wake time scaled
 * with mount count invisibly.
 *
 * Two intents (#276):
 *
 *  - **start** is the boot path and must stay cheap. On a warm volume it
 *    plans no git, no installs and no skills work at all; on a cold one it
 *    provisions fully. A mount added since the last start is cold *for that
 *    mount* and nothing else.
 *  - **refresh** is the explicitly triggered operation: pull the Owned repo
 *    and every Mounted repo, reinstall dependencies, re-restore skills.
 *
 * A Dormant habitat has no process to ask, so Gaia leaves a stale mark on its
 * volume; a `start` that finds one promotes itself to a `refresh` and clears
 * the mark once the work has actually run.
 */

import { join } from "node:path";
import type { AgentEntry, HabitatConfig } from "../types.js";
import { provisionedMarkerPath, staleMarkerPath } from "./stale.js";
import type {
  FileCondition,
  ProvisionIntent,
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
  /** Defaults to `start` — the boot path. */
  intent?: ProvisionIntent;
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
  const { workDir, config, volume, intent = "start" } = input;

  // No config.json → the entrypoint's whole provisioning block was skipped.
  if (!volume.configPresent) {
    return {
      mode: "refresh",
      intent,
      promotedByStaleMark: false,
      workDir,
      newMounts: [],
      knownMounts: [],
      steps: [],
    };
  }

  // A start that finds the stale mark does the refresh the mark was asking
  // for. This is the only way a Dormant habitat's refresh ever happens.
  const promotedByStaleMark = intent === "start" && volume.staleMarkerPresent;
  const effective: ProvisionIntent = promotedByStaleMark ? "refresh" : intent;
  const refreshing = effective === "refresh";

  const steps: ProvisionStep[] = [];
  const ownedRepoDir = join(workDir, config.projectDir ?? "project");
  const agentsDir = join(workDir, "agents");
  const agents = normalizeAgents(config.agents);

  if (promotedByStaleMark) {
    steps.push({
      kind: "log",
      message: `${LOG} Stale mark found — refreshing before serving.`,
      onFailure: "warn",
    });
  }

  // ── Owned repo ──────────────────────────────────────────────────────
  const cloningOwned = Boolean(config.gitUrl) && !volume.ownedRepoCloned;
  if (cloningOwned && config.gitUrl) {
    steps.push({
      kind: "clone-owned-repo",
      dir: ownedRepoDir,
      url: config.gitUrl,
      branch: config.gitBranch,
      announce: `${LOG} Auto-provisioning from ${config.gitUrl}...`,
      done: `${LOG} Clone complete.`,
      onFailure: "abort",
    });
  } else if (config.gitUrl && refreshing) {
    // Fast-forward only, and never fail the run over it. Starting no longer
    // pulls (#276) — "push to repo → up to date" is now a refresh, dispatched
    // by the webhook hub rather than paid for on every wake.
    steps.push({
      kind: "update-owned-repo",
      dir: ownedRepoDir,
      branch: config.gitBranch,
      announce: `${LOG} Updating ${ownedRepoDir} (git pull --ff-only)...`,
      onFailure: "warn",
      // Names no cause. The step cannot tell a diverged branch from an expired
      // credential, and guessing produced a message that read as "nothing
      // changed" while auth had been failing for hours — git's own error is
      // already on stdout, so point at it instead of paraphrasing it wrong.
      warning: `${LOG} Pull FAILED for ${ownedRepoDir} — keeping current checkout, which is now STALE. See the git error above.`,
    });
  }

  // Installs are the expensive half. A warm volume already has them, so a
  // start skips them entirely; a cold volume and every refresh pay in full.
  // The project dir can exist without a gitUrl (a bind-mounted or seeded
  // volume), so the work is guarded on the files rather than on having cloned.
  if (refreshing || !volume.volumeProvisioned) {
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
  }

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

    const cloned = Boolean(volume.agents[agent.id]?.repoCloned);
    if (cloned) {
      knownMounts.push(agent.id);
    } else {
      newMounts.push(agent.id);
    }

    // A present mount costs a start nothing — no clone, no pull, no install.
    // This is the whole point of #276: wake latency must not scale with the
    // number of Mounted repos, and the rollup habitat has the most of them.
    if (cloned && !refreshing) continue;

    if (!cloned) {
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
        // Name the likely cause. Under an installation token git reports a
        // repo outside the installation as `could not read Username for
        // 'https://github.com'` — which reads like a missing prompt, not a
        // missing grant, and sends people looking at credentials instead of
        // at the App's repo list. Declaring read scope in Gaia does not
        // install the App; those are two separate grants and only one of
        // them is ours.
        warning:
          `${LOG} Clone failed for agent ${agent.id} from ${agent.gitRemote} (continuing without it).\n` +
          `${LOG}   If git said "could not read Username", the @habitats GitHub App is probably not installed on that repo.\n` +
          `${LOG}   Gaia's read scope and the App's installation are separate grants — declaring the scope does not add the repo to the App.`,
      });
    } else {
      steps.push({
        kind: "update-agent-repo",
        agentId: agent.id,
        dir: agentRepo,
        branch: agent.gitBranch,
        envNames: agent.envNames,
        announce: `${LOG} Updating agent ${agent.id} (git pull --ff-only)...`,
        onFailure: "warn",
        warning: `${LOG} Pull FAILED for agent ${agent.id} — keeping current checkout, which is now STALE. See the git error above.`,
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

  if (!refreshing && knownMounts.length > 0) {
    steps.push({
      kind: "log",
      message: `${LOG} ${knownMounts.length} mounted repo(s) already present; not refreshed on start.`,
      onFailure: "warn",
    });
  }

  // ── Skills provisioning ─────────────────────────────────────────────
  const skillSources = Array.isArray(config.skillsFromGit) ? config.skillsFromGit : [];
  if (skillSources.length > 0) {
    if (volume.skillsLockPresent) {
      // The lock plus the installed skills are already on the volume, so a
      // start needs nothing; a refresh re-restores in case the lock moved.
      if (refreshing) {
        steps.push({
          kind: "restore-skills",
          dir: workDir,
          announce: `${LOG} Restoring skills from skills-lock.json...`,
          done: `${LOG} Skills restore complete.`,
          onFailure: "warn",
          warning: `${LOG} Skills restore had warnings (non-fatal)`,
        });
      }
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

  // ── Marks ───────────────────────────────────────────────────────────
  if (refreshing || !volume.volumeProvisioned) {
    steps.push({
      kind: "mark-volume-provisioned",
      path: provisionedMarkerPath(workDir),
      onFailure: "warn",
      warning: `${LOG} Could not write the provisioned marker — the next start will provision again.`,
    });
  }
  // Cleared last, and only after the refresh it asked for has actually run.
  if (promotedByStaleMark) {
    steps.push({
      kind: "clear-stale-mark",
      path: staleMarkerPath(workDir),
      done: `${LOG} Stale mark cleared.`,
      onFailure: "warn",
      warning: `${LOG} Could not clear the stale mark — the next start will refresh again.`,
    });
  }

  const declaredRepos =
    (config.gitUrl ? 1 : 0) +
    agents.filter((a) => !REPOLESS_KINDS.has(a.kind) && a.gitRemote).length;
  const presentRepos =
    (config.gitUrl && volume.ownedRepoCloned ? 1 : 0) + knownMounts.length;

  return {
    mode: classify(declaredRepos, presentRepos),
    intent: effective,
    promotedByStaleMark,
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
    `${LOG} provision plan: intent=${plan.intent}, mode=${plan.mode}, steps=${plan.steps.length}` +
      (plan.promotedByStaleMark ? " (promoted by stale mark)" : "") +
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
