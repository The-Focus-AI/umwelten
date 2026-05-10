import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityResolver } from "./capability-resolver.js";
import { CredentialCatalog } from "./credential-catalog.js";
import { GaiaSecretVault } from "./secrets.js";
import { GaiaRegistryManager } from "./registry.js";
import type { CredentialEntry, GaiaHabitatEntry } from "./types.js";
import type { CapabilityBinding } from "../types.js";

function makeCredential(overrides: Partial<CredentialEntry> = {}): CredentialEntry {
	return {
		name: "test-key",
		label: "Test Key",
		provider: "github",
		capabilities: ["github:read"],
		scopes: ["repo:read"],
		status: "unknown",
		...overrides,
	};
}

describe("CapabilityResolver.validate", () => {
	let dataDir: string;
	let catalog: CredentialCatalog;
	let resolver: CapabilityResolver;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cap-validate-"));
		catalog = new CredentialCatalog(dataDir);
		await catalog.load();
		resolver = new CapabilityResolver();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("returns the catalog entry when credential exists and grants capability", async () => {
		const entry = makeCredential({
			name: "gh-key",
			capabilities: ["github:read", "github:write"],
		});
		await catalog.add(entry);

		const result = resolver.validate(
			{ capability: "github:read", credential: "gh-key" },
			catalog,
		);
		expect(result.name).toBe("gh-key");
		expect(result.capabilities).toContain("github:read");
	});

	it("throws when credential does not exist", () => {
		expect(() =>
			resolver.validate(
				{ capability: "github:read", credential: "missing-key" },
				catalog,
			),
		).toThrow('Credential "missing-key" not found in catalog');
	});

	it("throws when credential exists but does not grant the capability", async () => {
		await catalog.add(
			makeCredential({
				name: "gh-key",
				capabilities: ["github:read"],
			}),
		);

		expect(() =>
			resolver.validate(
				{ capability: "quickbooks:read", credential: "gh-key" },
				catalog,
			),
		).toThrow(
			'Credential "gh-key" does not grant capability "quickbooks:read"',
		);
	});
});

describe("Gaia registry — create with capabilities", () => {
	let dataDir: string;
	let registry: GaiaRegistryManager;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-reg-cap-"));
		registry = new GaiaRegistryManager(dataDir);
		await registry.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("stores capabilities in the habitat config", async () => {
		const entry = await registry.create({
			id: "test-habitat",
			name: "Test Habitat",
			provider: "google",
			model: "gemini-3-flash-preview",
			capabilities: [
				{ capability: "github:read", credential: "gh-key" },
			],
		});

		expect(entry.config.capabilities).toEqual([
			{ capability: "github:read", credential: "gh-key" },
		]);
	});

	it("handles creation without capabilities (backward compat)", async () => {
		const entry = await registry.create({
			id: "no-cap",
			name: "No Cap",
			provider: "google",
			model: "gemini-3-flash-preview",
		});

		expect(entry.config.capabilities).toBeUndefined();
	});

	it("handles empty capabilities array", async () => {
		const entry = await registry.create({
			id: "empty-cap",
			name: "Empty Cap",
			provider: "google",
			model: "gemini-3-flash-preview",
			capabilities: [],
		});

		expect(entry.config.capabilities).toBeUndefined();
		// Empty arrays are skipped by the spread conditional
	});
});
