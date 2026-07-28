/**
 * Provisioning decision types.
 *
 * A `ProvisionPlan` is a complete, side-effect-free description of the work
 * `entrypoint.sh` used to inline: cloning or updating the Owned repo,
 * installing its toolchain and dependencies, cloning each declared agent repo,
 * and restoring skills. Planning is separated from execution so the decision
 * — cold start or refresh, and what actually needs doing given the volume's
 * state — is testable without Docker, git, or the network.
 *
 * See ADR 0006 for the Owned/Mounted repo split and umwelten #269.
 */

/**
 * Why the provisioner was invoked (#276).
 *
 * `start` is the boot path and must stay cheap: it does the minimum needed to
 * serve requests, which on a warm volume is nothing at all. `refresh` is the
 * explicitly triggered operation that pulls, reinstalls and re-restores.
 * Keeping them apart is what stops wake latency from scaling with mount count.
 */
export type ProvisionIntent = "start" | "refresh";

/** How much of the declared environment is already on the volume. */
export type ProvisionMode =
  /** Nothing declared has been provisioned yet — a brand-new volume. */
  | "cold"
  /** Some declared repos are present and some are not (e.g. a mount added since last start). */
  | "partial"
  /** Everything declared is already on the volume; this run only refreshes it. */
  | "refresh";

/**
 * A file test the executor evaluates immediately before running a step.
 *
 * Some decisions genuinely cannot be made up front: whether a repo has a
 * `mise.toml` is only knowable after it has been cloned. Rather than pretend
 * otherwise, the plan carries the condition and the executor resolves it —
 * which is exactly what the shell did with its `[ -f ... ]` guards.
 */
export interface FileCondition {
  /** Absolute directory the paths below are relative to. */
  dir: string;
  /** The condition holds when at least one of these exists under `dir`. */
  anyOf: string[];
}

/** What happens when a step's command exits non-zero. */
export type FailurePolicy =
  /** Abort provisioning — the shell's `set -e` behaviour. */
  | "abort"
  /** Log `warning` and carry on — the shell's `|| echo ...` behaviour. */
  | "warn";

interface StepBase {
  /** Logged before the step runs. */
  announce?: string;
  /** Logged after the step succeeds. */
  done?: string;
  /** Skip the step unless this holds at execution time. */
  condition?: FileCondition;
  onFailure: FailurePolicy;
  /** Logged when the step fails under an `onFailure: "warn"` policy. */
  warning?: string;
}

/** A message with no side effect — keeps the plan a complete account of the boot log. */
export interface LogStep extends StepBase {
  kind: "log";
  message: string;
}

/** `mkdir -p <dir>`. */
export interface EnsureDirStep extends StepBase {
  kind: "ensure-dir";
  dir: string;
}

/** First clone of the Owned repo into the project directory. */
export interface CloneOwnedRepoStep extends StepBase {
  kind: "clone-owned-repo";
  dir: string;
  url: string;
  branch?: string;
}

/** Fast-forward an Owned repo that is already on the volume. */
export interface UpdateOwnedRepoStep extends StepBase {
  kind: "update-owned-repo";
  dir: string;
  branch?: string;
}

/** `mise install` in a repo that declares a mise config. */
export interface MiseInstallStep extends StepBase {
  kind: "mise-install";
  dir: string;
  scope: "owned" | "agent";
  agentId?: string;
}

/** `pnpm install --prod` for a repo that has a package.json. */
export interface InstallNodeDepsStep extends StepBase {
  kind: "install-node-deps";
  dir: string;
  /** When this holds, the install runs under `mise exec --`. */
  miseWrap: FileCondition;
}

/** Clone one agent's repo with only that agent's scoped env exported. */
export interface CloneAgentRepoStep extends StepBase {
  kind: "clone-agent-repo";
  agentId: string;
  /** Absolute destination — `<workDir>/agents/<id>/repo`. */
  dir: string;
  remote: string;
  branch?: string;
  /** Agent kind and mode, for the boot log. */
  agentKind: string;
  agentMode: string;
  /**
   * Env var names the clone may see, resolved to values at execution time.
   * Nothing outside this list crosses into the clone's environment.
   */
  envNames: string[];
}

