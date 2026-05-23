/**
 * Tests verifying the playbooks → skill_candidates rename is complete and consistent.
 *
 * Acceptance criteria from issue #58:
 * - [x] No "playbook" or "PLAYBOOK" string remains in packages/ except in CONTEXT.md flagged ambiguity
 * - [x] Digester prompt asks for SKILL_CANDIDATES
 * - [x] ClassifiedLearnings interface uses skill_candidates field
 * - [x] LearningKind type includes "skill_candidates" (not "playbooks")
 * - [x] Storage filename is skill_candidates.jsonl
 * - [x] CLI help references skill_candidates
 * - [x] Phase summaries no longer written as pseudo-playbooks
 *
 * Strategy: test public API contracts (types, constants) directly, and verify
 * source files by content inspection for non-exported items.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ─── Public API imports ─────────────────────────────────────────────────────

import { LEARNING_KINDS, LEARNING_FILENAMES } from "./types.js";
import type { LearningKind } from "./types.js";

const __dirname = new URL(".", import.meta.url).pathname;
const packagesRoot = resolve(__dirname, "../../../..");

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Search all source files in packages/ for a pattern, returning violations. */
async function findInPackagesSources(
	pattern: RegExp,
	excludePaths: RegExp[] = [],
): Promise<string[]> {
	// We walk packages/ directory manually to avoid glob dependency issues
	const { readdir } = await import("node:fs/promises");
	const { join, extname } = await import("node:path");

	const violations: string[] = [];
	const sourceExts = new Set([".ts", ".tsx", ".md", ".json", ".js"]);

	async function walk(dir: string): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			const relPath = fullPath.replace(packagesRoot + "/", "");

			if (
				entry.name === "node_modules" ||
				entry.name === "dist" ||
				entry.name === ".git" ||
				entry.name === ".pi-lens"
			)
				continue;

			if (excludePaths.some((re) => re.test(relPath))) continue;

			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (sourceExts.has(extname(entry.name))) {
				try {
					const content = await readFile(fullPath, "utf-8");
					const lines = content.split("\n");
					for (let i = 0; i < lines.length; i++) {
						if (pattern.test(lines[i])) {
							violations.push(
								`${relPath}:${i + 1}: ${lines[i].trim().slice(0, 120)}`,
							);
						}
					}
				} catch {
					// skip unreadable files
				}
			}
		}
	}

	await walk(packagesRoot + "/packages");
	return violations;
}

// ─── Acceptance Criterion 1: No "playbook" in packages/ ────────────────────

describe("playbooks → skill_candidates: string search", () => {
	it("contains no 'playbook' in packages/ source (CONTEXT.md flagged ambiguity is exempt)", async () => {
		const violations = await findInPackagesSources(/playbook/i, [
			/CONTEXT\.md$/, // flagged ambiguity section is explicitly allowed
			/skill-candidates-rename\.test\.ts$/, // this test file itself uses "playbook" in assertions
		]);
		expect(
			violations,
			`Found "playbook" in ${violations.length} location(s) outside CONTEXT.md:\n${violations.join("\n")}`,
		).toEqual([]);
	});

	it("contains no files named with 'playbook' in packages/", async () => {
		const { readdir } = await import("node:fs/promises");
		const violations: string[] = [];

		async function walk(dir: string): Promise<void> {
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const relPath = dir.replace(packagesRoot + "/", "") + "/" + entry.name;
				if (
					entry.name === "node_modules" ||
					entry.name === "dist" ||
					entry.name === ".pi-lens"
				)
					continue;
				if (entry.name.toLowerCase().includes("playbook")) {
					violations.push(relPath);
				}
				if (entry.isDirectory()) {
					await walk(dir + "/" + entry.name);
				}
			}
		}

		await walk(packagesRoot + "/packages");
		expect(violations).toEqual([]);
	});
});

// ─── Acceptance Criterion 2: LearningKind includes skill_candidates ─────────

describe("LearningKind type contract", () => {
	it("includes 'skill_candidates' in LEARNING_KINDS array", () => {
		expect(LEARNING_KINDS).toContain("skill_candidates" satisfies LearningKind);
	});

	it("does NOT include 'playbooks' in LEARNING_KINDS array", () => {
		const kinds = LEARNING_KINDS as readonly string[];
		expect(kinds).not.toContain("playbooks");
		expect(kinds).not.toContain("PLAYBOOKS");
	});

	it("has exactly the 5 canonical kinds (not 6 with playbooks)", () => {
		const expectedKinds: LearningKind[] = [
			"facts",
			"skill_candidates",
			"mistakes",
			"open_loops",
			"preferences",
		];
		expect([...LEARNING_KINDS].sort()).toEqual([...expectedKinds].sort());
	});
});

