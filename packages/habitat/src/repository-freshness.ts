import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveProjectDir } from "./config.js";
import type { HabitatConfig } from "./types.js";

const exec = promisify(execFile);

/** Only fixed diagnostic text escapes this module: Git errors can contain credentials. */
export async function refreshRepositories(
  workDir: string,
  config: HabitatConfig,
): Promise<boolean> {
  const repos = new Map<string, { id: string; branch: string }>();
  // IDs are operator-facing labels, never paths/URLs or arbitrary error text.
  const safeId = (id: string) =>
    /^[a-zA-Z0-9_-]{1,80}$/.test(id) ? id : "invalid-agent-id";
  const addRepo = async (id: string, path: string, branch: string) => {
    let dir: string;
    try {
      dir = await realpath(resolve(workDir, path));
    } catch {
      throw new Error(
        `Repository freshness blocked [${id}]: missing or inaccessible checkout. Check config.json and the mounted directory.`,
      );
    }
    const previous = repos.get(dir);
    if (previous && previous.branch !== branch) {
      throw new Error(
        `Repository freshness blocked [${id}]: conflicting branch declaration with [${previous.id}]. Correct config.json.`,
      );
    }
    if (!previous) repos.set(dir, { id, branch });
  };
  if (config.gitUrl)
    await addRepo(
      "owned",
      resolveProjectDir(workDir, config),
      config.gitBranch ?? "main",
    );
  for (const agent of config.agents) {
    if (agent.kind && agent.kind !== "repo") continue;
    if (!agent.gitRemote || !agent.projectPath) continue;
    await addRepo(
      safeId(agent.id),
      agent.projectPath,
      agent.gitBranch ?? "main",
    );
  }
  if (!repos.size) return false;
  let token: string;
  try {
    if (!process.env.GAIA_URL || !process.env.HABITAT_API_KEY)
      throw new Error();
    const response = await fetch(
      `${process.env.GAIA_URL.replace(/\/$/, "")}/github/token`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.HABITAT_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "read" }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error();
    const body = (await response.json()) as {
      token?: string;
      expiresAt?: string;
    };
    if (
      !body.token ||
      !body.expiresAt ||
      !(Date.parse(body.expiresAt) > Date.now() + 60_000)
    )
      throw new Error();
    token = body.token;
  } catch {
    const ids = [...repos.values()].map((repo) => repo.id).join(", ");
    throw new Error(
      `Repository freshness blocked [${ids}]: cannot obtain a fresh Gaia GitHub read token. Check GAIA_URL, HABITAT_API_KEY, connectivity and GitHub App access.`,
    );
  }
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: `url.https://x-access-token:${token}@github.com/.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/",
    GIT_CONFIG_KEY_1: `url.https://x-access-token:${token}@github.com/.insteadOf`,
    GIT_CONFIG_VALUE_1: "git@github.com:",
    GIT_CONFIG_KEY_2: `url.https://x-access-token:${token}@github.com/.insteadOf`,
    GIT_CONFIG_VALUE_2: "ssh://git@github.com/",
  };
  const git = async (cwd: string, args: string[], action: string) => {
    try {
      return (
        await exec("git", args, {
          cwd,
          env,
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        })
      ).stdout.trim();
    } catch {
      throw new Error(
        `Repository freshness blocked [${repos.get(cwd)!.id}]: ${action}. Check repository configuration, connectivity and read access; repair the checkout manually. No work was discarded.`,
      );
    }
  };
  let changed = false;
  // Preflight all checkouts before updating any of them.
  for (const [dir, { id, branch }] of repos) {
    await git(
      dir,
      ["check-ref-format", "--branch", branch],
      "invalid intended branch",
    );
    if (
      (await git(
        dir,
        ["symbolic-ref", "--short", "HEAD"],
        "detached or missing checkout",
      )) !== branch
    ) {
      throw new Error(
        `Repository freshness blocked [${id}]: wrong branch. Check out the configured branch manually (default main); no branch switch was attempted.`,
      );
    }
    if (
      await git(
        dir,
        ["status", "--porcelain", "--untracked-files=all"],
        "cannot inspect worktree",
      )
    ) {
      throw new Error(
        `Repository freshness blocked [${id}]: dirty worktree. Commit or move local changes manually, then retry; nothing was stashed or discarded.`,
      );
    }
  }
  for (const [dir, { branch }] of repos) {
    const before = await git(dir, ["rev-parse", "HEAD"], "cannot read HEAD");
    await git(
      dir,
      ["fetch", "--no-tags", "origin", `refs/heads/${branch}`],
      "fetch failed (offline, authentication or missing branch)",
    );
    const target = await git(
      dir,
      ["rev-parse", "FETCH_HEAD"],
      "cannot read fetched HEAD",
    );
    await git(
      dir,
      ["merge-base", "--is-ancestor", before, target],
      "local commits are ahead or diverged",
    );
    if (before !== target) {
      await git(dir, ["merge", "--ff-only", target], "fast-forward failed");
      changed = true;
    }
  }
  return changed;
}
