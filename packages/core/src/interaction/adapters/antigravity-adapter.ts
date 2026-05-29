/**
 * Antigravity session adapter
 *
 * Reads sessions from Google Antigravity's encrypted protobuf storage.
 * Location: ~/.gemini/antigravity-{cli,ide,*}/conversations/{conversationId}.pb
 *
 * File format (per-file, reverse-engineered from the `agy` Go binary,
 * package `third_party/jetski/cortex/proto_saver`):
 *
 *   [ nonce: 12 bytes | AES-256-GCM(ciphertext + tag) ]
 *
 * The 32-byte AES key is a hardcoded ASCII string ("safeCodeiumworldKeYsecretBalloon")
 * baked into every Antigravity language_server binary. Same key for every install,
 * every user, every conversation worldwide. The Keychain entry
 * "Antigravity Safe Storage" is used by the hub Electron app for Cookies, not for
 * conversation data — the language_server does not read from the Keychain.
 *
 * Plaintext payload is a `gemini_coder.Trajectory` protobuf:
 *
 *   Trajectory {
 *     string trajectory_id = 1;
 *     repeated Step  steps = 2;
 *     ... other metadata ...
 *   }
 *
 *   Step {
 *     CortexStepType  type   = 1;   // enum (14=USER_INPUT, 20=PLANNER_RESPONSE, ...)
 *     CortexStepStatus status = 4;
 *     CortexStepMetadata metadata = 5;  // contains timestamp
 *     CortexStepUserInput     user_input        = 19;  // user prompt
 *     CortexStepPlannerResponse planner_response = 20;  // assistant reply
 *     CortexStepSystemMessage system_message    = 114;
 *     ... 50+ other tool-shaped step variants ...
 *   }
 *
 * Only the user/assistant/system step variants are surfaced as NormalizedMessages;
 * tool steps (run_command, view_file, etc.) are summarized into `role: "tool"`
 * messages with `tool.name` set to the step variant name.
 */

import { createDecipheriv } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import type { SessionAdapter } from "./adapter.js";
import type {
	NormalizedMessage,
	NormalizedSession,
	NormalizedSessionEntry,
	SessionDiscoveryOptions,
	SessionDiscoveryResult,
	SessionMetrics,
	SessionSource,
} from "../types/normalized-types.js";

// ── format constants ───────────────────────────────────────────────────────

/** AES-256-GCM key, ASCII, hardcoded in the Antigravity language_server binary. */
const ANTIGRAVITY_KEY = Buffer.from("safeCodeiumworldKeYsecretBalloon", "utf8");
const NONCE_LEN = 12;
const GCM_TAG_LEN = 16;

/** Map of Step field-number → human-readable kind. */
const STEP_VARIANTS: Record<number, string> = {
	// Conversation messages
	19: "user_input",
	20: "planner_response",
	114: "system_message",
	// Tool / action steps
	9: "mquery",
	10: "code_action",
	11: "git_commit",
	12: "finish",
	13: "grep_search",
	14: "view_file",
	15: "list_directory",
	16: "compile",
	22: "view_code_item",
	23: "checkpoint",
	24: "error_message",
	28: "run_command",
	34: "find",
	36: "suggested_responses",
	37: "command_status",
	40: "read_url_content",
	41: "view_content_chunk",
	42: "search_web",
	47: "mcp_tool",
	55: "clipboard",
	58: "view_file_outline",
	62: "list_resources",
	63: "read_resource",
	64: "lint_diff",
	67: "open_browser_url",
	72: "trajectory_search",
	86: "file_change",
	87: "move",
	92: "delete_directory",
	98: "conversation_history",
	100: "send_command_input",
	101: "system_message_event",
	102: "wait",
	127: "invoke_subagent",
	140: "generic",
};

// ── tiny protobuf wire-format reader ───────────────────────────────────────

interface WireField {
	field: number;
	wt: number;
	value: number | Buffer;
}

function readVarint(
	buf: Buffer,
	pos: number,
): { value: number; pos: number } {
	let value = 0;
	let shift = 0;
	let p = pos;
	while (p < buf.length) {
		const b = buf[p++];
		value |= (b & 0x7f) << shift;
		if ((b & 0x80) === 0) return { value: value >>> 0, pos: p };
		shift += 7;
		if (shift > 64) throw new Error("varint too long");
	}
	throw new Error("varint truncated");
}

