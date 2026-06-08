/**
 * SessionHitParser — translate a RawScanHit (ripgrep match record)
 * into a typed SessionHit (one conversation message that matched).
 *
 * What this module knows:
 *  - How Claude Code encodes project paths in directory names
 *    (`/Users/foo/bar` → `-Users-foo-bar`).
 *  - The shape of a Claude Code JSONL message line: `type`, `timestamp`,
 *    `message.role`, `message.content` (string for user, array of
 *    content blocks for assistant).
 *  - That `summary`, `queue-operation`, and other non-message record
 *    types should produce no hit (they aren't conversation messages).
 *  - How to build a ripgrep-style ~80-char snippet centered on the
 *    query's position within the matched message (slice 3).
 *
 * What this module does NOT know:
 *  - Noise filtering (sidechain, micro-file): see noise-filters.ts.
 */

import { basename, dirname } from "node:path";
import type { RawScanHit, SessionHit } from "./types.js";

/**
 * Target snippet width in characters. ~80 chars fits comfortably in a
 * typical terminal column without wrapping. Public so tests and TUI
 * code can reference a single constant.
 */
export const SNIPPET_WIDTH = 80;
const ELLIPSIS = "…";

/**
 * Decode a Claude Code project directory name back to its filesystem
 * path. Claude Code maps `/Users/foo/bar/baz` → `-Users-foo-bar-baz`.
 * This is the inverse, matching the convention in
 * core/interaction/adapters/claude-code-adapter.ts.
 */
export function decodeProjectDirName(dirName: string): string {
	return dirName.replace(/^-/, "/").replace(/-/g, "/");
}

/**
 * Map a RawScanHit to a SessionHit, or return null if the matched
 * line isn't a conversation message we can usefully surface.
 *
 * Reasons to return null:
 *  - The line isn't valid JSON (rare in practice — JSONL by definition).
 *  - The record's `type` isn't a message type we recognise
 *    (`user`, `assistant`, `tool`, `system`). Records like
 *    `queue-operation`, `summary`, and `file-history-snapshot` aren't
 *    conversation content.
 *  - The record has no extractable text content.
 *
 * The `query` parameter is required so the parser can build a snippet
 * centered on the match within the extracted message text. The match
 * is located case-insensitively (mirroring the default ripgrep flag).
 * If the query somehow doesn't appear in the flattened text — e.g. the
 * raw match was inside a JSON envelope field we don't extract — the
 * snippet falls back to the message's opening characters.
 */
export function parseHit(raw: RawScanHit, query: string): SessionHit | null {
	let record: any;
	try {
		record = JSON.parse(raw.matchedLine);
	} catch {
		return null;
	}

	const type = record?.type;
	if (type !== "user" && type !== "assistant" && type !== "tool" && type !== "system") {
		return null;
	}

	const fullMessageContent = extractMessageText(record);
	if (!fullMessageContent) return null;

	const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";

	// Decode the project from the file's parent directory.
	const parentDir = dirname(raw.filePath);
	const parentDirName = basename(parentDir);
	const projectPath = decodeProjectDirName(parentDirName);
	const projectName = basename(projectPath) || projectPath;

	const sessionId = basename(raw.filePath, ".jsonl");

	const snippet = buildSnippet(fullMessageContent, query);

	return {
		projectPath,
		projectName,
		sessionId,
		filePath: raw.filePath,
		messageTimestamp: timestamp,
		role: type as SessionHit["role"],
		snippet,
		fullMessageContent,
	};
}

/**
 * Build a ripgrep-style ~80-char context window centered on the
 * query's position within `text`.
 *
 * Rules:
 *  - If `text.length <= SNIPPET_WIDTH`, return the full text unchanged
 *    (no ellipsis markers).
 *  - Otherwise find the first case-insensitive occurrence of `query`.
 *    If `query` doesn't appear (the JSONL envelope matched, not the
 *    message body), fall back to the opening of the text.
 *  - Center the window on the match, then clamp to the text bounds.
 *    Prepend `…` if the window doesn't start at character 0; append
 *    `…` if it doesn't end at the last character.
 *  - Newlines and surrounding whitespace inside the window are
 *    collapsed to single spaces so the snippet renders cleanly on
 *    one TUI row.
 */
export function buildSnippet(text: string, query: string): string {
	// Collapse internal whitespace runs (newlines, tabs, repeated spaces)
	// to single spaces so the snippet renders on one row.
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length <= SNIPPET_WIDTH) return flat;

	const trimmedQuery = (query ?? "").trim();
	let matchStart = -1;
	let matchLen = 0;
	if (trimmedQuery) {
		matchStart = flat.toLowerCase().indexOf(trimmedQuery.toLowerCase());
		matchLen = trimmedQuery.length;
	}

	let start: number;
	let end: number;
	if (matchStart < 0) {
		// Query didn't appear in the extracted text. Fall back to the
		// opening of the message.
		start = 0;
		end = SNIPPET_WIDTH;
	} else {
		const matchCenter = matchStart + Math.floor(matchLen / 2);
		start = matchCenter - Math.floor(SNIPPET_WIDTH / 2);
		end = start + SNIPPET_WIDTH;
		// Clamp into bounds, preserving the window width.
		if (start < 0) {
			end -= start; // shift right
			start = 0;
		}
		if (end > flat.length) {
			start -= end - flat.length; // shift left
			end = flat.length;
			if (start < 0) start = 0;
		}
	}

	const leadingEllipsis = start > 0;
	const trailingEllipsis = end < flat.length;

	let snippet = flat.slice(start, end);
	if (leadingEllipsis) snippet = ELLIPSIS + snippet;
	if (trailingEllipsis) snippet = snippet + ELLIPSIS;
	return snippet;
}

/**
 * Extract the message's text content as a single string.
 *
 * Claude Code message shapes we handle:
 *  - User: `{message: {role, content: "string"}}`. Most common.
 *  - User w/ array content: `{message: {role, content: [{type:"text",text:"..."}, ...]}}`.
 *    Also covers tool_result blocks etc. — we concatenate the text-typed entries.
 *  - Assistant: `{message: {role, content: [{type:"text",text:"..."}, {type:"tool_use",...}, ...]}}`.
 *    We extract text blocks; tool_use blocks contribute their `input` JSON as a fallback
 *    so a hit inside a tool call payload still surfaces something meaningful.
 *
 * Returns the empty string if no text could be extracted.
 */
export function extractMessageText(record: any): string {
	const content = record?.message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if (typeof block.text === "string") {
			parts.push(block.text);
			continue;
		}
		if (block.type === "tool_use" && block.input !== undefined) {
			try {
				parts.push(JSON.stringify(block.input));
			} catch {
				/* unrepresentable input — skip */
			}
			continue;
		}
		if (block.type === "tool_result" && typeof block.content === "string") {
			parts.push(block.content);
		}
	}
	return parts.join("\n");
}
