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
import type { GithubTokenService } from "../github/token-service.js";
import type { GithubAdministration } from "../github/admin.js";
import { resolveSaasAppOrigin } from "../saas-registry.js";

export interface GaiaToolsContext {
	registry: GaiaRegistryManager;
	vault: GaiaSecretVault;
	docker: DockerManager;
	catalog: CredentialCatalog;
	audit: CredentialAuditLogger;
	/**
	 * GitHub App token minting (ADR 0004). Always present when built via
	 * Gaia.start (a disabled service when the App is unconfigured); optional
	 * so tests and embedders without GitHub needs can omit it.
	 */
	githubTokens?: GithubTokenService;
	/** Explicit Level-2 GitHub capability. Absent means provisioning fails closed. */
	githubAdministration?: GithubAdministration;
	/** Gaia's own data directory (where config.json lives). */
	gaiaDataDir: string;
	/** Gaia's provider (for defaulting child habitats). */
	gaiaProvider?: string;
	/** Gaia's model (for defaulting child habitats). */
	gaiaModel?: string;
	/** Gaia's own config (from Gaia data-dir config.json). */
	gaiaConfig?: Pick<
		import("../../../types.js").HabitatConfig,
		"standardsRepoUrl" | "standardsRepoBranch" | "modelCredentials"
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
 * "Open in browser" URL for a habitat. A public child goes through the SaaS
 * one-time login handoff; no reusable child key or JWT is placed in the URL.
 * Local-only children use a clean loopback Shell URL and retain local/dev auth.
 */
export function entryOpenUrl(
	entry: GaiaHabitatEntry,
	port: number | undefined = entry.containerPort,
): string | null {
	const host = resolveHabitatHostname(entry);
	if (host) {
		const saasOrigin = resolveSaasAppOrigin();
		if (saasOrigin) {
			const url = new URL("/auth/handoff", saasOrigin);
			url.searchParams.set("habitat_id", entry.id);
			url.searchParams.set("return_to", "/shell/");
			return url.toString();
		}
		return `https://${host}/shell/`;
	}
	if (port) return `http://localhost:${port}/shell/`;
	return null;
}

/** One habitat's entry in the Directory. */
export type DiscoveredHabitat =
	| { id: string; card: AgentCardSummary; cached: boolean; fetchedAt?: string }
	| { id: string; error: string; card?: AgentCardSummary; fetchedAt?: string };

export interface DiscoverHabitatsOptions {
	/**
	 * Persist a freshly fetched card back onto the registry entry. Omitted in
	 * tests and in read-only callers; without it discovery still answers, it
	 * just does not warm the cache.
	 */
	saveCard?: (
		id: string,
		card: AgentCardSummary,
		fetchedAt: string,
	) => Promise<void>;
	/** Injectable clock so tests do not depend on wall time. */
	now?: () => string;
	/** Injectable card fetch (tests). */
	fetchCard?: typeof fetchAgentCard;
}

/**
 * Report every habitat in the fleet, running or not.
 *
 * Running habitats are fetched live and their card is cached on the way
 * through. Dormant habitats answer from that cache — the whole point, since
 * a fleet that sleeps by design would otherwise report almost nothing
 * (ADR 0008). A habitat that has never been started has no card at all,
 * which is reported as such rather than as an error, because "we have never
 * seen this one" and "this one failed" are different situations.
 *
 * A failed fetch against a running habitat keeps the previously cached card:
 * a transient blip should degrade the Directory to stale, not to empty.
 */
export async function discoverHabitats(
	entries: GaiaHabitatEntry[],
	options: DiscoverHabitatsOptions = {},
): Promise<DiscoveredHabitat[]> {
	const now = options.now ?? (() => new Date().toISOString());
	const fetchCard = options.fetchCard ?? fetchAgentCard;

	return Promise.all(
		entries.map(async (entry): Promise<DiscoveredHabitat> => {
			const cached = entry.cachedCard;

			if (!entry.containerPort) {
				// Dormant. Answer from cache rather than waking it.
				if (cached) {
					return {
						id: entry.id,
						card: cached.card,
						cached: true,
						fetchedAt: cached.fetchedAt,
					};
				}
				return {
					id: entry.id,
					error: "No cached agent card — this habitat has not been started yet.",
				};
			}

			try {
				const card = await fetchCard(entryToEndpoint(entry));
				const fetchedAt = now();
				// Best effort: a registry write failure must not fail discovery.
				await options.saveCard?.(entry.id, card, fetchedAt).catch(() => {});
				return { id: entry.id, card, cached: false, fetchedAt };
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown error";
				return cached
					? {
							id: entry.id,
							error: message,
							card: cached.card,
							fetchedAt: cached.fetchedAt,
						}
					: { id: entry.id, error: message };
			}
		}),
	);
}
