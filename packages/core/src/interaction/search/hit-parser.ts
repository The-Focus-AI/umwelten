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
 *
 * What this module does NOT know (slice 2 and beyond):
 *  - Noise filtering (sidechain, micro-file): slice 2.
 *  - Snippet construction (context window centered on match): slice 3.
 *  - Full-message content extraction for the TUI preview pane: slice 3.
 *
 * For slice 1 the `matchedText` field carries whatever text content
 * we could extract from the matched message. Slice 3 splits that into
 * separate snippet + fullMessageContent fields.
 */

import { basename, dirname } from "node:path";
import type { RawScanHit, SessionHit } from "./types.js";

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
 * Reasons to return null in slice 1:
 *  - The line isn't valid JSON (rare in practice — JSONL by definition).
 *  - The record's `type` isn't a message type we recognise
 *    (`user`, `assistant`, `tool`, `system`). Records like
 *    `queue-operation`, `summary`, and `file-history-snapshot` aren't
 *    conversation content.
 *  - The record has no extractable text content.
 */
export function parseHit(raw: RawScanHit): SessionHit | null {
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

	const text = extractMessageText(record);
	if (!text) return null;

	const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";

	// Decode the project from the file's parent directory.
	const parentDir = dirname(raw.filePath);
	const parentDirName = basename(parentDir);
	const projectPath = decodeProjectDirName(parentDirName);
	const projectName = basename(projectPath) || projectPath;

	const sessionId = basename(raw.filePath, ".jsonl");

	return {
		projectPath,
		projectName,
		sessionId,
		filePath: raw.filePath,
		messageTimestamp: timestamp,
		role: type as SessionHit["role"],
		matchedText: text,
	};
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
