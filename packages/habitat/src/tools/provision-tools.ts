/**
 * Provisioning tools for reproducible habitat setup.
 * Handles git clone, mise install, dependency installation, and secret declarations.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { HabitatConfig, RequiredSecret } from "../types.js";
import { resolveProjectDir, saveConfig, fileExists } from "../config.js";

const execFileAsync = promisify(execFile);

export interface ProvisionToolsContext {
  getWorkDir(): string;
  getConfig(): HabitatConfig;
  getConfigPath(): string;
  reloadConfig(): Promise<void>;
}

async function exec(
  command: string,
  cwd: string,
  timeout = 300000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
      cwd,
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
    return { stdout: stdout || "", stderr: stderr || "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: typeof err.code === "number" ? err.code : (err.status ?? 1),
    };
  }
}

async function detectAndInstallDeps(projectDir: string): Promise<string[]> {
  const steps: string[] = [];

  // Check for mise.toml and run mise install
  if (await fileExists(join(projectDir, "mise.toml"))) {
    const result = await exec("mise install", projectDir);
    if (result.exitCode === 0) {
      steps.push("mise install: success");
    } else {
      steps.push(`mise install: failed (${result.stderr.trim()})`);
    }
  } else if (await fileExists(join(projectDir, ".mise.toml"))) {
    const result = await exec("mise install", projectDir);
    if (result.exitCode === 0) {
      steps.push("mise install: success");
    } else {
      steps.push(`mise install: failed (${result.stderr.trim()})`);
    }
  }

  // Detect package manager and install dependencies
  if (await fileExists(join(projectDir, "pnpm-lock.yaml"))) {
    const result = await exec("pnpm install --frozen-lockfile", projectDir);
    steps.push(
      result.exitCode === 0
        ? "pnpm install: success"
        : `pnpm install: failed (${result.stderr.trim()})`,
    );
  } else if (await fileExists(join(projectDir, "package-lock.json"))) {
    const result = await exec("npm ci", projectDir);
    steps.push(
      result.exitCode === 0
        ? "npm ci: success"
        : `npm ci: failed (${result.stderr.trim()})`,
    );
  } else if (await fileExists(join(projectDir, "yarn.lock"))) {
    const result = await exec("yarn install --frozen-lockfile", projectDir);
    steps.push(
      result.exitCode === 0
        ? "yarn install: success"
        : `yarn install: failed (${result.stderr.trim()})`,
    );
  } else if (await fileExists(join(projectDir, "package.json"))) {
    const result = await exec("npm install", projectDir);
    steps.push(
      result.exitCode === 0
        ? "npm install: success"
        : `npm install: failed (${result.stderr.trim()})`,
    );
  }

  // Python
  if (await fileExists(join(projectDir, "requirements.txt"))) {
    const result = await exec("pip install -r requirements.txt", projectDir);
    steps.push(
      result.exitCode === 0
        ? "pip install: success"
        : `pip install: failed (${result.stderr.trim()})`,
    );
  }

  return steps;
}

export function createProvisionTools(
  ctx: ProvisionToolsContext,
): Record<string, Tool> {
  const provisionFromGit = tool({
    description:
      "Clone a git repository into the project directory and install dependencies. Sets up the habitat for reproducible operation. Runs: git clone → mise install → package install.",
    inputSchema: z.object({
      url: z
        .string()
        .describe("Git URL to clone (https or ssh)"),
      branch: z
        .string()
        .optional()
        .describe("Branch to check out (default: main)"),
    }),
    execute: async ({ url, branch }) => {
      const workDir = ctx.getWorkDir();
      const config = ctx.getConfig();
      const projectDir = resolveProjectDir(workDir, config);

      // Check if already cloned
      if (await fileExists(join(projectDir, ".git"))) {
        return {
          error: "PROJECT_ALREADY_EXISTS",
          message: `Project already cloned at ${projectDir}. Use provision_update to pull latest changes.`,
        };
      }

      // Clone
      const branchArg = branch ? `--branch ${branch}` : "";
      const cloneResult = await exec(
        `git clone ${branchArg} "${url}" "${projectDir}"`,
        workDir,
      );
      if (cloneResult.exitCode !== 0) {
        return {
          error: "CLONE_FAILED",
          message: cloneResult.stderr.trim(),
        };
      }

      // Update config with git info
      config.gitUrl = url;
      if (branch) config.gitBranch = branch;
      await saveConfig(ctx.getConfigPath(), config);
      await ctx.reloadConfig();

      // Install dependencies
      const steps = await detectAndInstallDeps(projectDir);

      return {
        success: true,
        projectDir,
        gitUrl: url,
        branch: branch ?? "main",
        installSteps: steps,
      };
    },
  });

  const provisionUpdate = tool({
    description:
      "Update the project: git pull, mise install, re-install dependencies if lockfiles changed.",
    inputSchema: z.object({}),
    execute: async () => {
      const workDir = ctx.getWorkDir();
      const config = ctx.getConfig();
      const projectDir = resolveProjectDir(workDir, config);

      if (!(await fileExists(join(projectDir, ".git")))) {
        return {
          error: "NO_PROJECT",
          message: "No project cloned yet. Use provision_from_git first.",
        };
      }

      // Git pull
      const pullResult = await exec("git pull", projectDir);
      if (pullResult.exitCode !== 0) {
        return {
          error: "PULL_FAILED",
          message: pullResult.stderr.trim(),
        };
      }

      // Re-install deps
      const steps = await detectAndInstallDeps(projectDir);

      return {
        success: true,
        gitOutput: pullResult.stdout.trim(),
        installSteps: steps,
      };
    },
  });

  const installPackage = tool({
    description:
      "Install a runtime or tool via mise. Modifies the project's mise.toml. Examples: node@22, python@3.12, ripgrep.",
    inputSchema: z.object({
      name: z.string().describe("Package/runtime name (e.g. node, python, ripgrep)"),
      version: z
        .string()
        .optional()
        .describe("Version (e.g. 22, 3.12, latest). Omit for latest."),
    }),
    execute: async ({ name, version }) => {
      const workDir = ctx.getWorkDir();
      const config = ctx.getConfig();
      const projectDir = resolveProjectDir(workDir, config);

      const spec = version ? `${name}@${version}` : name;
      const result = await exec(`mise use ${spec}`, projectDir);

      if (result.exitCode !== 0) {
        return {
          error: "INSTALL_FAILED",
          message: result.stderr.trim(),
        };
      }

      return {
        success: true,
        package: spec,
        output: result.stdout.trim(),
      };
    },
  });

  const declareSecret = tool({
    description:
      "Declare a required secret for this habitat. Records it in config.json so fresh deployments know what secrets to inject.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("Secret name (e.g. OPENAI_API_KEY, DATABASE_URL)"),
      description: z
        .string()
        .optional()
        .describe("Human-readable description of what the secret is for"),
      required: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether this secret is required (default: true)"),
    }),
    execute: async ({ name, description, required }) => {
      const config = ctx.getConfig();

      if (!config.requiredSecrets) {
        config.requiredSecrets = [];
      }

      // Update or add
      const existing = config.requiredSecrets.find((s) => s.name === name);
      if (existing) {
        existing.description = description;
        existing.required = required;
      } else {
        const entry: RequiredSecret = { name, required };
        if (description) entry.description = description;
        config.requiredSecrets.push(entry);
      }

      await saveConfig(ctx.getConfigPath(), config);
      await ctx.reloadConfig();

      return {
        success: true,
        secret: { name, description, required },
        totalDeclared: config.requiredSecrets.length,
      };
    },
  });

  const provisionStatus = tool({
    description:
      "Check provisioning status: is project cloned? Are mise tools installed? Are required secrets set?",
    inputSchema: z.object({}),
    execute: async () => {
      const workDir = ctx.getWorkDir();
      const config = ctx.getConfig();
      const projectDir = resolveProjectDir(workDir, config);

      // Project check
      const projectCloned = await fileExists(join(projectDir, ".git"));

      // mise check
      let miseInstalled = false;
      if (projectCloned) {
        const miseCheck = await exec("mise ls --json", projectDir);
        miseInstalled = miseCheck.exitCode === 0;
      }

      // Secrets check
      let secretsStatus: { name: string; set: boolean }[] = [];
      if (config.requiredSecrets && config.requiredSecrets.length > 0) {
        // Load secrets.json
        let secrets: Record<string, string> = {};
        try {
          const raw = await readFile(join(workDir, "secrets.json"), "utf-8");
          secrets = JSON.parse(raw);
        } catch {
          // No secrets file
        }

        secretsStatus = config.requiredSecrets.map((s) => ({
          name: s.name,
          set: s.name in secrets || s.name in process.env,
        }));
      }

      const allSecretsSet =
        secretsStatus.length === 0 || secretsStatus.every((s) => s.set || !config.requiredSecrets!.find(r => r.name === s.name)?.required);

      // Determine overall state
      let state: "empty" | "cloned" | "installed" | "ready";
      if (!projectCloned) {
        state = "empty";
      } else if (!miseInstalled) {
        state = "cloned";
      } else if (!allSecretsSet) {
        state = "installed";
      } else {
        state = "ready";
      }

      return {
        state,
        projectDir,
        projectCloned,
        gitUrl: config.gitUrl ?? null,
        gitBranch: config.gitBranch ?? "main",
        miseInstalled,
        secrets: secretsStatus,
        allSecretsSet,
      };
    },
  });

  return {
    provision_from_git: provisionFromGit,
    provision_update: provisionUpdate,
    install_package: installPackage,
    declare_secret: declareSecret,
    provision_status: provisionStatus,
  };
}
