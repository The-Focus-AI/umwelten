/**
 * Pi Session Adapter
 *
 * Discovers and parses pi session files from ~/.pi/agent/sessions/.
 * Pi stores sessions as JSONL files with a tree structure (id/parentId),
 * supporting branches, compactions, branch summaries, labels, and metadata.
 *
 * Session directory: ~/.pi/agent/sessions/--<path-encoded>--/<timestamp>_<uuid>.jsonl
 * Path encoding: / replaced with -, each path segment prefixed with --
 */
import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import type {
	SessionSource,
	NormalizedSession,
	NormalizedSessionEntry,
	NormalizedMessage,
	SessionDiscoveryOptions,
	SessionDiscoveryResult,
} from "../types/normalized-types.js";
import type { SessionAdapter } from "./adapter.js";

// ── Types for pi session entries ────────────────────────────────────────

export interface PiSessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface PiEntryBase {
	type: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
}

export interface PiMessageEntry extends PiEntryBase {
	type: "message";
	message: PiAgentMessage;
}

export interface PiAgentMessage {
	role:
		| "user"
		| "assistant"
		| "toolResult"
		| "bashExecution"
		| "custom"
		| "branchSummary"
		| "compactionSummary";
	content: string | PiContentBlock[];
	timestamp?: number;
	toolCallId?: string;
	toolName?: string;
	isError?: boolean;
	api?: string;
	provider?: string;
	model?: string;
	usage?: PiUsage;
	stopReason?: string;
	/** Branch summary messages */
	fromId?: string;
	summary?: string;
	/** Compaction summary messages */
	tokensBefore?: number;
	/** Custom messages */
	customType?: string;
	display?: boolean;
}

export interface PiContentBlock {
	type: "text" | "image" | "thinking" | "toolCall";
	text?: string;
	data?: string;
	mimeType?: string;
	thinking?: string;
	id?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

export interface PiUsage {
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens: number;
	cost?: {
		input: number;
		output: number;
		cacheRead?: number;
		cacheWrite?: number;
		total: number;
	};
}

export interface PiModelChangeEntry extends PiEntryBase {
	type: "model_change";
	provider: string;
	modelId: string;
}

export interface PiThinkingLevelChangeEntry extends PiEntryBase {
	type: "thinking_level_change";
	thinkingLevel: string;
}

export interface PiCompactionEntry extends PiEntryBase {
	type: "compaction";
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: Record<string, unknown>;
	fromHook?: boolean;
}

export interface PiBranchSummaryEntry extends PiEntryBase {
	type: "branch_summary";
	fromId: string;
	summary: string;
	details?: Record<string, unknown>;
}

export interface PiCustomEntry extends PiEntryBase {
	type: "custom";
	customType: string;
	data?: unknown;
}

export interface PiCustomMessageEntry extends PiEntryBase {
	type: "custom_message";
	customType: string;
	content: string | PiContentBlock[];
	display: boolean;
	details?: unknown;
}

export interface PiLabelEntry extends PiEntryBase {
	type: "label";
	targetId: string;
	label?: string;
}

export interface PiSessionInfoEntry extends PiEntryBase {
	type: "session_info";
	name?: string;
}

export type PiSessionEntry =
	| PiMessageEntry
	| PiModelChangeEntry
	| PiThinkingLevelChangeEntry
	| PiCompactionEntry
	| PiBranchSummaryEntry
	| PiCustomEntry
	| PiCustomMessageEntry
	| PiLabelEntry
	| PiSessionInfoEntry;

// ── Parsed result types ─────────────────────────────────────────────────

export interface ParsedPiSession {
	header: PiSessionHeader;
	entries: PiSessionEntry[];
	/** Tree structure: parentId -> children ids */
	tree: Map<string, string[]>;
	/** Labels keyed by target entry ID */
	labels: Map<string, string>;
	/** Session display name (from latest session_info) */
	displayName?: string;
	/** Current model at session end */
	model?: { provider: string; modelId: string };
	/** Current thinking level at session end */
	thinkingLevel?: string;
	/** Active path (root to leaf IDs) */
	activePath: string[];
	/** Branch points */
	branchCount: number;
	/** Compact points */
	compactionCount: number;
}

// ── Constants ───────────────────────────────────────────────────────────

const PI_SESSION_BASE = join(homedir(), ".pi", "agent", "sessions");
const SOURCE: SessionSource = "pi";

// ── Adapter ─────────────────────────────────────────────────────────────

export class PiSessionAdapter implements SessionAdapter {
	readonly source: SessionSource = SOURCE;
	readonly displayName = "pi";

