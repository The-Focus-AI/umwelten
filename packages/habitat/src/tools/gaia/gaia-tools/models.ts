/**
 * Model discovery for Gaia — `list_models`.
 *
 * Gaia writes `defaultModel` strings into child habitat configs, and an LLM
 * left to its own memory invents stale ids (e.g. `claude-3.5-sonnet`). This
 * tool queries OpenRouter's live catalog (newest first) so Gaia can pick a
 * model id that actually exists, with pricing + context size to choose by.
 *
 * The OpenRouter key resolves from Gaia's master vault first, then process
 * env — the same key that gets bound into child habitats.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { createOpenRouterProvider } from "@umwelten/core/providers/openrouter.js";
import type { ModelDetails } from "@umwelten/core/cognition/types.js";
import type { GaiaToolsContext } from "./context.js";

/** Injectable catalog fetcher (tests). Defaults to the OpenRouter provider. */
export type OpenRouterLister = (apiKey: string) => Promise<ModelDetails[]>;

const defaultLister: OpenRouterLister = (apiKey) =>
	createOpenRouterProvider(apiKey).listModels();

function fmtCost(v: number | undefined): string {
	if (v === undefined) return "?";
	return `$${v.toFixed(v < 1 ? 3 : 2)}/M`;
}

export function createModelDiscoveryTools(
	ctx: GaiaToolsContext,
	deps: { listOpenRouterModels?: OpenRouterLister } = {},
): Record<string, Tool> {
	const listOpenRouterModels = deps.listOpenRouterModels ?? defaultLister;

	const list_models = tool({
		description:
			"List CURRENT model ids available on OpenRouter, newest first, with context size and pricing. " +
			"ALWAYS use this before setting a habitat's model — never write a model id from memory; " +
			"model ids from memory are stale or wrong. Filter with `search` (e.g. 'sonnet', 'anthropic/', " +
			"'gemini'). The returned `id` values are exactly what create_habitat / update_habitat_config expect.",
		inputSchema: z.object({
			search: z
				.string()
				.optional()
				.describe(
					"Case-insensitive substring filter on the model id (e.g. 'sonnet', 'anthropic/', 'gpt')",
				),
			limit: z
				.number()
				.int()
				.min(1)
				.max(100)
				.optional()
				.describe("Max models to return (default 25, newest first)"),
		}),
		execute: async ({ search, limit }) => {
			const apiKey =
				ctx.vault.get("OPENROUTER_API_KEY") ??
				process.env.OPENROUTER_API_KEY;
			if (!apiKey) {
				return {
					error: "NO_OPENROUTER_KEY",
					message:
						"OPENROUTER_API_KEY is not in the master vault or environment — bind it with bind_secret to list models.",
				};
			}

			let models: ModelDetails[];
			try {
				models = await listOpenRouterModels(apiKey);
			} catch (err) {
				return {
					error: "MODEL_LIST_FAILED",
					message: err instanceof Error ? err.message : String(err),
				};
			}

			const needle = search?.trim().toLowerCase();
			const filtered = needle
				? models.filter((m) => m.name.toLowerCase().includes(needle))
				: models;

			// Newest first — "latest frontier" is the default view.
			const sorted = [...filtered].sort(
				(a, b) => (b.addedDate?.getTime() ?? 0) - (a.addedDate?.getTime() ?? 0),
			);

			const max = limit ?? 25;
			return {
				provider: "openrouter",
				total: filtered.length,
				showing: Math.min(max, sorted.length),
				models: sorted.slice(0, max).map((m) => ({
					id: m.name,
					context: m.contextLength,
					prompt: fmtCost(m.costs?.promptTokens),
					completion: fmtCost(m.costs?.completionTokens),
					added: m.addedDate ? m.addedDate.toISOString().slice(0, 10) : undefined,
				})),
			};
		},
	});

	return { list_models };
}