function parseProto(buf: Buffer): WireField[] {
	const out: WireField[] = [];
	let i = 0;
	while (i < buf.length) {
		const startI = i;
		const tag = readVarint(buf, i);
		i = tag.pos;
		const field = tag.value >> 3;
		const wt = tag.value & 7;
		if (wt === 0) {
			const v = readVarint(buf, i);
			out.push({ field, wt, value: v.value });
			i = v.pos;
		} else if (wt === 1) {
			if (i + 8 > buf.length) break;
			out.push({ field, wt, value: buf.subarray(i, i + 8) });
			i += 8;
		} else if (wt === 2) {
			const len = readVarint(buf, i);
			i = len.pos;
			// Sanity bound: a single length-delimited field can't exceed remaining buffer
			if (len.value > buf.length - i) break;
			out.push({ field, wt, value: buf.subarray(i, i + len.value) });
			i += len.value;
		} else if (wt === 5) {
			if (i + 4 > buf.length) break;
			out.push({ field, wt, value: buf.subarray(i, i + 4) });
			i += 4;
		} else {
			// Unknown wire type (3/4 are deprecated groups). Stop parsing.
			break;
		}
		// Defensive: must always make forward progress.
		if (i <= startI) break;
	}
	return out;
}

/** Convenience: get first field with given number as Buffer (wt=2) or undefined. */
function getBuf(fields: WireField[], field: number): Buffer | undefined {
	for (const f of fields) {
		if (f.field === field && f.wt === 2) return f.value as Buffer;
	}
	return undefined;
}

/** Convenience: get first field with given number as varint or undefined. */
function getVarint(fields: WireField[], field: number): number | undefined {
	for (const f of fields) {
		if (f.field === field && f.wt === 0) return f.value as number;
	}
	return undefined;
}

/** Convenience: get all fields with given number (for repeated fields). */
function getAllBufs(fields: WireField[], field: number): Buffer[] {
	return fields
		.filter((f) => f.field === field && f.wt === 2)
		.map((f) => f.value as Buffer);
}

// ── decryption ─────────────────────────────────────────────────────────────

/** Decrypt an Antigravity .pb file. Returns the plaintext Trajectory bytes. */
function decryptTrajectory(encrypted: Buffer): Buffer {
	if (encrypted.length < NONCE_LEN + GCM_TAG_LEN) {
		throw new Error(
			`encrypted payload too short (${encrypted.length} bytes); need at least ${NONCE_LEN + GCM_TAG_LEN}`,
		);
	}
	const nonce = encrypted.subarray(0, NONCE_LEN);
	const ctWithTag = encrypted.subarray(NONCE_LEN);
	const ciphertext = ctWithTag.subarray(0, ctWithTag.length - GCM_TAG_LEN);
	const tag = ctWithTag.subarray(ctWithTag.length - GCM_TAG_LEN);

	const decipher = createDecipheriv("aes-256-gcm", ANTIGRAVITY_KEY, nonce);
	decipher.setAuthTag(tag);
	const pt = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return pt;
}

// ── Trajectory → NormalizedSession ─────────────────────────────────────────

interface ParsedStep {
	type: number;
	variant: string | undefined;
	timestamp: string | undefined;
	/** Free-text content if this step carries a user/assistant/system message. */
	text: string | undefined;
	/** Tool input as a JSON-ish summary string, when this step is a tool action. */
	toolSummary: string | undefined;
	/** Role hint; undefined for tool/internal steps. */
	role: "user" | "assistant" | "system" | undefined;
}

function parseStepMetadataTimestamp(metaBuf: Buffer): string | undefined {
	// CortexStepMetadata field 1 = google.protobuf.Timestamp { int64 seconds=1; int32 nanos=2 }
	const meta = parseProto(metaBuf);
	const tsBuf = getBuf(meta, 1);
	if (!tsBuf) return undefined;
	const ts = parseProto(tsBuf);
	const seconds = getVarint(ts, 1) ?? 0;
	const nanos = getVarint(ts, 2) ?? 0;
	if (!seconds) return undefined;
	const ms = seconds * 1000 + Math.floor(nanos / 1_000_000);
	return new Date(ms).toISOString();
}

