import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GaiaRegistryManager } from "./registry.js";
import { GaiaSecretVault } from "./secrets.js";
import { CredentialCatalog } from "./credential-catalog.js";
import { createGaiaToolSet, type GaiaToolsContext } from "./gaia-tools.js";
import { STANDARDS_AGENT_ID, ORG_READONLY_TEMPLATE_ID } from "./gaia-seed.js";
import type { AgentEntry } from "../../types.js";

// Mock the A2A server module: define the mock factory inline to avoid
// the vitest hoisting restriction on top-level variables.
vi.mock("@umwelten/protocols", () => {
	const sendA2AMessage = vi.fn();
	return {
		sendA2AMessage,
		fetchAgentCard: vi.fn(),
	};
});

/** Build a standards agent entry that matches what seedStandardsAgent produces. */
function makeStandardsAgent(): AgentEntry {
	return {
		id: STANDARDS_AGENT_ID,
		name: "Standards",
		kind: "repo",
		mode: "read",
		gitRemote: "https://github.com/example/standards.git",
		projectPath: "/data/agents/standards/repo",
		identity: {
			principal: STANDARDS_AGENT_ID,
			vault: { backend: "habitat" },
			scopes: [
				{
					kind: "git-read",
					env: ["GITHUB_TOKEN"],
					source: ORG_READONLY_TEMPLATE_ID,
				},
			],
		},
	};
}

/** Minimal mock DockerManager for tests that don't actually start containers. */
function mockDockerManager(
	overrides: Partial<{
		status: string;
		buildOutput: string;
		logs: string;
	}> = {},
) {
	const status = overrides.status ?? "exited";
	return {
		buildImage: vi.fn().mockResolvedValue(overrides.buildOutput ?? "built"),
		isDockerAvailable: vi.fn().mockResolvedValue(true),
		imageExists: vi.fn().mockResolvedValue(true),
		getStatus: vi.fn().mockResolvedValue(status),
		getLogs: vi.fn().mockResolvedValue(overrides.logs ?? ""),
		startContainer: vi.fn().mockResolvedValue(9999),
		stopContainer: vi.fn().mockResolvedValue(undefined),
		seedVolume: vi.fn().mockResolvedValue(undefined),
	} as any;
}

