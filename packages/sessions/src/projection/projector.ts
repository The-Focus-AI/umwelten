/**
 * Session Projector
 *
 * Bridges Source Session domain types with adapters by discovering
 * sessions from all registered sources and projecting them into
 * default Explorations.
 *
 * Every discovered Source Session yields exactly one default Exploration,
 * preserving source-specific metadata for browser display and later
 * Reflection.
 */
import type {
	SourceSession,
	SourceSessionMetrics,
	SourceSessionKind,
	Exploration,
} from "../types/domain-types.js";
import { createDefaultExploration } from "../types/domain-types.js";
import type {
	NormalizedSessionEntry,
	NormalizedSession,
	SessionDiscoveryOptions,
} from "../types/normalized-types.js";
import type { AdapterRegistry } from "../adapters/adapter.js";
import { adapterRegistry } from "../adapters/adapter.js";

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Result of projecting sessions for a project.
 */
export interface ProjectionResult {
	/** All Explorations created from discovered sessions. */
	explorations: Exploration[];

	/** Source Sessions used to create the Explorations. */
	sourceSessions: SourceSession[];

	/** Breakdown by source adapter. */
	sources: ProjectionSourceResult[];
}

/**
 * Per-source projection breakdown.
 */
export interface ProjectionSourceResult {
	source: SourceSessionKind;
	displayName: string;
	sessionCount: number;
	explorationCount: number;
}

/**
 * Options for projecting sessions.
 */
export interface ProjectionOptions extends SessionDiscoveryOptions {
	/** Adapter registry to use (defaults to global). */
	registry?: AdapterRegistry;
}

// ── Projection ──────────────────────────────────────────────────────────

/**
 * Project all discovered Source Sessions into default Explorations for a
 * given project path.
 *
 * Discovers sessions from every registered adapter, converts them to
 * SourceSession domain objects, and creates one default Exploration per
 * session.
 *
 * Sessions that fail to parse are skipped silently.
 */
export async function projectSessions(
	projectPath: string,
	options?: ProjectionOptions,
): Promise<ProjectionResult> {
	const registry = options?.registry ?? adapterRegistry;
	const allExplorations: Exploration[] = [];
	const allSourceSessions: SourceSession[] = [];
	const sources: ProjectionSourceResult[] = [];

	const allResults = await registry.discoverAllSessions({
		...options,
		projectPath,
	});

	for (const [source, result] of allResults) {
		const sourceKind = source as SourceSessionKind;
		const adapter = registry.get(source);
		const sourceExplorations: Exploration[] = [];

		for (const entry of result.sessions) {
			try {
				const sourceSession = toSourceSession(entry, sourceKind);
				const { exploration } = createDefaultExploration(sourceSession);
				allSourceSessions.push(sourceSession);
				sourceExplorations.push(exploration);
			} catch {
				// Skip sessions that fail to convert
			}
		}

		allExplorations.push(...sourceExplorations);

		sources.push({
			source: sourceKind,
			displayName: adapter?.displayName ?? sourceKind,
			sessionCount: result.totalCount,
			explorationCount: sourceExplorations.length,
		});
	}

	return {
		explorations: allExplorations,
		sourceSessions: allSourceSessions,
		sources,
	};
}

/**
 * Project a single session entry into its default Exploration.
 */
export function projectSessionEntry(
	entry: NormalizedSessionEntry,
	source: SourceSessionKind,
): Exploration {
	const sourceSession = toSourceSession(entry, source);
	return createDefaultExploration(sourceSession).exploration;
}

// ── Conversion ──────────────────────────────────────────────────────────

/**
 * Convert a NormalizedSessionEntry to a domain SourceSession.
 *
 * The SourceSession is the domain-level representation of tool-specific
 * persisted history, preserving metadata from the source adapter.
 */
export function toSourceSession(
	entry: NormalizedSessionEntry,
	source: SourceSessionKind,
): SourceSession {
	return {
		id: entry.id,
		source,
		sourceId: entry.sourceId,
		title: entry.firstPrompt
			? entry.firstPrompt.slice(0, 80) +
				(entry.firstPrompt.length > 80 ? "..." : "")
			: "",
		projectPath: entry.projectPath,
		gitBranch: entry.gitBranch,
		created: entry.created,
		modified: entry.modified,
		messageCount: entry.messageCount,
		firstPrompt: entry.firstPrompt,
		metrics: entry.metrics
			? {
					userMessages: entry.metrics.userMessages,
					assistantMessages: entry.metrics.assistantMessages,
					toolCalls: entry.metrics.toolCalls,
					totalTokens: entry.metrics.totalTokens,
					inputTokens: entry.metrics.inputTokens,
					outputTokens: entry.metrics.outputTokens,
					cacheReadTokens: entry.metrics.cacheReadTokens,
					cacheWriteTokens: entry.metrics.cacheWriteTokens,
					estimatedCost: entry.metrics.estimatedCost,
				}
			: undefined,
		sourceData: entry.sourceData,
	};
}

/**
 * Convert a full NormalizedSession (with messages) to a SourceSession.
 * Used when detailed session data is already loaded.
 */
export function toSourceSessionFull(session: NormalizedSession): SourceSession {
	const metrics: SourceSessionMetrics | undefined = session.metrics
		? {
				userMessages: session.metrics.userMessages,
				assistantMessages: session.metrics.assistantMessages,
				toolCalls: session.metrics.toolCalls,
				totalTokens: session.metrics.totalTokens,
				inputTokens: session.metrics.inputTokens,
				outputTokens: session.metrics.outputTokens,
				cacheReadTokens: session.metrics.cacheReadTokens,
				cacheWriteTokens: session.metrics.cacheWriteTokens,
				estimatedCost: session.metrics.estimatedCost,
			}
		: undefined;

	return {
		id: session.id,
		source: session.source as SourceSessionKind,
		sourceId: session.sourceId,
		title: session.firstPrompt
			? session.firstPrompt.slice(0, 80) +
				(session.firstPrompt.length > 80 ? "..." : "")
			: "",
		projectPath: session.projectPath,
		gitRepo: session.gitRepo,
		created: session.created,
		modified: session.modified,
		messageCount: session.messageCount,
		firstPrompt: session.firstPrompt,
		metrics,
		sourceData: session.sourceData,
	};
}