function parseStep(stepBuf: Buffer): ParsedStep {
	const fields = parseProto(stepBuf);
	const type = getVarint(fields, 1) ?? 0;
	const metaBuf = getBuf(fields, 5);
	const timestamp = metaBuf ? parseStepMetadataTimestamp(metaBuf) : undefined;

	// USER_INPUT (Step.user_input = 19, CortexStepUserInput.user_response = 2)
	const userInputBuf = getBuf(fields, 19);
	if (userInputBuf) {
		const ui = parseProto(userInputBuf);
		const responseBuf = getBuf(ui, 2);
		const text = responseBuf ? responseBuf.toString("utf8") : "";
		return {
			type,
			variant: "user_input",
			timestamp,
			text,
			toolSummary: undefined,
			role: "user",
		};
	}

	// PLANNER_RESPONSE (Step.planner_response = 20, CortexStepPlannerResponse.response = 1)
	const plannerBuf = getBuf(fields, 20);
	if (plannerBuf) {
		const pr = parseProto(plannerBuf);
		const responseBuf = getBuf(pr, 1);
		const modifiedBuf = getBuf(pr, 8);
		const thinkingBuf = getBuf(pr, 3);
		const modified = modifiedBuf?.toString("utf8") ?? "";
		const response = responseBuf?.toString("utf8") ?? "";
		const thinking = thinkingBuf?.toString("utf8") ?? "";
		// Prefer non-empty modified > response > thinking
		const text =
			(modified.trim() && modified) ||
			(response.trim() && response) ||
			(thinking.trim() && thinking) ||
			"";
		// If there's no prose at all, skip — the assistant emitted a tool-only
		// turn and the actual tool call will appear as its own subsequent step.
		if (!text.trim()) {
			return {
				type,
				variant: "planner_response_empty",
				timestamp,
				text: undefined,
				toolSummary: undefined,
				role: undefined,
			};
		}
		return {
			type,
			variant: "planner_response",
			timestamp,
			text,
			toolSummary: undefined,
			role: "assistant",
		};
	}

	// SYSTEM_MESSAGE (Step.system_message = 114, CortexStepSystemMessage.message = 1)
	const systemBuf = getBuf(fields, 114);
	if (systemBuf) {
		const sm = parseProto(systemBuf);
		const messageBuf = getBuf(sm, 1);
		const text = messageBuf ? messageBuf.toString("utf8") : "";
		return {
			type,
			variant: "system_message",
			timestamp,
			text,
			toolSummary: undefined,
			role: "system",
		};
	}

	// Otherwise: this is a tool/action step. Pick the variant whose field is present.
	let variant: string | undefined;
	let toolBody: Buffer | undefined;
	for (const f of fields) {
		if (
			f.wt === 2 &&
			STEP_VARIANTS[f.field] &&
			f.field !== 5 && // metadata
			f.field !== 19 &&
			f.field !== 20 &&
			f.field !== 114
		) {
			variant = STEP_VARIANTS[f.field];
			toolBody = f.value as Buffer;
			break;
		}
	}

	// Best-effort: turn the tool body into a short readable summary by extracting
	// any short ASCII string fields we find (paths, queries, command lines).
	let toolSummary: string | undefined;
	if (toolBody) {
		const inner = parseProto(toolBody);
		const strs: string[] = [];
		for (const f of inner) {
			if (f.wt === 2) {
				const b = f.value as Buffer;
				if (b.length > 0 && b.length < 1024) {
					// Heuristic: keep buffers that are mostly printable ASCII.
					const s = b.toString("utf8");
					if (/^[\x20-\x7e\n\r\t]+$/.test(s) && s.trim().length > 0) {
						strs.push(s.length > 200 ? `${s.slice(0, 200)}…` : s);
					}
				}
			}
		}
		if (strs.length > 0) toolSummary = strs.join(" · ");
	}

	return {
		type,
		variant: variant ?? `step_type_${type}`,
		timestamp,
		text: undefined,
		toolSummary,
		role: undefined,
	};
}

