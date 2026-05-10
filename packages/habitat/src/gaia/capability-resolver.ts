/**
 * Capability Resolver — resolves capability bindings into actual secret
 * values from the credential catalog + master vault.
 *
 * Given a list of CapabilityBinding objects and the credential catalog
 * + secret vault, resolves each binding to an env var name + value.
 * Validates that all requested capabilities are satisfiable (credential
 * exists, is active). Warnings are emitted for expired credentials.
 */

import type { CapabilityBinding } from "../types.js";
import type { CredentialCatalog } from "./credential-catalog.js";
import type { GaiaSecretVault } from "./secrets.js";

/** Result of resolving capability bindings into env vars. */
export interface ResolverResult {
	/** Env var names mapped to their secret values. */
	envVars: Record<string, string>;
	/** Non-fatal warnings (e.g. expired credentials). */
	warnings: string[];
}

/**
 * Resolves capability bindings against a credential catalog and master vault.
 *
 * For each binding, looks up the credential in the catalog, validates its
 * status, and retrieves the actual secret value from the vault. The credential
 * name is used as the env var name in the habitat.
 */
export class CapabilityResolver {
	/**
	 * Resolve a list of capability bindings into env vars.
	 *
	 * Throws if any binding references a credential that doesn't exist in
	 * the catalog. Emits warnings for expired credentials or expired refresh
	 * tokens — these don't block resolution.
	 */
	resolve(
		bindings: CapabilityBinding[],
		catalog: CredentialCatalog,
		vault: GaiaSecretVault,
	): ResolverResult {
		const envVars: Record<string, string> = {};
		const warnings: string[] = [];

		for (const binding of bindings) {
			const entry = catalog.get(binding.credential);
			if (!entry) {
				throw new Error(
					`Credential "${binding.credential}" not found in catalog (required for capability "${binding.capability}")`,
				);
			}

			// Warn on expired status
			if (entry.status === "expired") {
				warnings.push(`Credential "${binding.credential}" is marked expired`);
			}

			// Warn on expired refresh token
			if (entry.refreshTokenExpiry) {
				const expiry = new Date(entry.refreshTokenExpiry);
				if (expiry < new Date()) {
					warnings.push(
						`Credential "${binding.credential}" refresh token expired at ${entry.refreshTokenExpiry}`,
					);
				}
			}

			// Get the actual secret value from the master vault.
			// The credential name doubles as the vault key and env var name.
			const value = vault.get(binding.credential);
			if (value !== undefined) {
				envVars[binding.credential] = value;
			}
		}

		return { envVars, warnings };
	}
}
