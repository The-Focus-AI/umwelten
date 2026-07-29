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
import { describeSecretNeeds, secretNeeds } from "../required-secrets.js";
import {
	describeModelCredential,
	resolveModelCredential,
} from "../model-credentials.js";

export function createSecretsTools(ctx: GaiaToolsContext): Record<string, Tool> {
	const { registry, vault, gaiaConfig } = ctx;

	return {
		secret_status: tool({
			description:
				"Show what each habitat declares it needs, whether its vault can supply it, and which vault it resolves against. Reads the habitat's own requiredSecrets contract where it has one; a habitat still on the old bare secretBindings list is flagged as un-migrated. Credentials the habitat mints itself (type: oauth) are listed separately \u2014 Gaia supplies nothing for those and never counts them missing. Optionally scope to one habitat.",
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
				// Reported against what each habitat DECLARES, not the
				// hand-maintained binding list. A habitat that has not migrated is
				// named as such rather than having its bindings quietly presented
				// as though they were a contract it agreed to.
				const blocks = entries.map((e) => {
					const needs = secretNeeds(e.config, e.secretBindings);
					const resolved: Record<string, string> = {};
					for (const name of needs.fromVault) {
						const v = vault.get(name);
						if (v) resolved[name] = v;
					}
					// Model access is Gaia's to supply, not the habitat's to declare,
					// so it is reported apart from anything in the contract.
					const modelLine = `    ${describeModelCredential(
						resolveModelCredential(e.config.defaultProvider, {
							...(gaiaConfig?.modelCredentials
								? { map: gaiaConfig.modelCredentials }
								: {}),
							secret: (name) => vault.get(name),
						}),
					)}`;
					const vaultLine = e.vaultToml
						? "    vault: its own (fnox.toml in its repo)"
						: "    vault: shared master vault — not yet migrated (#284)";
					return [
						describeSecretNeeds(e.id, needs, resolved),
						modelLine,
						vaultLine,
					].join("\n");
				});

				return blocks.length ? blocks.join("\n\n") : "No habitats registered.";
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
				"Bind a master secret to a habitat by adding it to the legacy secretBindings list. Only has any effect on a habitat that has NOT declared requiredSecrets — once a habitat declares its own contract, that contract decides what gets seeded and this list is ignored. Prefer editing requiredSecrets in the habitat's repo.",
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

				// Refuse rather than succeed-and-do-nothing. A habitat that
				// declares requiredSecrets is provisioned from that contract, so
				// appending here changes nothing — and reporting success for a
				// write with no effect is the exact failure mode this whole
				// sequence exists to remove.
				const needs = secretNeeds(entry.config, entry.secretBindings);
				if (needs.source === "contract" && !needs.fromVault.includes(secretName)) {
					const declared = needs.fromVault.length
						? needs.fromVault.join(", ")
						: "(nothing)";
					return (
						`Refusing: "${habitatId}" declares its own requiredSecrets contract, so secretBindings is ignored — ` +
						`binding "${secretName}" here would have no effect and the container would still not receive it.\n` +
						`It currently declares: ${declared}.\n` +
						`Add "${secretName}" to requiredSecrets in habitat.json in its repo, then re-apply the declaration and rebuild.`
					);
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
