import { describe, expect, it } from "vitest";
import type { SessionHit } from "@umwelten/core/interaction/search/index.js";
import { formatHitRow, formatHitRows } from "./search-format.js";

function makeHit(overrides: Partial<SessionHit> = {}): SessionHit {
	return {
		projectPath: "/Users/me/projects/umwelten",
		projectName: "umwelten",
		sessionId: "abc-123",
		filePath: "/Users/me/.claude/projects/x/abc-123.jsonl",
		messageTimestamp: "2026-06-10T13:31:00.000Z",
		role: "user",
		snippet: "…the score industry baseline was…",
		fullMessageContent: "long body",
		...overrides,
	};
}

describe("formatHitRow", () => {
	it("renders timestamp · project · role · snippet", () => {
		expect(formatHitRow(makeHit())).toBe(
			"2026-06-10T13:31:00.000Z · umwelten · user · …the score industry baseline was…",
		);
	});

	it("flattens newlines and tabs in the snippet so rows stay one line", () => {
		const row = formatHitRow(
			makeHit({ snippet: "line one\nline two\tand more" }),
		);
		expect(row).not.toMatch(/[\n\t]/);
		expect(row).toContain("line one line two and more");
	});

	it("renders every role verbatim", () => {
		for (const role of ["user", "assistant", "tool", "system"] as const) {
			expect(formatHitRow(makeHit({ role }))).toContain(` · ${role} · `);
		}
	});
});

describe("formatHitRows", () => {
	it("joins rows with newlines and ends with a trailing newline", () => {
		const out = formatHitRows([
			makeHit({ snippet: "first" }),
			makeHit({ snippet: "second" }),
		]);
		const lines = out.split("\n");
		expect(out.endsWith("\n")).toBe(true);
		expect(lines).toHaveLength(3); // 2 rows + empty string after final \n
		expect(lines[0]).toContain("first");
		expect(lines[1]).toContain("second");
	});

	it("returns an empty string for zero hits (nothing to pipe)", () => {
		expect(formatHitRows([])).toBe("");
	});
});
