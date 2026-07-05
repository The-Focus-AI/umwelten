/**
 * create_habitat defaulting tests.
 *
 * Regression: provider/model were REQUIRED in the tool schema while their
 * descriptions promised defaults — a model that trusted the "default:" hint
 * and omitted them failed the tool call with a missing-parameter error.
 * Now they're optional and an omitted value inherits Gaia's own.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GaiaRegistryManager } from "./registry.js";
import { GaiaSecretVault } from "./secrets.js";
import { CredentialCatalog } from "./credential-catalog.js";
import { createHabitatLifecycleTools } from "./gaia-tools/habitats.js";
import type { GaiaToolsContext } from "./gaia-tools/context.js";

function mockDockerManager() {
	return {
		buildImage: vi.fn().mockResolvedValue("built"),
		isDockerAvailable: vi.fn().mockResolvedValue(true),
		imageExists: vi.fn().mockResolvedValue(true),
		getStatus: vi.fn().mockResolvedValue("exited"),
		getLogs: vi.fn().mockResolvedValue(""),
		startContainer: vi.fn().mockResolvedValue(7440),
		stopContainer: vi.fn().mockResolvedValue(undefined),
		seedVolume: vi.fn().mockResolvedValue(undefined),
	} as any;
}

describe("create_habitat provider/model defaults", () => {
	let dataDir: string;
	let registry: GaiaRegistryManager;
	let vault: GaiaSecretVault;
	let catalog: CredentialCatalog;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-create-test-"));
		registry = new GaiaRegistryManager(dataDir);
		vault = new GaiaSecretVault(dataDir);
		catalog = new CredentialCatalog(dataDir);
		await registry.load();
		await vault.load();
		await catalog.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	function tools(gaia?: { provider?: string; model?: string }) {
		const ctx = {
			registry,
			vault,
			docker: mockDockerManager(),
			catalog,
			audit: { log: vi.fn() } as any,
			gaiaDataDir: dataDir,
			gaiaProvider: gaia?.provider,
			gaiaModel: gaia?.model,
		} as unknown as GaiaToolsContext;
		return createHabitatLifecycleTools(ctx);
	}

	async function create(t: Record<string, any>, input: Record<string, unknown>) {
		return t.create_habitat.execute(input, {} as any);
	}

	it("an omitted provider/model inherits Gaia's own", async () => {
		const t = tools({ provider: "openrouter", model: "anthropic/claude-sonnet-4.6" });
		await create(t, { id: "newbie", name: "Newbie" });
		const entry = registry.get("newbie")!;
		expect(entry.config.defaultProvider).toBe("openrouter");
		expect(entry.config.defaultModel).toBe("anthropic/claude-sonnet-4.6");
	});

	it("explicit provider/model win over Gaia's defaults", async () => {
		const t = tools({ provider: "openrouter", model: "anthropic/claude-sonnet-4.6" });
		await create(t, {
			id: "explicit",
			name: "Explicit",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		const entry = registry.get("explicit")!;
		expect(entry.config.defaultProvider).toBe("google");
		expect(entry.config.defaultModel).toBe("gemini-3-flash-preview");
	});

	it("falls back to google/gemini-3-flash-preview when Gaia has no defaults", async () => {
		const t = tools();
		await create(t, { id: "bare", name: "Bare" });
		const entry = registry.get("bare")!;
		expect(entry.config.defaultProvider).toBe("google");
		expect(entry.config.defaultModel).toBe("gemini-3-flash-preview");
	});

	it("declares provider and model as optional in the tool schema", () => {
		const t = tools();
		const shape = (t.create_habitat as any).inputSchema.shape;
		expect(shape.provider.isOptional()).toBe(true);
		expect(shape.model.isOptional()).toBe(true);
	});
});
