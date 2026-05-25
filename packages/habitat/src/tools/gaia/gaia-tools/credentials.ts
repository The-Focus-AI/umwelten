/**
 * Credential catalog tools.
 *
 * Two related concepts live here:
 * 1. Credentials — entries in the catalog (metadata about secrets:
 *    provider, capabilities granted, scopes, dashboard URL).
 *    Tools: add_credential, list_credentials, remove_credential,
 *    verify_credential.
 * 2. Capability bindings — `capability → credential` mappings on a
 *    habitat. Tools: bind_capability, unbind_capability,
 *    list_habitat_capabilities.
 * Plus read_credential_audit_log which surfaces the append-only log
 * of every add/remove/verify/bind/unbind operation.
 */

import { tool } from "ai";
import { z } from "zod";
import type { Tool } from "ai";
import { CapabilityResolver } from "../capability-resolver.js";
import {
	credentialEntry,
	bindingEntry,
} from "../credential-audit.js";
import type { GaiaToolsContext } from "./context.js";
import { buildSeedFiles } from "./seed-files.js";

export function createCredentialsTools(
	ctx: GaiaToolsContext,
): Record<string, Tool> {
	const { registry, vault, docker, catalog, audit } = ctx;

	return {
		add_credential: tool({
			description:
				"Add a credential entry to the catalog. Stores metadata about a secret (provider, capabilities, scopes) — NOT the actual secret value. Use set_secret to store the actual value in the master vault.",
			inputSchema: z.object({
				name: z
					.string()
					.describe("Stable machine name (e.g. 'quickbooks-read-key')"),
				label: z.string().describe("Human-readable label"),
				provider: z
					.string()
					.describe("Provider namespace (e.g. 'intuit/quickbooks', 'github')"),
				capabilities: z
					.array(z.string())
					.describe(
						"Capability names this credential grants (e.g. ['quickbooks:read'])",
					),
				scopes: z
					.array(z.string())
					.optional()
					.describe("Upstream OAuth scopes (e.g. ['accounts:read'])"),
				dashboardUrl: z
					.string()
					.optional()
					.describe("URL to billing/quotas dashboard"),
				sourceVaultRef: z
					.string()
					.optional()
					.describe(
						"Reference to secret location (1Password item, age key, etc.)",
					),
			}),
			execute: async (params) => {
				try {
					await catalog.add({
						name: params.name,
						label: params.label,
						provider: params.provider,
						capabilities: params.capabilities,
						scopes: params.scopes ?? [],
						dashboardUrl: params.dashboardUrl,
						sourceVaultRef: params.sourceVaultRef,
						status: "unknown",
					});
					await audit.log(credentialEntry("add_credential", params.name));
					return `Added credential "${params.name}" (${params.provider}).`;
				} catch (err: any) {
					return `Error: ${err.message}`;
				}
			},
		}),

		list_credentials: tool({
			description:
				"List all credentials in the catalog with their capabilities and status.",
			inputSchema: z.object({
				provider: z
					.string()
					.optional()
					.describe("Filter by provider namespace"),
				capability: z.string().optional().describe("Filter by capability"),
			}),
			execute: async ({ provider, capability }) => {
				let entries = catalog.list();
				if (provider) entries = entries.filter((e) => e.provider === provider);
				if (capability)
					entries = entries.filter((e) => e.capabilities.includes(capability));
				if (entries.length === 0) return "No credentials found.";
				const summary = entries.map((e) => {
					const capStr =
						e.capabilities.length > 0 ? e.capabilities.join(", ") : "none";
					const verified = e.lastVerified
						? ` (verified ${e.lastVerified.slice(0, 10)})`
						: "";
					return `  - ${e.name} [${e.provider}] caps: ${capStr} status: ${e.status}${verified}`;
				});
				return `Credentials (${entries.length}):\n${summary.join("\n")}`;
			},
		}),

		remove_credential: tool({
			description:
				"Remove a credential entry from the catalog by name. Does NOT delete the secret from the master vault.",
			inputSchema: z.object({
				name: z.string().describe("Credential name to remove"),
			}),
			execute: async ({ name }) => {
				const removed = await catalog.remove(name);
				if (removed) {
					await audit.log(credentialEntry("remove_credential", name));
					return `Removed credential "${name}".`;
				}
				return `Credential "${name}" not found.`;
			},
		}),

		verify_credential: tool({
			description:
				"Mark a credential as verified (sets status to active and updates lastVerified timestamp).",
			inputSchema: z.object({
				name: z.string().describe("Credential name to verify"),
			}),
			execute: async ({ name }) => {
				const entry = await catalog.verify(name);
				if (!entry) return `Credential "${name}" not found.`;
				await audit.log(credentialEntry("verify_credential", name));
				return `Verified credential "${name}" (status: active, verified: ${entry.lastVerified}).`;
			},
		}),

		bind_capability: tool({
			description:
				"Bind a capability to a habitat using a specific credential. The credential must exist in the catalog and grant the requested capability. Adds the binding to the habitat config and re-seeds the volume.",
			inputSchema: z.object({
				habitatId: z.string().describe("Habitat ID"),
				capability: z
					.string()
					.describe("Capability to bind (e.g. 'github:read')"),
				credential: z.string().describe("Credential name in the catalog"),
			}),
			execute: async ({ habitatId, capability, credential }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;

				// Validate
				const resolver = new CapabilityResolver();
				try {
					resolver.validate({ capability, credential }, catalog);
				} catch (err: any) {
					return `Validation failed: ${err.message}`;
				}

				// Check for duplicate
				if (!entry.config.capabilities) entry.config.capabilities = [];
				const existing = entry.config.capabilities.find(
					(b) => b.capability === capability && b.credential === credential,
				);
				if (existing) {
					return `Capability "${capability}" already bound to credential "${credential}" on habitat "${habitatId}".`;
				}

				entry.config.capabilities.push({ capability, credential });
				await registry.update(habitatId, { config: entry.config });

				// Re-seed volume
				await docker.seedVolume(
					habitatId,
					buildSeedFiles(entry, vault, catalog),
				);

				await audit.log(
					bindingEntry("bind_capability", habitatId, capability, credential),
				);

				const status = await docker.getStatus(habitatId);
				const hint =
					status === "running"
						? " Rebuild the habitat for the new capability to take effect."
						: "";
				return `Bound capability "${capability}" → credential "${credential}" on habitat "${habitatId}".${hint}`;
			},
		}),

		unbind_capability: tool({
			description:
				"Remove a capability binding from a habitat. Takes the capability name (e.g. 'github:read') and removes all bindings for that capability.",
			inputSchema: z.object({
				habitatId: z.string().describe("Habitat ID"),
				capability: z
					.string()
					.describe("Capability to unbind (e.g. 'github:read')"),
			}),
			execute: async ({ habitatId, capability }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;

				if (!entry.config.capabilities?.length) {
					return `Habitat "${habitatId}" has no capability bindings.`;
				}

				const removed = entry.config.capabilities.filter(
					(b) => b.capability === capability,
				);
				if (removed.length === 0) {
					return `Capability "${capability}" is not bound on habitat "${habitatId}".`;
				}

				entry.config.capabilities = entry.config.capabilities.filter(
					(b) => b.capability !== capability,
				);
				await registry.update(habitatId, { config: entry.config });

				// Re-seed volume
				await docker.seedVolume(
					habitatId,
					buildSeedFiles(entry, vault, catalog),
				);

				for (const b of removed) {
					await audit.log(
						bindingEntry(
							"unbind_capability",
							habitatId,
							b.capability,
							b.credential,
						),
					);
				}

				const credList = removed.map((b) => `"${b.credential}"`).join(", ");
				const status = await docker.getStatus(habitatId);
				const hint =
					status === "running"
						? " Rebuild the habitat for changes to take effect."
						: "";
				return `Unbound capability "${capability}" (removed credentials: ${credList}) from habitat "${habitatId}".${hint}`;
			},
		}),

		read_credential_audit_log: tool({
			description:
				"Read the most recent credential audit log entries. Shows timestamped records of add/remove/verify/bind/unbind operations.",
			inputSchema: z.object({
				n: z
					.number()
					.optional()
					.describe("Number of entries to return (default: 50)"),
			}),
			execute: async ({ n }) => {
				const entries = await audit.read(n ?? 50);
				if (entries.length === 0) return "No audit entries yet.";
				const lines = entries.map((e) => {
					const context = e.habitatId
						? ` habitat=${e.habitatId} cap=${e.capability}`
						: "";
					return `[${e.timestamp}] ${e.operation} credential=${e.credential}${context}`;
				});
				return `Audit log (${entries.length} entries):\n${lines.join("\n")}`;
			},
		}),

		list_habitat_capabilities: tool({
			description:
				"List all capability bindings on a habitat, with the credential status for each.",
			inputSchema: z.object({
				habitatId: z.string().describe("Habitat ID"),
			}),
			execute: async ({ habitatId }) => {
				const entry = registry.get(habitatId);
				if (!entry) return `Habitat "${habitatId}" not found`;

				if (!entry.config.capabilities?.length) {
					return `Habitat "${habitatId}" has no capability bindings.`;
				}

				const summary = entry.config.capabilities.map((b) => {
					const cred = catalog.get(b.credential);
					const status = cred?.status ?? "not-in-catalog";
					const verified = cred?.lastVerified
						? ` (verified ${cred.lastVerified.slice(0, 10)})`
						: "";
					const hasSecret = vault.get(b.credential) !== undefined;
					const secretStatus = hasSecret ? "has secret" : "no secret in vault";
					return `  - ${b.capability} → ${b.credential} [${cred?.provider ?? "unknown"}] status: ${status}${verified}, ${secretStatus}`;
				});

				return `Capability bindings on "${habitatId}":
${summary.join("\n")}`;
			},
		}),
	};
}