/** Fast-forward one agent's repo, under the same scoped env as its clone. */
export interface UpdateAgentRepoStep extends StepBase {
  kind: "update-agent-repo";
  agentId: string;
  dir: string;
  branch?: string;
  envNames: string[];
}

/** Write the `.provisioned` marker `provision_status` reads. */
export interface MarkAgentProvisionedStep extends StepBase {
  kind: "mark-agent-provisioned";
  agentId: string;
  path: string;
}

/**
 * Write the volume-level `.provisioned` marker. Its absence is what tells a
 * later `start` that the volume is cold and owes a full provision.
 */
export interface MarkVolumeProvisionedStep extends StepBase {
  kind: "mark-volume-provisioned";
  path: string;
}

/** Remove the stale mark once the refresh it asked for has actually run. */
export interface ClearStaleMarkStep extends StepBase {
  kind: "clear-stale-mark";
  path: string;
}

/** Restore skills from an existing `skills-lock.json`. */
export interface RestoreSkillsStep extends StepBase {
  kind: "restore-skills";
  dir: string;
}

/** Install skills from one `config.skillsFromGit` source. */
export interface InstallSkillsStep extends StepBase {
  kind: "install-skills";
  dir: string;
  source: string;
}

export type ProvisionStep =
  | LogStep
  | EnsureDirStep
  | CloneOwnedRepoStep
  | UpdateOwnedRepoStep
  | MiseInstallStep
  | InstallNodeDepsStep
  | CloneAgentRepoStep
  | UpdateAgentRepoStep
  | MarkAgentProvisionedStep
  | MarkVolumeProvisionedStep
  | ClearStaleMarkStep
  | RestoreSkillsStep
  | InstallSkillsStep;

/** Step kinds that shell out. These are what wake latency is made of. */
export const COSTLY_STEP_KINDS = new Set<ProvisionStep["kind"]>([
  "clone-owned-repo",
  "update-owned-repo",
  "mise-install",
  "install-node-deps",
  "clone-agent-repo",
  "update-agent-repo",
  "restore-skills",
  "install-skills",
]);

/** What one declared agent looks like on disk right now. */
export interface AgentVolumeState {
  /** `<workDir>/agents/<id>/repo/.git` exists. */
  repoCloned: boolean;
}

/**
 * The volume as the planner sees it. Everything the decision depends on and
 * nothing else, so tests can describe a volume as a literal.
 */
export interface VolumeState {
  /** `<workDir>/config.json` exists. Without it the entrypoint provisions nothing. */
  configPresent: boolean;
  /** `<projectDir>/.git` exists — the Owned repo has been cloned. */
  ownedRepoCloned: boolean;
  /** `<workDir>/skills-lock.json` exists — skills restore rather than install. */
  skillsLockPresent: boolean;
  /**
   * `<workDir>/.provisioned` exists — this volume has been fully provisioned
   * at least once, so a `start` owes it nothing. A volume last touched by the
   * pre-#276 entrypoint has no marker and is correctly treated as cold.
   */
  volumeProvisioned: boolean;
  /**
   * `<workDir>/.needs-refresh` exists — Gaia marked this habitat stale while
   * it was Dormant. The next start upgrades itself to a refresh.
   */
  staleMarkerPresent: boolean;
  /** Keyed by agent id. Agents absent from the map are treated as unprovisioned. */
  agents: Record<string, AgentVolumeState>;
}

/** The decision: what this boot intends to do, and why. */
export interface ProvisionPlan {
  mode: ProvisionMode;
  /** The intent actually planned for — a stale `start` is promoted to `refresh`. */
  intent: ProvisionIntent;
  /** True when a `start` was promoted because the volume carried the stale mark. */
  promotedByStaleMark: boolean;
  workDir: string;
  /** Absolute project directory, when the habitat declares an Owned repo. */
  ownedRepoDir?: string;
  /** Agent ids whose repos will be cloned this run — mounts added since last start. */
  newMounts: string[];
  /** Agent ids whose repos are already on the volume. */
  knownMounts: string[];
  steps: ProvisionStep[];
}