/** Result of opening one .pb file and turning it into a normalized session. */
interface OpenedTrajectory {
	/** Filename-based id (matches the basename of the .pb on disk). */
	fileId: string;
	/** Inner protobuf trajectory_id (often differs from fileId). */
	trajectoryId: string;
	installVariant: string;
	filePath: string;
	/** Workspace (project) path from history.jsonl, if resolvable. */
	workspacePath: string | undefined;
	steps: ParsedStep[];
	created: string;
	modified: string;
}

/**
 * One install's `history.jsonl` parsed into a lookup table.
 * `byPrompt` maps a user prompt's `display` text → workspace path.
 */
interface HistoryIndex {
	byPrompt: Map<string, string>;
}

async function loadHistoryIndex(installDir: string): Promise<HistoryIndex> {
	const byPrompt = new Map<string, string>();
	try {
		const text = await readFile(join(installDir, "history.jsonl"), "utf8");
		for (const line of text.split("\n")) {
			if (!line.trim()) continue;
			try {
				const obj = JSON.parse(line) as { display?: string; workspace?: string };
				if (obj.display && obj.workspace && !byPrompt.has(obj.display)) {
					byPrompt.set(obj.display, obj.workspace);
				}
			} catch {
				/* skip */
			}
		}
	} catch {
		/* no history.jsonl */
	}
	return { byPrompt };
}

async function openTrajectory(
	filePath: string,
	installVariant: string,
	historyIndex: HistoryIndex,
): Promise<OpenedTrajectory | null> {
	const raw = await readFile(filePath);
	let plaintext: Buffer;
	try {
		plaintext = decryptTrajectory(raw);
	} catch {
		// Either format change, corrupt file, or empty stub.
		return null;
	}

	let fields: WireField[];
	try {
		fields = parseProto(plaintext);
	} catch {
		return null;
	}
	const idBuf = getBuf(fields, 1);
	const trajectoryId = idBuf ? idBuf.toString("utf8") : basename(filePath, ".pb");
	const fileId = basename(filePath, ".pb");

	const stepBufs = getAllBufs(fields, 2);
	const steps: ParsedStep[] = [];
	for (const sb of stepBufs) {
		try {
			steps.push(parseStep(sb));
		} catch {
			// skip malformed step
		}
	}

	// Resolve workspace from the first user prompt via history.jsonl.
	const firstUserPrompt = steps.find((s) => s.role === "user")?.text;
	const workspacePath = firstUserPrompt
		? historyIndex.byPrompt.get(firstUserPrompt)
		: undefined;

	const st = await stat(filePath);
	const firstTs = steps.find((s) => s.timestamp)?.timestamp;
	const lastTs = [...steps].reverse().find((s) => s.timestamp)?.timestamp;
	const created = firstTs ?? st.birthtime.toISOString();
	const modified = lastTs ?? st.mtime.toISOString();

	return {
		fileId,
		trajectoryId,
		installVariant,
		filePath,
		workspacePath,
		steps,
		created,
		modified,
	};
}

function trajectoryToNormalizedSession(t: OpenedTrajectory): NormalizedSession {
	const messages: NormalizedMessage[] = t.steps.map((step, idx) => {
		const id = `${t.fileId}#${idx}`;
		if (step.role) {
			return {
				id,
				role: step.role,
				content: step.text ?? "",
				timestamp: step.timestamp,
				sourceData: { stepType: step.type, variant: step.variant },
			};
		}
		// Tool / action step
		return {
			id,
			role: "tool",
			content: step.toolSummary ?? `[${step.variant}]`,
			timestamp: step.timestamp,
			tool: {
				name: step.variant ?? `step_type_${step.type}`,
			},
			sourceData: { stepType: step.type, variant: step.variant },
		};
	});

	const userMessages = messages.filter((m) => m.role === "user").length;
	const assistantMessages = messages.filter(
		(m) => m.role === "assistant",
	).length;
	const toolCalls = messages.filter((m) => m.role === "tool").length;
	const metrics: SessionMetrics = {
		userMessages,
		assistantMessages,
		toolCalls,
	};

	const firstUserMsg = messages.find((m) => m.role === "user");
	const firstPrompt = firstUserMsg?.content?.slice(0, 500) ?? "";

	let duration: number | undefined;
	const timestamps = messages
		.filter((m) => m.timestamp)
		.map((m) => new Date(m.timestamp as string).getTime());
	if (timestamps.length >= 2) {
		duration = Math.max(...timestamps) - Math.min(...timestamps);
	}

	return {
		id: `antigravity:${t.fileId}`,
		source: "antigravity",
		sourceId: t.fileId,
		projectPath: t.workspacePath,
		workspacePath: t.workspacePath,
		created: t.created,
		modified: t.modified,
		duration,
		messages,
		messageCount: messages.length,
		firstPrompt,
		metrics,
		sourceData: {
			installVariant: t.installVariant,
			filePath: t.filePath,
			trajectoryId: t.trajectoryId,
		},
	};
}

