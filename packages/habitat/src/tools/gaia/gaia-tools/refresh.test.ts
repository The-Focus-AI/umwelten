import { describe, expect, it } from "vitest";
import { REFRESH_COMMAND, refreshHabitat } from "./refresh.js";
import type { RefreshContext } from "./refresh.js";
import type { ContainerStatus } from "../types.js";

const NOW = new Date("2026-07-26T00:00:00.000Z");

interface Fake {
  ctx: RefreshContext;
  execs: { id: string; command: string }[];
  writes: { id: string; path: string; content: string }[];
}

function fake(options: {
  known?: string[];
  status?: ContainerStatus;
  execOk?: boolean;
  execOutput?: string;
}): Fake {
  const known = new Set(options.known ?? ["ops"]);
  const f: Fake = { execs: [], writes: [], ctx: null as unknown as RefreshContext };
  f.ctx = {
    registry: { get: (id: string) => (known.has(id) ? ({ id } as never) : undefined) },
    docker: {
      getStatus: async () => options.status ?? "running",
      execInContainer: async (id: string, command: string) => {
        f.execs.push({ id, command });
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
