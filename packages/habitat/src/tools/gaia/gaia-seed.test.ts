import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	seedOrgReadonly,
	orgReadonlyBindings,
	ORG_READONLY_AGENT_ID,
	ORG_READONLY_TEMPLATE_ID,
	STANDARDS_AGENT_ID,
	seedStandardsAgent,
} from "./gaia-seed.js";
import { GaiaSecretVault } from "./secrets.js";
import type { HabitatConfig } from "../../types.js";

function freshConfig(): HabitatConfig {
	return { agents: [] } as unknown as HabitatConfig;
}

describe("seedStandardsAgent", () => {
	it("is a no-op when Gaia has no standardsRepoUrl", () => {
		const config = freshConfig();
		const result = seedStandardsAgent(config, {});

		expect(result.agentAdded).toBe(false);
		expect(config.agents).toEqual([]);
	});

	it("adds a read-only standards repo agent from Gaia config", async () => {
		const config = freshConfig();
		config.scopeTemplates = {
			[ORG_READONLY_TEMPLATE_ID]: {
				from: `agents/${ORG_READONLY_AGENT_ID}`,
				kind: "git-read",
				env: ["GITHUB_TOKEN"],
			},
		};

		const result = seedStandardsAgent(config, {
			standardsRepoUrl: "https://github.com/example/standards.git",
			standardsRepoBranch: "main",
		});

		expect(result).toEqual({
			agentAdded: true,
			repoUrl: "https://github.com/example/standards.git",
		});
		const agent = config.agents.find((a) => a.id === STANDARDS_AGENT_ID);
		expect(agent).toMatchObject({
			id: STANDARDS_AGENT_ID,
			name: "Standards",
			kind: "repo",
			mode: "read",
			gitRemote: "https://github.com/example/standards.git",
			gitBranch: "main",
			projectPath: "/data/agents/standards/repo",
		});
		expect(agent?.identity?.scopes[0]).toEqual({
			kind: "git-read",
			env: ["GITHUB_TOKEN"],
			source: ORG_READONLY_TEMPLATE_ID,
		});
	});

	it("is idempotent — re-running does not duplicate standards", () => {
		const config = freshConfig();
		seedStandardsAgent(config, {
			standardsRepoUrl: "https://github.com/example/standards.git",
		});
		const second = seedStandardsAgent(config, {
			standardsRepoUrl: "https://github.com/example/standards.git",
		});

		expect(second.agentAdded).toBe(false);
		expect(
			config.agents.filter((a) => a.id === STANDARDS_AGENT_ID),
		).toHaveLength(1);
	});
});

describe("seedOrgReadonly", () => {
	let dataDir: string;
	let vault: GaiaSecretVault;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-seed-"));
		vault = new GaiaSecretVault(dataDir);
		await vault.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("is a no-op when the master vault has no org tokens", () => {
		const config = freshConfig();
		const result = seedOrgReadonly(config, vault);
		expect(result.bindings).toEqual([]);
		expect(result.scopeAdded).toBe(false);
		expect(result.agentAdded).toBe(false);
		expect(config.agents).toEqual([]);
		expect(config.scopeTemplates).toBeUndefined();
	});

	it("adds scopeTemplate + agent when GITHUB_TOKEN is in the vault", async () => {
		await vault.set("GITHUB_TOKEN", "ghp_test");
		const config = freshConfig();
		const result = seedOrgReadonly(config, vault);

		expect(result.bindings).toEqual(["GITHUB_TOKEN"]);
		expect(result.scopeAdded).toBe(true);
		expect(result.agentAdded).toBe(true);

		expect(config.scopeTemplates?.[ORG_READONLY_TEMPLATE_ID]).toBeDefined();
		expect(config.scopeTemplates?.[ORG_READONLY_TEMPLATE_ID].kind).toBe(
			"git-read",
		);
		expect(config.scopeTemplates?.[ORG_READONLY_TEMPLATE_ID].env).toEqual([
			"GITHUB_TOKEN",
		]);

		const agent = config.agents.find((a) => a.id === ORG_READONLY_AGENT_ID);
		expect(agent).toBeDefined();
		expect(agent?.kind).toBe("credential-only");
		expect(agent?.mode).toBe("read");
		expect(agent?.identity?.scopes[0].source).toBe(ORG_READONLY_TEMPLATE_ID);
	});

	it("is idempotent — re-running does not add duplicates", async () => {
		await vault.set("GITHUB_TOKEN", "ghp_test");
		const config = freshConfig();
		seedOrgReadonly(config, vault);
		const second = seedOrgReadonly(config, vault);
		expect(second.scopeAdded).toBe(false);
		expect(second.agentAdded).toBe(false);
		expect(
			config.agents.filter((a) => a.id === ORG_READONLY_AGENT_ID),
		).toHaveLength(1);
	});

	it("orgReadonlyBindings reflects the master vault state", async () => {
		expect(orgReadonlyBindings(vault)).toEqual([]);
		await vault.set("GITHUB_TOKEN", "ghp_x");
		expect(orgReadonlyBindings(vault)).toEqual(["GITHUB_TOKEN"]);
	});
});
