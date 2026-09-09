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
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { GaiaRegistryManager } from "./registry.js";
import { GaiaSecretVault } from "./secrets.js";
import { CredentialCatalog } from "./credential-catalog.js";
import { createHabitatLifecycleTools } from "./gaia-tools/habitats.js";
import type { GaiaToolsContext } from "./gaia-tools/context.js";
import { handleGaiaRoute, type GaiaRouteContext } from "./routes.js";

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

	async function create(
		t: Record<string, any>,
		input: Record<string, unknown>,
	) {
		return t.create_habitat.execute(input, {} as any);
	}

	it("an omitted provider/model inherits Gaia's own", async () => {
		const t = tools({
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.6",
		});
		await create(t, { id: "newbie", name: "Newbie" });
		const entry = registry.get("newbie")!;
		expect(entry.config.defaultProvider).toBe("openrouter");
		expect(entry.config.defaultModel).toBe("anthropic/claude-sonnet-4.6");
	});

	it("explicit provider/model win over Gaia's defaults", async () => {
		const t = tools({
			provider: "openrouter",
			model: "anthropic/claude-sonnet-4.6",
		});
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

	it("falls back to Mycel/DeepSeek V4 Pro when Gaia has no defaults", async () => {
		const t = tools();
		await create(t, { id: "bare", name: "Bare" });
		const entry = registry.get("bare")!;
		expect(entry.config.defaultProvider).toBe("mycel");
		expect(entry.config.defaultModel).toBe("deepseek/deepseek-v4-pro");
	});

	it("declares provider and model as optional in the tool schema", () => {
		const t = tools();
		const shape = (t.create_habitat as any).inputSchema.shape;
		expect(shape.provider.isOptional()).toBe(true);
		expect(shape.model.isOptional()).toBe(true);
	});

	async function post(ctx: GaiaRouteContext, url: string, body = {}) {
		const req = Object.assign(
			Readable.from([Buffer.from(JSON.stringify(body))]),
			{
				method: "POST",
				url,
				headers: {},
			},
		) as IncomingMessage;
		const res = { writeHead: vi.fn(), end: vi.fn() };
		expect(
			await handleGaiaRoute(ctx, req, res as unknown as ServerResponse),
		).toBe(true);
		return {
			status: res.writeHead.mock.calls[0][0],
			body: JSON.parse(res.end.mock.calls[0][0]),
		};
	}

	it("REST creation inherits Gaia's Exchange model while preserving explicit overrides", async () => {
		const ctx = {
			registry,
			vault,
			catalog,
			docker: mockDockerManager(),
			audit: {} as any,
			gaiaProvider: "mycel",
			gaiaModel: "moonshotai/kimi-k3",
		};
		expect(
			(await post(ctx, "/api/habitats", { id: "rest", name: "REST" })).status,
		).toBe(201);
		expect(registry.get("rest")!.config).toMatchObject({
			defaultProvider: "mycel",
			defaultModel: "moonshotai/kimi-k3",
		});
		await post(ctx, "/api/habitats", {
			id: "explicit",
			name: "Explicit",
			provider: "google",
			model: "gemini-3-flash-preview",
		});
		expect(registry.get("explicit")!.config.defaultProvider).toBe("google");
	});

	it.each(["start", "rebuild"])(
		"REST %s supplies the vault credential without writing it to the child volume",
		async (action) => {
			await create(tools(), { id: "exchange", name: "Exchange" });
			await vault.set("MYCEL_API_KEY", "platform-exchange-key");
			const docker = mockDockerManager();
			const ctx = {
				registry,
				vault,
				catalog,
				docker,
				audit: {} as any,
				gaiaConfig: { modelCredentials: { mycel: "MYCEL_API_KEY" } },
			};
			expect((await post(ctx, `/api/habitats/exchange/${action}`)).status).toBe(
				200,
			);
			expect(docker.startContainer).toHaveBeenCalledWith(
				expect.objectContaining({ id: "exchange" }),
				"",
				expect.any(Array),
				expect.objectContaining({
					modelCredential: {
						envName: "MYCEL_API_KEY",
						value: "platform-exchange-key",
					},
				}),
			);
			expect(JSON.stringify(docker.seedVolume.mock.calls)).not.toContain(
				"platform-exchange-key",
			);
			expect(registry.get("exchange")!.containerPort).toBe(7440);
		},
	);
});
