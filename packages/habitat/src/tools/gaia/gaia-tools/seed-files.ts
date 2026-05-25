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

export function buildSeedFiles(
	entry: GaiaHabitatEntry,
	vault: GaiaSecretVault,
	catalog?: CredentialCatalog,
): Array<{ path: string; content: string }> {
	const filtered: Record<string, string> = {};

	// Direct secret bindings
	for (const name of entry.secretBindings) {
		const val = vault.get(name);
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
