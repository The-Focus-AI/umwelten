/**
 * Gaia session adapter — reads habitat container sessions over HTTP.
 *
 * For remote Gaia hosts where bind mounts don't help: lists and fetches
 * sessions through Gaia's authenticated proxy routes (the per-habitat
 * sessions API), tagging each session with its habitat entry. Registers
 * with the projection layer like any other adapter, so `umwelten browse`
 * and the digester consume remote sessions the same way as local ones.
 *
 * Wire shapes consumed (Gaia orchestrator, bearer auth):
 *   GET {host}/api/habitats                         → GaiaHabitatEntry[] (+status)
 *   GET {host}/api/habitats/:id/sessions            → { sessions, total }
 *   GET {host}/api/habitats/:id/sessions/:sid/messages → { sessionId, messages }
 *
 * Degradation contract: an unreachable host or bad token logs a warning
 * and yields an empty discovery result (skipped source), never a throw
 * that would take down the whole projection. A single failing habitat is
 * skipped; the others still list.
 *
 * Configuration: GAIA_HOST (e.g. "http://gaia.example:7420") and
 * GAIA_TOKEN env vars, or explicit options. With no host configured the
 * adapter is inert (empty results, no warnings).
 */

import type {
	NormalizedMessage,
	NormalizedSession,
	NormalizedSessionEntry,
	SessionDiscoveryOptions,
	SessionDiscoveryResult,
	SessionSource,
} from "../types/normalized-types.js";
import type { SessionAdapter } from "./adapter.js";

// ── Wire types (subset of the Gaia / container HTTP responses) ────

interface WireHabitatEntry {
	id: string;
	name?: string;
	status?: string;
}

interface WireSessionEntry {
	sessionId: string;
	type?: string;
	created: string;
	lastUsed?: string;
	firstPrompt?: string;
	messageCount?: number;
	chatId?: string;
}

interface WireMessage {
	index?: number;
	role: string;
	content?: string;
	timestamp?: string;
	model?: string;
	toolCalls?: Array<{ id?: string; name: string; input?: unknown }>;
	toolResults?: Array<{
		tool_use_id?: string;
		content?: string;
		is_error?: boolean;
	}>;
}

export interface GaiaSessionAdapterOptions {
	/** Gaia host base URL, e.g. "http://gaia.example:7420". Default: GAIA_HOST. */
	host?: string;
	/** Bearer token for the Gaia API. Default: GAIA_TOKEN. */
	token?: string;
	/** Fetch implementation (injectable for tests). Default: global fetch. */
	fetchImpl?: typeof fetch;
	/** Warning sink. Default: console.warn. */
	warn?: (message: string) => void;
}

export class GaiaSessionAdapter implements SessionAdapter {
	readonly source: SessionSource = "gaia";
	readonly displayName = "Gaia (remote habitats)";

	private readonly host?: string;
	private readonly token?: string;
	private readonly fetchImpl: typeof fetch;
	private readonly warn: (message: string) => void;

	constructor(options: GaiaSessionAdapterOptions = {}) {
		const host = options.host ?? process.env.GAIA_HOST;
		this.host = host ? host.replace(/\/$/, "") : undefined;
		this.token = options.token ?? process.env.GAIA_TOKEN;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.warn = options.warn ?? ((m) => console.warn(m));
	}

	getSourceLocation(): string {
		return this.host ?? "(GAIA_HOST not set)";
	}

	/** Remote sessions are host-scoped, not project-scoped. */
	async canHandle(_projectPath: string): Promise<boolean> {
		return Boolean(this.host);
	}

	async discoverProjects(): Promise<string[]> {
		return [];
	}

	async hasSessionsForProject(_projectPath: string): Promise<boolean> {
		return false;
	}

	async discoverSessions(
		options?: SessionDiscoveryOptions,
	): Promise<SessionDiscoveryResult> {
		const empty: SessionDiscoveryResult = {
			sessions: [],
			source: this.source,
			totalCount: 0,
			hasMore: false,
		};
		if (!this.host) return empty;

		let habitats: WireHabitatEntry[];
		try {
			habitats = await this.getJson<WireHabitatEntry[]>("/api/habitats");
		} catch (err) {
			this.warn(
				`[gaia-adapter] skipping Gaia source — ${this.host} unreachable or rejected the token: ${err instanceof Error ? err.message : String(err)}`,
			);
			return empty;
		}

		const entries: NormalizedSessionEntry[] = [];
		for (const habitat of habitats) {
			let result: { sessions?: WireSessionEntry[] };
			try {
				result = await this.getJson<{ sessions?: WireSessionEntry[] }>(
					`/api/habitats/${encodeURIComponent(habitat.id)}/sessions`,
				);
			} catch (err) {
				this.warn(
					`[gaia-adapter] skipping habitat "${habitat.id}": ${err instanceof Error ? err.message : String(err)}`,
				);
				continue;
			}
			for (const session of result.sessions ?? []) {
				entries.push(this.toNormalizedEntry(habitat, session));
			}
		}

		// Date window + sort + limit (mirrors the other adapters).
		let filtered = entries;
		if (options?.since) {
			const since = options.since.getTime();
			filtered = filtered.filter(
				(e) => new Date(e.modified).getTime() >= since,
			);
		}
		if (options?.until) {
			const until = options.until.getTime();
			filtered = filtered.filter(
				(e) => new Date(e.created).getTime() <= until,
			);
		}
		const sortBy = options?.sortBy ?? "modified";
		const dir = options?.sortOrder === "asc" ? 1 : -1;
		filtered.sort((a, b) => {
			const av =
				sortBy === "messageCount"
					? a.messageCount
					: new Date(a[sortBy]).getTime();
			const bv =
				sortBy === "messageCount"
					? b.messageCount
					: new Date(b[sortBy]).getTime();
			return (av - bv) * dir;
		});
		const totalCount = filtered.length;
		if (options?.limit && filtered.length > options.limit) {
			filtered = filtered.slice(0, options.limit);
		}

		return {
			sessions: filtered,
			source: this.source,
			totalCount,
			hasMore: filtered.length < totalCount,
		};
	}

