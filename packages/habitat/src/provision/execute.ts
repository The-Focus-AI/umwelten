/**
 * Execute a `ProvisionPlan`.
 *
 * Every command string here is the one `entrypoint.sh` ran, character for
 * character, including the `env -i` isolation on per-agent clones — that is
 * what makes "behaviour unchanged" (umwelten #269) a claim rather than a hope.
 * Effects go through injected deps so the command strings can be asserted
 * without git, mise, pnpm, or a network.
 */

import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { fileExists } from "../config.js";
import type { FileCondition, ProvisionPlan, ProvisionStep } from "./types.js";
import { join } from "node:path";

export interface ProvisionExecutorDeps {
  /** Resolve a `FileCondition` member. */
  exists(path: string): Promise<boolean>;
  /** Run a shell command; resolve `false` on a non-zero exit. */
  run(command: string, cwd: string): Promise<boolean>;
  /** `mkdir -p`. */
  ensureDir(path: string): Promise<void>;
  /** Truncate the `.provisioned` marker to mode 0600. */
  writeMarker(path: string): Promise<void>;
  /** Resolve a secret by name — the habitat vault, then process env. */
  secret(name: string): string | undefined;
  log(message: string): void;
}

export interface ProvisionResult {
  /** Steps that ran and succeeded, or whose condition excluded them. */
  ran: ProvisionStep[];
  /** Steps that failed under an `onFailure: "warn"` policy. */
  warned: ProvisionStep[];
  /** The `onFailure: "abort"` step that stopped the run, if any. */
  aborted?: ProvisionStep;
}

/** Wrap a value for a POSIX shell single-quoted context. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function conditionHolds(
  condition: FileCondition | undefined,
  deps: ProvisionExecutorDeps,
): Promise<boolean> {
  if (!condition) return true;
  for (const name of condition.anyOf) {
    if (await deps.exists(join(condition.dir, name))) return true;
  }
  return false;
}

/**
 * The command a step runs, or `null` for steps whose effect is not a shell
 * command (logs, mkdir, the provision marker). Exported for tests.
 */
export async function commandFor(
  step: ProvisionStep,
  deps: ProvisionExecutorDeps,
): Promise<{ command: string; cwd: string } | null> {
  switch (step.kind) {
    case "clone-owned-repo": {
      const branch = step.branch ? `--branch ${step.branch} ` : "";
      return { command: `git clone ${branch}"${step.url}" "${step.dir}"`, cwd: "." };
    }
    case "update-owned-repo":
      return {
        command: step.branch
          ? `git fetch origin ${step.branch} && git pull --ff-only origin ${step.branch}`
          : "git pull --ff-only",
        cwd: step.dir,
      };
    case "mise-install":
      return { command: "mise install", cwd: step.dir };
    case "install-node-deps": {
      const viaMise = await conditionHolds(step.miseWrap, deps);
      return {
        command: viaMise ? "mise exec -- pnpm install --prod" : "pnpm install --prod",
        cwd: step.dir,
      };
    }
    case "clone-agent-repo": {
      // Only this agent's declared env crosses into the clone. `env -i` drops
      // everything else — including the habitat's github token git config, so
      // one agent's credentials can never authenticate another's remote.
      const assignments = step.envNames
        .map((name) => {
          const value = deps.secret(name);
          return value ? ` ${name}=${shellQuote(value)}` : "";
        })
        .join("");
      const branch = step.branch ? `--branch ${step.branch} ` : "";
      // `$PATH` / `$HOME` are left for the shell running this command to
      // expand, so the clone keeps the container's toolchain and nothing else.
      return {
        command:
          `env -i PATH="$PATH" HOME="$HOME"${assignments} ` +
          `git clone ${branch}"${step.remote}" "${step.dir}"`,
        cwd: ".",
      };
    }
    case "restore-skills":
      return { command: "npx skills@latest experimental_install 2>&1", cwd: step.dir };
    case "install-skills":
      return {
        command: `npx skills@latest add "${step.source}" --all -y 2>&1`,
        cwd: step.dir,
      };
    default:
      return null;
  }
}

export async function executeProvisionPlan(
  plan: ProvisionPlan,
  deps: ProvisionExecutorDeps,
): Promise<ProvisionResult> {
  const result: ProvisionResult = { ran: [], warned: [] };

  for (const step of plan.steps) {
    if (!(await conditionHolds(step.condition, deps))) {
      result.ran.push(step);
      continue;
    }
    if (step.announce) deps.log(step.announce);

    let ok = true;
    if (step.kind === "log") {
      deps.log(step.message);
    } else if (step.kind === "ensure-dir") {
      await deps.ensureDir(step.dir);
    } else if (step.kind === "mark-agent-provisioned") {
      await deps.writeMarker(step.path);
    } else {
      const command = await commandFor(step, deps);
      if (command) ok = await deps.run(command.command, command.cwd);
    }

    if (ok) {
      result.ran.push(step);
      if (step.done) deps.log(step.done);
      continue;
    }

    if (step.onFailure === "abort") {
      result.aborted = step;
      return result;
    }
    result.warned.push(step);
    if (step.warning) deps.log(step.warning);
  }

  return result;
}

/** Real effects, for the container entrypoint. */
export function nodeExecutorDeps(
  secret: (name: string) => string | undefined,
): ProvisionExecutorDeps {
  return {
    exists: fileExists,
    ensureDir: async (path) => {
      await mkdir(path, { recursive: true });
    },
    writeMarker: async (path) => {
      await writeFile(path, "");
      await chmod(path, 0o600).catch(() => {});
    },
    secret,
    log: (message) => console.log(message),
    run: (command, cwd) =>
      new Promise<boolean>((resolve) => {
        const child = spawn("/bin/sh", ["-c", command], { cwd, stdio: "inherit" });
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
      }),
  };
}