// ─── Acceptance Criterion 3: Filename is skill_candidates.jsonl ────────────

describe("LEARNING_FILENAMES contract", () => {
	it("maps 'skill_candidates' key to 'skill_candidates.jsonl'", () => {
		expect(LEARNING_FILENAMES["skill_candidates"]).toBe(
			"skill_candidates.jsonl",
		);
	});

	it("does NOT contain a 'playbooks' key", () => {
		expect(LEARNING_FILENAMES).not.toHaveProperty("playbooks");
	});

	it("does NOT contain 'playbooks.jsonl' as any value", () => {
		const values = Object.values(LEARNING_FILENAMES);
		expect(values).not.toContain("playbooks.jsonl");
		expect(values).not.toContain("PLAYBOOKS.jsonl");
	});
});

// ─── Acceptance Criterion 4: Digester prompt uses SKILL_CANDIDATES ──────────

describe("digester prompt uses SKILL_CANDIDATES (not PLAYBOOKS)", () => {
	it("source file contains SKILL_CANDIDATES in the batch beat prompt", async () => {
		const digesterPath = resolve(
			__dirname,
			"../interaction/analysis/session-digester.ts",
		);
		const source = await readFile(digesterPath, "utf-8");

		// BATCH_BEAT_PROMPT is not exported; verify via source inspection
		// It should contain "SKILL_CANDIDATES" as a category label
		expect(source).toMatch(/SKILL_CANDIDATES/);
		expect(source).not.toMatch(/PLAYBOOKS/i);
	});
});

// ─── Acceptance Criterion 5: Digester TypeScript types use skill_candidates ─

describe("ClassifiedLearnings interface uses skill_candidates field", () => {
	it("source file defines skill_candidates (not playbooks) on ClassifiedLearnings", async () => {
		const digesterPath = resolve(
			__dirname,
			"../interaction/analysis/session-digester.ts",
		);
		const source = await readFile(digesterPath, "utf-8");

		// The interface should have skill_candidates field
		expect(source).toMatch(/skill_candidates\s*:\s*string\[\]/);

		// And NOT have playbooks field
		expect(
			source,
			"ClassifiedLearnings should not define 'playbooks' field",
		).not.toMatch(/playbooks\s*:\s*string\[\]/);
	});

	it("canonical learning kinds in digest loop use skill_candidates", async () => {
		const digesterPath = resolve(
			__dirname,
			"../interaction/analysis/session-digester.ts",
		);
		const source = await readFile(digesterPath, "utf-8");

		// The loop that iterates kinds should include skill_candidates
		expect(source).toMatch(/"skill_candidates"/);

		// ...and NOT "playbooks"
		expect(source).not.toMatch(/"playbooks"/);
	});
});

// ─── Acceptance Criterion 6: CLI help references skill_candidates ───────────

describe("CLI help text references skill_candidates", () => {
	it("sessions CLI source references skill_candidates in --kind option", async () => {
		const sessionsPath = resolve(
			__dirname,
			"../../../sessions/src/sessions.ts",
		);
		const source = await readFile(sessionsPath, "utf-8");

		// The --kind option help text should mention skill_candidates
		expect(source).toMatch(/skill_candidates/);
		expect(source, "CLI help should NOT mention playbooks").not.toMatch(
			/playbook/i,
		);
	});
});

// ─── Acceptance Criterion 7: Phase summaries not pseudo-playbooks ───────────

describe("no playbook terminology in phase/summary code", () => {
	it("digest-related source files never mention playbook", async () => {
		const filesToCheck = [
			"packages/core/src/interaction/analysis/session-digester.ts",
			"packages/core/src/session-record/types.ts",
			"packages/core/src/session-record/learnings-store.ts",
			"packages/sessions/src/sessions.ts",
			"packages/habitat/src/tools/session-tools.ts",
		];

		for (const file of filesToCheck) {
			const fullPath = resolve(packagesRoot, file);
			const source = await readFile(fullPath, "utf-8");
			expect(source, `${file} should not contain "playbook"`).not.toMatch(
				/playbook/i,
			);
		}
	});
});
