import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { commandFor, executeProvisionPlan } from "./execute.js";
import { planProvision } from "./plan.js";
import type { ProvisionExecutorDeps, ProvisionResult } from "./execute.js";
import type { HabitatConfig } from "../types.js";
import type { ProvisionPlan, ProvisionStep, VolumeState } from "./types.js";

/** The habitat boot-token passthrough every scoped git command carries. */
const GIT_CRED =
  'GIT_CONFIG_COUNT="$GIT_CONFIG_COUNT" GIT_CONFIG_KEY_0="$GIT_CONFIG_KEY_0" GIT_CONFIG_VALUE_0="$GIT_CONFIG_VALUE_0"';

interface Recorder {
  deps: ProvisionExecutorDeps;
  commands: { command: string; cwd: string }[];
  dirs: string[];
  markers: string[];
  removed: string[];
  logs: string[];
}

function recorder(options: {
  present?: string[];
  secrets?: Record<string, string>;
  fails?: (command: string) => boolean;
}): Recorder {
  const present = new Set(options.present ?? []);
  const rec: Recorder = {
    commands: [],
    dirs: [],
    markers: [],
    removed: [],
    logs: [],
    deps: null as unknown as ProvisionExecutorDeps,
  };
  rec.deps = {
    exists: async (path) => present.has(path),
    run: async (command, cwd) => {
      rec.commands.push({ command, cwd });
      return !options.fails?.(command);
    },
    ensureDir: async (path) => {
      rec.dirs.push(path);
    },
    writeMarker: async (path) => {
      rec.markers.push(path);
    },
    removeMarker: async (path) => {
      rec.removed.push(path);
    },
    secret: (name) => options.secrets?.[name],
    log: (message) => {
      rec.logs.push(message);
    },
  };
  return rec;
}

const VOLUME: VolumeState = {
  configPresent: true,
  ownedRepoCloned: false,
  skillsLockPresent: false,
  volumeProvisioned: false,
  staleMarkerPresent: false,
  agents: {},
};

function planFor(
  config: HabitatConfig,
  volume: Partial<VolumeState> = {},
  intent: "start" | "refresh" = "refresh",
): ProvisionPlan {
  return planProvision({
    workDir: "/data",
    config,
    volume: { ...VOLUME, ...volume },
    intent,
  });
}

function only(plan: ProvisionPlan, kind: ProvisionStep["kind"]): ProvisionStep {
  const step = plan.steps.find((s) => s.kind === kind);
  if (!step) throw new Error(`no ${kind} step in plan`);
  return step;
}