	async getSessionEntry(
		sessionId: string,
	): Promise<NormalizedSessionEntry | null> {
		const parsed = this.parseId(sessionId);
		if (!parsed || !this.host) return null;
		try {
			const result = await this.getJson<{ sessions?: WireSessionEntry[] }>(
				`/api/habitats/${encodeURIComponent(parsed.habitatId)}/sessions`,
			);
			const session = (result.sessions ?? []).find(
				(s) => s.sessionId === parsed.sessionId,
			);
			if (!session) return null;
			return this.toNormalizedEntry({ id: parsed.habitatId }, session);
		} catch {
			return null;
		}
	}

	async getSession(sessionId: string): Promise<NormalizedSession | null> {
		const entry = await this.getSessionEntry(sessionId);
		if (!entry) return null;
		const messages = await this.getMessages(sessionId);
		return {
			...entry,
			messages,
			messageCount: messages.length || entry.messageCount,
		};
	}

	async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
		const parsed = this.parseId(sessionId);
		if (!parsed || !this.host) return [];
		let result: { messages?: WireMessage[] };
		try {
			result = await this.getJson<{ messages?: WireMessage[] }>(
				`/api/habitats/${encodeURIComponent(parsed.habitatId)}/sessions/${encodeURIComponent(parsed.sessionId)}/messages`,
			);
		} catch (err) {
			this.warn(
				`[gaia-adapter] failed to load messages for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
			);
			return [];
		}
		return this.toNormalizedMessages(result.messages ?? []);
	}

	// ── Mapping ─────────────────────────────────────────────────────

	private toNormalizedEntry(
		habitat: WireHabitatEntry,
		session: WireSessionEntry,
	): NormalizedSessionEntry {
		return {
			id: `gaia:${habitat.id}:${session.sessionId}`,
			source: this.source,
			sourceId: `${habitat.id}:${session.sessionId}`,
			created: session.created,
			modified: session.lastUsed ?? session.created,
			messageCount: session.messageCount ?? 0,
			firstPrompt: session.firstPrompt ?? "",
			sourceData: {
				habitatId: habitat.id,
				habitatName: habitat.name ?? habitat.id,
				gaiaHost: this.host,
				sessionType: session.type,
				chatId: session.chatId,
			},
		};
	}

	private toNormalizedMessages(wire: WireMessage[]): NormalizedMessage[] {
		const messages: NormalizedMessage[] = [];
		for (const [i, raw] of wire.entries()) {
			const role =
				raw.role === "user" ||
				raw.role === "assistant" ||
				raw.role === "system" ||
				raw.role === "tool"
					? raw.role
					: "assistant";
			messages.push({
				id: `msg-${raw.index ?? i}`,
				role,
				content: raw.content ?? "",
				timestamp: raw.timestamp,
				model: raw.model,
			});
			// Surface tool activity as tool messages, joining results by id.
			for (const call of raw.toolCalls ?? []) {
				const match = (raw.toolResults ?? []).find(
					(r) => r.tool_use_id && r.tool_use_id === call.id,
				);
				messages.push({
					id: `msg-${raw.index ?? i}-tool-${call.id ?? call.name}`,
					role: "tool",
					content: match?.content ?? "",
					timestamp: raw.timestamp,
					tool: {
						name: call.name,
						input: (call.input ?? undefined) as
							| Record<string, unknown>
							| undefined,
						output: match?.content,
						isError: match?.is_error,
					},
				});
			}
		}
		return messages;
	}

	// ── HTTP ────────────────────────────────────────────────────────

	/** Accepts "gaia:<habitatId>:<sessionId>" or "<habitatId>:<sessionId>". */
	private parseId(
		id: string,
	): { habitatId: string; sessionId: string } | null {
		const raw = id.startsWith("gaia:") ? id.slice(5) : id;
		const sep = raw.indexOf(":");
		if (sep <= 0 || sep === raw.length - 1) return null;
		return { habitatId: raw.slice(0, sep), sessionId: raw.slice(sep + 1) };
	}

	private async getJson<T>(path: string): Promise<T> {
		const response = await this.fetchImpl(`${this.host}${path}`, {
			headers: {
				accept: "application/json",
				...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
			},
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} from ${path}`);
		}
		return (await response.json()) as T;
	}
}

export function createGaiaSessionAdapter(): GaiaSessionAdapter {
	return new GaiaSessionAdapter();
}