	getSourceLocation(): string {
		return PI_SESSION_BASE;
	}

	/**
	 * Encode a project path to pi's directory format.
	 * /Users/wschenk/The-Focus-AI/umwelten → --Users-wschenk-The-Focus-AI-umwelten--
	 */
	private encodeProjectPath(projectPath: string): string {
		const normalized = projectPath.replace(/\/$/, "");
		return "--" + normalized.replace(/\//g, "-").replace(/^-/, "") + "--";
	}

	/** Decode encoded directory back to project path (always absolute) */
	private decodeProjectPath(encoded: string): string {
		const decoded = encoded.replace(/^--|--$/g, "").replace(/-/g, "/");
		return decoded.startsWith("/") ? decoded : "/" + decoded;
	}

	/** Build the session directory path for a local project (.pi/sessions) */
	private localSessionDir(projectPath: string): string {
		return join(projectPath, ".pi", "sessions");
	}

	/** Check if a local session directory exists for the project */
	private async hasLocalSessionsDir(projectPath: string): Promise<boolean> {
		try {
			await readdir(this.localSessionDir(projectPath));
			return true;
		} catch {
			return false;
		}
	}

	/** Build the session directory path for a project (global ~/.pi/agent/sessions) */
	private sessionDirForProject(projectPath: string): string {
		return join(PI_SESSION_BASE, this.encodeProjectPath(projectPath));
	}

	async canHandle(projectPath: string): Promise<boolean> {
		const dir = this.sessionDirForProject(projectPath);
		try {
			await readdir(dir);
			return true;
		} catch {
			return this.hasLocalSessionsDir(projectPath);
		}
	}

	async discoverProjects(): Promise<string[]> {
		try {
			const entries = await readdir(PI_SESSION_BASE, { withFileTypes: true });
			return entries
				.filter((e) => e.isDirectory())
				.map((e) => this.decodeProjectPath(e.name))
				.filter((p) => p.startsWith("/")); // valid absolute paths only
		} catch {
			return [];
		}
	}

	async discoverSessions(
		options?: SessionDiscoveryOptions,
	): Promise<SessionDiscoveryResult> {
		const projectPath = options?.projectPath;
		if (!projectPath) {
			// Return sessions across all projects
			const projects = await this.discoverProjects();
			const allSessions: NormalizedSessionEntry[] = [];
			for (const proj of projects) {
				const result = await this.discoverSessions({
					...options,
					projectPath: proj,
				});
				allSessions.push(...result.sessions);
			}
			return {
				sessions: allSessions,
				source: SOURCE,
				totalCount: allSessions.length,
				hasMore: false,
			};
		}

		const globalDir = this.sessionDirForProject(projectPath);
		const localDir = this.localSessionDir(projectPath);
		const sessions: NormalizedSessionEntry[] = [];

		const buildFromDir = async (dir: string, isLocal: boolean) => {
			try {
				const files = await readdir(dir);
				const jsonlFiles = files
					.filter((f) => f.endsWith(".jsonl"))
					.sort()
					.reverse();
				for (const file of jsonlFiles) {
					const filePath = join(dir, file);
					const entry = await this.parseSessionEntry(
						filePath,
						projectPath,
						isLocal,
					);
					if (entry) sessions.push(entry);
				}
			} catch {
				// directory doesn't exist — skip
			}
		};

		await buildFromDir(globalDir, false);
		await buildFromDir(localDir, true);

		// Apply filters
		const filtered = this.filterSessions(sessions, options);

		// Apply limit
		const limit = options?.limit ?? filtered.length;
		const limited = filtered.slice(0, limit);

		return {
			sessions: limited,
			source: SOURCE,
			totalCount: filtered.length,
			hasMore: limited.length < filtered.length,
		};
	}

	async getSessionEntry(
		sessionId: string,
	): Promise<NormalizedSessionEntry | null> {
		const [projectPath, file] = this.resolveSessionId(sessionId);
		if (!projectPath || !file) return null;
		return this.parseSessionEntry(file, projectPath, sessionId.startsWith("piloc:"));
	}

	async getSession(sessionId: string): Promise<NormalizedSession | null> {
		const [projectPath, file] = this.resolveSessionId(sessionId);
		if (!projectPath || !file) return null;

		try {
			const raw = await readFile(file, "utf-8");
			const parsed = this.parseRawSession(raw);
			if (!parsed) return null;

			return this.toNormalizedSession(parsed, projectPath, file);
		} catch {
			return null;
		}
	}

	async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
		const session = await this.getSession(sessionId);
		return session?.messages ?? [];
	}

