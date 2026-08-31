import { describe, expect, it, vi } from "vitest";
import type { PreviewSupervisorOptions } from "./supervisor.js";
import {
  PreviewWorktreeManager,
  type ManagedPreviewSupervisor,
  type WorktreeGit,
} from "./worktree-manager.js";

function harness() {
  let branch = "main";
  let now = 0;
  const calls = {
    validate: [] as string[],
    add: [] as Array<{ path: string; branch: string }>,
    prepare: [] as string[],
    remove: [] as string[],
  };
  const git: WorktreeGit = {
    currentBranch: vi.fn(async () => branch),
    list: vi.fn(async () => []),
    validateBranch: vi.fn(async (value) => {
      calls.validate.push(value);
    }),
    add: vi.fn(async (_primary, path, value) => {
      calls.add.push({ path, branch: value });
    }),
    prepare: vi.fn(async (path) => {
      calls.prepare.push(path);
    }),
    remove: vi.fn(async (_primary, path) => {
      calls.remove.push(path);
    }),
  };
  const supervisors: Array<
    ManagedPreviewSupervisor & {
      options: PreviewSupervisorOptions;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }
  > = [];
  const createSupervisor = (options: PreviewSupervisorOptions) => {
    const supervisor = {
      options,
      start: vi.fn(),
      stop: vi.fn(async () => {}),
      status: () => ({
        worktreeId: options.worktreeId ?? "primary",
        branch: options.branch,
        snapshot: { status: "starting" as const },
        logs: "",
      }),
    };
    supervisors.push(supervisor);
    return supervisor;
  };

  return {
    git,
    calls,
    supervisors,
    createSupervisor,
    now: () => now,
    setNow: (value: number) => {
      now = value;
    },
    setBranch: (value: string) => {
      branch = value;
    },
  };
}

async function manager(h: ReturnType<typeof harness>) {
  return PreviewWorktreeManager.create({
    primaryDir: "/project",
    worktreesDir: "/data/worktrees",
    supervisor: {
      projectId: "demo",
      previewSuffix: "a1b2c3d4e5f60718293a4b5c",
    },
    git: h.git,
    createSupervisor: h.createSupervisor,
    now: h.now,
    serverIdleMs: 100,
    worktreeAbandonMs: 1_000,
    ensureDirectory: async () => {},
  });
}

describe("PreviewWorktreeManager", () => {
  it("treats the current primary branch uniformly without creating a worktree", async () => {
    const h = harness();
    const previews = await manager(h);

    await expect(previews.ensure("main")).resolves.toMatchObject({
      worktreeId: "primary",
      branch: "main",
    });
    expect(h.calls.add).toEqual([]);
    expect(h.supervisors[0].start).toHaveBeenCalledOnce();
  });

  it("creates, prepares, and supervises one shared-object-store worktree per branch", async () => {
    const h = harness();
    const previews = await manager(h);

    const first = await previews.ensure("feature/client-review");
    const second = await previews.ensure("feature/client-review");

    expect(first.worktreeId).toBe(second.worktreeId);
    expect(h.calls.add).toEqual([
      {
        path: expect.stringMatching(
          /^\/data\/worktrees\/feature-client-review-[a-f0-9]{8}$/,
        ),
        branch: "feature/client-review",
      },
    ]);
    expect(h.calls.prepare).toEqual([h.calls.add[0].path]);
    expect(h.supervisors).toHaveLength(2);
    expect(h.supervisors[1].options.projectDir).toBe(h.calls.add[0].path);
  });

  it("reattaches persisted secondary worktrees after a Habitat restart", async () => {
    const h = harness();
    vi.mocked(h.git.list).mockResolvedValueOnce([
      { path: "/project", branch: "main" },
      {
        path: "/data/worktrees/feature-review-deadbeef",
        branch: "feature/review",
      },
    ]);

    const previews = await manager(h);
    await expect(previews.statuses()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ branch: "main", worktreeId: "primary" }),
        expect.objectContaining({ branch: "feature/review" }),
      ]),
    );
    expect(h.supervisors).toHaveLength(2);
    expect(h.supervisors[1].options.projectDir).toBe(
      "/data/worktrees/feature-review-deadbeef",
    );
  });

  it("follows a primary branch switch and never removes the primary checkout", async () => {
    const h = harness();
    const previews = await manager(h);
    h.setBranch("agent/new-work");

    await expect(previews.statuses()).resolves.toContainEqual(
      expect.objectContaining({
        worktreeId: "primary",
        branch: "agent/new-work",
      }),
    );
    expect(h.supervisors[0].stop).toHaveBeenCalledOnce();

    h.setNow(2_000);
    await previews.cleanup();
    expect(h.calls.remove).toEqual([]);
  });

  it("stops idle servers before removing abandoned secondary worktrees", async () => {
    const h = harness();
    const previews = await manager(h);
    const secondary = await previews.ensure("feature/old");
    h.setNow(1_500);

    await expect(previews.cleanup()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          worktreeId: secondary.worktreeId,
          action: "stop-server",
        }),
      ]),
    );
    expect(h.calls.remove).toEqual([]);

    await expect(previews.cleanup()).resolves.toEqual([
      expect.objectContaining({
        worktreeId: secondary.worktreeId,
        action: "remove-worktree",
      }),
    ]);
    expect(h.calls.remove).toEqual([h.calls.add[0].path]);
  });

  it("restarts an idle-stopped branch when routed preview traffic touches it", async () => {
    const h = harness();
    const previews = await manager(h);
    const secondary = await previews.ensure("feature/review");
    h.setNow(200);
    await previews.cleanup();
    expect(h.supervisors[1].stop).toHaveBeenCalledOnce();

    previews.touch(secondary.worktreeId);

    expect(h.supervisors).toHaveLength(3);
    expect(h.supervisors[2].options.branch).toBe("feature/review");
    expect(h.supervisors[2].start).toHaveBeenCalledOnce();
  });

  it("rolls back a new worktree when prerequisite installation fails", async () => {
    const h = harness();
    vi.mocked(h.git.prepare).mockRejectedValueOnce(new Error("install failed"));
    const previews = await manager(h);

    await expect(previews.ensure("feature/broken")).rejects.toThrow(
      "install failed",
    );
    expect(h.calls.remove).toEqual([h.calls.add[0].path]);
    await expect(previews.statuses()).resolves.toHaveLength(1);
  });

  it("surfaces Git validation and worktree creation failures without starting a supervisor", async () => {
    const h = harness();
    const previews = await manager(h);
    vi.mocked(h.git.validateBranch).mockRejectedValueOnce(
      new Error("invalid branch"),
    );
    await expect(previews.ensure("bad branch")).rejects.toThrow(
      "invalid branch",
    );

    vi.mocked(h.git.add).mockRejectedValueOnce(new Error("branch missing"));
    await expect(previews.ensure("missing")).rejects.toThrow("branch missing");
    expect(h.supervisors).toHaveLength(1);
  });
});
