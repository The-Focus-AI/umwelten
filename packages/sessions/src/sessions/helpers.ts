/**
 * Shared helpers for the `umwelten sessions` Commander tree.
 *
 * Lookup + formatting bits that every subcommand needs: session
 * lookup-by-id (Claude direct file, prefix, then adapter fallback),
 * --file / --session-dir adapters, date/duration formatting,
 * source colour mapping, common option types.
 */

import { resolve, join, basename } from "node:path";
import { stat } from "node:fs/promises";
import chalk from "chalk";
import {
	getProjectSessionsIncludingFromDirectory,
	buildSessionEntryFromFile,
	discoverSessionFilesInProject,
	getClaudeProjectPath,
} from "@umwelten/core/interaction/persistence/session-store.js";
import type { SessionIndexEntry } from "@umwelten/core/interaction/types/types.js";
import { getAdapterRegistry } from "@umwelten/core/interaction/adapters/index.js";
import type { SessionSource } from "@umwelten/core/interaction/types/normalized-types.js";
import type { LearningKind } from "@umwelten/core/session-record/types.js";
import { LEARNING_KINDS } from "@umwelten/core/session-record/types.js";
import { resolveClaudeCodeSessionHandle } from "@umwelten/core/session-record/resolve-claude.js";

/**
 * Look up a single session by id (full or prefix) without requiring a full index.
 *
 * Strategy:
 *  1. If id is a full UUID, try the JSONL file directly — fastest path, no directory scan.
 *  2. Otherwise scan the project's Claude directory for a matching filename prefix.
 *  3. Fall back to the existing index/directory merge (catches indexed entries whose
 *     file may not live under the Claude dir for this encoded path).
 *
 * Returns a fully-populated SessionIndexEntry (streams the file for metadata when needed).
 */
export async function findSessionById(
	projectPath: string,
	sessionId: string,
): Promise<SessionIndexEntry | null> {
	if (!sessionId) return null;

	const claudeDir = getClaudeProjectPath(projectPath);

	// 1. Direct file path (full UUID case)
	const directPath = join(claudeDir, `${sessionId}.jsonl`);
	try {
		await stat(directPath);
		return await buildSessionEntryFromFile(directPath, projectPath);
	} catch {
		// Not a full UUID or file doesn't exist — fall through
	}

	// 2. Prefix match against directory listing (Claude Code JSONL)
	const files = await discoverSessionFilesInProject(projectPath);
	const match = files.find((f) => basename(f, ".jsonl").startsWith(sessionId));
	if (match) {
		return await buildSessionEntryFromFile(match, projectPath);
	}

	// 3. Adapter-based lookup (pi, cursor, habitat, etc.)
	const registry = getAdapterRegistry();
	const adapters = await registry.detectAdapters(projectPath);
	for (const adapter of adapters) {
		try {
			const result = await adapter.discoverSessions({
				projectPath,
				sortBy: "modified",
				sortOrder: "desc",
				limit: 200,
			});
			const match = result.sessions.find(
				(s) =>
					s.id === sessionId ||
					s.id.startsWith(sessionId) ||
					s.sourceId?.startsWith(sessionId),
			);
			if (match) {
				return {
					sessionId: match.id,
					source: match.source,
					firstPrompt: match.firstPrompt ?? "",
					messageCount: match.messageCount ?? 0,
					created: match.created ?? "",
					modified: match.modified ?? "",
					gitBranch: match.gitBranch ?? "",
					projectPath: match.projectPath ?? projectPath,
					isSidechain: false,
					fileMtime: 0,
				};
			}
		} catch {
			// Try next adapter
		}
	}

	// 4. Fall back to merged index + directory (preserves any edge cases)
	try {
		const entries = await getProjectSessionsIncludingFromDirectory(projectPath);
		return (
			entries.find(
				(e) => e.sessionId === sessionId || e.sessionId.startsWith(sessionId),
			) ?? null
		);
	} catch {
		return null;
	}
}

/**
 * Resolve session for show/messages/stats: from project (lazy lookup), or from --file / --session-dir (Jeeves-style).
 */