	async hasSessionsForProject(projectPath: string): Promise<boolean> {
		return this.canHandle(projectPath);
	}

	// ── Parsing ─────────────────────────────────────────────────────────

	/**
	 * Parse a raw pi session JSONL string into structured format.
	 */
	parseRawSession(raw: string): ParsedPiSession | null {
		const lines = raw.trim().split("\n");
		if (lines.length === 0) return null;

		// Parse header
		let header: PiSessionHeader;
		try {
			header = JSON.parse(lines[0]) as PiSessionHeader;
		} catch {
			return null;
		}

		if (header.type !== "session") return null;

		const entries: PiSessionEntry[] = [];
		const childrenMap = new Map<string, string[]>();
		const labels = new Map<string, string>();
		let displayName: string | undefined;
		const activePath: string[] = [];
		let latestModel: { provider: string; modelId: string } | undefined;
		let latestThinkingLevel: string | undefined;

		// Track leaf: the entry with no children
		const hasParent = new Set<string>();
		const allIds = new Set<string>();

		for (let i = 1; i < lines.length; i++) {
			try {
				const entry = JSON.parse(lines[i]) as PiSessionEntry;
				entries.push(entry);

				const id = entry.id;
				if (id) {
					allIds.add(id);
					const parentId = entry.parentId;
					if (parentId) {
						hasParent.add(id);
						if (!childrenMap.has(parentId)) {
							childrenMap.set(parentId, []);
						}
						childrenMap.get(parentId)!.push(id);
					}

					// Track specific entry types
					switch (entry.type) {
						case "label": {
							const labelEntry = entry as PiLabelEntry;
							if (labelEntry.targetId && labelEntry.label) {
								labels.set(labelEntry.targetId, labelEntry.label);
							} else if (labelEntry.targetId) {
								labels.delete(labelEntry.targetId); // clearing a label
							}
							break;
						}
						case "session_info": {
							const infoEntry = entry as PiSessionInfoEntry;
							if (infoEntry.name) displayName = infoEntry.name;
							break;
						}
						case "model_change": {
							const mc = entry as PiModelChangeEntry;
							latestModel = { provider: mc.provider, modelId: mc.modelId };
							break;
						}
						case "thinking_level_change": {
							const tc = entry as PiThinkingLevelChangeEntry;
							latestThinkingLevel = tc.thinkingLevel;
							break;
						}
					}
				}
			} catch {
				// Skip malformed JSON lines
			}
		}

		// Build active path (root to leaf)
		const roots = entries.filter((e) => e.id && !hasParent.has(e.id));
		if (roots.length > 0) {
			const root = roots[0];
			if (root.id) {
				this.buildPathToLeaf(root.id, childrenMap, activePath, new Set());
			}
		}

		const branchCount = [...childrenMap.values()].filter(
			(c) => c.length > 1,
		).length;
		const compactionCount = entries.filter(
			(e) => e.type === "compaction",
		).length;

		return {
			header,
			entries,
			tree: childrenMap,
			labels,
			displayName,
			model: latestModel,
			thinkingLevel: latestThinkingLevel,
			activePath,
			branchCount,
			compactionCount,
		};
	}