function trajectoryToEntry(t: OpenedTrajectory): NormalizedSessionEntry {
	const userMessages = t.steps.filter((s) => s.role === "user");
	const assistantMessages = t.steps.filter((s) => s.role === "assistant");
	const toolCalls = t.steps.filter((s) => s.role === undefined);
	return {
		id: `antigravity:${t.fileId}`,
		source: "antigravity",
		sourceId: t.fileId,
		projectPath: t.workspacePath,
		created: t.created,
		modified: t.modified,
		messageCount: t.steps.length,
		firstPrompt: userMessages[0]?.text?.slice(0, 500) ?? "",
		metrics: {
			userMessages: userMessages.length,
			assistantMessages: assistantMessages.length,
			toolCalls: toolCalls.length,
		},
		sourceData: {
			installVariant: t.installVariant,
			filePath: t.filePath,
			trajectoryId: t.trajectoryId,
			workspacePath: t.workspacePath,
		},
	};
}

// ── Adapter ────────────────────────────────────────────────────────────────

/**
 * Antigravity session adapter.
 *
 * Discovers conversations under every `~/.gemini/antigravity-*\/conversations/`
 * directory (CLI and IDE installs, plus any backups/snapshots), AES-256-GCM
 * decrypts each `.pb`, and normalizes the resulting Trajectory into a
 * `NormalizedSession`.
 *
 * On disk Antigravity uses a single shared key worldwide, so this adapter has
 * no per-user setup; it just reads the files in place.
 */
export class AntigravityAdapter implements SessionAdapter {
	readonly source: SessionSource = "antigravity";
	readonly displayName = "Antigravity";

	private geminiDir: string;

	constructor() {
		this.geminiDir = join(homedir(), ".gemini");
	}

	getSourceLocation(): string {
		return this.geminiDir;
	}

	async canHandle(_projectPath: string): Promise<boolean> {
		// Antigravity sessions aren't reliably project-scoped on disk (workspace
		// path is only available in `history.jsonl`, not in the encrypted .pb).
		// We treat the adapter as always-applicable at the install level; the
		// session browser does the project filtering itself based on workspace
		// info surfaced via `firstPrompt` and `sourceData`.
		return await this.hasAnyInstall();
	}

	async hasSessionsForProject(_projectPath: string): Promise<boolean> {
		return await this.hasAnyInstall();
	}

	async discoverProjects(): Promise<string[]> {
		// We can read workspace paths out of each install's history.jsonl. Each
		// line is `{ display, timestamp, workspace }`. Dedupe across all installs.
		const installs = await this.listInstalls();
		const workspaces = new Set<string>();
		for (const install of installs) {
			const historyPath = join(install.dir, "history.jsonl");
			try {
				const text = await readFile(historyPath, "utf8");
				for (const line of text.split("\n")) {
					if (!line.trim()) continue;
					try {
						const obj = JSON.parse(line) as { workspace?: string };
						if (obj.workspace) workspaces.add(obj.workspace);
					} catch {
						// skip malformed line
					}
				}
			} catch {
				// install has no history.jsonl; skip
			}
		}
		return [...workspaces];
	}

