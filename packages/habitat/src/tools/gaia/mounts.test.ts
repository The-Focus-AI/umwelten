import { describe, expect, it } from "vitest";
import { MountDeclarationError, mountsToAgentEntries } from "./mounts.js";

describe("mountsToAgentEntries", () => {
	it("returns nothing when no mounts are declared", () => {
		expect(mountsToAgentEntries(undefined)).toEqual([]);
		expect(mountsToAgentEntries([])).toEqual([]);
	});

	it("derives the mount id from the repo name, so the common case is just a remote", () => {
		const [entry] = mountsToAgentEntries([
			{ gitRemote: "https://github.com/The-Focus-AI/uh-api.git" },
		]);
		expect(entry).toMatchObject({ id: "uh-api", name: "uh-api" });
	});

	/**
	 * The half that makes this a Mounted repo rather than a second Owned one:
	 * read mode blocks writes and forces read-only tool subsets.
	 */
	it("marks every mount read-only", () => {
		const entries = mountsToAgentEntries([
			{ gitRemote: "https://github.com/x/a.git" },
			{ gitRemote: "https://github.com/x/b.git" },
		]);
		expect(entries.every((e) => e.mode === "read")).toBe(true);
		expect(entries.every((e) => e.kind === "repo")).toBe(true);
	});

	it("gives each mount its own directory", () => {
		const entries = mountsToAgentEntries([
			{ gitRemote: "https://github.com/x/a.git" },
			{ gitRemote: "https://github.com/x/b.git" },
		]);
		expect(entries.map((e) => e.projectPath)).toEqual([
			"agents/a/repo",
			"agents/b/repo",
		]);
	});

	it("honours an explicit id and name", () => {
		const [entry] = mountsToAgentEntries([
			{ gitRemote: "https://github.com/x/a.git", id: "api", name: "The API" },
		]);
		expect(entry).toMatchObject({ id: "api", name: "The API", projectPath: "agents/api/repo" });
	});

	it("carries a branch when one is pinned", () => {
		const [entry] = mountsToAgentEntries([
			{ gitRemote: "https://github.com/x/a.git", gitBranch: "release" },
		]);
		expect(entry.gitBranch).toBe("release");
	});

	it("omits the branch when none is pinned", () => {
		const [entry] = mountsToAgentEntries([{ gitRemote: "https://github.com/x/a.git" }]);
		expect(entry).not.toHaveProperty("gitBranch");
	});

	it("handles ssh remotes", () => {
		const [entry] = mountsToAgentEntries([
			{ gitRemote: "git@github.com:The-Focus-AI/uh-web.git" },
		]);
		expect(entry.id).toBe("uh-web");
	});

	/**
	 * Throwing beats skipping: a mount that silently vanishes surfaces much
	 * later as "the agent can't see that repo".
	 */
	it("rejects a mount with no remote", () => {
		expect(() => mountsToAgentEntries([{ gitRemote: "  " }])).toThrow(
			MountDeclarationError,
		);
	});

	it("rejects a remote it cannot name, rather than guessing", () => {
		expect(() => mountsToAgentEntries([{ gitRemote: "wat" }])).toThrow(
			/explicit id/,
		);
	});

	it("rejects duplicate ids, which would collide in one directory namespace", () => {
		expect(() =>
			mountsToAgentEntries([
				{ gitRemote: "https://github.com/a/same.git" },
				{ gitRemote: "https://github.com/b/same.git" },
			]),
		).toThrow(/Duplicate mount id/);
	});

	it("allows two repos with the same name when one is given an explicit id", () => {
		const entries = mountsToAgentEntries([
			{ gitRemote: "https://github.com/a/same.git" },
			{ gitRemote: "https://github.com/b/same.git", id: "same-b" },
		]);
		expect(entries.map((e) => e.id)).toEqual(["same", "same-b"]);
	});
});
