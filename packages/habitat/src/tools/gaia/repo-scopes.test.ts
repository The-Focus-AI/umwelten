import { describe, expect, it } from "vitest";
import type { HabitatConfig } from "../../types.js";
import {
	bareRepoName,
	deriveRepoScopes,
	mergeDerivedReadScope,
	repoNameFromGitUrl,
} from "./repo-scopes.js";

function config(overrides: Partial<HabitatConfig> = {}): HabitatConfig {
	return { name: "test", agents: [], ...overrides } as HabitatConfig;
}

describe("repoNameFromGitUrl", () => {
	it.each([
		["https://github.com/The-Focus-AI/umwelten.git", "The-Focus-AI/umwelten"],
		["https://github.com/The-Focus-AI/umwelten", "The-Focus-AI/umwelten"],
		["git@github.com:The-Focus-AI/umwelten.git", "The-Focus-AI/umwelten"],
		["git@github.com:The-Focus-AI/umwelten", "The-Focus-AI/umwelten"],
		["ssh://git@github.com/The-Focus-AI/umwelten.git", "The-Focus-AI/umwelten"],
	])("parses %s", (url, expected) => {
		expect(repoNameFromGitUrl(url)).toBe(expected);
	});

	it.each([undefined, "", "   ", "not-a-url", "https://github.com/onlyowner"])(
		"returns undefined for %s rather than guessing",
		(url) => {
			expect(repoNameFromGitUrl(url as string | undefined)).toBeUndefined();
		},
	);
});

describe("bareRepoName", () => {
	it("drops the owner", () => {
		expect(bareRepoName("The-Focus-AI/umwelten")).toBe("umwelten");
	});

	it("passes through a name that has no owner", () => {
		expect(bareRepoName("umwelten")).toBe("umwelten");
	});

	it("returns undefined for nothing", () => {
		expect(bareRepoName(undefined)).toBeUndefined();
	});
});

describe("deriveRepoScopes", () => {
	it("derives nothing from an empty habitat", () => {
		expect(deriveRepoScopes(config())).toEqual({
			read: [],
			mounted: [],
			unresolved: [],
		});
	});

	it("includes the Owned repo in the read scope", () => {
		const derived = deriveRepoScopes(
			config({ gitUrl: "https://github.com/The-Focus-AI/client-upperhand.git" }),
		);
		expect(derived.owned).toBe("client-upperhand");
		expect(derived.read).toEqual(["client-upperhand"]);
	});

	it("widens the read scope for each Mounted repo", () => {
		const derived = deriveRepoScopes(
			config({
				gitUrl: "https://github.com/The-Focus-AI/client-upperhand.git",
				agents: [
					{ id: "a", name: "A", projectPath: "a", kind: "repo", mode: "read", gitRemote: "https://github.com/The-Focus-AI/uh-api.git" },
					{ id: "b", name: "B", projectPath: "b", kind: "repo", mode: "read", gitRemote: "git@github.com:The-Focus-AI/uh-web.git" },
				],
			}),
		);
		expect(derived.read).toEqual(["client-upperhand", "uh-api", "uh-web"]);
		expect(derived.mounted).toEqual(["uh-api", "uh-web"]);
	});

	it("narrows again when a mount is removed", () => {
		const withMount = deriveRepoScopes(
			config({
				agents: [
					{ id: "a", name: "A", projectPath: "a", kind: "repo", gitRemote: "https://github.com/x/one.git" },
				],
			}),
		);
		const without = deriveRepoScopes(config());
		expect(withMount.read).toEqual(["one"]);
		expect(without.read).toEqual([]);
	});

	it("does not duplicate a repo that is both owned and mounted", () => {
		const derived = deriveRepoScopes(
			config({
				gitUrl: "https://github.com/x/same.git",
				agents: [
					{ id: "a", name: "A", projectPath: "a", kind: "repo", gitRemote: "https://github.com/x/same.git" },
				],
			}),
		);
		expect(derived.read).toEqual(["same"]);
	});

	it("includes mcp-agent mounts, which are also cloned at boot", () => {
		const derived = deriveRepoScopes(
			config({
				agents: [
					{ id: "m", name: "M", projectPath: "m", kind: "mcp-agent", gitRemote: "https://github.com/x/tool.git" },
				],
			}),
		);
		expect(derived.read).toEqual(["tool"]);
	});

	it("ignores agents that are not code-bearing", () => {
		const derived = deriveRepoScopes(
			config({
				agents: [
					{ id: "r", name: "R", projectPath: "r", kind: "remote-habitat", a2aUrl: "http://peer/a2a" },
					{ id: "c", name: "C", projectPath: "c", kind: "credential-only" },
				],
			}),
		);
		expect(derived.read).toEqual([]);
	});

	it("ignores a repo agent with no remote", () => {
		const derived = deriveRepoScopes(
			config({
				agents: [{ id: "a", name: "A", projectPath: "a", kind: "repo" }],
			}),
		);
		expect(derived.read).toEqual([]);
		expect(derived.unresolved).toEqual([]);
	});

	it("reports an unparseable remote instead of silently dropping it", () => {
		const derived = deriveRepoScopes(
			config({
				agents: [
					{ id: "a", name: "A", projectPath: "a", kind: "repo", gitRemote: "wat" },
				],
			}),
		);
		expect(derived.read).toEqual([]);
		expect(derived.unresolved).toEqual(["wat"]);
	});

	it("never derives an org-wide read", () => {
		const derived = deriveRepoScopes(
			config({
				gitUrl: "https://github.com/x/a.git",
				agents: Array.from({ length: 5 }, (_, i) => ({
					id: `m${i}`,
					name: `M${i}`,
					projectPath: `m${i}`,
					kind: "repo" as const,
					gitRemote: `https://github.com/x/m${i}.git`,
				})),
			}),
		);
		expect(Array.isArray(derived.read)).toBe(true);
		expect(derived.read).toHaveLength(6);
	});

	it("does not produce a write scope — write is never derived", () => {
		const derived = deriveRepoScopes(
			config({ gitUrl: "https://github.com/x/owned.git" }),
		);
		expect(derived).not.toHaveProperty("write");
	});
});

describe("mergeDerivedReadScope", () => {
	const derived = deriveRepoScopes(
		config({
			gitUrl: "https://github.com/x/owned.git",
			agents: [
				{ id: "a", name: "A", projectPath: "a", kind: "repo", gitRemote: "https://github.com/x/mounted.git" },
			],
		}),
	);

	it("produces the derived list when nothing was declared", () => {
		expect(mergeDerivedReadScope(undefined, derived).read).toEqual([
			"owned",
			"mounted",
		]);
	});

	it("keeps explicitly declared repos the habitat does not mount", () => {
		const merged = mergeDerivedReadScope({ read: ["standards"] }, derived);
		expect(merged.read).toEqual(["standards", "owned", "mounted"]);
	});

	it("does not duplicate a repo that was already declared", () => {
		const merged = mergeDerivedReadScope({ read: ["owned"] }, derived);
		expect(merged.read).toEqual(["owned", "mounted"]);
	});

	it("preserves an existing org-wide read rather than narrowing it", () => {
		const merged = mergeDerivedReadScope({ read: "org" }, derived);
		expect(merged.read).toBe("org");
	});

	it("never touches the write scope", () => {
		const merged = mergeDerivedReadScope(
			{ read: [], write: ["owned"] },
			derived,
		);
		expect(merged.write).toEqual(["owned"]);
	});

	it("leaves write absent when none was declared, even though a repo is owned", () => {
		expect(mergeDerivedReadScope({ read: [] }, derived).write).toBeUndefined();
	});
});
