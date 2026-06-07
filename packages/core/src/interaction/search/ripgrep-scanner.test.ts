/**
 * RipgrepScanner unit/integration tests.
 *
 * These tests invoke the real `rg` binary against fixture and tmpdir
 * JSONL files. They are skipped entirely if `rg` isn't on PATH so a
 * developer without ripgrep installed can still run `pnpm test:run`.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
	scanWithRipgrep,
	RipgrepNotFoundError,
} from "./index.js";

const HAS_RG = (() => {
	const result = spawnSync("rg", ["--version"], { stdio: "ignore" });
	return result.status === 0;
})();

// Skip every test in this file when rg is absent.
const describeRg = HAS_RG ? describe : describe.skip;

describeRg("scanWithRipgrep", () => {
	const FIXTURES = join(import.meta.dirname, "__fixtures__", "projects");

	it("finds matches in fixture .jsonl files", async () => {
		const hits = await scanWithRipgrep("score the industry", {
			searchRoots: [FIXTURES],
		});
		expect(hits.length).toBeGreaterThan(0);
		for (const h of hits) {
			expect(h.filePath).toMatch(/\.jsonl$/);
			expect(h.matchedLine.toLowerCase()).toContain("score the industry");
			expect(h.lineNumber).toBeGreaterThanOrEqual(1);
			expect(h.submatches.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("returns an empty array when no matches exist", async () => {
		const hits = await scanWithRipgrep(
			"thisstringdefinitelydoesnotappear" + Math.random(),
			{ searchRoots: [FIXTURES] },
		);
		expect(hits).toEqual([]);
	});

	it("returns an empty array for an empty query", async () => {
		const hits = await scanWithRipgrep("", { searchRoots: [FIXTURES] });
		expect(hits).toEqual([]);
	});

	it("is case-insensitive by default", async () => {
		const lower = await scanWithRipgrep("score the industry", {
			searchRoots: [FIXTURES],
		});
		const upper = await scanWithRipgrep("SCORE THE INDUSTRY", {
			searchRoots: [FIXTURES],
		});
		expect(lower.length).toBeGreaterThan(0);
		expect(upper.length).toBe(lower.length);
	});

	it("respects caseSensitive: true", async () => {
		// Match against a known-mixed-case fixture string. "Industry" only
		// appears as "industry" in the fixtures, so a case-sensitive search
		// for "Industry" should miss it.
		const sensitive = await scanWithRipgrep("Industry", {
			searchRoots: [FIXTURES],
			caseSensitive: true,
		});
		const insensitive = await scanWithRipgrep("Industry", {
			searchRoots: [FIXTURES],
			caseSensitive: false,
		});
		expect(insensitive.length).toBeGreaterThan(sensitive.length);
	});

	describe("with synthetic tmpdir corpus", () => {
		let dir: string;

		beforeAll(async () => {
			dir = await mkdtemp(join(tmpdir(), "umwelten-search-test-"));
		});

		it("only scans .jsonl files (other extensions ignored)", async () => {
			const proj = join(dir, "-tmp-proj-other");
			await mkdir(proj, { recursive: true });
			await writeFile(
				join(proj, "session.jsonl"),
				`{"type":"user","timestamp":"2026-05-01T00:00:00Z","message":{"role":"user","content":"unique-marker-token"}}\n`,
			);
			await writeFile(
				join(proj, "notes.txt"),
				"unique-marker-token in a non-jsonl file\n",
			);

			const hits = await scanWithRipgrep("unique-marker-token", {
				searchRoots: [proj],
			});
			expect(hits.length).toBe(1);
			expect(hits[0].filePath.endsWith(".jsonl")).toBe(true);
		});

		it("caps per-file matches via maxCountPerFile", async () => {
			const proj = join(dir, "-tmp-proj-maxcount");
			await mkdir(proj, { recursive: true });
			const lines: string[] = [];
			for (let i = 0; i < 20; i++) {
				lines.push(
					JSON.stringify({
						type: "user",
						timestamp: `2026-05-01T00:00:${String(i).padStart(2, "0")}Z`,
						message: { role: "user", content: `the cap-test-token line ${i}` },
					}),
				);
			}
			await writeFile(join(proj, "session.jsonl"), lines.join("\n") + "\n");

			const capped = await scanWithRipgrep("cap-test-token", {
				searchRoots: [proj],
				maxCountPerFile: 3,
			});
			expect(capped.length).toBe(3);

			const uncapped = await scanWithRipgrep("cap-test-token", {
				searchRoots: [proj],
				maxCountPerFile: 50,
			});
			expect(uncapped.length).toBe(20);
		});
	});
});

describe("RipgrepNotFoundError", () => {
	it("has a helpful install hint in its message", () => {
		const err = new RipgrepNotFoundError();
		expect(err.message).toContain("ripgrep");
		expect(err.message).toContain("brew install ripgrep");
		expect(err.message).toContain("apt install ripgrep");
		expect(err.name).toBe("RipgrepNotFoundError");
	});
});
