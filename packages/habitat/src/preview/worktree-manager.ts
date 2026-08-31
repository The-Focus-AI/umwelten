import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  PreviewSupervisor,
  type PreviewStatus,
  type PreviewSupervisorOptions,
} from "./supervisor.js";

const execFileAsync = promisify(execFile);

export interface WorktreeGit {
  currentBranch(path: string): Promise<string>;
  list(primaryDir: string): Promise<Array<{ path: string; branch: string }>>;
  validateBranch(branch: string): Promise<void>;
  add(primaryDir: string, path: string, branch: string): Promise<void>;
  prepare(path: string): Promise<void>;
  remove(primaryDir: string, path: string): Promise<void>;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await execFileAsync(command, args, { cwd });
}

export const nodeWorktreeGit: WorktreeGit = {
  async currentBranch(path) {
    const { stdout } = await execFileAsync(
      "git",
      ["branch", "--show-current"],
      { cwd: path },
    );
    const branch = stdout.trim();
    if (!branch)
      throw new Error(`Git checkout at ${path} has no current branch`);
    return branch;
  },
  async validateBranch(branch) {
    await execFileAsync("git", ["check-ref-format", "--branch", branch]);
  },
  async list(primaryDir) {
    const { stdout } = await execFileAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: primaryDir },
    );
    return stdout
      .trim()
      .split(/\n\n+/)
      .map((record) => {
        const lines = record.split("\n");
        const path = lines
          .find((line) => line.startsWith("worktree "))
          ?.slice(9);
        const branch = lines
          .find((line) => line.startsWith("branch refs/heads/"))
          ?.slice("branch refs/heads/".length);
        return path && branch ? { path, branch } : null;
      })
      .filter(
        (value): value is { path: string; branch: string } => value !== null,
      );
  },
  async add(primaryDir, path, branch) {
    await execFileAsync("git", ["worktree", "add", path, branch], {
      cwd: primaryDir,
    });
  },
  async prepare(path) {
    if (
      (await exists(join(path, "mise.toml"))) ||
      (await exists(join(path, ".mise.toml")))
    ) {
      await run("mise", ["install"], path);
    }
    if (await exists(join(path, "pnpm-lock.yaml"))) {
      await run("pnpm", ["install", "--frozen-lockfile"], path);
    } else if (await exists(join(path, "package-lock.json"))) {
      await run("npm", ["ci"], path);
    } else if (await exists(join(path, "yarn.lock"))) {
      await run("yarn", ["install", "--frozen-lockfile"], path);
    } else if (await exists(join(path, "package.json"))) {
      await run("npm", ["install"], path);
    }
  },
  async remove(primaryDir, path) {
    await execFileAsync("git", ["worktree", "remove", path], {
      cwd: primaryDir,
    });
  },
};

export interface ManagedPreviewSupervisor {
  start(): void;
  stop(): Promise<void>;
  status(): PreviewStatus;
}

interface ManagedWorktree {
  id: string;
  branch: string;
  path: string;
  primary: boolean;
  supervisor: ManagedPreviewSupervisor;
  lastRequestedAt: number;
  serverStoppedAt?: number;
}

export interface WorktreeCleanupEvent {
  worktreeId: string;
  branch: string;
  action: "stop-server" | "remove-worktree";
  detail: string;
}

export interface PreviewWorktreeManagerOptions {
  primaryDir: string;
  worktreesDir: string;
  supervisor: Omit<
    PreviewSupervisorOptions,
    "projectDir" | "branch" | "worktreeId"
  >;
  git?: WorktreeGit;
  createSupervisor?: (
    options: PreviewSupervisorOptions,
  ) => ManagedPreviewSupervisor;
  now?: () => number;
  serverIdleMs?: number;
  worktreeAbandonMs?: number;
  report?: (event: WorktreeCleanupEvent) => void;
  ensureDirectory?: (path: string) => Promise<void>;
}

function worktreeId(branch: string): string {
  const slug =
    branch
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "branch";
  const hash = createHash("sha256").update(branch).digest("hex").slice(0, 8);
  return `${slug}-${hash}`;
}

export class PreviewWorktreeManager {
  private readonly git: WorktreeGit;
  private readonly createSupervisor: NonNullable<
    PreviewWorktreeManagerOptions["createSupervisor"]
  >;
  private readonly now: () => number;
  private readonly worktrees = new Map<string, ManagedWorktree>();

  private constructor(private readonly options: PreviewWorktreeManagerOptions) {
    this.git = options.git ?? nodeWorktreeGit;
    this.createSupervisor =
      options.createSupervisor ??
      ((supervisorOptions) => new PreviewSupervisor(supervisorOptions));
    this.now = options.now ?? Date.now;
  }