	/**
	 * Parse session metadata from a file (without loading full messages).
	 */
	private async parseSessionEntry(
		filePath: string,
		projectPath: string,
		isLocal = false,
	): Promise<NormalizedSessionEntry | null> {
		try {
			const raw = await readFile(filePath, "utf-8");
			const lines = raw.trim().split("\n");
			if (lines.length === 0) return null;

			const header = JSON.parse(lines[0]) as PiSessionHeader;
			if (header.type !== "session") return null;

			const sessionId = this.buildSessionId(filePath, projectPath, isLocal);
			const filename = filePath.split(sep).pop() ?? "";

			// Quick parse for metadata without building full tree
			let messageCount = 0;
			let userMessages = 0;
			let assistantMessages = 0;
			let toolCalls = 0;
			let totalTokens = 0;
			let inputTokens = 0;
			let outputTokens = 0;
			let cacheReadTokens = 0;
			let cacheWriteTokens = 0;
			let estimatedCost = 0;
			let displayName: string | undefined;
			for (let i = 1; i < lines.length; i++) {
				try {
					const entry = JSON.parse(lines[i]);
					if (entry.type === "message") {
						messageCount++;
						const role = entry.message?.role;
						if (role === "user") userMessages++;
						if (role === "assistant") assistantMessages++;

						const content = entry.message?.content;
						if (Array.isArray(content)) {
							toolCalls += content.filter(
								(block) => block?.type === "toolCall",
							).length;
						}

						const usage = entry.message?.usage;
						if (usage) {
							totalTokens += usage.totalTokens ?? 0;
							inputTokens += usage.input ?? 0;
							outputTokens += usage.output ?? 0;
							cacheReadTokens += usage.cacheRead ?? 0;
							cacheWriteTokens += usage.cacheWrite ?? 0;
							estimatedCost += usage.cost?.total ?? 0;
						}
					}
					if (entry.type === "session_info" && entry.name)
						displayName = entry.name;
				} catch {
					// skip malformed
				}
			}

			return {
				id: sessionId,
				source: SOURCE,
				sourceId: header.id,
				projectPath,
				created: header.timestamp,
				modified: this.extractModifiedTime(lines),
				messageCount,
				firstPrompt: this.extractFirstPrompt(lines),
				metrics: {
					userMessages,
					assistantMessages,
					toolCalls,
					totalTokens,
					inputTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens,
					estimatedCost,
				},
				sourceData: { filename, displayName, cwd: header.cwd, filePath },
			};
		} catch {
			return null;
		}
	}

