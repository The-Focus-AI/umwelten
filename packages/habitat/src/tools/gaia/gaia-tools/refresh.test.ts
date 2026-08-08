import { describe, expect, it } from "vitest";
import { REFRESH_COMMAND, refreshHabitat } from "./refresh.js";
import type { RefreshContext } from "./refresh.js";
import type { ContainerStatus } from "../types.js";

const NOW = new Date("2026-07-26T00:00:00.000Z");

interface Fake {
  ctx: RefreshContext;
  execs: { id: string; command: string; env?: Record<string, string> }[];
  writes: { id: string; path: string; content: string }[];
  mints: number;
}

function fake(options: {
  known?: string[];
  status?: ContainerStatus;
  execOk?: boolean;
  execOutput?: string;
  /** Undefined ⇒ no GitHub App wired up at all. */
  token?: string | null;
  mintThrows?: boolean;
}): Fake {
  const known = new Set(options.known ?? ["ops"]);
  const f: Fake = {
    execs: [],
    writes: [],
    mints: 0,
    ctx: null as unknown as RefreshContext,
  };
  f.ctx = {
    registry: { get: (id: string) => (known.has(id) ? ({ id } as never) : undefined) },
    ...(options.token === undefined
      ? {}
      : {
          githubTokens: {
            bootTokensFor: async () => {
              f.mints++;
              if (options.mintThrows) throw new Error("mint failed");
              return options.token ? { read: options.token } : undefined;
            },
          } as never,
        }),
    docker: {
      getStatus: async () => options.status ?? "running",
      execInContainer: async (
        id: string,
        command: string,
        _timeout?: number,
        env?: Record<string, string>,
      ) => {
        f.execs.push({ id, command, ...(env ? { env } : {}) });
        return {
          ok: options.execOk ?? true,
          output: options.execOutput ?? "[entrypoint] provision plan: intent=refresh",
        };
      },
      writeVolumeFile: async (id: string, path: string, content: string) => {
        f.writes.push({ id, path, content });
      },
    },
    now: () => NOW,
  } as RefreshContext;
  return f;
}

describe("refreshHabitat", () => {
  it("refreshes a running habitat in place", async () => {
    const f = fake({ status: "running" });
    const outcome = await refreshHabitat(f.ctx, "ops");

    expect(outcome.action).toBe("refreshed");
    expect(f.execs).toEqual([{ id: "ops", command: REFRESH_COMMAND }]);
    expect(f.writes).toEqual([]);
    expect(REFRESH_COMMAND).toContain("--refresh");
  });

  it("marks a dormant habitat stale rather than starting it", async () => {
    const f = fake({ status: "exited" });
    const outcome = await refreshHabitat(f.ctx, "ops");

    expect(outcome.action).toBe("marked-stale");
    expect(outcome.detail).toContain("refresh on its next wake");
    expect(f.execs).toEqual([]);
    expect(f.writes).toEqual([
      { id: "ops", path: ".needs-refresh", content: `${NOW.toISOString()}\n` },
    ]);
  });

  it.each<ContainerStatus>(["exited", "paused", "dead", "created", "not-found"])(
    "treats %s as dormant",
    async (status) => {
      const f = fake({ status });
      expect((await refreshHabitat(f.ctx, "ops")).action).toBe("marked-stale");
      expect(f.execs).toEqual([]);
    },
  );

  it("falls back to the stale mark when the in-place refresh fails", async () => {
    // A refresh that could not run is not a refresh. Leaving the mark means
    // the next wake retries rather than the request being silently lost.
    const f = fake({ status: "running", execOk: false, execOutput: "container is unhealthy" });
    const outcome = await refreshHabitat(f.ctx, "ops");

    expect(outcome.action).toBe("marked-stale");
    expect(outcome.detail).toContain("container is unhealthy");
    expect(f.writes).toHaveLength(1);
  });

  it("reports an unknown habitat without touching Docker", async () => {
    const f = fake({ known: [] });
    const outcome = await refreshHabitat(f.ctx, "ghost");

    expect(outcome.action).toBe("not-found");
    expect(f.execs).toEqual([]);
    expect(f.writes).toEqual([]);
  });

  it("is idempotent — marking twice leaves one mark", async () => {
    const f = fake({ status: "exited" });
    await refreshHabitat(f.ctx, "ops");
    await refreshHabitat(f.ctx, "ops");

    expect(f.writes).toHaveLength(2);
    expect(new Set(f.writes.map((w) => `${w.id}:${w.path}`)).size).toBe(1);
  });

  it("is idempotent — refreshing twice runs the same command", async () => {
    const f = fake({ status: "running" });
    await refreshHabitat(f.ctx, "ops");
    await refreshHabitat(f.ctx, "ops");

    expect(f.execs.map((e) => e.command)).toEqual([REFRESH_COMMAND, REFRESH_COMMAND]);
    expect(f.writes).toEqual([]);
  });
});

/**
 * Refresh runs via `docker exec`, which inherits the environment the container
 * was STARTED with — including a GitHub boot token that expires in about an
 * hour. Past that every pull failed authentication, and since git had no TTY
 * to prompt on it failed as "could not read Username", which the plan reported
 * as "non-fast-forward or offline". Habitats went on answering from checkouts
 * that had silently stopped moving — observed live, days stale.
 */
describe("github credential", () => {
  it("mints a fresh token for the refresh instead of inheriting the container's", async () => {
    const f = fake({ token: "ghs_fresh" });
    await refreshHabitat(f.ctx, "ops");

    expect(f.mints).toBe(1);
    const env = f.execs[0]?.env;
    expect(env?.GIT_CONFIG_COUNT).toBe("1");
    expect(env?.GIT_CONFIG_KEY_0).toContain("ghs_fresh");
    expect(env?.GIT_CONFIG_VALUE_0).toBe("https://github.com/");
  });

  /** The exact form entrypoint.sh exports, so the provisioner needs no change. */
  it("passes the credential as the insteadOf rewrite the provisioner already reads", async () => {
    const f = fake({ token: "ghs_abc" });
    await refreshHabitat(f.ctx, "ops");

    expect(f.execs[0]?.env?.GIT_CONFIG_KEY_0).toBe(
      "url.https://x-access-token:ghs_abc@github.com/.insteadOf",
    );
  });

  /** A deploy without the GitHub App still refreshes — public repos need none. */
  it("refreshes with no override when there is no token service", async () => {
    const f = fake({});
    const out = await refreshHabitat(f.ctx, "ops");

    expect(out.action).toBe("refreshed");
    expect(f.execs[0]?.env).toBeUndefined();
  });

  it("refreshes with no override when the service mints nothing", async () => {
    const f = fake({ token: null });
    const out = await refreshHabitat(f.ctx, "ops");

    expect(out.action).toBe("refreshed");
    expect(f.execs[0]?.env).toBeUndefined();
  });

  /**
   * Minting is best-effort: a token service outage should degrade to the old
   * behaviour, not block a refresh that may not need credentials at all.
   */
  it("still refreshes when minting throws", async () => {
    const f = fake({ token: "ghs_x", mintThrows: true });
    const out = await refreshHabitat(f.ctx, "ops");

    expect(out.action).toBe("refreshed");
    expect(f.execs).toHaveLength(1);
    expect(f.execs[0]?.env).toBeUndefined();
  });

  it("does not mint for a dormant habitat, which is only marked stale", async () => {
    const f = fake({ token: "ghs_x", status: "not-found" });
    const out = await refreshHabitat(f.ctx, "ops");

    expect(out.action).toBe("marked-stale");
    expect(f.mints).toBe(0);
    expect(f.execs).toHaveLength(0);
  });
});