describe("commandFor", () => {
  const deps = recorder({}).deps;

  it("clones the owned repo on the declared branch", async () => {
    const plan = planFor({ agents: [], gitUrl: "https://example.com/r.git", gitBranch: "main" });
    expect(await commandFor(only(plan, "clone-owned-repo"), deps)).toEqual({
      command: 'git clone --branch main "https://example.com/r.git" "/data/project"',
      cwd: ".",
    });
  });

  it("omits --branch when none is declared", async () => {
    const plan = planFor({ agents: [], gitUrl: "https://example.com/r.git" });
    expect((await commandFor(only(plan, "clone-owned-repo"), deps))?.command).toBe(
      'git clone "https://example.com/r.git" "/data/project"',
    );
  });

  it("fast-forwards a branch explicitly, or the current one otherwise", async () => {
    const branched = planFor(
      { agents: [], gitUrl: "https://example.com/r.git", gitBranch: "main" },
      { ownedRepoCloned: true },
    );
    expect(await commandFor(only(branched, "update-owned-repo"), deps)).toEqual({
      command: "git fetch origin main && git pull --ff-only origin main",
      cwd: "/data/project",
    });

    const plain = planFor(
      { agents: [], gitUrl: "https://example.com/r.git" },
      { ownedRepoCloned: true },
    );
    expect((await commandFor(only(plain, "update-owned-repo"), deps))?.command).toBe(
      "git pull --ff-only",
    );
  });

  it("wraps the dependency install in mise only when the repo is mise-managed", async () => {
    const plan = planFor({ agents: [], gitUrl: "https://example.com/r.git" });
    const step = only(plan, "install-node-deps");

    const bare = recorder({}).deps;
    expect((await commandFor(step, bare))?.command).toBe("pnpm install --prod");

    const mised = recorder({ present: ["/data/project/mise.toml"] }).deps;
    expect((await commandFor(step, mised))?.command).toBe("mise exec -- pnpm install --prod");
  });

  it("clones an agent repo with only that agent's declared env", async () => {
    const plan = planFor({
      agents: [
        {
          id: "web",
          name: "web",
          projectPath: "",
          gitRemote: "git@github.com:acme/web.git",
          gitBranch: "trunk",
          secrets: ["DEPLOY_KEY", "ABSENT_KEY"],
        },
      ],
    });
    const withSecrets = recorder({ secrets: { DEPLOY_KEY: "s3cr3t", OTHER: "nope" } }).deps;

    expect(await commandFor(only(plan, "clone-agent-repo"), withSecrets)).toEqual({
      command:
        'env -i PATH="$PATH" HOME="$HOME" ' + GIT_CRED + ' DEPLOY_KEY=\'s3cr3t\' ' +
        'git clone --branch trunk "git@github.com:acme/web.git" "/data/agents/web/repo"',
      cwd: ".",
    });
  });

  /**
   * The regression this guards: `env -i` used to drop the habitat's
   * github-token git config along with everything else, so a read-only mount
   * had no credential at all and every clone of a private repo died with
   * "could not read Username". Mounts are private repos by definition
   * (ADR 0006), so this broke the whole feature.
   */
  it("carries the habitat's github credential into a mount clone", async () => {
    const plan = planFor({
      agents: [
        {
          id: "web",
          name: "web",
          projectPath: "",
          gitRemote: "https://github.com/acme/web.git",
          mode: "read",
        },
      ],
    });

    const { command } = await commandFor(
      only(plan, "clone-agent-repo"),
      recorder({}).deps,
    );

    for (const name of [
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
    ]) {
      expect(command).toContain(`${name}="$${name}"`);
    }
  });

  /**
   * By reference, never by value: the token lives inside GIT_CONFIG_KEY_0, and
   * command strings are the one place a provisioning secret could surface in a
   * log or an error. The running shell expands it; we never interpolate it.
   */
  it("passes the credential by reference so the token never enters the command", async () => {
    const plan = planFor({
      agents: [
        { id: "web", name: "web", projectPath: "", gitRemote: "https://github.com/acme/web.git" },
      ],
    });
    const leaky = recorder({
      secrets: {
        GIT_CONFIG_KEY_0:
          "url.https://x-access-token:ghs_SUPERSECRET@github.com/.insteadOf",
      },
    }).deps;

    const { command } = await commandFor(only(plan, "clone-agent-repo"), leaky);

    expect(command).not.toContain("ghs_SUPERSECRET");
  });

  /** Agent isolation is unchanged — only the habitat's own grant is shared. */
  it("still keeps one agent's declared secrets out of another's clone", async () => {
    const plan = planFor({
      agents: [
        { id: "a", name: "a", projectPath: "", gitRemote: "git@github.com:acme/a.git", secrets: ["A_KEY"] },
        { id: "b", name: "b", projectPath: "", gitRemote: "git@github.com:acme/b.git", secrets: ["B_KEY"] },
      ],
    });
    const deps = recorder({ secrets: { A_KEY: "aaa", B_KEY: "bbb" } }).deps;

    const clones = plan.steps.filter((s) => s.kind === "clone-agent-repo");
    const [a, b] = await Promise.all(clones.map((s) => commandFor(s, deps)));

    expect(a!.command).toContain("A_KEY='aaa'");
    expect(a!.command).not.toContain("bbb");
    expect(b!.command).toContain("B_KEY='bbb'");
    expect(b!.command).not.toContain("aaa");
  });

  it("shell-quotes secret values so they cannot break out of the assignment", async () => {
    const value = "a'; touch /tmp/pwned; echo '";
    const plan = planFor({
      agents: [
        {
          id: "web",
          name: "web",
          projectPath: "",
          gitRemote: "git@github.com:acme/web.git",
          secrets: ["TOKEN"],
        },
      ],
    });
    const evil = recorder({ secrets: { TOKEN: value } }).deps;
    const command = (await commandFor(only(plan, "clone-agent-repo"), evil))?.command ?? "";

    // Ask a real shell: the assignment must survive as one word, and `git
    // clone` must still be the command being run rather than a payload.
    const assignment = command.slice(
      command.indexOf("TOKEN="),
      command.indexOf(" git clone"),
    );
    const roundTripped = execFileSync("/bin/sh", [
      "-c",
      `${assignment} sh -c 'printf %s "$TOKEN"'`,
    ]).toString();
    expect(roundTripped).toBe(value);
  });

  it("restores or installs skills in the work dir", async () => {
    const restore = planFor({ agents: [], skillsFromGit: ["acme/skills"] }, { skillsLockPresent: true });
    expect(await commandFor(only(restore, "restore-skills"), deps)).toEqual({
      command: "npx skills@latest experimental_install 2>&1",
      cwd: "/data",
    });

    const install = planFor({ agents: [], skillsFromGit: ["acme/skills"] });
    expect((await commandFor(only(install, "install-skills"), deps))?.command).toBe(
      'npx skills@latest add "acme/skills" --all -y 2>&1',
    );
  });
});