  static async create(
    options: PreviewWorktreeManagerOptions,
  ): Promise<PreviewWorktreeManager> {
    const manager = new PreviewWorktreeManager(options);
    await manager.refreshPrimary();
    for (const existing of await manager.git.list(options.primaryDir)) {
      if (existing.path === options.primaryDir) continue;
      const id = worktreeId(existing.branch);
      if (manager.worktrees.has(id)) continue;
      const worktree = manager.makeWorktree(
        id,
        existing.branch,
        existing.path,
        false,
      );
      manager.worktrees.set(id, worktree);
      worktree.supervisor.start();
    }
    return manager;
  }

  async ensure(branch: string): Promise<PreviewStatus> {
    await this.git.validateBranch(branch);
    await this.refreshPrimary();
    const existing = [...this.worktrees.values()].find(
      (worktree) => worktree.branch === branch,
    );
    if (existing) {
      existing.lastRequestedAt = this.now();
      if (existing.serverStoppedAt !== undefined) this.restart(existing);
      return existing.supervisor.status();
    }

    const id = worktreeId(branch);
    const path = join(this.options.worktreesDir, id);
    await (
      this.options.ensureDirectory ??
      (async (directory) => {
        await mkdir(directory, { recursive: true });
      })
    )(this.options.worktreesDir);
    await this.git.add(this.options.primaryDir, path, branch);
    try {
      await this.git.prepare(path);
    } catch (error) {
      await this.git.remove(this.options.primaryDir, path).catch(() => {});
      throw error;
    }
    const worktree = this.makeWorktree(id, branch, path, false);
    this.worktrees.set(id, worktree);
    worktree.supervisor.start();
    return worktree.supervisor.status();
  }

  async statuses(): Promise<PreviewStatus[]> {
    await this.refreshPrimary();
    return [...this.worktrees.values()]
      .sort(
        (a, b) =>
          Number(b.primary) - Number(a.primary) ||
          a.branch.localeCompare(b.branch),
      )
      .map((worktree) => worktree.supervisor.status());
  }

  touch(id: string): void {
    const worktree = this.worktrees.get(id);
    if (worktree) worktree.lastRequestedAt = this.now();
  }

  async cleanup(): Promise<WorktreeCleanupEvent[]> {
    const now = this.now();
    const serverIdleMs = this.options.serverIdleMs ?? 30 * 60_000;
    const abandonMs = this.options.worktreeAbandonMs ?? 7 * 24 * 60 * 60_000;
    const events: WorktreeCleanupEvent[] = [];
    for (const worktree of [...this.worktrees.values()]) {
      const idleMs = now - worktree.lastRequestedAt;
      const wasStopped = worktree.serverStoppedAt !== undefined;
      if (worktree.serverStoppedAt === undefined && idleMs >= serverIdleMs) {
        await worktree.supervisor.stop();
        worktree.serverStoppedAt = now;
        events.push({
          worktreeId: worktree.id,
          branch: worktree.branch,
          action: "stop-server",
          detail: `Stopped preview server after ${idleMs}ms idle.`,
        });
      }
      if (!worktree.primary && wasStopped && idleMs >= abandonMs) {
        if (worktree.serverStoppedAt === undefined)
          await worktree.supervisor.stop();
        await this.git.remove(this.options.primaryDir, worktree.path);
        this.worktrees.delete(worktree.id);
        events.push({
          worktreeId: worktree.id,
          branch: worktree.branch,
          action: "remove-worktree",
          detail: `Removed abandoned worktree after ${idleMs}ms idle.`,
        });
      }
    }
    for (const event of events) this.options.report?.(event);
    return events;
  }

  async stop(): Promise<void> {
    await Promise.all(
      [...this.worktrees.values()].map((worktree) =>
        worktree.supervisor.stop(),
      ),
    );
  }

  private async refreshPrimary(): Promise<void> {
    const branch = await this.git.currentBranch(this.options.primaryDir);
    const primary = this.worktrees.get("primary");
    if (primary?.branch === branch) return;
    if (primary) await primary.supervisor.stop();
    const replacement = this.makeWorktree(
      "primary",
      branch,
      this.options.primaryDir,
      true,
    );
    this.worktrees.set("primary", replacement);
    replacement.supervisor.start();
  }

  private makeWorktree(
    id: string,
    branch: string,
    path: string,
    primary: boolean,
  ): ManagedWorktree {
    return {
      id,
      branch,
      path,
      primary,
      lastRequestedAt: this.now(),
      supervisor: this.createSupervisor({
        ...this.options.supervisor,
        projectDir: path,
        branch,
        worktreeId: id,
      }),
    };
  }

  private restart(worktree: ManagedWorktree): void {
    worktree.supervisor = this.createSupervisor({
      ...this.options.supervisor,
      projectDir: worktree.path,
      branch: worktree.branch,
      worktreeId: worktree.id,
    });
    worktree.serverStoppedAt = undefined;
    worktree.supervisor.start();
  }
}
