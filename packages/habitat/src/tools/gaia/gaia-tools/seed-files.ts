/**
 * Build the seed files (config.json + secrets.json) for a habitat
 * volume. The orchestrator calls this every time it provisions or
 * re-seeds a child habitat.
 *
 * Skills are NOT seeded as a lock file here — the container
 * entrypoint installs them via `npx skills add` at boot, which
 * generates a proper skills-lock.json with correct skill paths and
 * hashes.
 *
 * If `catalog` is provided and the habitat config has capability
 * bindings, they are resolved into secret values from the master
 * vault and merged into secrets.json alongside direct
 * secretBindings.
 *
 * Exported because `routes.ts` calls it directly when handling
 * REST-level operations (create, update_config, rebuild, bind_capability).
 */

import type { GaiaHabitatEntry } from "../types.js";
import type { GaiaSecretVault } from "../secrets.js";
import type { CredentialCatalog } from "../credential-catalog.js";
import { CapabilityResolver } from "../capability-resolver.js";
import { secretNeeds } from "../required-secrets.js";

export function buildSeedFiles(
	entry: GaiaHabitatEntry,
	vault: GaiaSecretVault,
	catalog?: CredentialCatalog,
	/**
	 * Values from the habitat's **own** vault (#283). When present these are
	 * the habitat's secrets outright — the master vault is not consulted, so
	 * two habitats can declare the same env var name and get different values.
	 * Absent means no vault of its own; the master vault answers, as before.
	 */
	resolved?: Record<string, string>,
): Array<{ path: string; content: string }> {
	const filtered: Record<string, string> = {};

	// What the habitat says it needs, from its own declaration where it has
	// one. Self-minted (`type: "oauth"`) names are deliberately absent — the
	// habitat creates those itself when a user connects, and seeding a blank
	// would overwrite a token it already holds.
	const needs = secretNeeds(entry.config, entry.secretBindings);
	for (const name of needs.fromVault) {
		const val = resolved ? resolved[name] : vault.get(name);
		if (val) filtered[name] = val;
	}

	// Capability-resolved secrets
	if (catalog && entry.config.capabilities?.length) {
		const resolver = new CapabilityResolver();
		const result = resolver.resolve(entry.config.capabilities, catalog, vault);
		Object.assign(filtered, result.envVars);
		// Warnings are logged by the caller when they surface through tool output
	}

	return [
		{
			path: "config.json",
			content: JSON.stringify(entry.config, null, 2) + "\n",
		},
		{ path: "secrets.json", content: JSON.stringify(filtered, null, 2) + "\n" },
	];
}
