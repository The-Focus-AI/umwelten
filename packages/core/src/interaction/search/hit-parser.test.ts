/**
 * SessionHitParser unit tests.
 *
 * Drives parseHit() with synthetic RawScanHits that point at fixture
 * .jsonl files. The fixtures encode real-shaped Claude Code messages.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
	parseHit,
	decodeProjectDirName,
	extractMessageText,
	buildSnippet,
	SNIPPET_WIDTH,
	type RawScanHit,
} from "./index.js";

const FIXTURE_ALPHA = join(
	import.meta.dirname,
	"__fixtures__",
	"projects",
	"-tmp-search-fixture-project-alpha",
	"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.jsonl",
);

const FIXTURE_BETA = join(
	import.meta.dirname,
	"__fixtures__",
	"projects",
	"-tmp-search-fixture-project-beta",
	"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb.jsonl",
);

async function fixtureLine(path: string, lineNumber: number): Promise<string> {
	const lines = (await readFile(path, "utf-8")).split("\n");
	// lineNumber is 1-indexed (matches ripgrep)
	return lines[lineNumber - 1];
}

function makeRawHit(filePath: string, matchedLine: string, lineNumber: number): RawScanHit {
	return {
		filePath,
		lineNumber,
		matchedLine,
		submatches: [],
	};
}

describe("decodeProjectDirName", () => {
	it("decodes the Claude Code project-path encoding", () => {
		expect(decodeProjectDirName("-Users-foo-bar")).toBe("/Users/foo/bar");
		expect(decodeProjectDirName("-tmp-search-fixture-project-alpha")).toBe(
			"/tmp/search/fixture/project/alpha",
		);
	});
});

describe("extractMessageText", () => {
	it("returns string content directly for user messages", () => {
		const text = extractMessageText({
			type: "user",
			message: { role: "user", content: "hello" },
		});
		expect(text).toBe("hello");
	});

	it("concatenates text blocks from assistant messages", () => {
		const text = extractMessageText({
			type: "assistant",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "first sentence." },
					{ type: "text", text: "second sentence." },
				],
			},
		});
		expect(text).toBe("first sentence.\nsecond sentence.");
	});

	it("falls back to tool_use input when no text blocks are present", () => {
		const text = extractMessageText({
			type: "assistant",
			message: {
				role: "assistant",
				content: [
					{ type: "tool_use", id: "x", name: "rg", input: { query: "score" } },
				],
			},
		});
		expect(text).toContain("score");
	});

	it("returns the empty string when content is missing", () => {
		expect(extractMessageText({ type: "user" })).toBe("");
		expect(extractMessageText({ type: "user", message: {} })).toBe("");
	});
});

describe("parseHit", () => {
	it("parses a user-message hit into a SessionHit", async () => {
		const line = await fixtureLine(FIXTURE_ALPHA, 1);
		const hit = parseHit(makeRawHit(FIXTURE_ALPHA, line, 1), "score");

		expect(hit).not.toBeNull();
		expect(hit!.projectPath).toBe("/tmp/search/fixture/project/alpha");
		expect(hit!.projectName).toBe("alpha");
		expect(hit!.sessionId).toBe("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
		expect(hit!.filePath).toBe(FIXTURE_ALPHA);
		expect(hit!.role).toBe("user");
		expect(hit!.messageTimestamp).toBe("2026-05-01T10:00:00.000Z");
		expect(hit!.fullMessageContent).toContain("score the industry");
		expect(hit!.snippet).toContain("score the industry");
	});

	it("parses an assistant-message hit into a SessionHit", async () => {
		const line = await fixtureLine(FIXTURE_ALPHA, 2);
		const hit = parseHit(makeRawHit(FIXTURE_ALPHA, line, 2), "seven-pillar");

		expect(hit).not.toBeNull();
		expect(hit!.role).toBe("assistant");
		expect(hit!.fullMessageContent).toContain("seven-pillar framework");
		expect(hit!.snippet).toContain("seven-pillar");
	});

	it("extracts content from assistant messages with mixed text + tool_use blocks", async () => {
		const line = await fixtureLine(FIXTURE_BETA, 2);
		const hit = parseHit(makeRawHit(FIXTURE_BETA, line, 2), "score");

		expect(hit).not.toBeNull();
		expect(hit!.role).toBe("assistant");
		// Should include both the text block and the tool_use input JSON
		expect(hit!.fullMessageContent).toContain("Running the search");
		expect(hit!.fullMessageContent).toContain("score"); // from tool_use input
	});

	it("returns null for unrecognised record types", () => {
		const line = JSON.stringify({
			type: "queue-operation",
			timestamp: "2026-05-01T00:00:00Z",
			sessionId: "abc",
		});
		const hit = parseHit(makeRawHit("/tmp/fake/-tmp-x/abc.jsonl", line, 1), "abc");
		expect(hit).toBeNull();
	});

	it("returns null when the matched line isn't valid JSON", () => {
		const hit = parseHit(
			makeRawHit("/tmp/fake/-tmp-x/abc.jsonl", "not json", 1),
			"json",
		);
		expect(hit).toBeNull();
	});

	it("returns null when message has no extractable text content", () => {
		const line = JSON.stringify({
			type: "user",
			timestamp: "2026-05-01T00:00:00Z",
			message: { role: "user", content: [] },
		});
		const hit = parseHit(
			makeRawHit("/tmp/fake/-tmp-x/abc.jsonl", line, 1),
			"x",
		);
		expect(hit).toBeNull();
	});

	// #109 — the directory-name encoding is lossy for paths containing
	// dashes (`The-Focus-AI` decodes to `The/Focus/AI`). The record's
	// `cwd` field is the authoritative project path when present.
	describe("cwd-based project path (#109)", () => {
		const DASHED_DIR_FILE =
			"/tmp/fake/-Users-wschenk-The-Focus-AI-umwelten/abc.jsonl";

		it("prefers the record's cwd field over the decoded directory name", () => {
			const line = JSON.stringify({
				type: "user",
				timestamp: "2026-05-01T00:00:00Z",
				cwd: "/Users/wschenk/The-Focus-AI/umwelten",
				message: { role: "user", content: "hello dashed world" },
			});
			const hit = parseHit(makeRawHit(DASHED_DIR_FILE, line, 1), "dashed");
			expect(hit).not.toBeNull();
			expect(hit!.projectPath).toBe("/Users/wschenk/The-Focus-AI/umwelten");
			expect(hit!.projectName).toBe("umwelten");
		});

		it("falls back to the decoded directory name when cwd is absent", () => {
			const line = JSON.stringify({
				type: "user",
				timestamp: "2026-05-01T00:00:00Z",
				message: { role: "user", content: "hello dashed world" },
			});
			const hit = parseHit(makeRawHit(DASHED_DIR_FILE, line, 1), "dashed");
			expect(hit).not.toBeNull();
			// Lossy, but the documented best-effort fallback.
			expect(hit!.projectPath).toBe("/Users/wschenk/The/Focus/AI/umwelten");
			expect(hit!.projectName).toBe("umwelten");
		});

		it("falls back when cwd is empty or not a string", () => {
			for (const cwd of ["", 42, null, { not: "a string" }]) {
				const line = JSON.stringify({
					type: "user",
					timestamp: "2026-05-01T00:00:00Z",
					cwd,
					message: { role: "user", content: "hello dashed world" },
				});
				const hit = parseHit(makeRawHit(DASHED_DIR_FILE, line, 1), "dashed");
				expect(hit).not.toBeNull();
				expect(hit!.projectPath).toBe("/Users/wschenk/The/Focus/AI/umwelten");
			}
		});
	});
});

describe("buildSnippet", () => {
	const SHORT = "Score the industry.";
	const LONG =
		"Once upon a time in a faraway land there was a programmer who wrote " +
		"twelve thousand lines of Lisp before lunch and then settled in to " +
		"think very carefully about how to score the industry of widget " +
		"manufacturing, paying close attention to the seven-pillar framework " +
		"that had been handed down from previous engagements.";

	it("returns the whole message unchanged when it fits in the window", () => {
		const snip = buildSnippet(SHORT, "score");
		expect(snip).toBe(SHORT);
		expect(snip).not.toContain("…");
	});

	it("collapses internal whitespace to single spaces", () => {
		const snip = buildSnippet("score\n  the\tindustry\n", "score");
		expect(snip).toBe("score the industry");
	});

	it("centers the window on the match and adds ellipsis markers on both sides", () => {
		const snip = buildSnippet(LONG, "score");
		// Long message → must be truncated, leading + trailing ellipsis.
		expect(snip.startsWith("…")).toBe(true);
		expect(snip.endsWith("…")).toBe(true);
		expect(snip).toContain("score");
		// Width: SNIPPET_WIDTH chars + up to 2 ellipsis chars.
		expect(snip.length).toBeLessThanOrEqual(SNIPPET_WIDTH + 2);
	});

	it("omits the leading ellipsis when the match is near the start", () => {
		const text =
			"score the industry " +
			"and then go on with quite a bit more text to push the message past " +
			"the snippet width threshold so we trigger truncation behaviour.";
		const snip = buildSnippet(text, "score");
		expect(snip.startsWith("…")).toBe(false);
		expect(snip.endsWith("…")).toBe(true);
		expect(snip).toContain("score the industry");
	});

	it("omits the trailing ellipsis when the match is near the end", () => {
		const prefix = "Lots of context goes here before the final word: ";
		const padding =
			"and then we keep going with more context that pads out the front of " +
			"the message so the match is at the tail. ";
		const text = prefix + padding + "the score";
		const snip = buildSnippet(text, "score");
		expect(snip.endsWith("…")).toBe(false);
		expect(snip.startsWith("…")).toBe(true);
		expect(snip).toContain("the score");
	});

	it("falls back to the opening of the message when the query is absent", () => {
		const snip = buildSnippet(LONG, "this-query-is-not-in-the-text");
		expect(snip.startsWith("…")).toBe(false);
		expect(snip.endsWith("…")).toBe(true);
		expect(snip.slice(0, 10)).toBe(LONG.slice(0, 10));
	});

	it("is case-insensitive when locating the match", () => {
		const text =
			"This is a message about Industry Scoring that needs to be padded out " +
			"so it goes past the snippet width threshold and triggers truncation.";
		const snip = buildSnippet(text, "INDUSTRY");
		// Lowercase 'industry' appears in the source. The snippet should
		// be centered on it, not at the start of the message.
		expect(snip).toContain("Industry");
		expect(snip.length).toBeLessThanOrEqual(SNIPPET_WIDTH + 2);
	});
});
