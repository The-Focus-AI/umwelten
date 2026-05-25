/**
 * Master-vault secret tools: set, list, bind to habitat.
 *
 * The vault stores the raw secret values. `bind_secret` adds the
 * secret name to a habitat's `secretBindings` so it gets included
 * in that habitat's seeded `secrets.json` on next start / rebuild.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import type { GaiaToolsContext } from "./context.js";

export function createSecretsTools(ctx: GaiaToolsContext): Record<string, Tool> {
	const { registry, vault } = ctx;

	return {
		set_secret: tool({
			description: "Add or update a secret in the master vault.",
			inputSchema: z.object({
				name: z.string().describe("Secret name (env var name)"),
				value: z.string().describe("Secret value"),
			}),
			execute: async ({ name, value }) => {
				await vault.set(name, value);
				return `Secret "${name}" set in master vault.`;
			},
		}),

		list_secrets: tool({
			description: "List all secret names in the master vault (not values).",
			inputSchema: z.object({}),
			execute: async () => {
				const names = vault.listNames();
				if (names.length === 0) return "No secrets stored.";
				return `Secrets: ${names.join(", ")}`;
			},
		}),

		bind_secret: tool({
			description:
				"Bind a master secret to a habitat (add to its secretBindings).",
			inputSchema: z.object({
				habitatId: z.string(),
				secretName: z.string(),
			}),
			execute: async ({ habitatId, secretName }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;
				if (!vault.listNames().includes(secretName)) {
					return `Secret "${secretName}" not in master vault`;
				}
				if (!entry.secretBindings.includes(secretName)) {
					entry.secretBindings.push(secretName);
					await registry.update(habitatId, {
						secretBindings: entry.secretBindings,
					});
				}
				return `Secret "${secretName}" bound to habitat "${habitatId}"`;
			},
		}),
	};
}
