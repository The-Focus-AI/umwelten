/**
 * SessionSearcher integration test.
 *
 * End-to-end: feed the searcher a fixture project root and assert
 * the returned SessionHits include the expected matches with the
 * expected project/session/role/text fields populated.
 *
 * Skipped if `rg` isn't on PATH (the scanner needs it).
 */

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { searchSessions } from "./index.js";

const HAS_RG = (() => {
	const result = spawnSync("rg", ["--version"], { stdio: "ignore" });
	return result.status === 0;
})();

const describeRg = HAS_RG ? describe : describe.skip;

describeRg("searchSessions (integration)", () => {
	const FIXTURES = join(import.meta.dirname, "__fixtures__", "projects");

	it("returns hits from every fixture project that contains the query", async () => {
		const hits = await searchSessions("score", {
			searchRoots: [FIXTURES],
		});
		expect(hits.length).toBeGreaterThanOrEqual(2);

		// Both fixture projects should appear
		const projectNames = new Set(hits.map((h) => h.projectName));
		expect(projectNames.has("alpha")).toBe(true);
		expect(projectNames.has("beta")).toBe(true);
	});

	it("returns hits with populated SessionHit fields", async () => {
		const hits = await searchSessions("seven-pillar", {
			searchRoots: [FIXTURES],
		});
		expect(hits.length).toBeGreaterThan(0);
		const h = hits[0];
		expect(h.projectPath).toMatch(/alpha$/);
		expect(h.projectName).toBe("alpha");
		expect(h.sessionId).toBe("aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa");
		expect(h.filePath.endsWith(".jsonl")).toBe(true);
		expect(h.messageTimestamp).toBeTruthy();
		expect(h.role).toBe("assistant");
		expect(h.matchedText).toContain("seven-pillar");
	});

	it("returns an empty array for an empty query", async () => {
		const hits = await searchSessions("", { searchRoots: [FIXTURES] });
		expect(hits).toEqual([]);
	});

	it("returns an empty array when nothing matches", async () => {
		const unique = "zzz-no-such-token-" + Math.random();
		const hits = await searchSessions(unique, { searchRoots: [FIXTURES] });
		expect(hits).toEqual([]);
	});

	it("trims whitespace-only queries to empty", async () => {
		const hits = await searchSessions("   ", { searchRoots: [FIXTURES] });
		expect(hits).toEqual([]);
	});

	// Slice 2 (#84): noise filtering parity with the Claude Code adapter.
	describe("noise filtering", () => {
		const NOISY = join(
			import.meta.dirname,
			"__fixtures__",
			"projects",
			"-tmp-search-fixture-project-noisy",
		);

		it("filters out hits from sidechain transcripts, micro-files, and queue-op-only files", async () => {
			const hits = await searchSessions("noise-test-token", {
				searchRoots: [NOISY],
			});

			// Only the regular session should survive. All hits must come
			// from regular-ddd.jsonl, not sidechain-aaa, micro-bbb, or
			// queueop-ccc.
			expect(hits.length).toBeGreaterThan(0);
			for (const h of hits) {
				expect(h.sessionId).toBe("regular-ddd");
				expect(h.filePath).toMatch(/regular-ddd\.jsonl$/);
			}
		});

		it("sidechain files do not contribute hits even though rg matches their content", async () => {
			const hits = await searchSessions("noise-test-token", {
				searchRoots: [NOISY],
			});
			const sidechainHits = hits.filter((h) =>
				h.filePath.endsWith("sidechain-aaa.jsonl"),
			);
			expect(sidechainHits.length).toBe(0);
		});

		it("micro-files do not contribute hits even though rg matches their content", async () => {
			const hits = await searchSessions("noise-test-token", {
				searchRoots: [NOISY],
			});
			const microHits = hits.filter((h) =>
				h.filePath.endsWith("micro-bbb.jsonl"),
			);
			expect(microHits.length).toBe(0);
		});
	});
});
