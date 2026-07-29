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
import {
	describeFleetSecretStatus,
	fleetSecretStatus,
	habitatSecretStatus,
} from "../secret-status.js";
import {
	describeVaultMigration,
	planVaultMigration,
} from "../vault-migration.js";

export function createSecretsTools(ctx: GaiaToolsContext): Record<string, Tool> {
	const { registry, vault } = ctx;

	return {
		secret_status: tool({
			description:
				"Show which habitat is bound to which secret, and whether the master vault can actually supply it. A binding the vault cannot satisfy is dropped from the habitat's secrets.json rather than failing the start — so the container boots, health-checks fine, and then fails on first use. Also reports each habitat's model credential, which is platform-injected rather than declared. Check this before blaming the container. Optionally scope to one habitat.",
			inputSchema: z.object({
				habitatId: z
					.string()
					.optional()
					.describe("Limit to one habitat; omit for the whole fleet"),
			}),
			execute: async ({ habitatId }) => {
				const entries = habitatId
					? registry.list().filter((h) => h.id === habitatId)
					: registry.list();
				if (habitatId && entries.length === 0) {
					return `Habitat "${habitatId}" not found`;
				}
				// Which vault each habitat resolves against (#283). A habitat with
				// its own is self-contained; one still on the shared master vault
				// cannot hold a different value for a name another habitat uses,
				// which is the collision per-habitat vaults exist to remove.
				const vaults = entries.map(
					(e) =>
						`  ${e.id}: ${e.vaultToml ? "its own vault (fnox.toml in its repo)" : "shared master vault"}`,
				);

				return [
					describeFleetSecretStatus(fleetSecretStatus(entries, vault)),
					"",
					"Vaults:",
					...vaults,
				].join("\n");
			},
		}),

		plan_vault_migration: tool({
			description:
				"Work out what a habitat's own vault would need to declare to replace its share of the flat master vault (#284). Emits an fnox.toml to commit to the habitat's repo — it does NOT write anything, because the repo is the source of truth for what a habitat is, and that is also what makes each migration revertible by deleting one file. Never copies secret values; the output is references only, so it is safe to review and diff.",
			inputSchema: z.object({
				id: z.string().describe("Habitat ID to plan a migration for"),
				vaultName: z
					.string()
					.optional()
					.describe("1Password vault name (default: the habitat id)"),
			}),
			execute: async ({ id, vaultName }) => {
				const entry = registry.get(id);
				if (!entry) return `Habitat "${id}" not found`;
				return describeVaultMigration(
					planVaultMigration({
						habitatId: id,
						secretBindings: entry.secretBindings ?? [],
						hasOwnVault: Boolean(entry.vaultToml),
						masterHas: (name) => Boolean(vault.get(name)),
						...(vaultName ? { vaultName } : {}),
					}),
				);
			},
		}),

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
				// Report the whole picture, not just this one binding. A habitat
				// with one good binding and one unsatisfiable one still starts
				// and still fails, and this is the moment someone is looking.
				const status = habitatSecretStatus(entry, vault);
				const gap = status.missing.length
					? `\nStill unsatisfiable for "${habitatId}": ${status.missing.join(", ")} — bound, but the vault has no value, so they will be missing from the container.`
					: "";
				return `Secret "${secretName}" bound to habitat "${habitatId}". Rebuild for it to reach a running container.${gap}`;
			},
		}),
	};
}
