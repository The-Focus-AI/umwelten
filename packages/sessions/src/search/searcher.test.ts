/**
 * SessionSearcher integration test.
 *
 * End-to-end: feed the searcher a fixture project root and assert
 * the returned SessionHits include the expected matches with the
 * expected project/session/role/text fields populated.
 *
 * Skipped if `rg` isn't on PATH (the scanner needs it).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { searchSessions, SNIPPET_WIDTH } from "./index.js";

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
		expect(h.fullMessageContent).toContain("seven-pillar");
		expect(h.snippet).toContain("seven-pillar");
	});

	// #109 — projectPath must survive dashes in real directory names.
	// The fixture directory is `-tmp-search-fixture-The-Focus-AI-dashed-project`
	// and every record carries the authoritative
	// `cwd: "/tmp/search-fixture/The-Focus-AI/dashed-project"`. The lossy
	// directory-name decode would mangle this to
	// `/tmp/search/fixture/The/Focus/AI/dashed/project`.
	describe("dashed project paths (#109)", () => {
		it("returns projectPath matching the JSONL cwd, not the lossy decode", async () => {
			const hits = await searchSessions("dashed-path-token", {
				searchRoots: [FIXTURES],
			});
			expect(hits.length).toBeGreaterThan(0);
			for (const h of hits) {
				expect(h.projectPath).toBe(
					"/tmp/search-fixture/The-Focus-AI/dashed-project",
				);
				expect(h.projectName).toBe("dashed-project");
				expect(h.sessionId).toBe("cccccccc-cccc-4ccc-cccc-cccccccccccc");
			}
		});
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

	// Slice 3 (#85) — sort + snippet + cap behaviour against a tmpdir
	// corpus that has hits interleaved across sessions.
	describe("slice 3: sort, snippet, caps", () => {
		let dir: string;

		beforeAll(async () => {
			dir = await mkdtemp(join(tmpdir(), "umwelten-searcher-slice3-"));
			// Two projects, each with one session, hits interleaved in time.
			// Each session has multiple hits to exercise the sort.
			const projA = join(dir, "-tmp-projA");
			const projB = join(dir, "-tmp-projB");
			await mkdir(projA, { recursive: true });
			await mkdir(projB, { recursive: true });

			const linesA = [
				makeMessage("user", "2026-05-01T10:00:00.000Z", "marker-token appears at A early"),
				makeMessage("assistant", "2026-05-01T12:00:00.000Z", "marker-token appears at A mid-day"),
				makeMessage("user", "2026-05-03T08:00:00.000Z", "marker-token appears at A latest"),
				// extra non-matching lines so the file isn't a micro-file
				makeMessage("user", "2026-05-03T08:00:01.000Z", "noise filler line 1"),
				makeMessage("user", "2026-05-03T08:00:02.000Z", "noise filler line 2"),
			];
			const linesB = [
				makeMessage("user", "2026-05-02T09:00:00.000Z", "marker-token appears at B mid"),
				makeMessage("assistant", "2026-05-04T11:00:00.000Z", "marker-token appears at B newest"),
				makeMessage("user", "2026-05-04T11:00:01.000Z", "noise filler line 1"),
				makeMessage("user", "2026-05-04T11:00:02.000Z", "noise filler line 2"),
				makeMessage("user", "2026-05-04T11:00:03.000Z", "noise filler line 3"),
			];
			await writeFile(join(projA, "ses-a.jsonl"), linesA.join("\n") + "\n");
			await writeFile(join(projB, "ses-b.jsonl"), linesB.join("\n") + "\n");

			// A session with a long matching message for snippet truncation.
			const projC = join(dir, "-tmp-projC");
			await mkdir(projC, { recursive: true });
			const longText =
				"Once upon a time there was a very long opening clause that " +
				"keeps going and going and going and going until eventually " +
				"someone wrote about marker-token deep inside the message, " +
				"after which the message keeps going with yet more clauses " +
				"that pile up well past any reasonable terminal column width.";
			const linesC = [
				makeMessage("user", "2026-04-01T00:00:00.000Z", longText),
				makeMessage("user", "2026-04-01T00:00:01.000Z", "noise filler line 1"),
				makeMessage("user", "2026-04-01T00:00:02.000Z", "noise filler line 2"),
				makeMessage("user", "2026-04-01T00:00:03.000Z", "noise filler line 3"),
				makeMessage("user", "2026-04-01T00:00:04.000Z", "noise filler line 4"),
			];
			await writeFile(join(projC, "ses-c.jsonl"), linesC.join("\n") + "\n");

			// A session with > 5 matching messages to verify the default
			// per-file cap.
			const projD = join(dir, "-tmp-projD");
			await mkdir(projD, { recursive: true });
			const linesD: string[] = [];
			for (let i = 0; i < 12; i++) {
				linesD.push(
					makeMessage(
						"user",
						`2026-05-05T00:00:${String(i).padStart(2, "0")}.000Z`,
						`cap-marker line ${i}`,
					),
				);
			}
			await writeFile(join(projD, "ses-d.jsonl"), linesD.join("\n") + "\n");
		});

		afterAll(async () => {
			if (dir) await rm(dir, { recursive: true, force: true });
		});

		it("sorts hits by messageTimestamp descending, interleaving sessions", async () => {
			// Scope to projA + projB only — projC also contains
			// 'marker-token' but is reserved for the snippet test.
			const hits = await searchSessions("marker-token", {
				searchRoots: [join(dir, "-tmp-projA"), join(dir, "-tmp-projB")],
			});
			expect(hits.length).toBe(5);

			// Verify strictly non-increasing timestamps.
			for (let i = 1; i < hits.length; i++) {
				expect(hits[i - 1].messageTimestamp >= hits[i].messageTimestamp).toBe(
					true,
				);
			}
			// Newest must be project B (2026-05-04). Oldest must be A early.
			expect(hits[0].projectName).toBe("projB");
			expect(hits[0].messageTimestamp).toBe("2026-05-04T11:00:00.000Z");
			expect(hits[hits.length - 1].projectName).toBe("projA");

			// Sessions are interleaved (not grouped): the second-newest hit
			// is from projA latest, then projB mid, then projA mid-day,
			// then projA early.
			expect(hits.map((h) => h.projectName)).toEqual([
				"projB", // 2026-05-04
				"projA", // 2026-05-03
				"projB", // 2026-05-02
				"projA", // 2026-05-01 12:00
				"projA", // 2026-05-01 10:00
			]);
		});

		it("builds a centered, ellipsised snippet for long matched messages", async () => {
			const hits = await searchSessions("marker-token", {
				searchRoots: [join(dir, "-tmp-projC")],
			});
			expect(hits.length).toBe(1);
			const h = hits[0];
			expect(h.snippet).toContain("marker-token");
			// Long message must produce a truncated snippet with both markers.
			expect(h.snippet.startsWith("…")).toBe(true);
			expect(h.snippet.endsWith("…")).toBe(true);
			expect(h.snippet.length).toBeLessThanOrEqual(SNIPPET_WIDTH + 2);
			// Full message content remains the full text.
			expect(h.fullMessageContent.length).toBeGreaterThan(SNIPPET_WIDTH);
			expect(h.fullMessageContent).toContain("marker-token");
		});

		it("applies the default per-file cap of 5", async () => {
			// projD has 12 matching messages but the default --max-count=5
			// limits ripgrep to 5 lines per file.
			const hits = await searchSessions("cap-marker", {
				searchRoots: [join(dir, "-tmp-projD")],
			});
			expect(hits.length).toBe(5);
			for (const h of hits) {
				expect(h.sessionId).toBe("ses-d");
			}
		});

		it("respects an explicit maxCountPerFile override above the default", async () => {
			const hits = await searchSessions("cap-marker", {
				searchRoots: [join(dir, "-tmp-projD")],
				maxCountPerFile: 12,
			});
			expect(hits.length).toBe(12);
		});
	});

	// Slice 8 (#90) — search must NOT collapse batch-run sessions the
	// way the Claude Code adapter's discovery layer does. Search is
	// "find every place I said X." Collapsing hides what the user is
	// asking for.
	//
	// The fixture has 4 sessions whose first user message shares the
	// long prefix `Score the industry for trinity-hunt-pilot-batchrun`
	// — exactly the shape of the real-world trinity-hunt-pilot corpus
	// that motivated the adapter's `collapseBatchRuns` behavior. The
	// adapter would surface ONE row for these on the dashboard;
	// `SessionSearcher.search()` MUST surface every individual hit.
	describe("batch-run contract", () => {
		const BATCHRUN = join(
			import.meta.dirname,
			"__fixtures__",
			"projects",
			"-tmp-search-fixture-project-batchrun",
		);
		const SHARED_PREFIX = "Score the industry for trinity-hunt-pilot-batchrun";

		it("returns one hit per matching session, not a collapsed representative", async () => {
			const hits = await searchSessions(SHARED_PREFIX, {
				searchRoots: [BATCHRUN],
			});

			// 4 sessions, one matching message each → 4 hits. If search
			// ever started applying the adapter's batch-collapse rule,
			// this would drop to 1.
			expect(hits.length).toBe(4);

			// All 4 sessions must be represented — every sessionId
			// distinct.
			const sessionIds = new Set(hits.map((h) => h.sessionId));
			expect(sessionIds.size).toBe(4);
			expect(sessionIds.has("run-001")).toBe(true);
			expect(sessionIds.has("run-002")).toBe(true);
			expect(sessionIds.has("run-003")).toBe(true);
			expect(sessionIds.has("run-004")).toBe(true);
		});

		it("returns hits with distinct timestamps for the same shared prefix", async () => {
			const hits = await searchSessions(SHARED_PREFIX, {
				searchRoots: [BATCHRUN],
			});
			const timestamps = new Set(hits.map((h) => h.messageTimestamp));
			// Each fixture session opens at a distinct hour, so all 4
			// timestamps should be distinct. A collapsing implementation
			// would lose 3 of them.
			expect(timestamps.size).toBe(4);
		});
	});
});

function makeMessage(
	role: "user" | "assistant",
	timestamp: string,
	content: string,
): string {
	return JSON.stringify({
		type: role,
		timestamp,
		message: { role, content },
		isSidechain: false,
		uuid: `${role}-${timestamp}`,
	});
}