describe("executeProvisionPlan", () => {
  const fullConfig: HabitatConfig = {
    gitUrl: "https://example.com/ops.git",
    agents: [
      { id: "web", name: "web", projectPath: "", gitRemote: "git@github.com:acme/web.git" },
    ],
    skillsFromGit: ["acme/skills"],
  };

  it("runs a cold start end to end", async () => {
    const rec = recorder({ present: ["/data/project/package.json"] });
    const result = await executeProvisionPlan(planFor(fullConfig), rec.deps);

    expect(result.aborted).toBeUndefined();
    expect(result.warned).toEqual([]);
    expect(rec.commands.map((c) => c.command)).toEqual([
      'git clone "https://example.com/ops.git" "/data/project"',
      "pnpm install --prod",
      `env -i PATH="$PATH" HOME="$HOME" ${GIT_CRED} git clone "git@github.com:acme/web.git" "/data/agents/web/repo"`,
      'npx skills@latest add "acme/skills" --all -y 2>&1',
    ]);
    expect(rec.dirs).toEqual(["/data/agents", "/data/agents/web"]);
    expect(rec.markers).toEqual([
      "/data/agents/web/.provisioned",
      "/data/.provisioned",
    ]);
  });

  it("skips conditional steps whose files are absent", async () => {
    const rec = recorder({});
    await executeProvisionPlan(planFor(fullConfig), rec.deps);
    expect(rec.commands.map((c) => c.command)).not.toContain("pnpm install --prod");
    expect(rec.commands.map((c) => c.command)).not.toContain("mise install");
  });

  it("runs the mise install once the repo turns out to be mise-managed", async () => {
    const rec = recorder({ present: ["/data/project/.mise.toml", "/data/agents/web/repo/mise.toml"] });
    await executeProvisionPlan(planFor(fullConfig), rec.deps);
    expect(rec.commands.filter((c) => c.command === "mise install").map((c) => c.cwd)).toEqual([
      "/data/project",
      "/data/agents/web/repo",
    ]);
  });

  it("aborts the run when the owned-repo clone fails", async () => {
    const rec = recorder({ fails: (c) => c.startsWith("git clone") });
    const result = await executeProvisionPlan(planFor(fullConfig), rec.deps);

    expect(result.aborted?.kind).toBe("clone-owned-repo");
    expect(rec.commands).toHaveLength(1);
    expect(rec.markers).toEqual([]);
  });

  it("warns and continues when an agent clone fails, still marking it attempted", async () => {
    const rec = recorder({ fails: (c) => c.startsWith("env -i") });
    const result = await executeProvisionPlan(planFor(fullConfig), rec.deps);

    expect(result.aborted).toBeUndefined();
    expect(result.warned.map((s) => s.kind)).toEqual(["clone-agent-repo"]);
    // The warning names the likely cause, not just the fact of failure —
    // git reports a repo outside the App installation as "could not read
    // Username", which sends people looking at credentials rather than at
    // the App's repo list.
    const warning = rec.logs.find((l) => l.includes("Clone failed for agent web"));
    expect(warning).toBeDefined();
    expect(warning).toContain("GitHub App is probably not installed");
    expect(warning).toContain("separate grants");
    expect(rec.markers).toContain("/data/agents/web/.provisioned");
    // Skills still get installed after the failure.
    expect(rec.commands.at(-1)?.command).toContain("npx skills@latest add");
  });

  it("logs the boot lines the shell used to print", async () => {
    const rec = recorder({});
    await executeProvisionPlan(
      planFor(fullConfig, { ownedRepoCloned: true, agents: { web: { repoCloned: true } } }),
      rec.deps,
    );
    expect(rec.logs).toContain("[entrypoint] Updating /data/project (git pull --ff-only)...");
    expect(rec.logs).toContain("[entrypoint] Updating agent web (git pull --ff-only)...");
  });

  it("reports a non-fast-forward pull as a warning, not a failure", async () => {
    const rec = recorder({ fails: (c) => c.includes("git pull") });
    const result: ProvisionResult = await executeProvisionPlan(
      planFor(fullConfig, { ownedRepoCloned: true }),
      rec.deps,
    );
    expect(result.aborted).toBeUndefined();
    expect(rec.logs).toContain(
      "[entrypoint] Pull skipped (non-fast-forward or offline; keeping current checkout).",
    );
  });

  it("does nothing at all without a config.json", async () => {
    const rec = recorder({});
    await executeProvisionPlan(planFor(fullConfig, { configPresent: false }), rec.deps);
    expect(rec.commands).toEqual([]);
    expect(rec.dirs).toEqual([]);
    expect(rec.logs).toEqual([]);
  });
});
