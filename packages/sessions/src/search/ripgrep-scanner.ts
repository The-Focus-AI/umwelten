/**
 * RipgrepScanner — spawn the system `rg` binary, parse its `--json`
 * output stream, and return an array of normalized RawScanHits.
 *
 * Why shell out (as opposed to bundle `@vscode/ripgrep` or write a
 * pure-JS scanner): see ADR docs/adr/0002-session-search-shells-out-to-ripgrep.md.
 *
 * The scanner is a deep module — callers pass a query and options and
 * get hits back. They never see child_process, the rg flags, or the
 * JSON-stream parsing.
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { claudeProjectsDir } from "../persistence/claude-dir.js";

import {
	type RawScanHit,
	RipgrepNotFoundError,
	type ScanOptions,
} from "./types.js";

/**
 * Default scan root: every Claude Code project the user has ever opened.
 * Per slice 1 / ADR 0002, Session Search v1 covers Claude Code only.
 */
export function defaultSearchRoots(): string[] {
	return [claudeProjectsDir()];
}

/**
 * Scan one or more directories for matches of `query` in `.jsonl` files.
 *
 * Throws RipgrepNotFoundError when `rg` is not on PATH. All other
 * spawn errors are surfaced as rejections of the returned Promise.
 *
 * The scanner is "fire and accumulate" — it waits for rg to exit
 * before resolving. We do NOT stream hits to callers; sub-second
 * total scans on representative corpora (1.1 GB / 26k files) make
 * streaming unnecessary complexity. Per PRD #82 slice 4 ("wait for
 * scan to finish before rendering").
 */
export async function scanWithRipgrep(
	query: string,
	options: ScanOptions = {},
): Promise<RawScanHit[]> {
	const caseSensitive = options.caseSensitive ?? false;
	const maxCountPerFile = options.maxCountPerFile ?? 5;
	const maxFilesizeMB = options.maxFilesizeMB ?? 50;
	const searchRoots = options.searchRoots ?? defaultSearchRoots();

	if (!query) return []; // empty query is a no-op

	const args = [
		"--json", // emit newline-delimited JSON records
		"--type-add",
		"jsonl:*.jsonl",
		"--type",
		"jsonl",
		`--max-count=${maxCountPerFile}`,
		`--max-filesize=${maxFilesizeMB}M`,
		caseSensitive ? "--case-sensitive" : "--ignore-case",
		"--",
		query,
		...searchRoots,
	];

	return new Promise<RawScanHit[]>((resolve, reject) => {
		let child;
		try {
			child = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
		} catch (err) {
			// Synchronous spawn errors are rare on modern Node, but cover them.
			if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
				reject(new RipgrepNotFoundError());
			} else {
				reject(err);
			}
			return;
		}

		const hits: RawScanHit[] = [];
		let stderrBuf = "";

		// Errors on the child (ENOENT etc.) fire asynchronously.
		child.on("error", (err) => {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				reject(new RipgrepNotFoundError());
			} else {
				reject(err);
			}
		});

		// readline gives us proper line-delimited JSON consumption with
		// backpressure built in.
		const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });
		rl.on("line", (line) => {
			if (!line) return;
			let record: any;
			try {
				record = JSON.parse(line);
			} catch {
				// rg may print non-JSON warnings to stdout in rare cases;
				// ignore lines we can't parse.
				return;
			}
			if (record?.type !== "match") return;
			const hit = recordToHit(record);
			if (hit) hits.push(hit);
		});

		child.stderr!.on("data", (chunk) => {
			stderrBuf += chunk.toString();
		});

		child.on("close", (code) => {
			// rg exit code semantics:
			//   0 = matches found
			//   1 = no matches (NOT an error)
			//   2 = real error
			if (code === 0 || code === 1) {
				resolve(hits);
			} else {
				const msg = stderrBuf.trim() || `rg exited with code ${code}`;
				reject(new Error(msg));
			}
		});
	});
}

/**
 * Translate one rg `match` JSON record into a RawScanHit.
 *
 * ripgrep wraps every bytes-bearing field (path, matched line, match
 * text) in an "ArbitraryData" object that's one of two shapes:
 *
 *   { "text": "..." }                  // valid UTF-8
 *   { "bytes": "...base64..." }        // not valid UTF-8
 *
 * Our corpus is exclusively JSONL (always UTF-8 by the JSON spec), so
 * we'll almost always see `text`. The `bytes` case can still appear
 * for an oddly-named directory path on the user's filesystem. We
 * decode both rather than dropping the hit.
 */
function decodeArbitraryData(d: any): string | null {
	if (!d || typeof d !== "object") return null;
	if (typeof d.text === "string") return d.text;
	if (typeof d.bytes === "string") {
		try {
			return Buffer.from(d.bytes, "base64").toString("utf8");
		} catch {
			return null;
		}
	}
	return null;
}

function recordToHit(record: any): RawScanHit | null {
	const data = record?.data;
	if (!data) return null;

	const filePath = decodeArbitraryData(data.path);
	const matchedLine = decodeArbitraryData(data.lines);
	const lineNumber = data.line_number;

	if (filePath === null) return null;
	if (matchedLine === null) return null;
	if (typeof lineNumber !== "number") return null;

	const submatchesRaw = Array.isArray(data.submatches) ? data.submatches : [];
	const submatches = submatchesRaw
		.map((sm: any) => {
			const text = decodeArbitraryData(sm?.match);
			if (text === null) return null;
			if (typeof sm.start !== "number" || typeof sm.end !== "number") {
				return null;
			}
			return { start: sm.start, end: sm.end, text };
		})
		.filter(
			(x: { start: number; end: number; text: string } | null): x is { start: number; end: number; text: string } => x !== null,
		);

	return { filePath, lineNumber, matchedLine, submatches };
}
