import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectRepositoryTools } from "./project-repository.js";
import { startHabitatContainer } from "./habitats.js";

vi.mock("./habitats.js", () => ({ startHabitatContainer: vi.fn() }));

describe("create_private_project_habitat", () => {
  let github: any;
  let registry: any;
  let audit: any;
  beforeEach(() => {
    vi.mocked(startHabitatContainer).mockReset().mockResolvedValue(7421);
    github = {
      organization: "bound-org",
      installationId: "42",
      createPrivateRepository: vi
        .fn()
        .mockResolvedValue({
          id: 7,
          htmlUrl: "https://github.com/bound-org/new",
          cloneUrl: "unused",
        }),
      addRepositoryToInstallation: vi.fn().mockResolvedValue(undefined),
      removeRepositoryFromInstallation: vi.fn().mockResolvedValue(undefined),
      deleteRepository: vi.fn().mockResolvedValue(undefined),
    };
    registry = {
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn(),
      list: vi.fn(),
    };
    audit = { log: vi.fn().mockResolvedValue(undefined) };
  });
  const run = async () => {
    const tools = createProjectRepositoryTools({
      githubAdministration: github,
      githubTokens: { enabled: true },
      registry,
      audit,
    } as any);
    return JSON.parse(
      await (tools.create_private_project_habitat as any).execute(
        { repository: "new", habitatId: "new", name: "New" },
        {},
      ),
    );
  };

  it("fails closed before GitHub when administration-write is absent", async () => {
    const tools = createProjectRepositoryTools({
      githubTokens: { enabled: true },
    } as any);
    await expect(
      (tools.create_private_project_habitat as any).execute(
        { repository: "new", habitatId: "new", name: "New" },
        {},
      ),
    ).rejects.toThrow(/administration-write/);
  });

  it("creates private repo, explicitly scopes exactly it, registers explicit Owned write, and starts", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
    expect(github.createPrivateRepository).toHaveBeenCalledWith(
      "new",
      undefined,
    );
    expect(github.addRepositoryToInstallation).toHaveBeenCalledWith(7);
    expect(registry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        gitUrl: "https://github.com/bound-org/new.git",
        image: "habitat-coding",
        github: { write: ["new"] },
      }),
    );
    expect(startHabitatContainer).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledTimes(4);
  });

  it("reports repository creation failure without later mutations", async () => {
    github.createPrivateRepository.mockRejectedValue(
      new Error("create denied"),
    );
    const result = await run();
    expect(result.failedAt).toBe("create_repository");
    expect(github.addRepositoryToInstallation).not.toHaveBeenCalled();
  });

  it("deletes the repository when installation scoping fails", async () => {
    github.addRepositoryToInstallation.mockRejectedValue(
      new Error("scope denied"),
    );
    const result = await run();
    expect(result.failedAt).toBe("add_installation_access");
    expect(github.deleteRepository).toHaveBeenCalledWith("new");
    expect(result.reconciliation.repositoryCreated).toBe(false);
  });

  it("removes App access and deletes the repo when registration fails", async () => {
    registry.create.mockRejectedValue(new Error("disk full"));
    const result = await run();
    expect(result.failedAt).toBe("register_habitat");
    expect(github.removeRepositoryFromInstallation).toHaveBeenCalledWith(7);
    expect(github.deleteRepository).toHaveBeenCalledWith("new");
  });

  it("keeps an actionable auditable reconciliation state when start fails", async () => {
    vi.mocked(startHabitatContainer).mockRejectedValue(
      new Error("image missing"),
    );
    const result = await run();
    expect(result.failedAt).toBe("start_habitat");
    expect(result.reconciliation).toMatchObject({
      repositoryCreated: true,
      installationAccess: true,
      habitatRegistered: true,
      habitatStarted: false,
    });
    expect(result.reconciliation.nextAction).toContain("start_habitat");
  });
});
