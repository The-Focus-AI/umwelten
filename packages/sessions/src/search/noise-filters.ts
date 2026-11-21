/**
 * Noise filters for Claude Code session files.
 *
 * Claude Code's `~/.claude/projects/<encoded>/<uuid>.jsonl` storage
 * contains two kinds of files that aren't useful conversation hits:
 *
 *   1. Sidechain transcripts — sub-agent (Task tool) invocations. The
 *      first message has `isSidechain: true` and/or an `agentId`
 *      string. They are agent-internal turn-arounds, not user-facing
 *      conversations. One pathological project on a representative
 *      machine had 21,000+ of these warmup pings.
 *
 *   2. Micro-files — files with fewer than ~5 lines. These are
 *      typically warmup pings, aborted starts, or one-shot queue
 *      operations. Same project had 23,000 of these.
 *
 * This module exposes the constants and the per-file "peek" helper so
 * the search layer and (in a future PR) the Claude Code adapter can
 * apply the same rules from one source of truth.
 *
 * Rationale for the threshold: 5 lines is the smallest count that
 * reliably distinguishes "real conversation" (1 user turn + 1
 * assistant message has ≥2 lines plus we need some metadata) from
 * "ping/probe." Empirically validated against the trinity-hunt-pilot
 * corpus where the cutoff cleanly separates real sessions from
 * sub-agent noise.
 */

import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline";

/**
 * Minimum line count for a Claude Code JSONL file to be considered a
 * real conversation rather than a micro-file. Public for tests and
 * for callers who want to use the same threshold.
 */
export const CLAUDE_CODE_MIN_SESSION_LINES = 5;

/**
 * Per-file metadata derived from peeking at the first line and
 * counting lines up to the noise threshold.
 *
 *   - `lines`: number of lines in the file, capped at `threshold`
 *     for performance (we stop reading once we know the file is
 *     "big enough"). To know the EXACT count, pass a high threshold.
 *   - `firstIsSidechain`: the first line's `isSidechain` field, when
 *     it parses as JSON and the field is exactly `true`.
 *   - `firstHasAgentId`: the first line has a non-empty string
 *     `agentId` field. Sub-agent transcripts always have this.
 */
export interface PeekedFile {
	lines: number;
	firstIsSidechain: boolean;
	firstHasAgentId: boolean;
}

/**
 * Stream-read a JSONL file just enough to compute `PeekedFile` data.
 *
 * Reads at most `threshold` lines, then stops the stream. Parses ONLY
 * the first line as JSON — later lines are counted but not parsed.
 *
 * Resolves with `{ lines: 0, firstIsSidechain: false, firstHasAgentId: false }`
 * for files that don't exist, aren't readable, or have stream errors.
 * Callers should treat that as "skip this file" — it's the same
 * effective filter as "the file isn't a real conversation."
 *
 * Why first-line peek vs scanning every line: the adapter's existing
 * parser (when one existed) used the LAST message's `isSidechain`
 * value, which was wrong for files whose first message marked them
 * as sidechain but whose later messages didn't repeat it. Read the
 * first line; that's the file-level marker.
 */
export async function peekFile(
	filePath: string,
	threshold: number = CLAUDE_CODE_MIN_SESSION_LINES,
): Promise<PeekedFile> {
	// Pre-check existence + readability. Without this `createReadStream`
	// can surface ENOENT in a way that escapes our error handler in
	// some Node versions, leaving an "unhandled exception" warning in
	// the test runner. Treating "can't read" as "noise file" is
	// exactly what callers want anyway.
	try {
		await access(filePath);
	} catch {
		return {
			lines: 0,
			firstIsSidechain: false,
			firstHasAgentId: false,
		};
	}

	return new Promise((resolve) => {
		let lines = 0;
		let firstIsSidechain = false;
		let firstHasAgentId = false;
		let firstLineParsed = false;

		const stream = createReadStream(filePath, { encoding: "utf-8" });

		let resolved = false;
		const safeResolve = () => {
			if (resolved) return;
			resolved = true;
			resolve({ lines, firstIsSidechain, firstHasAgentId });
		};
		stream.on("error", () => safeResolve());

		const rl = createInterface({ input: stream, crlfDelay: Infinity });
		rl.on("error", () => safeResolve());

		const finish = () => {
			try {
				rl.close();
			} catch {
				/* ignore */
			}
			try {
				stream.destroy();
			} catch {
				/* ignore */
			}
			safeResolve();
		};

		rl.on("line", (line) => {
			lines++;
			if (!firstLineParsed) {
				firstLineParsed = true;
				try {
					const m = JSON.parse(line);
					firstIsSidechain = m?.isSidechain === true;
					firstHasAgentId =
						typeof m?.agentId === "string" && m.agentId.length > 0;
				} catch {
					/* non-JSON first line — treat as not-sidechain, not-agent */
				}
			}
			if (lines >= threshold) finish();
		});
		rl.on("close", () => safeResolve());
	});
}

/**
 * Apply the noise rules to a `PeekedFile`. Returns true when the file
 * is noise (should be filtered out of search results).
 *
 * Rules in order of cost (cheapest first):
 *   1. Micro-file: lines < CLAUDE_CODE_MIN_SESSION_LINES
 *   2. Sub-agent: firstIsSidechain || firstHasAgentId
 */
export function isNoiseFile(peeked: PeekedFile): boolean {
	if (peeked.lines < CLAUDE_CODE_MIN_SESSION_LINES) return true;
	if (peeked.firstIsSidechain) return true;
	if (peeked.firstHasAgentId) return true;
	return false;
}
