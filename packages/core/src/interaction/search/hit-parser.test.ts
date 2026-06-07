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
		const hit = parseHit(makeRawHit(FIXTURE_ALPHA, line, 1));

		expect(hit).not.toBeNull();
		expect(hit!.projectPath).toBe("/tmp/search/fixture/project/alpha");
		expect(hit!.projectName).toBe("alpha");
		expect(hit!.sessionId).toBe("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
		expect(hit!.filePath).toBe(FIXTURE_ALPHA);
		expect(hit!.role).toBe("user");
		expect(hit!.messageTimestamp).toBe("2026-05-01T10:00:00.000Z");
		expect(hit!.matchedText).toContain("score the industry");
	});

	it("parses an assistant-message hit into a SessionHit", async () => {
		const line = await fixtureLine(FIXTURE_ALPHA, 2);
		const hit = parseHit(makeRawHit(FIXTURE_ALPHA, line, 2));

		expect(hit).not.toBeNull();
		expect(hit!.role).toBe("assistant");
		expect(hit!.matchedText).toContain("seven-pillar framework");
	});

	it("extracts content from assistant messages with mixed text + tool_use blocks", async () => {
		const line = await fixtureLine(FIXTURE_BETA, 2);
		const hit = parseHit(makeRawHit(FIXTURE_BETA, line, 2));

		expect(hit).not.toBeNull();
		expect(hit!.role).toBe("assistant");
		// Should include both the text block and the tool_use input JSON
		expect(hit!.matchedText).toContain("Running the search");
		expect(hit!.matchedText).toContain("score"); // from tool_use input
	});

	it("returns null for unrecognised record types", () => {
		const line = JSON.stringify({
			type: "queue-operation",
			timestamp: "2026-05-01T00:00:00Z",
			sessionId: "abc",
		});
		const hit = parseHit(makeRawHit("/tmp/fake/-tmp-x/abc.jsonl", line, 1));
		expect(hit).toBeNull();
	});

	it("returns null when the matched line isn't valid JSON", () => {
		const hit = parseHit(makeRawHit("/tmp/fake/-tmp-x/abc.jsonl", "not json", 1));
		expect(hit).toBeNull();
	});

	it("returns null when message has no extractable text content", () => {
		const line = JSON.stringify({
			type: "user",
			timestamp: "2026-05-01T00:00:00Z",
			message: { role: "user", content: [] },
		});
		const hit = parseHit(makeRawHit("/tmp/fake/-tmp-x/abc.jsonl", line, 1));
		expect(hit).toBeNull();
	});
});