export async function resolveSessionEntry(
	projectPath: string,
	sessionId: string,
	filePath?: string,
	sessionDir?: string,
): Promise<SessionIndexEntry | null> {
	if (filePath) {
		const full = resolve(filePath);
		try {
			await stat(full);
		} catch {
			return null;
		}
		const dir = basename(resolve(full, ".."));
		return {
			sessionId: dir,
			fullPath: full,
			fileMtime: 0,
			firstPrompt: "",
			messageCount: 0,
			created: "",
			modified: "",
			gitBranch: "",
			projectPath: resolve(full, "..", ".."),
			isSidechain: false,
		};
	}
	if (sessionDir) {
		const full = join(resolve(sessionDir), "transcript.jsonl");
		try {
			await stat(full);
		} catch {
			return null;
		}
		const dirName = basename(resolve(sessionDir));
		return {
			sessionId: dirName,
			fullPath: full,
			fileMtime: 0,
			firstPrompt: "",
			messageCount: 0,
			created: "",
			modified: "",
			gitBranch: "",
			projectPath: resolve(sessionDir, ".."),
			isSidechain: false,
		};
	}
	return findSessionById(projectPath, sessionId);
}

// ── Formatting helpers ───────────────────────────────────────────────

export function formatDate(dateStr: string): string {
	const date = new Date(dateStr);
	const now = new Date();
	const diffMs = now.getTime() - date.getTime();
	const diffHours = diffMs / (1000 * 60 * 60);
	const diffDays = diffMs / (1000 * 60 * 60 * 24);

	if (diffHours < 1) {
		const minutes = Math.floor(diffMs / (1000 * 60));
		return `${minutes}m ago`;
	} else if (diffHours < 24) {
		return `${Math.floor(diffHours)}h ago`;
	} else if (diffDays < 7) {
		return `${Math.floor(diffDays)}d ago`;
	}

	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
	});
}

export function truncatePrompt(prompt: string, maxLength: number = 50): string {
	if (prompt.length <= maxLength) return prompt;
	return prompt.slice(0, maxLength - 3) + "...";
}

export function shortSessionId(sessionId: string): string {
	return sessionId.split("-")[0];
}

export function formatDuration(durationMs: number): string {
	const seconds = Math.floor(durationMs / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);

	if (days > 0) {
		return `${days}d ${hours % 24}h`;
	} else if (hours > 0) {
		return `${hours}h ${minutes % 60}m`;
	} else if (minutes > 0) {
		return `${minutes}m ${seconds % 60}s`;
	} else {
		return `${seconds}s`;
	}
}

export interface ListOptions {
	project: string;
	limit: string;
	branch?: string;
	sort: "created" | "modified" | "messages";
	source?: string;
	json?: boolean;
}

// Source colour mapping
export function getSourceColor(source: SessionSource): (text: string) => string {
	switch (source) {
		case "claude-code":
			return chalk.blue;
		case "cursor":
			return chalk.magenta;
		default:
			return chalk.gray;
	}
}

export function getSourceLabel(source: SessionSource): string {
	switch (source) {
		case "claude-code":
			return "Claude";
		case "cursor":
			return "Cursor";
		default:
			return source;
	}
}

// ── Learnings root resolution (for `umwelten sessions learnings`) ────

export async function resolveLearningsRootForCli(opts: {
	sessionDir?: string;
	workDir?: string;
	claudeProject?: string;
	claudeUuid?: string;
}): Promise<string> {
	if (opts.sessionDir) {
		return resolve(opts.sessionDir);
	}
	if (opts.workDir && opts.claudeProject && opts.claudeUuid) {
		const h = await resolveClaudeCodeSessionHandle({
			workDir: resolve(opts.workDir),
			projectPath: resolve(opts.claudeProject),
			sessionUuid: opts.claudeUuid,
		});
		return h.learningsRoot;
	}
	throw new Error(
		"Provide --session-dir PATH or --work-dir, --claude-project, and --claude-uuid",
	);
}

export function isLearningKind(s: string): s is LearningKind {
	return (LEARNING_KINDS as readonly string[]).includes(s);
}
