/**
 * The Directory — what the fleet contains and what each Habitat can do.
 *
 * ADR 0008 makes Gaia the directory rather than the router, and ADR 0007
 * makes sleeping the normal state of a Habitat. Those two together rule out
 * discovery-by-live-fetch: a fleet that is mostly Dormant would report
 * almost nothing, and waking a Habitat to ask what it can do defeats the
 * point of letting it sleep.
 *
 * So each Habitat's agent card is cached on its registry entry while the
 * Habitat is awake, and the Directory is served from that cache. A pass over
 * the Directory refreshes the cards of the Habitats that happen to be awake;
 * Dormant ones answer from their last capture, labelled with its age so a
 * consumer can decide whether to trust it.
 *
 * The card fetch is injected (`fetchCard`), so the whole thing is testable
 * without Docker or the network.
 */

import { fetchAgentCard, type AgentCardSummary } from "@umwelten/protocols";
import type {
	CachedAgentCard,
	ContainerStatus,
	GaiaHabitatEntry,
} from "../types.js";
import type { GaiaRegistryManager } from "../registry.js";
import type { DockerManager } from "../docker.js";
import { entryToEndpoint } from "./context.js";

/**
 * Where an entry's card came from on this pass.
 *
 * - `live` — fetched just now from an awake Habitat.
 * - `cache` — the last card captured while the Habitat was awake.
 * - `none` — no card has ever been captured for this Habitat.
 */
export type DirectoryCardSource = "live" | "cache" | "none";

/** One Habitat as the Directory sees it. */
export interface DirectoryEntry {
	id: string;
	name: string;
	/** Container status at the time of the pass. */
	containerStatus: ContainerStatus;
	/** True when the container is running and reachable on a port. */
	awake: boolean;
	/** The card, from whichever source `cardSource` names. Null when none. */
	card: AgentCardSummary | null;
	cardSource: DirectoryCardSource;
	/** When `card` was captured; null when there is no card. */
	capturedAt: string | null;
	/** True when `card` was not refreshed on this pass (Dormant, or fetch failed). */
	stale: boolean;
	/** Why a live fetch failed, when one was attempted and did not succeed. */
	cardError?: string;
}

/** Fetch one Habitat's agent card. Injected so tests need no network. */
export type AgentCardFetcher = (
	entry: GaiaHabitatEntry,
) => Promise<AgentCardSummary>;

export interface DirectoryDeps {
	registry: GaiaRegistryManager;
	docker: Pick<DockerManager, "getStatus">;
	/** Defaults to a real A2A agent-card fetch against the container. */
	fetchCard?: AgentCardFetcher;
	/** Clock, for the capture timestamp. Defaults to the wall clock. */
	now?: () => Date;
}

const defaultFetchCard: AgentCardFetcher = (entry) =>
	fetchAgentCard(entryToEndpoint(entry));

/**
 * A Habitat is awake when Docker says its container is running *and* the
 * registry knows a port for it. The port alone is not enough: it is written
 * on start and is not reliably cleared on stop, so a Dormant Habitat can
 * still carry one.
 */
export async function isAwake(
	entry: GaiaHabitatEntry,
	docker: Pick<DockerManager, "getStatus">,
): Promise<{ awake: boolean; containerStatus: ContainerStatus }> {
	const containerStatus = await docker.getStatus(entry.id);
	return {
		awake: containerStatus === "running" && entry.containerPort != null,
		containerStatus,
	};
}

/**
 * Build the Directory: every registered Habitat, Dormant ones included.
 *
 * Awake Habitats get a live card fetch, and a successful fetch is written
 * back to the registry so the Habitat keeps answering for itself after it
 * goes to sleep. A failed fetch never discards what was already cached.
 */
export async function buildDirectory(
	deps: DirectoryDeps,
): Promise<DirectoryEntry[]> {
	const { registry, docker } = deps;
	const fetchCard = deps.fetchCard ?? defaultFetchCard;
	const now = deps.now ?? (() => new Date());

	const entries = registry.list();

	// Fetch in parallel, persist sequentially — registry.save() rewrites the
	// whole file, so overlapping writes are not worth the milliseconds.
	const passes = await Promise.all(
		entries.map(async (entry) => {
			const { awake, containerStatus } = await isAwake(entry, docker);
			if (!awake) return { entry, containerStatus, awake };
			try {
				const card = await fetchCard(entry);
				return { entry, containerStatus, awake, card };
			} catch (err: any) {
				return {
					entry,
					containerStatus,
					awake,
					error: err?.message ?? "Unknown error",
				};
			}
		}),
	);

	const directory: DirectoryEntry[] = [];

	for (const pass of passes) {
		const { entry, containerStatus, awake } = pass;
		const base = { id: entry.id, name: entry.name, containerStatus, awake };

		if ("card" in pass && pass.card) {
			const cached: CachedAgentCard = {
				card: pass.card,
				capturedAt: now().toISOString(),
			};
			await registry.update(entry.id, { cachedCard: cached });
			directory.push({
				...base,
				card: cached.card,
				cardSource: "live",
				capturedAt: cached.capturedAt,
				stale: false,
			});
			continue;
		}

		const error = "error" in pass ? pass.error : undefined;
		const cached = entry.cachedCard;
		directory.push({
			...base,
			card: cached?.card ?? null,
			cardSource: cached ? "cache" : "none",
			capturedAt: cached?.capturedAt ?? null,
			stale: cached != null,
			...(error ? { cardError: error } : {}),
		});
	}

	return directory;
}