	/**
	 * Build a unique session ID from project path and file.
	 */
	private buildSessionId(
		filePath: string,
		projectPath?: string,
		isLocal = false,
	): string {
		if (isLocal && projectPath) {
			const filename = filePath.split(sep).pop() ?? "";
			return `piloc:${projectPath}:${filename}`;
		}
		const rel = filePath.slice(PI_SESSION_BASE.length).replace(/^\/+/, "");
		const safe = rel.replace(/\//g, "-").replace(/--+/g, "--");
		return `pi${safe}`;
	}

	/**
	 * Resolve a session ID back to project path and file path.
	 * Session IDs are like: pi--Users-wschenk-Proj--2026-05-10T...jsonl
	 */
	private resolveSessionId(sessionId: string): [string | null, string | null] {
		if (sessionId.startsWith("piloc:")) {
			const rest = sessionId.slice(6);
			const lastColon = rest.lastIndexOf(":");
			if (lastColon === -1) return [null, null];
			const projectPath = rest.slice(0, lastColon);
			const filename = rest.slice(lastColon + 1);
			const filePath = join(projectPath, ".pi", "sessions", filename);
			return [projectPath, filePath];
		}
		if (!sessionId.startsWith("pi")) return [null, null];
		const encoded = sessionId.slice(2);
		const lastDoubleDash = encoded.lastIndexOf("--");
		if (lastDoubleDash === -1) return [null, null];
		const dirEncoded = encoded.slice(0, lastDoubleDash + 2);
		const filename = encoded.slice(lastDoubleDash + 2);
		const projectPath = this.decodeProjectPath(dirEncoded);
		const filePath = join(PI_SESSION_BASE, dirEncoded, filename);
		return [projectPath, filePath];
	}

	/**
	 * Convert parsed pi session to NormalizedSession.
	 */
	private toNormalizedSession(
		parsed: ParsedPiSession,
		projectPath: string,
		filePath: string,
	): NormalizedSession {
		const isLocal = filePath.startsWith(this.localSessionDir(projectPath));
		const sessionId = this.buildSessionId(filePath, projectPath, isLocal);
		const filename = filePath.split(sep).pop() ?? "";

		const messages = this.entriesToMessages(parsed);

		return {
			id: sessionId,
			source: SOURCE,
			sourceId: parsed.header.id,
			projectPath,
			gitRepo: projectPath.split(sep).pop(),
			created: parsed.header.timestamp,
			modified: this.extractModifiedTimeFromParsed(parsed),
			messages,
			messageCount: messages.length,
			firstPrompt: this.extractFirstPromptFromParsed(parsed),
			sourceData: {
				filename,
				displayName: parsed.displayName,
				cwd: parsed.header.cwd,
				branchCount: parsed.branchCount,
				compactionCount: parsed.compactionCount,
				labels: Object.fromEntries(parsed.labels),
				model: parsed.model,
				thinkingLevel: parsed.thinkingLevel,
				tree: [...parsed.tree.entries()].map(([p, c]) => ({
					parent: p,
					children: c,
				})),
				activePath: parsed.activePath,
				entries: parsed.entries.map((e) => ({
					type: e.type,
					id: e.id,
					parentId: e.parentId,
				})),
			},
		};
	}

	/**
	 * Convert parsed entries to NormalizedMessage[].
	 * Includes messages on the active path plus compaction/branch summaries.
	 */
	private entriesToMessages(parsed: ParsedPiSession): NormalizedMessage[] {
		const messages: NormalizedMessage[] = [];
		let msgIndex = 0;

		for (const entry of parsed.entries) {
			// Always include message entries (filter to active path is optional for now)
			if (entry.type === "message") {
				const msg = entry as PiMessageEntry;
				const normalized = this.toNormalizedMessage(msg, parsed, msgIndex);
				if (normalized) {
					messages.push(normalized);
					msgIndex++;
				}
			} else if (entry.type === "compaction") {
				const comp = entry as PiCompactionEntry;
				messages.push({
					id: `compaction-${comp.id ?? msgIndex}`,
					role: "system",
					content: `[Context compacted: ${comp.summary}]`,
					timestamp: comp.timestamp,
					sourceData: {
						piType: "compaction",
						tokensBefore: comp.tokensBefore,
						firstKeptEntryId: comp.firstKeptEntryId,
					},
				});
				msgIndex++;
			} else if (entry.type === "branch_summary") {
				const bs = entry as PiBranchSummaryEntry;
				messages.push({
					id: `branch-summary-${bs.id ?? msgIndex}`,
					role: "system",
					content: `[Branch summary: ${bs.summary}]`,
					timestamp: bs.timestamp,
					sourceData: {
						piType: "branch_summary",
						fromId: bs.fromId,
					},
				});
				msgIndex++;
			} else if (entry.type === "custom_message") {
				const cm = entry as PiCustomMessageEntry;
				const content =
					typeof cm.content === "string"
						? cm.content
						: JSON.stringify(cm.content);
				messages.push({
					id: `custom-message-${cm.id ?? msgIndex}`,
					role: "system",
					content,
					timestamp: cm.timestamp,
					sourceData: {
						piType: "custom_message",
						customType: cm.customType,
						display: cm.display,
					},
				});
				msgIndex++;
			}
		}

		return messages;
	}

	/**
	 * Convert a pi message entry to NormalizedMessage.
	 */
	private toNormalizedMessage(
		entry: PiMessageEntry,
		parsed: ParsedPiSession,
		index: number,
	): NormalizedMessage | null {
		const agentMsg = entry.message;
		if (!agentMsg) return null;

		const content = this.extractTextContent(agentMsg.content);
		const label = parsed.labels.get(entry.id ?? "");

		const msg: NormalizedMessage = {
			id: `pi-${entry.id ?? index}`,
			role: this.piRoleToNormalized(agentMsg.role),
			content,
			timestamp: entry.timestamp,
		};

		// Tool-specific metadata
		if (agentMsg.role === "toolResult") {
			msg.tool = {
				name: agentMsg.toolName ?? "unknown",
				output: content,
				isError: agentMsg.isError ?? false,
			};
		}

		// Assistant metadata
		if (agentMsg.role === "assistant") {
			msg.model = agentMsg.model ?? parsed.model?.modelId;
			if (agentMsg.usage) {
				msg.tokens = {
					input: agentMsg.usage.input,
					output: agentMsg.usage.output,
					total: agentMsg.usage.totalTokens,
				};
			}
		}

		// Labels
		if (label) {
			msg.sourceData = { ...(msg.sourceData ?? {}), label };
		}

		return msg;
	}

	/**
	 * Extract plain text from pi content (string or content blocks).
	 *
	 * pi assistant messages are mostly composed of `thinking` + `toolCall`
	 * blocks; raw `text` blocks are rare. To keep downstream consumers
	 * (digester, analyzer, dashboard) from seeing empty assistant content,
	 * surface thinking and toolCall blocks as readable markdown too.
	 */
	private extractTextContent(
		content: string | PiContentBlock[] | undefined | null,
	): string {
		if (!content) return "";
		if (typeof content === "string") return content;
		const parts: string[] = [];
		for (const b of content) {
			if (b.type === "text" && b.text) {
				parts.push(b.text);
			} else if (b.type === "thinking" && b.thinking) {
				parts.push(`[thinking] ${b.thinking}`);
			} else if (b.type === "toolCall" && b.name) {
				const argsPreview = b.arguments
					? JSON.stringify(b.arguments).slice(0, 200)
					: "";
				parts.push(
					argsPreview
						? `[tool ${b.name}] ${argsPreview}`
						: `[tool ${b.name}]`,
				);
			}
		}
		return parts.join("\n");
	}

	/**
	 * Map pi agent message role to normalized message role.
	 */
	private piRoleToNormalized(
		role: PiAgentMessage["role"],
	): "user" | "assistant" | "tool" | "system" {
		switch (role) {
			case "user":
				return "user";
			case "assistant":
				return "assistant";
			case "toolResult":
				return "tool";
			case "bashExecution":
				return "tool";
			case "custom":
				return "system";
			case "branchSummary":
				return "system";
			case "compactionSummary":
				return "system";
		}
	}

	/**
	 * Extract the modified time from a session file (last message timestamp).
	 */
	private extractModifiedTime(lines: string[]): string {
		for (let i = lines.length - 1; i >= 1; i--) {
			try {
				const entry = JSON.parse(lines[i]);
				if (entry.timestamp) return entry.timestamp;
			} catch {
				// Skip malformed JSON lines
			}
		}
		return "";
	}

	private extractModifiedTimeFromParsed(parsed: ParsedPiSession): string {
		const entries = parsed.entries;
		for (let i = entries.length - 1; i >= 0; i--) {
			if (entries[i].timestamp) return entries[i].timestamp!;
		}
		return parsed.header.timestamp;
	}

	/**
	 * Extract the first user prompt from a session.
	 */
	private extractFirstPrompt(lines: string[]): string {
		for (let i = 1; i < lines.length; i++) {
			try {
				const entry = JSON.parse(lines[i]);
				if (entry.type === "message" && entry.message?.role === "user") {
					const msg = entry.message;
					return typeof msg.content === "string"
						? msg.content
						: (msg.content
								?.filter((b: PiContentBlock) => b.type === "text")
								.map((b: PiContentBlock) => b.text)
								.join(" ") ?? "");
				}
			} catch {
				// Skip malformed JSON lines
			}
		}
		return "";
	}

	private extractFirstPromptFromParsed(parsed: ParsedPiSession): string {
		for (const entry of parsed.entries) {
			if (entry.type === "message") {
				const msg = entry as PiMessageEntry;
				if (msg.message.role === "user") {
					return this.extractTextContent(msg.message.content);
				}
			}
		}
		return "";
	}

	/**
	 * Build the path from root to a leaf node.
	 */
	private buildPathToLeaf(
		nodeId: string,
		tree: Map<string, string[]>,
		path: string[],
		visited: Set<string>,
	): void {
		if (visited.has(nodeId)) return;
		visited.add(nodeId);
		path.push(nodeId);

		const children = tree.get(nodeId);
		if (children && children.length > 0) {
			// Follow the last child (most recent branch) for the active path
			this.buildPathToLeaf(children[children.length - 1], tree, path, visited);
		}
	}

	/**
	 * Apply discovery filters to session entries.
	 */
	private filterSessions(
		sessions: NormalizedSessionEntry[],
		options?: SessionDiscoveryOptions,
	): NormalizedSessionEntry[] {
		let filtered = sessions;

		if (options?.gitBranch) {
			// Pi doesn't store git branch per-entry, skip filtering
		}

		if (options?.since) {
			const since = options.since.getTime();
			filtered = filtered.filter((s) => new Date(s.created).getTime() >= since);
		}

		if (options?.until) {
			const until = options.until.getTime();
			filtered = filtered.filter((s) => new Date(s.created).getTime() <= until);
		}

		// Sort by modified desc by default
		const sortBy = options?.sortBy ?? "modified";
		const sortOrder = options?.sortOrder ?? "desc";
		filtered = [...filtered].sort((a, b) => {
			const aVal = sortBy === "created" ? a.created : a.modified;
			const bVal = sortBy === "created" ? b.created : b.modified;
			const cmp = aVal.localeCompare(bVal);
			return sortOrder === "desc" ? -cmp : cmp;
		});

		return filtered;
	}
}
