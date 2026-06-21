/**
 * Shared context for the Gaia tool factories.
 *
 * Each per-domain factory in `./habitats.ts`, `./secrets.ts`, etc.
 * closes over a `GaiaToolsContext` — the registry / vault / docker /
 * catalog handles plus the orchestrator's own config and provider
 * defaults. `./index.ts:createGaiaToolSet` calls them all with one
 * shared `ctx`.
 *
 * Also hosts two small A2A helpers (`entryToEndpoint`, `discoverHabitats`)
 * used by `ask_habitat`, `discover_habitats`, and the standards audit.
 */

import {
	fetchAgentCard,
	type A2AEndpoint,
	type AgentCardSummary,
} from "@umwelten/protocols";
import type { GaiaHabitatEntry } from "../types.js";
import type { GaiaRegistryManager } from "../registry.js";
import type { GaiaSecretVault } from "../secrets.js";
import {
	type DockerManager,
	containerName,
	CHILD_INTERNAL_PORT,
	resolveHabitatHostname,
} from "../docker.js";
import type { CredentialCatalog } from "../credential-catalog.js";
import type { CredentialAuditLogger } from "../credential-audit.js";

export interface GaiaToolsContext {
	registry: GaiaRegistryManager;
	vault: GaiaSecretVault;
	docker: DockerManager;
	catalog: CredentialCatalog;
	audit: CredentialAuditLogger;
	/** Gaia's own data directory (where config.json lives). */
	gaiaDataDir: string;
	/** Gaia's provider (for defaulting child habitats). */
	gaiaProvider?: string;
	/** Gaia's model (for defaulting child habitats). */
	gaiaModel?: string;
	/** Gaia's own config (from Gaia data-dir config.json). */
	gaiaConfig?: Pick<
		import("../../../types.js").HabitatConfig,
		"standardsRepoUrl" | "standardsRepoBranch"
	>;
}

/** Adapt a Gaia registry entry to a generic A2A endpoint. */
export function entryToEndpoint(entry: GaiaHabitatEntry): A2AEndpoint {
	// containerPort is the "running" marker (set when the container is up);
	// the address itself is the container's embedded-DNS name on the shared
	// network, so Gaia no longer needs host networking (#170 follow-up).
	if (!entry.containerPort) {
		throw new Error(`Container ${entry.id} not running`);
	}
	return {
		host: containerName(entry.id),
		port: CHILD_INTERNAL_PORT,
		apiKey: entry.apiKey,
		label: entry.id,
	};
}

/**
 * "Open in browser" URL for a habitat: prefer its public Caddy hostname
 * (reachable from anywhere, valid TLS), falling back to the host loopback port
 * (only useful on the Gaia host itself). Null when neither is available.
 */
export function entryOpenUrl(
	entry: GaiaHabitatEntry,
	port: number | undefined = entry.containerPort,
): string | null {
	const host = resolveHabitatHostname(entry);
	if (host) return `https://${host}/?token=${entry.apiKey}`;
	if (port) return `http://localhost:${port}/?token=${entry.apiKey}`;
	return null;
}

/** Fetch agent cards from all running habitats; failures are reported per-entry. */
export async function discoverHabitats(
	entries: GaiaHabitatEntry[],
): Promise<
	Array<{ id: string; card: AgentCardSummary } | { id: string; error: string }>
> {
	const running = entries.filter((e) => e.containerPort);
	const results = await Promise.allSettled(
		running.map(async (entry) => {
			const card = await fetchAgentCard(entryToEndpoint(entry));
			return { id: entry.id, card };
		}),
	);

	return results.map((r, i) =>
		r.status === "fulfilled"
			? r.value
			: { id: running[i].id, error: r.reason?.message ?? "Unknown error" },
	);
}