describe("broadcast_standards tool", () => {
	let dataDir: string;
	let registry: GaiaRegistryManager;
	let vault: GaiaSecretVault;
	let catalog: CredentialCatalog;
	let mockSendA2AMessage: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-standards-test-"));
		registry = new GaiaRegistryManager(dataDir);
		vault = new GaiaSecretVault(dataDir);
		catalog = new CredentialCatalog(dataDir);
		await registry.load();
		await vault.load();
		await catalog.load();

		// Re-import the mocked module to get a fresh reference after reset
		const mod = await import("@umwelten/protocols");
		mockSendA2AMessage = vi.mocked(mod.sendA2AMessage);
		mockSendA2AMessage.mockReset();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("skips habitats that are not running", async () => {
		const docker = mockDockerManager({ status: "exited" });

		await registry.create({
			id: "sleepy-hab",
			name: "Sleepy Habitat",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		const entry = registry.get("sleepy-hab")!;
		entry.config.agents = [makeStandardsAgent()];
		await registry.update("sleepy-hab", { config: entry.config });

		const ctx: GaiaToolsContext = { registry, vault, docker, catalog };
		const tools = createGaiaToolSet(ctx).createTools();
		const result = (await tools.broadcast_standards.execute!({
			habitatId: undefined,
		})) as string;

		expect(mockSendA2AMessage).not.toHaveBeenCalled();
		expect(result).toContain("No eligible habitats to audit");
		expect(result).toContain("is not running");
	});

	it("skips habitats without a standards agent", async () => {
		const docker = mockDockerManager({ status: "running" });

		await registry.create({
			id: "no-standards-hab",
			name: "No Standards",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		await registry.update("no-standards-hab", { containerPort: 9000 });

		const ctx: GaiaToolsContext = { registry, vault, docker, catalog };
		const tools = createGaiaToolSet(ctx).createTools();
		const result = (await tools.broadcast_standards.execute!({
			habitatId: undefined,
		})) as string;

		expect(mockSendA2AMessage).not.toHaveBeenCalled();
		expect(result).toContain("No eligible habitats to audit");
		expect(result).toContain("has no standards agent");
	});

	it("audits a specific running habitat with standards agent", async () => {
		mockSendA2AMessage.mockResolvedValue({
			text: "Compliant: code-review checklist, linting. Non-compliant (warn): missing security scan. Remediations: add secret scanning to CI.",
			artifacts: undefined,
		});

		const docker = mockDockerManager({ status: "running" });

		const entry = await registry.create({
			id: "compliant-hab",
			name: "Compliant Habitat",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		entry.config.agents = [makeStandardsAgent()];
		await registry.update("compliant-hab", {
			config: entry.config,
			containerPort: 9001,
		});

		const ctx: GaiaToolsContext = { registry, vault, docker, catalog };
		const tools = createGaiaToolSet(ctx).createTools();
		const result = (await tools.broadcast_standards.execute!({
			habitatId: "compliant-hab",
		})) as string;

		expect(mockSendA2AMessage).toHaveBeenCalledTimes(1);
		expect(result).toContain("Standards Audit");
		expect(result).toContain("Responded: 1/1");
		expect(result).toContain("Compliant Habitat");
		expect(result).toContain("security scan");
	});

	it("audits all running habitats with standards agents", async () => {
		mockSendA2AMessage.mockResolvedValue({
			text: "All checks passed.",
			artifacts: undefined,
		});

		const docker = mockDockerManager({ status: "running" });

		// Habitat 1: running, has standards agent
		const hab1 = await registry.create({
			id: "hab-1",
			name: "Habitat One",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		hab1.config.agents = [makeStandardsAgent()];
		await registry.update("hab-1", {
			config: hab1.config,
			containerPort: 9010,
		});

		// Habitat 2: running, has standards agent
		const hab2 = await registry.create({
			id: "hab-2",
			name: "Habitat Two",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		hab2.config.agents = [makeStandardsAgent()];
		await registry.update("hab-2", {
			config: hab2.config,
			containerPort: 9020,
		});

		// Habitat 3: running, NO standards agent — should be skipped
		await registry.create({
			id: "hab-3",
			name: "Habitat Three",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		await registry.update("hab-3", { containerPort: 9030 });

		// Habitat 4: NOT running, has standards agent — should be skipped
		const hab4 = await registry.create({
			id: "hab-4",
			name: "Habitat Four",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		hab4.config.agents = [makeStandardsAgent()];
		await registry.update("hab-4", { config: hab4.config });

		const ctx: GaiaToolsContext = { registry, vault, docker, catalog };
		const tools = createGaiaToolSet(ctx).createTools();
		const result = (await tools.broadcast_standards.execute!({
			habitatId: undefined,
		})) as string;

		// Should have called sendA2AMessage for exactly 2 habitats (hab-1, hab-2)
		expect(mockSendA2AMessage).toHaveBeenCalledTimes(2);
		expect(result).toContain("Responded: 2/2");
		expect(result).toContain("Unresponsive: 0/2");
		expect(result).toContain("Habitat One");
		expect(result).toContain("Habitat Two");
		expect(result).toContain("hab-3");
		expect(result).toContain("has no standards agent");
		expect(result).toContain("hab-4");
		expect(result).toContain("is not running");
	});

	it("reports 'not found' for a habitatId that does not exist", async () => {
		const docker = mockDockerManager({ status: "running" });

		const ctx: GaiaToolsContext = { registry, vault, docker, catalog };
		const tools = createGaiaToolSet(ctx).createTools();
		const result = (await tools.broadcast_standards.execute!({
			habitatId: "nonexistent",
		})) as string;

		expect(result).toBe('Habitat "nonexistent" not found.');
	});

	it("reports 'no habitats registered' when registry is empty", async () => {
		const docker = mockDockerManager({ status: "running" });

		const ctx: GaiaToolsContext = { registry, vault, docker, catalog };
		const tools = createGaiaToolSet(ctx).createTools();
		const result = (await tools.broadcast_standards.execute!({
			habitatId: undefined,
		})) as string;

		expect(result).toBe("No habitats registered.");
	});

	it("handles unresponsive habitat (timeout)", async () => {
		mockSendA2AMessage.mockRejectedValue(new Error("timeout"));

		const docker = mockDockerManager({ status: "running" });

		const entry = await registry.create({
			id: "slow-hab",
			name: "Slow Habitat",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		entry.config.agents = [makeStandardsAgent()];
		await registry.update("slow-hab", {
			config: entry.config,
			containerPort: 9005,
		});

		const ctx: GaiaToolsContext = { registry, vault, docker, catalog };
		const tools = createGaiaToolSet(ctx).createTools();
		const result = (await tools.broadcast_standards.execute!({
			habitatId: undefined,
		})) as string;

		expect(result).toContain("Unresponsive: 1/1");
		expect(result).toContain("Slow Habitat");
		expect(result).toContain("Unresponsive");
	});
});
