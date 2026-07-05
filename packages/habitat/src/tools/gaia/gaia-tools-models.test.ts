/**
 * list_models tests — live OpenRouter catalog discovery for Gaia.
 *
 * The tool exists so Gaia stops writing stale model ids from memory: it must
 * return real ids, newest first, filterable, and degrade with structured
 * errors when the key is missing or the catalog call fails.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GaiaSecretVault } from "./secrets.js";
import { createModelDiscoveryTools } from "./gaia-tools/models.js";
import type { GaiaToolsContext } from "./gaia-tools/context.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";

function model(
	name: string,
	added: string,
	costs?: { promptTokens: number; completionTokens: number },
): ModelDetails {
	return {
		name,
		provider: "openrouter",
		addedDate: new Date(added),
		contextLength: 200000,
		costs,
	} as ModelDetails;
}

const CATALOG: ModelDetails[] = [
	model("anthropic/claude-sonnet-4.6", "2026-02-01", {
		promptTokens: 3,
		completionTokens: 15,
	}),
	model("anthropic/claude-sonnet-4.7", "2026-06-01", {
		promptTokens: 3,
		completionTokens: 15,
	}),
	model("openai/gpt-4o-mini", "2024-07-18", {
		promptTokens: 0.15,
		completionTokens: 0.6,
	}),
	model("google/gemini-3-flash-preview", "2026-04-01"),
];

describe("list_models", () => {
	let dataDir: string;
	let vault: GaiaSecretVault;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "gaia-models-test-"));
		vault = new GaiaSecretVault(dataDir);
		await vault.load();
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
		vi.unstubAllEnvs();
	});

	function tools(lister = vi.fn().mockResolvedValue(CATALOG)) {
		const ctx = { vault } as unknown as GaiaToolsContext;
		return {
			t: createModelDiscoveryTools(ctx, { listOpenRouterModels: lister }),
			lister,
		};
	}

	async function run(t: Record<string, any>, input: Record<string, unknown> = {}) {
		return t.list_models.execute(input, {} as any);
	}

	it("returns models newest first with exact ids", async () => {
		await vault.set("OPENROUTER_API_KEY", "sk-or-test");
		const { t } = tools();
		const out = await run(t);
		expect(out.models.map((m: any) => m.id)).toEqual([
			"anthropic/claude-sonnet-4.7",
			"google/gemini-3-flash-preview",
			"anthropic/claude-sonnet-4.6",
			"openai/gpt-4o-mini",
		]);
		expect(out.models[0].added).toBe("2026-06-01");
		expect(out.models[0].completion).toBe("$15.00/M");
	});

	it("filters by search substring, case-insensitive", async () => {
		await vault.set("OPENROUTER_API_KEY", "sk-or-test");
		const { t } = tools();
		const out = await run(t, { search: "SONNET" });
		expect(out.total).toBe(2);
		expect(out.models.map((m: any) => m.id)).toEqual([
			"anthropic/claude-sonnet-4.7",
			"anthropic/claude-sonnet-4.6",
		]);
	});

	it("matches space-separated search tokens against dashed ids", async () => {
		await vault.set("OPENROUTER_API_KEY", "sk-or-test");
		const { t } = tools();
		// LLMs write "claude sonnet"; ids spell it "claude-sonnet". Every
		// token must match somewhere, order-independent.
		const out = await run(t, { search: "claude sonnet" });
		expect(out.total).toBe(2);
		expect(out.models.map((m: any) => m.id)).toEqual([
			"anthropic/claude-sonnet-4.7",
			"anthropic/claude-sonnet-4.6",
		]);
		const swapped = await run(t, { search: "sonnet anthropic" });
		expect(swapped.total).toBe(2);
	});

	it("respects limit while reporting the full match count", async () => {
		await vault.set("OPENROUTER_API_KEY", "sk-or-test");
		const { t } = tools();
		const out = await run(t, { limit: 1 });
		expect(out.total).toBe(4);
		expect(out.showing).toBe(1);
		expect(out.models).toHaveLength(1);
	});

	it("reads the key from the vault and passes it to the lister", async () => {
		await vault.set("OPENROUTER_API_KEY", "sk-or-vault");
		const { t, lister } = tools();
		await run(t);
		expect(lister).toHaveBeenCalledWith("sk-or-vault");
	});

	it("returns NO_OPENROUTER_KEY when neither vault nor env has the key", async () => {
		vi.stubEnv("OPENROUTER_API_KEY", "");
		const { t, lister } = tools();
		const out = await run(t);
		expect(out.error).toBe("NO_OPENROUTER_KEY");
		expect(lister).not.toHaveBeenCalled();
	});

	it("wraps catalog failures as MODEL_LIST_FAILED", async () => {
		await vault.set("OPENROUTER_API_KEY", "sk-or-test");
		const { t } = tools(vi.fn().mockRejectedValue(new Error("HTTP 429")));
		const out = await run(t);
		expect(out).toEqual({ error: "MODEL_LIST_FAILED", message: "HTTP 429" });
	});
});
