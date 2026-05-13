import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CapabilityResolver } from "./capability-resolver.js";
import { CredentialCatalog } from "./credential-catalog.js";
import { GaiaSecretVault } from "./secrets.js";
import type { CredentialEntry, GaiaHabitatEntry } from "./types.js";
import type { CapabilityBinding } from "../../types.js";
import { buildSeedFiles } from "./gaia-tools.js";

function makeCredential(
	overrides: Partial<CredentialEntry> = {},
): CredentialEntry {
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

function makeHabitatEntry(
	overrides: Partial<GaiaHabitatEntry> = {},
): GaiaHabitatEntry {
	return {
		id: "test-habitat",
		name: "Test Habitat",
		config: {
			name: "Test Habitat",
			defaultProvider: "google",
			defaultModel: "gemini-3-flash-preview",
			agents: [],
		},
		secretBindings: [],
		apiKey: "gaia_testkey123",
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

describe("CapabilityResolver", () => {
	let dataDir: string;
	let catalog: CredentialCatalog;
	let vault: GaiaSecretVault;
	let resolver: CapabilityResolver;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cap-resolver-"));
		catalog = new CredentialCatalog(dataDir);
		await catalog.load();
		vault = new GaiaSecretVault(dataDir);
		await vault.load();
		resolver = new CapabilityResolver();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	// ── Valid bindings ─────────────────────────────────────────────────

	it("resolves valid capability bindings to env vars", async () => {
		await catalog.add(
			makeCredential({
				name: "gh-read",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await vault.set("gh-read", "ghp_secret123");

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "gh-read" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.envVars).toEqual({ "gh-read": "ghp_secret123" });
		expect(result.warnings).toEqual([]);
	});

	it("resolves multiple bindings", async () => {
		await catalog.add(
			makeCredential({
				name: "gh-key",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await catalog.add(
			makeCredential({
				name: "qb-key",
				capabilities: ["quickbooks:read"],
				status: "active",
			}),
		);
		await vault.set("gh-key", "ghp_123");
		await vault.set("qb-key", "qbp_456");

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "gh-key" },
			{ capability: "quickbooks:read", credential: "qb-key" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.envVars).toEqual({
			"gh-key": "ghp_123",
			"qb-key": "qbp_456",
		});
		expect(result.warnings).toEqual([]);
	});

	// ── Missing credential ──────────────────────────────────────────────

	it("rejects bindings where credential doesn't exist in catalog", async () => {
		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "nonexistent" },
		];

		expect(() => resolver.resolve(bindings, catalog, vault)).toThrow(
			'Credential "nonexistent" not found in catalog',
		);
	});

	// ── Expired credential ──────────────────────────────────────────────

	it("warns when credential status is expired", async () => {
		await catalog.add(
			makeCredential({
				name: "old-key",
				capabilities: ["github:read"],
				status: "expired",
			}),
		);
		await vault.set("old-key", "ghp_old");

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "old-key" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.warnings).toContain('Credential "old-key" is marked expired');
		expect(result.envVars).toEqual({ "old-key": "ghp_old" }); // still resolves value
	});

	// ── Expired refresh token ───────────────────────────────────────────

	it("warns when refresh token has expired", async () => {
		const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
		await catalog.add(
			makeCredential({
				name: "stale-key",
				capabilities: ["github:read"],
				status: "active",
				refreshTokenExpiry: pastDate,
			}),
		);
		await vault.set("stale-key", "ghp_stale");

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "stale-key" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.warnings.length).toBeGreaterThan(0);
		expect(result.warnings[0]).toContain("refresh token expired");
		expect(result.warnings[0]).toContain("stale-key");
		expect(result.envVars).toEqual({ "stale-key": "ghp_stale" });
	});

	it("does not warn when refresh token is in the future", async () => {
		const futureDate = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days
		await catalog.add(
			makeCredential({
				name: "fresh-key",
				capabilities: ["github:read"],
				status: "active",
				refreshTokenExpiry: futureDate,
			}),
		);
		await vault.set("fresh-key", "ghp_fresh");

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "fresh-key" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.warnings).toEqual([]);
		expect(result.envVars).toEqual({ "fresh-key": "ghp_fresh" });
	});

	// ── Empty bindings ──────────────────────────────────────────────────

	it("returns empty result for empty bindings", () => {
		const result = resolver.resolve([], catalog, vault);
		expect(result.envVars).toEqual({});
		expect(result.warnings).toEqual([]);
	});

	// ── Credential without vault value ──────────────────────────────────

	it("omits credential from envVars when vault has no value", async () => {
		await catalog.add(
			makeCredential({
				name: "no-vault-key",
				capabilities: ["github:read"],
				status: "active",
			}),
		);

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "no-vault-key" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.envVars).toEqual({});
		expect(result.warnings).toEqual([]);
	});

	// ── Overlapping capabilities ────────────────────────────────────────

	it("handles overlapping capabilities (multiple bindings for same capability)", async () => {
		await catalog.add(
			makeCredential({
				name: "key-a",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await catalog.add(
			makeCredential({
				name: "key-b",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await vault.set("key-a", "val-a");
		await vault.set("key-b", "val-b");

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "key-a" },
			{ capability: "github:read", credential: "key-b" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.envVars).toEqual({ "key-a": "val-a", "key-b": "val-b" });
	});
});

describe("buildSeedFiles with capabilities", () => {
	let dataDir: string;
	let catalog: CredentialCatalog;
	let vault: GaiaSecretVault;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "buildSeed-"));
		catalog = new CredentialCatalog(dataDir);
		await catalog.load();
		vault = new GaiaSecretVault(dataDir);
		await vault.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	function extractSecrets(
		files: Array<{ path: string; content: string }>,
	): Record<string, string> {
		const f = files.find((x) => x.path === "secrets.json");
		if (!f) throw new Error("secrets.json not found in seed files");
		return JSON.parse(f.content);
	}

	function extractConfig(
		files: Array<{ path: string; content: string }>,
	): Record<string, unknown> {
		const f = files.find((x) => x.path === "config.json");
		if (!f) throw new Error("config.json not found in seed files");
		return JSON.parse(f.content);
	}

	// ── Capabilities resolved into secrets.json ─────────────────────────

	it("includes capability-resolved secrets in secrets.json", async () => {
		await catalog.add(
			makeCredential({
				name: "gh-key",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await vault.set("gh-key", "ghp_test123");

		const entry = makeHabitatEntry();
		entry.config.capabilities = [
			{ capability: "github:read", credential: "gh-key" },
		];

		const files = buildSeedFiles(entry, vault, catalog);
		expect(extractSecrets(files)).toEqual({ "gh-key": "ghp_test123" });
	});

	// ── Both direct bindings AND capability-resolved values ─────────────

	it("includes both secretBindings and capability-resolved values", async () => {
		await catalog.add(
			makeCredential({
				name: "gh-key",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await vault.set("DIRECT_SECRET", "direct_val");
		await vault.set("gh-key", "ghp_test123");

		const entry = makeHabitatEntry();
		entry.secretBindings = ["DIRECT_SECRET"];
		entry.config.capabilities = [
			{ capability: "github:read", credential: "gh-key" },
		];

		const files = buildSeedFiles(entry, vault, catalog);
		expect(extractSecrets(files)).toEqual({
			DIRECT_SECRET: "direct_val",
			"gh-key": "ghp_test123",
		});
	});

	// ── No capabilities field (backward compat) ─────────────────────────

	it("handles habitats without capabilities field (backward compat)", async () => {
		await vault.set("DIRECT_SECRET", "direct_val");

		const entry = makeHabitatEntry();
		entry.secretBindings = ["DIRECT_SECRET"];

		const files = buildSeedFiles(entry, vault, catalog);
		expect(extractSecrets(files)).toEqual({ DIRECT_SECRET: "direct_val" });
	});

	it("handles habitats with empty capabilities array", async () => {
		await vault.set("DIRECT_SECRET", "direct_val");

		const entry = makeHabitatEntry();
		entry.secretBindings = ["DIRECT_SECRET"];
		entry.config.capabilities = [];

		const files = buildSeedFiles(entry, vault, catalog);
		expect(extractSecrets(files)).toEqual({ DIRECT_SECRET: "direct_val" });
	});

	// ── No catalog provided (backward compat) ───────────────────────────

	it("handles missing catalog (backward compat — no catalog parameter)", async () => {
		await vault.set("DIRECT_SECRET", "direct_val");

		const entry = makeHabitatEntry();
		entry.secretBindings = ["DIRECT_SECRET"];
		entry.config.capabilities = [
			{ capability: "github:read", credential: "gh-key" },
		];

		// No catalog — capabilities are ignored
		const files = buildSeedFiles(entry, vault);
		expect(extractSecrets(files)).toEqual({ DIRECT_SECRET: "direct_val" });
	});

	// ── Config.json still contains capabilities ─────────────────────────

	it("config.json includes capabilities field", async () => {
		await catalog.add(
			makeCredential({
				name: "gh-key",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await vault.set("gh-key", "ghp_test");

		const entry = makeHabitatEntry();
		entry.config.capabilities = [
			{ capability: "github:read", credential: "gh-key" },
		];

		const files = buildSeedFiles(entry, vault, catalog);
		expect(extractConfig(files).capabilities).toEqual([
			{ capability: "github:read", credential: "gh-key" },
		]);
	});
});

describe("CapabilityResolver — expired and missing edge cases", () => {
	let dataDir: string;
	let catalog: CredentialCatalog;
	let vault: GaiaSecretVault;
	let resolver: CapabilityResolver;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "cap-edge-"));
		catalog = new CredentialCatalog(dataDir);
		await catalog.load();
		vault = new GaiaSecretVault(dataDir);
		await vault.load();
		resolver = new CapabilityResolver();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("combines both expired status and expired refresh token warnings", async () => {
		const pastDate = new Date(Date.now() - 86400000 * 7).toISOString();
		await catalog.add(
			makeCredential({
				name: "bad-key",
				capabilities: ["github:read"],
				status: "expired",
				refreshTokenExpiry: pastDate,
			}),
		);
		await vault.set("bad-key", "val");

		const bindings: CapabilityBinding[] = [
			{ capability: "github:read", credential: "bad-key" },
		];

		const result = resolver.resolve(bindings, catalog, vault);
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings).toContain('Credential "bad-key" is marked expired');
		expect(result.envVars).toEqual({ "bad-key": "val" });
	});

	it("errors on first missing credential even when others are valid", async () => {
		await catalog.add(
			makeCredential({
				name: "valid-key",
				capabilities: ["github:read"],
				status: "active",
			}),
		);
		await vault.set("valid-key", "val");

		const bindings: CapabilityBinding[] = [
			{ capability: "nothing", credential: "missing-key" },
			{ capability: "github:read", credential: "valid-key" },
		];

		expect(() => resolver.resolve(bindings, catalog, vault)).toThrow(
			'Credential "missing-key"',
		);
	});
});
