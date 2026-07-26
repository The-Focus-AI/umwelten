/**
 * Resolving a peer through the fleet Directory at call time.
 *
 * Remote peers used to be frozen configuration: the remote-ask tool
 * registered nothing unless peers were declared before the container
 * started, so onboarding a client habitat meant editing and restarting the
 * operations habitat. That directly breaks giving a prospect a habitat on
 * first contact.
 *
 * Per ADR 0008 Gaia is the Directory, not the router — it answers *who
 * exists and where*, and the caller then talks to the peer directly, one
 * hop, with Gaia off the path of the ask. This module is only the lookup
 * half; the A2A call itself never goes through Gaia.
 *
 * A habitat reaches its Directory over the same control API the rest of the
 * fleet uses, addressed by `GAIA_URL` and authenticated with its own
 * `HABITAT_API_KEY`. Unconfigured means no resolver, which leaves the old
 * declared-peers-only behaviour intact for local and standalone runs.
 */

import type { AgentHost } from "../types.js";
import type { ResolvedPeer } from "./remote-agent-tools.js";

/** Env var naming the Directory's base URL. */
export const GAIA_URL_ENV = "GAIA_URL";
/** Env var holding this habitat's own control-API key. */
export const HABITAT_API_KEY_ENV = "HABITAT_API_KEY";

const DIRECTORY_TIMEOUT_MS = 10_000;

/** One habitat as the Directory reports it. */
interface DirectoryEntry {
	id: string;
	name?: string;
	/** Public hostname, when the habitat is published. */
	hostname?: string;
	/** Loopback port, when it is only reachable on the host. */
	containerPort?: number;
	/** Per-habitat bearer for its A2A surface. */
	apiKey?: string;
}

/** Turn a Directory entry into something addressable, or nothing. */
export function directoryEntryToPeer(
	entry: DirectoryEntry,
): ResolvedPeer | undefined {
	// A published hostname beats a loopback port: it is the address that keeps
	// working from outside the host.
	const endpoint = entry.hostname
		? `https://${entry.hostname}`
		: entry.containerPort
			? `http://127.0.0.1:${entry.containerPort}`
			: undefined;
	if (!endpoint) return undefined;
	return {
		id: entry.id,
		endpoint,
		...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
	};
}

/** Match by id first, then display name, both case-insensitively. */
export function findDirectoryEntry(
	entries: DirectoryEntry[],
	agentId: string,
): DirectoryEntry | undefined {
	const needle = agentId.trim().toLowerCase();
	return (
		entries.find((e) => e.id.toLowerCase() === needle) ??
		entries.find((e) => e.name?.toLowerCase() === needle)
	);
}

export interface DirectoryResolverDeps {
	/** Directory base URL. Default: `GAIA_URL` from the habitat's secrets/env. */
	gaiaUrl?: string;
	/** This habitat's control-API key. Default: `HABITAT_API_KEY`. */
	apiKey?: string;
	fetchImpl?: typeof fetch;
}

/**
 * Build the resolver pair for `createRemoteAgentTools`, or `{}` when no
 * Directory is configured — in which case the remote-ask tool keeps its
 * original behaviour of registering only for declared peers.
 */
export function buildDirectoryResolver(
	habitat: Pick<AgentHost, "getSecret">,
	deps: DirectoryResolverDeps = {},
): {
	resolvePeer?: (agentId: string) => Promise<ResolvedPeer | undefined>;
	listPeers?: () => Promise<string[]>;
} {
	const gaiaUrl =
		deps.gaiaUrl ?? habitat.getSecret(GAIA_URL_ENV) ?? process.env[GAIA_URL_ENV];
	const apiKey =
		deps.apiKey ??
		habitat.getSecret(HABITAT_API_KEY_ENV) ??
		process.env[HABITAT_API_KEY_ENV];

	if (!gaiaUrl) return {};

	const fetchImpl = deps.fetchImpl ?? fetch;

	async function listEntries(): Promise<DirectoryEntry[]> {
		const url = new URL("/api/habitats", gaiaUrl);
		const res = await fetchImpl(url, {
			headers: {
				accept: "application/json",
				...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
			},
			signal: AbortSignal.timeout(DIRECTORY_TIMEOUT_MS),
		});
		if (!res.ok) {
			throw new Error(
				`directory returned HTTP ${res.status} for ${url.pathname}`,
			);
		}
		const body = (await res.json()) as
			| DirectoryEntry[]
			| { habitats?: DirectoryEntry[] };
		// Tolerate both a bare array and a wrapped object — the control API has
		// used both shapes, and guessing wrong here reads as "no such peer".
		return Array.isArray(body) ? body : (body.habitats ?? []);
	}

	return {
		resolvePeer: async (agentId) => {
			const found = findDirectoryEntry(await listEntries(), agentId);
			return found ? directoryEntryToPeer(found) : undefined;
		},
		listPeers: async () => (await listEntries()).map((e) => e.id),
	};
}