	async discoverSessions(
		options?: SessionDiscoveryOptions,
	): Promise<SessionDiscoveryResult> {
		const installs = await this.listInstalls();
		const opened: OpenedTrajectory[] = [];
		for (const install of installs) {
			const convDir = join(install.dir, "conversations");
			let files: string[];
			try {
				files = await readdir(convDir);
			} catch {
				continue;
			}
			const historyIndex = await loadHistoryIndex(install.dir);
			for (const f of files) {
				if (!f.endsWith(".pb")) continue;
				const t = await openTrajectory(
					join(convDir, f),
					install.variant,
					historyIndex,
				);
				if (t) opened.push(t);
			}
		}

		let entries = opened.map(trajectoryToEntry);

		if (options?.projectPath) {
			const target = options.projectPath;
			entries = entries.filter((e) => e.projectPath === target);
		}
		if (options?.since) {
			const since = options.since.getTime();
			entries = entries.filter((e) => new Date(e.created).getTime() >= since);
		}
		if (options?.until) {
			const until = options.until.getTime();
			entries = entries.filter((e) => new Date(e.created).getTime() <= until);
		}

		const sortBy = options?.sortBy ?? "modified";
		const sortOrder = options?.sortOrder ?? "desc";
		entries.sort((a, b) => {
			let cmp = 0;
			if (sortBy === "created") {
				cmp = new Date(a.created).getTime() - new Date(b.created).getTime();
			} else if (sortBy === "modified") {
				cmp = new Date(a.modified).getTime() - new Date(b.modified).getTime();
			} else if (sortBy === "messageCount") {
				cmp = a.messageCount - b.messageCount;
			}
			return sortOrder === "desc" ? -cmp : cmp;
		});

		const totalCount = entries.length;
		if (options?.limit && options.limit > 0) {
			entries = entries.slice(0, options.limit);
		}

		return {
			sessions: entries,
			source: this.source,
			totalCount,
			hasMore: totalCount > entries.length,
		};
	}

	async getSessionEntry(
		sessionId: string,
	): Promise<NormalizedSessionEntry | null> {
		const t = await this.openById(sessionId);
		return t ? trajectoryToEntry(t) : null;
	}

	async getSession(sessionId: string): Promise<NormalizedSession | null> {
		const t = await this.openById(sessionId);
		return t ? trajectoryToNormalizedSession(t) : null;
	}

	async getMessages(sessionId: string): Promise<NormalizedMessage[]> {
		const session = await this.getSession(sessionId);
		return session?.messages ?? [];
	}

	// ── private ──

	private async hasAnyInstall(): Promise<boolean> {
		const installs = await this.listInstalls();
		return installs.length > 0;
	}

	/** List every `~/.gemini/antigravity-*\/` dir that has a `conversations/` subdir. */
	private async listInstalls(): Promise<
		Array<{ dir: string; variant: string }>
	> {
		let entries: string[];
		try {
			entries = await readdir(this.geminiDir);
		} catch {
			return [];
		}
		const result: Array<{ dir: string; variant: string }> = [];
		for (const name of entries) {
			if (!name.startsWith("antigravity")) continue;
			const dir = join(this.geminiDir, name);
			try {
				const s = await stat(join(dir, "conversations"));
				if (!s.isDirectory()) continue;
			} catch {
				continue;
			}
			// "antigravity" -> "default", "antigravity-cli" -> "cli", "antigravity-backup" -> "backup"
			const variant = name === "antigravity" ? "default" : name.slice("antigravity-".length);
			result.push({ dir, variant });
		}
		return result;
	}

	private async openById(sessionId: string): Promise<OpenedTrajectory | null> {
		const originalId = sessionId.startsWith("antigravity:")
			? sessionId.slice("antigravity:".length)
			: sessionId;
		const installs = await this.listInstalls();
		for (const install of installs) {
			const filePath = join(install.dir, "conversations", `${originalId}.pb`);
			try {
				const s = await stat(filePath);
				if (!s.isFile()) continue;
			} catch {
				continue;
			}
			const historyIndex = await loadHistoryIndex(install.dir);
			const t = await openTrajectory(filePath, install.variant, historyIndex);
			if (t) return t;
		}
		return null;
	}
}

/** Factory function for creating AntigravityAdapter. */
export function createAntigravityAdapter(): AntigravityAdapter {
	return new AntigravityAdapter();
}
